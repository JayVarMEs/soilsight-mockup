"""Physical-scale texture model + extrapolation anchor (SoilSight v3 experiment).

Why: on Kaggle our CNN model scored 61 (public), while public notebooks that measure texture in
millimetres and extrapolate to soils coarser than the training set score about 22.
The test soils (e.g. cobbles at Muenster) are coarser than anything in the 24 training samples, and a
Ridge model cannot go beyond its training range.

Ideas follow the public notebook "Soil PSD - Physics, Not Deep Learning" by Sadam Torres (Apache-2.0,
Kaggle): features in millimetres, ridge on logit-PCA curves, leave-one-sample-out and site-grouped
validation, and a one-feature quantile model that extrapolates for coarse soils.
The code below is our own implementation. We do NOT use their manual 'clean sand' prior (it is a hand
judgement about test photos).

    python research/physical_model.py --data "C:\\400\\3.resource\\soil-grain-size-from-photos"
Writes artifacts/submission_phys.csv and prints validation scores.
"""
import argparse
import io
import pickle
import re
import sys
import time
import unicodedata
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from PIL import Image
from sklearn.decomposition import PCA
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
from soilsight.photo import estimate_scale, open_photo, photo_info  # noqa: E402

PPM = 4.5                         # common scale, px per mm
BANDS_MM = [0.25, 0.5, 1, 2, 4, 8, 16, 32]
WIN_MM = [1, 2, 4, 8, 16]
SUPPORT = np.array([0.002, 0.0063, 0.02, 0.063, 0.2, 0.63, 2, 6.3, 20, 63, 200])
COLS = ['0.002', '0.0063', '0.02', '0.063', '0.2', '0.63', '2', '6.3', '20', '63', '200']
W = np.diff(np.log10(SUPPORT))


def emd(Y, P):
    return (np.abs(Y - P)[:, :-1] * W).sum(1)


def norm(t):
    t = unicodedata.normalize('NFC', str(t)).lower()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        t = t.replace(a, b)
    return re.sub(r'[^a-z0-9]', '', t)


def match(name, ids):
    s = norm(Path(name).stem)
    hit = [i for i in ids if norm(i) and norm(i) in s]
    return max(hit, key=lambda i: len(norm(i))) if hit else None


# ---------------------------------------------------------------- photo -> common scale crop
def prepare(path):
    im, exif = open_photo(path.read_bytes())
    ppm = estimate_scale(im.size, path.name, photo_info(exif))['ppm']
    a = np.asarray(im.convert('RGB'))
    k = PPM / ppm
    a = cv2.resize(a, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
    h, w = a.shape[:2]
    a = a[int(.1 * h):int(.9 * h), int(.1 * w):int(.9 * w)]          # drop the border / tray edge
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, 'JPEG', quality=75)                  # same compression as the training photos
    return np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert('RGB'))


# ---------------------------------------------------------------- features in millimetres
def features(rgb):
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gn = g / (cv2.GaussianBlur(g, (0, 0), 15 * PPM) + 1e-3)           # remove uneven light
    f, prev = {}, cv2.GaussianBlur(gn, (0, 0), 0.125 * PPM)
    for s in BANDS_MM:
        cur = cv2.GaussianBlur(gn, (0, 0), s * PPM)
        f[f'dog_{s}'] = float(np.sqrt(np.mean((prev - cur) ** 2)))
        prev = cur
    tot = sum(f[f'dog_{s}'] for s in BANDS_MM) + 1e-9
    for s in BANDS_MM:
        f[f'dogfrac_{s}'] = f[f'dog_{s}'] / tot
    w = np.array([f[f'dog_{s}'] for s in BANDS_MM])
    f['centroid'] = float((w * np.log2(BANDS_MM)).sum() / w.sum())    # texture scale: bigger = coarser soil
    for wm in WIN_MM:
        k = int(wm * PPM) | 1
        mu, mu2 = cv2.blur(gn, (k, k)), cv2.blur(gn * gn, (k, k))
        f[f'lstd_{wm}'] = float(np.sqrt(np.maximum(mu2 - mu * mu, 0)).mean())
    mag = np.hypot(cv2.Sobel(gn, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(gn, cv2.CV_32F, 0, 1, ksize=3))
    f.update(grad_mean=float(mag.mean()), grad_p90=float(np.percentile(mag, 90)), grad_p99=float(np.percentile(mag, 99)),
             grad_cv=float(mag.std() / (mag.mean() + 1e-9)))
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    f.update(L_mean=float(lab[..., 0].mean()), L_std=float(lab[..., 0].std()),
             a_mean=float(lab[..., 1].mean()), b_mean=float(lab[..., 2].mean()))
    return f


def tiles(rgb, tile_mm=70, max_tiles=6):
    t = int(tile_mm * PPM)
    h, w = rgb.shape[:2]
    if h < t or w < t:
        return []
    ys = np.linspace(0, h - t, max(1, h // t)).astype(int)
    xs = np.linspace(0, w - t, max(1, w // t)).astype(int)
    out = [rgb[y:y + t, x:x + t] for y in ys for x in xs]
    if len(out) > max_tiles:
        out = [out[i] for i in np.linspace(0, len(out) - 1, max_tiles).astype(int)]
    return out


def project(P):
    P = np.clip(np.atleast_2d(P), 0, 100)
    out = np.array([IsotonicRegression(y_min=0, y_max=100).fit_transform(np.arange(11), p) for p in P])
    out[:, -1] = 100
    return out


# ---------------------------------------------------------------- models
class LogitPCARidge:
    def __init__(self, alpha=30.0, n_pc=3):
        self.alpha, self.n_pc = alpha, n_pc

    def fit(self, X, Y):
        p = np.clip(Y / 100, 0.005, 0.995)
        Z = np.log(p / (1 - p))
        self.sc = StandardScaler().fit(X)
        self.pca = PCA(self.n_pc).fit(Z)
        T = self.pca.transform(Z)
        Xs = self.sc.transform(X)
        self.m = [Ridge(alpha=self.alpha).fit(Xs, T[:, j]) for j in range(self.n_pc)]
        return self

    def predict(self, X):
        Xs = self.sc.transform(X)
        T = np.column_stack([m.predict(Xs) for m in self.m])
        return 100 / (1 + np.exp(-self.pca.inverse_transform(T)))


LEVELS = np.array([2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98])
LOGD = np.log10(SUPPORT)
LO, HI = np.log10(0.0005), np.log10(200)


def to_quantiles(y):
    yy = np.maximum.accumulate(np.concatenate([[0], y]) + np.arange(12) * 1e-6)
    return np.interp(LEVELS, yy, np.concatenate([[LO], LOGD]))


def from_quantiles(q):
    xx = np.maximum.accumulate(np.concatenate([[LO], np.sort(q), [HI]]) + np.arange(len(q) + 2) * 1e-6)
    return np.interp(LOGD, xx, np.concatenate([[0], LEVELS, [100]]))


class Anchor:
    """One feature (texture scale) -> grain-size quantiles in log-diameter. Linear, so it can extrapolate."""
    def fit(self, x, Y):
        self.sc = StandardScaler().fit(x)
        Q = np.array([to_quantiles(y) for y in Y])
        self.m = [Ridge(alpha=0.1).fit(self.sc.transform(x), Q[:, j]) for j in range(Q.shape[1])]
        return self

    def predict(self, x):
        Q = np.column_stack([m.predict(self.sc.transform(x)) for m in self.m])
        return np.array([from_quantiles(q) for q in Q])


def site_groups(ids):
    order = sorted(ids, key=lambda s: (s[0], int(s[1:])))
    site, g, prev = {}, 0, None
    for s in order:
        if prev is None or s[0] != prev[0] or int(s[1:]) - int(prev[1:]) > 12:
            g += 1
        site[s] = g
        prev = s
    return site


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', default=str(HERE / 'artifacts'))
    ap.add_argument('--budget', type=float, default=1e9, help='stop after this many seconds; run again to continue')
    a = ap.parse_args()
    root = Path(a.data)
    lab = pd.read_csv(next(root.rglob('Training_labels*.csv')))
    lab['sample_id'] = lab['sample_id'].astype(str)
    lab.columns = ['sample_id'] + COLS
    L = lab.set_index('sample_id')
    sub = pd.read_csv(next(root.rglob('sample_submission.csv')))
    test_ids = sub['sample_id'].astype(str).tolist()

    cache_f = Path(a.out) / 'physical_features.pkl'            # resume after a stop
    done = pickle.loads(cache_f.read_bytes()) if cache_f.exists() else {}
    t0 = time.time()
    for split, pat, ids in (('train', 'Training*', list(L.index)), ('test', 'Test*', test_ids)):
        files = sorted(p for d in root.glob(pat) if d.is_dir() for p in d.rglob('*') if p.suffix.lower() in ('.jpg', '.jpeg'))
        for i, p in enumerate(files):
            if p.name in done:
                continue
            sid = match(p.name, ids)
            if sid is None:
                done[p.name] = []
                continue
            rgb = prepare(p)
            r = [dict(split=split, sample_id=sid, tile=-1, **features(rgb))]
            r += [dict(split=split, sample_id=sid, tile=t, **features(ti)) for t, ti in enumerate(tiles(rgb))]
            done[p.name] = r
            if time.time() - t0 > a.budget:
                cache_f.write_bytes(pickle.dumps(done))
                print(f'STOPPED EARLY: {len(done)} photos done. Run the same command again to continue.')
                return
        print(f'  {split}: {len(files)} photos ready', flush=True)
    cache_f.write_bytes(pickle.dumps(done))
    rows = [r for v in done.values() for r in v]
    F = pd.DataFrame(rows)
    cols = [c for c in F.columns if c not in ('split', 'sample_id', 'tile')]
    tr = F[F.split == 'train'].merge(lab, on='sample_id')
    te = F[F.split == 'test']
    print('features:', len(cols), '| train rows', len(tr), '| test rows', len(te))

    def make():
        return LogitPCARidge(30.0, 3)

    sids = sorted(tr.sample_id.unique())
    pred = {}
    for s in sids:                                                   # leave one sample out
        A, B = tr[tr.sample_id != s], tr[tr.sample_id == s]
        p = project(make().fit(A[cols].values, A[COLS].values).predict(B[cols].values)).mean(0)
        pred[s] = project(p)[0]
    e_loso = pd.Series(emd(L.loc[sids, COLS].values, np.array([pred[s] for s in sids])), index=sids)
    site = site_groups(sids)
    pred2 = {}
    for g in sorted(set(site.values())):
        hold = [s for s in sids if site[s] == g]
        A, B = tr[~tr.sample_id.isin(hold)], tr[tr.sample_id.isin(hold)]
        pb = pd.DataFrame(project(make().fit(A[cols].values, A[COLS].values).predict(B[cols].values)), index=B.sample_id.values).groupby(level=0).mean()
        for s in pb.index:
            pred2[s] = project(pb.loc[[s]].values)[0]
    e_site = pd.Series(emd(L.loc[sids, COLS].values, np.array([pred2[s] for s in sids])), index=sids)
    print(f'LOSO EMD {e_loso.mean():.1f} | site-grouped EMD {e_site.mean():.1f} | (our CNN model: 37.6)')

    main_m = make().fit(tr[cols].values, tr[COLS].values)
    tp = pd.DataFrame(project(main_m.predict(te[cols].values)), columns=COLS).assign(sample_id=te.sample_id.values)
    P_main = tp.groupby('sample_id')[COLS].mean()
    P_main = pd.DataFrame(project(P_main.values), index=P_main.index, columns=COLS)

    trf, tef = tr[tr.tile == -1], te[te.tile == -1]
    anc = Anchor().fit(trf[['centroid']].values, trf[COLS].values)
    pa = pd.DataFrame(project(anc.predict(tef[['centroid']].values)), columns=COLS).assign(sample_id=tef.sample_id.values)
    P_anc = pa.groupby('sample_id')[COLS].mean()
    P_anc = pd.DataFrame(project(P_anc.values), index=P_anc.index, columns=COLS)
    c_max = trf.groupby('sample_id').centroid.mean().max()
    c_test = tef.groupby('sample_id').centroid.mean()
    w_anchor = ((c_test - c_max) / 0.5).clip(0, 1)
    P = P_main.mul(1 - w_anchor, axis=0) + P_anc.mul(w_anchor, axis=0)
    P = pd.DataFrame(project(P.values), index=P.index, columns=COLS)
    P['63'] = P['63'].clip(lower=85)                                 # training samples never go below 92 % at 63 mm
    P['200'] = 100.0
    print(pd.DataFrame({'texture_scale': c_test.round(2), 'train_max': round(c_max, 2), 'anchor_weight': w_anchor.round(2)}).to_string())

    fallback = project(L[COLS].values.mean(0))[0]
    out = pd.DataFrame([[s, *(P.loc[s].values if s in P.index else fallback)] for s in test_ids], columns=['sample_id'] + COLS)
    f = Path(a.out) / 'submission_phys.csv'
    out.to_csv(f, index=False)
    pd.DataFrame({'loso': e_loso, 'site': e_site}).round(1).to_csv(Path(a.out) / 'physical_cv.csv')
    print('wrote', f)
    print(out.set_index('sample_id').round(0).astype(int).to_string())


if __name__ == '__main__':
    main()
