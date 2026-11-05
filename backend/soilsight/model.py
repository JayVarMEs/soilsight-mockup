"""The model: 5-fold Ridge ensemble (based on the notebook), plus a confidence step.

Training (fit):
  for each of 5 folds -> scale features, fit Ridge (all 11 points).
  (The notebook also blends in 11 SVRs; RIDGE_WEIGHT=1.0 turns that off, see constants.py.)
  Keep all 5 fold models.
  Out-of-fold (OOF) predictions give an honest score and the error size
  at each sieve point, which we reuse for the confidence %.

Prediction:
  average the 5 fold models -> fix-ups -> curve.
  Confidence = how often the answer stays the same when we add realistic error
  (drawn from the OOF errors) to the curve 1000 times. Given for 3 questions:
  main group (Gravel/Sand/Silt/Clay, the headline), coarse or fine, and the detailed name.
"""
from collections import Counter
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.covariance import LedoitWolf
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR

from .constants import N_FOLDS, RIDGE_ALPHA, RIDGE_WEIGHT, SEED, SIZES_MM, SVR_C, SVR_EPS, TARGET_TRANSFORM, NOISE_SCALE, PHOTO_COUNT_NOISE
from .soil import apply_constraints, coarse_or_fine, emd, soil_group, soil_type

MODEL_NAME = 'ResNet34 + Ridge, scale-normalised'
MODEL_VERSION = '2.1'


def to_target(y):
    """% passing -> the scale Ridge learns on."""
    y = np.asarray(y, float)
    return np.log((y + 1) / (101 - y)) if TARGET_TRANSFORM == 'logit' else y


def from_target(t):
    t = np.asarray(t, float)
    return 101 - 102 / (1 + np.exp(t)) if TARGET_TRANSFORM == 'logit' else t


class SoilModel:
    def __init__(self):
        self.folds = []          # [(scaler, ridge, [svr x11])]
        self.err_mean = None     # OOF error mean per point
        self.err_cov = None      # OOF error covariance (shrunk)
        self.report = {}

    # ------------------------------------------------------------ training
    @staticmethod
    def _fit_fold(X, Y):
        scaler = StandardScaler().fit(X)
        Xs = scaler.transform(X)
        T = to_target(Y)
        ridge = Ridge(alpha=RIDGE_ALPHA, random_state=SEED).fit(Xs, T)
        svrs = [] if RIDGE_WEIGHT >= 1 else [SVR(C=SVR_C, epsilon=SVR_EPS, kernel='rbf').fit(Xs, T[:, k]) for k in range(T.shape[1])]
        return scaler, ridge, svrs

    @staticmethod
    def _fold_predict(fold, X):
        scaler, ridge, svrs = fold
        Xs = scaler.transform(X)
        r = from_target(ridge.predict(Xs))
        s = from_target(np.column_stack([m.predict(Xs) for m in svrs])) if svrs else r
        return r, s

    def fit(self, X, Y, sample_ids=None, log=print):
        X, Y = np.asarray(X, float), np.asarray(Y, float)
        n = len(X)
        kf = KFold(n_splits=min(N_FOLDS, n), shuffle=True, random_state=SEED)
        oof_r, oof_s, oof_base = np.zeros_like(Y), np.zeros_like(Y), np.zeros_like(Y)
        self.folds = []
        for i, (tr, va) in enumerate(kf.split(X)):
            fold = self._fit_fold(X[tr], Y[tr])
            r, s = self._fold_predict(fold, X[va])
            oof_r[va], oof_s[va] = r, s
            oof_base[va] = Y[tr].mean(axis=0)      # naive baseline: average curve
            self.folds.append(fold)
            log(f'  fold {i + 1}/{kf.n_splits}: trained on {len(tr)}, checked on {len(va)}')

        blend = RIDGE_WEIGHT * oof_r + (1 - RIDGE_WEIGHT) * oof_s
        final = apply_constraints(blend)
        scores = {
            'baseline_mean_curve': float(emd(Y, apply_constraints(oof_base)).mean()),
            'ridge': float(emd(Y, oof_r).mean()),
            **({'svr': float(emd(Y, oof_s).mean())} if RIDGE_WEIGHT < 1 else {}),
            'blend': float(emd(Y, blend).mean()),
            'blend_constrained': float(emd(Y, final).mean()),
        }
        # Error model for confidence (shrunk covariance: only ~25 samples)
        resid = Y - final
        self.err_mean = resid.mean(axis=0)
        self.err_cov = LedoitWolf().fit(resid[:, :-1]).covariance_   # last point is always 100
        type_true = [soil_type(y) for y in Y]
        type_pred = [soil_type(p) for p in final]
        self.report = {
            'model': MODEL_NAME, 'version': MODEL_VERSION,
            'trained_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'n_samples': n, 'n_features': X.shape[1], 'n_folds': kf.n_splits,
            'cv_emd': scores,
            'cv_type_accuracy': float(np.mean([a == b for a, b in zip(type_true, type_pred)])),
            'oof_abs_error_per_size': dict(zip([str(s) for s in SIZES_MM], np.abs(resid).mean(axis=0).round(2).tolist())),
            'oof': [
                {'sample_id': str(sid), 'true_type': t, 'pred_type': p, 'emd': float(e)}
                for sid, t, p, e in zip(sample_ids if sample_ids is not None else range(n), type_true, type_pred, emd(Y, final))
            ],
        }
        return self

    # ------------------------------------------------------------ predicting
    def predict_curve(self, X):
        """Average of the 5 fold models -> valid curves. X: [n, features]."""
        X = np.atleast_2d(X)
        preds = []
        for fold in self.folds:
            r, s = self._fold_predict(fold, X)
            preds.append(RIDGE_WEIGHT * r + (1 - RIDGE_WEIGHT) * s)
        members = np.stack(preds)                  # [folds, n, 11]
        return apply_constraints(members.mean(axis=0)), apply_constraints(members)

    def predict(self, x, n_draws=1000, seed=0, n_photos=3):
        """One sample -> curve, uncertainty band, soil type, confidence %.
        n_photos: how many photos were averaged into x (1-2 photos -> wider error)."""
        curve, members = self.predict_curve(x)
        curve, members = curve[0], members[:, 0]
        rng = np.random.default_rng(seed)
        # pick a fold model at random, then add a realistic error
        base = members[rng.integers(len(members), size=n_draws)]
        k = NOISE_SCALE * PHOTO_COUNT_NOISE.get(int(n_photos), 1.0)
        noise = self.err_mean[:-1] + k * rng.multivariate_normal(np.zeros(len(self.err_cov)), self.err_cov, size=n_draws)
        draws = base.copy()
        draws[:, :-1] += noise
        draws = apply_constraints(draws)

        def vote(fn):
            """Share of the 1000 noisy curves giving each answer. Shown answer = most common
            (ties -> answer of the best-guess curve)."""
            counts = Counter(fn(d) for d in draws)
            own = fn(curve)
            top = max(counts, key=lambda t: (counts[t], t == own))
            alts = [{'type': t, 'p': int(round(100 * c / n_draws))} for t, c in counts.most_common() if t != top][:2]
            return {'type': top, 'confidence': int(round(100 * counts[top] / n_draws)), 'alternatives': alts}

        group = vote(soil_group)       # Gravel / Sand / Silt / Clay: when >= 80 %, right 98 % of the time (CV)
        detail = vote(soil_type)       # e.g. Sandy gravel: finer question, lower confidence
        coarse = vote(coarse_or_fine)  # Coarse / Fine: when >= 80 %, right 98 % of the time (CV)
        lo, hi = np.percentile(draws, [10, 90], axis=0)
        return {
            'curve': [[float(d), round(float(p), 1)] for d, p in zip(SIZES_MM, curve)],
            'band': {'lo': np.round(lo, 1).tolist(), 'hi': np.round(hi, 1).tolist()},
            'type': group['type'],
            'confidence': group['confidence'],
            'alternatives': group['alternatives'],
            'detail': detail,
            'coarse': coarse,
        }

    # ------------------------------------------------------------ save / load
    def save(self, path):
        joblib.dump({'folds': self.folds, 'err_mean': self.err_mean, 'err_cov': self.err_cov, 'report': self.report}, path)

    @classmethod
    def load(cls, path):
        d = joblib.load(path)
        m = cls()
        m.folds, m.err_mean, m.err_cov, m.report = d['folds'], d['err_mean'], d['err_cov'], d['report']
        return m
