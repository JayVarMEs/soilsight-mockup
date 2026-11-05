"""Train the SoilSight model on the Kaggle data.

    python train.py --data PATH_TO_KAGGLE_DATA [--submission]

PATH_TO_KAGGLE_DATA is the unzipped folder from
https://www.kaggle.com/competitions/soil-grain-size-from-photos/data
(it holds ppm.csv, Training_labels_*.csv and the photo folders).

Writes:
    artifacts/model.joblib   the trained model (used by serve.py)
    artifacts/report.json    cross-validation scores
    artifacts/submission.csv Kaggle test predictions (with --submission)
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
import unicodedata
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from soilsight.constants import TARGET_COLUMNS  # noqa: E402
from soilsight.features import DeepEncoder, analyse_photo  # noqa: E402
from soilsight.photo import find_camera  # noqa: E402

FEATURE_VERSION = 'v2-scale4.5'   # change when features change, so the cache is rebuilt
from soilsight.model import SoilModel  # noqa: E402
from soilsight.soil import apply_constraints  # noqa: E402

IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp'}


# ------------------------------------------------------------------ find files
def find_one(root, pattern):
    hits = sorted(glob.glob(str(root / '**' / pattern), recursive=True))
    return Path(hits[0]) if hits else None


def image_dirs(root, prefix):
    """All folders whose name starts with `prefix` and that directly hold images."""
    out = []
    for d in sorted(root.rglob('*')):
        if d.is_dir() and d.name.lower().startswith(prefix.lower()):
            if any(p.suffix.lower() in IMG_EXT for p in d.iterdir()):
                out.append(d)
    return out


def list_images(dirs):
    return sorted({p for d in dirs for p in d.iterdir() if p.suffix.lower() in IMG_EXT})


# ------------------------------------------------------------------ match photo -> sample, camera -> ppm
def norm(text):
    """Make names comparable: 'HPC_Münster_BS6_9,0-10m (1).JPG' and 'HPC_Muenster_BS6_9_0-10m'
    both become plain lower-case letters/digits (ü->ue, spaces/commas/_/- removed)."""
    t = unicodedata.normalize('NFC', str(text)).lower()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        t = t.replace(a, b)
    return re.sub(r'[^a-z0-9]', '', t)


def match_sample(filename, sample_ids):
    """The sample ID appears inside the file name (e.g. Motorola_Edge_H030_01.jpg).
    Longest match wins, so 'H37' can't steal photos of 'H374'."""
    stem = norm(Path(filename).stem)
    hits = [s for s in sample_ids if norm(s) and norm(s) in stem]
    return max(hits, key=lambda s: len(norm(s))) if hits else None


def match_ppm(filename, ppm_df):
    """The camera is the start of the file name (e.g. Motorola_Edge_60_fusion_H374_01.jpg).
    Longest phone/camera name wins, so 'Motorola Edge 60 Fusion' is not read as 'Motorola Edge'."""
    stem = norm(Path(filename).stem)
    best, best_len = None, 0
    for _, row in ppm_df.iterrows():
        for name in (row['phone'], row['camera']):
            n = norm(name)
            if n and n in stem and len(n) > best_len:
                best, best_len = row, len(n)
    if best is not None:
        return float(best['ppm']), str(best['phone'])
    return float(ppm_df['ppm'].mean()), 'unknown (mean ppm)'


def build_table(images, sample_ids, ppm_df):
    rows, skipped = [], []
    for p in images:
        sid = match_sample(p.name, sample_ids)
        if sid is None:
            skipped.append(p.name)
            continue
        cam = find_camera(p.name)
        rows.append({'path': p, 'sample_id': sid, 'camera': cam['name'] if cam else 'unknown'})
    return pd.DataFrame(rows), skipped


# ------------------------------------------------------------------ features with a disk cache
def featurize(table, encoder, cache_dir):
    """Features per photo. The scale (px/mm) is worked out from the camera table AND the
    photo's real pixel size (the dataset's Motorola/Samsung photos are downsized)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    feats, ppms = [], []
    t0 = time.time()
    for i, r in enumerate(table.itertuples()):
        st = r.path.stat()
        key = hashlib.sha1(f'{FEATURE_VERSION}|{r.path.resolve()}|{st.st_size}|{st.st_mtime_ns}'.encode()).hexdigest()
        f = cache_dir / f'{key}.npz'
        if f.exists():
            z = np.load(f)
            v, ppm = z['v'], float(z['ppm'])
        else:
            v, scale, _, _ = analyse_photo(r.path.read_bytes(), encoder, None, r.path.name)
            ppm = scale['ppm']
            np.savez(f, v=v, ppm=ppm)
        feats.append(v)
        ppms.append(ppm)
        if (i + 1) % 10 == 0 or i + 1 == len(table):
            print(f'  {i + 1}/{len(table)} photos ({time.time() - t0:.0f}s)')
    table['ppm_real'] = ppms
    return np.stack(feats)


def pool_by_sample(table, feats, order):
    X, ids = [], []
    for sid in order:
        m = (table['sample_id'] == sid).values
        if m.any():
            X.append(feats[m].mean(axis=0))
            ids.append(sid)
    return np.stack(X), ids


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', required=True, help='Kaggle data folder')
    ap.add_argument('--out', default=str(HERE / 'artifacts'), help='where to save the model')
    ap.add_argument('--submission', action='store_true', help='also write Kaggle submission.csv')
    args = ap.parse_args()

    root, out = Path(args.data), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    labels_csv = find_one(root, 'Training_labels*.csv')
    ppm_csv = find_one(root, 'ppm*.csv')
    if not labels_csv or not ppm_csv:
        sys.exit(f'Could not find Training_labels*.csv and ppm*.csv under {root}')
    labels = pd.read_csv(labels_csv)
    ppm_df = pd.read_csv(ppm_csv)
    sample_ids = labels['sample_id'].astype(str).tolist()

    train_imgs = list_images(image_dirs(root, 'Training'))
    print(f'Labels: {labels_csv.name} ({len(labels)} samples) | photos found: {len(train_imgs)}')
    table, skipped = build_table(train_imgs, sample_ids, ppm_df)
    if skipped:
        print(f'  WARNING: {len(skipped)} photos matched no sample ID, e.g. {skipped[:3]}')
    missing = sorted(set(sample_ids) - set(table.sample_id)) if not table.empty else sample_ids
    if missing:
        print(f'  WARNING: {len(missing)} labelled samples have no photo: {missing[:5]}')
    if table.empty:
        sys.exit('No training photos matched a sample ID.')
    print(f'  matched {len(table)} photos to {table.sample_id.nunique()} samples')
    print('  cameras:', table.camera.value_counts().to_dict())

    print('Loading ResNet-34 ...')
    enc = DeepEncoder()
    print(f'Extracting features on {enc.device} ...')
    feats = featurize(table, enc, out / 'cache')
    print('  real scale (px/mm) per camera:', table.groupby('camera').ppm_real.agg(['min', 'max']).round(2).to_dict('index'))
    X, ids = pool_by_sample(table, feats, sample_ids)
    Y = labels.set_index(labels['sample_id'].astype(str)).loc[ids, TARGET_COLUMNS].to_numpy(float)
    print(f'Training matrix: {X.shape[0]} samples x {X.shape[1]} features')

    print('Cross-validation:')
    model = SoilModel().fit(X, Y, sample_ids=ids)
    rep = model.report
    print('\nEMD (lower is better)')
    for k, v in rep['cv_emd'].items():
        print(f'  {k:22s} {v:8.3f}')
    print(f'Soil type correct (CV): {rep["cv_type_accuracy"] * 100:.0f}%')

    model.save(out / 'model.joblib')
    (out / 'report.json').write_text(json.dumps(rep, indent=2))
    print(f'\nSaved {out / "model.joblib"} and report.json')

    if args.submission:
        sub_csv = find_one(root, 'sample_submission.csv')
        sub = pd.read_csv(sub_csv)
        test_ids = sub['sample_id'].astype(str).tolist()
        test_table, t_skip = build_table(list_images(image_dirs(root, 'Test')), test_ids, ppm_df)
        print(f'Test: {len(test_table)} photos -> {test_table.sample_id.nunique()}/{len(test_ids)} samples'
              + (f', {len(t_skip)} photos unmatched e.g. {t_skip[:3]}' if t_skip else ''))
        tf = featurize(test_table, enc, out / 'cache')
        Xt, tids = pool_by_sample(test_table, tf, test_ids)
        curves, _ = model.predict_curve(Xt)
        pred = dict(zip(tids, curves))
        fallback = apply_constraints(Y.mean(axis=0))   # if a test sample has no photo
        rows = [[sid, *pred.get(sid, fallback)] for sid in test_ids]
        pd.DataFrame(rows, columns=['sample_id', *TARGET_COLUMNS]).to_csv(out / 'submission.csv', index=False)
        print(f'Wrote {out / "submission.csv"} ({len(tids)}/{len(test_ids)} samples had photos)')


if __name__ == '__main__':
    main()
