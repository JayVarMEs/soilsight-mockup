"""Makes 3 Kaggle submission files to test why the public score (61.4) is much worse than the
cross-validation score (37.6).

What we found: the training photos are small (Motorola 1600x720, Samsung 1599x1200, JPEG quality
about 75) but the test photos are full-size iPhone photos (4032x3024 or 5712x4284, JPEG quality about 92).
After we resize both to the same scale, they still look different (sharpness, JPEG noise).
Variant "trainlike" shrinks each test photo to 1600 px and saves it as JPEG quality 75 first,
so it looks like the training photos.

    python research/submit_variants.py --data "C:\\400\\3.resource\\soil-grain-size-from-photos"

Writes backend/artifacts/submission_A.csv, submission_B.csv, submission_C.csv
  A = trainlike photos + Ridge alpha 150 (current setting)
  B = trainlike photos + Ridge alpha 1000
  C = normal photos    + Ridge alpha 1000
"""
import argparse
import io
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import train as T                                   # noqa: E402
import soilsight.model as M                         # noqa: E402
from soilsight.soil import apply_constraints       # noqa: E402
from soilsight.constants import TARGET_COLUMNS      # noqa: E402
from soilsight.features import DeepEncoder, analyse_photo  # noqa: E402
from soilsight.photo import estimate_scale, open_photo, photo_info  # noqa: E402

LONG_SIDE, JPEG_Q = 1600, 75


def trainlike_features(path, enc):
    data = path.read_bytes()
    im, exif = open_photo(data)
    scale = estimate_scale(im.size, path.name, photo_info(exif))
    k = LONG_SIDE / max(im.size)
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.BICUBIC)
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=JPEG_Q)
    v, *_ = analyse_photo(buf.getvalue(), enc, ppm=scale['ppm'] * min(k, 1.0), filename=path.name)
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    a = ap.parse_args()
    root, out = Path(a.data), HERE / 'artifacts'
    labels = pd.read_csv(T.find_one(root, 'Training_labels*.csv'))
    ppm_df = pd.read_csv(T.find_one(root, 'ppm*.csv'))
    sample_ids = labels['sample_id'].astype(str).tolist()
    enc = DeepEncoder()

    table, _ = T.build_table(T.list_images(T.image_dirs(root, 'Training')), sample_ids, ppm_df)
    feats = T.featurize(table, enc, out / 'cache')
    X, ids = T.pool_by_sample(table, feats, sample_ids)
    Y = labels.set_index(labels['sample_id'].astype(str)).loc[ids, TARGET_COLUMNS].to_numpy(float)

    sub = pd.read_csv(T.find_one(root, 'sample_submission.csv'))
    test_ids = sub['sample_id'].astype(str).tolist()
    tt, _ = T.build_table(T.list_images(T.image_dirs(root, 'Test')), test_ids, ppm_df)
    print('normal test photos ...')
    f_norm = T.featurize(tt, enc, out / 'cache')
    print('train-like test photos ...')
    f_like = np.stack([trainlike_features(p, enc) for p in tt['path']])
    Xn, tids = T.pool_by_sample(tt, f_norm, test_ids)
    Xl, _ = T.pool_by_sample(tt, f_like, test_ids)
    print('distance of test photos from the training photos (smaller = more similar):')
    mu, sd = X.mean(0), X.std(0) + 1e-6
    for nm, Z in (('normal', Xn), ('train-like', Xl)):
        print(f'  {nm:10s} mean z-distance {np.abs((Z - mu) / sd).mean():.3f}   (training samples: {np.abs((X - mu) / sd).mean():.3f})')

    fallback = None
    for name, Xt, alpha in (('A', Xl, 150.0), ('B', Xl, 1000.0), ('C', Xn, 1000.0)):
        M.RIDGE_ALPHA = alpha
        model = M.SoilModel().fit(X, Y, sample_ids=ids, log=lambda *x: None)
        curves, _ = model.predict_curve(Xt)
        pred = dict(zip(tids, curves))
        fallback = apply_constraints(Y.mean(axis=0))
        rows = [[s, *pred.get(s, fallback)] for s in test_ids]
        f = out / f'submission_{name}.csv'
        pd.DataFrame(rows, columns=['sample_id', *TARGET_COLUMNS]).to_csv(f, index=False)
        print('wrote', f, '| CV EMD', round(model.report['cv_emd'].get('blend_constrained', float('nan')), 1))
    print('Done. Submit A first.')


if __name__ == '__main__':
    main()
