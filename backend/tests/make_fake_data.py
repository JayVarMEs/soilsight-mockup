"""Make a small FAKE dataset with the same layout as the Kaggle data.

Only for testing the code path when the real data is not downloaded yet.
Photos are random grains whose size matches the label, so the model
has something to learn. Scores on this data mean nothing.

    python tests/make_fake_data.py OUT_DIR
"""
import sys
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soilsight.constants import SIZES_MM, TARGET_COLUMNS  # noqa: E402

# Same table and file-name style as the real Kaggle data (Nov 2026 update)
PPM_ROWS = [('iPhone 14', 'iPhone 14', 4032, 3024, 13.942), ('iPhone 16', 'iPhone 16', 5712, 4284, 19.525),
            ('Motorola Edge', 'motorola edge 20', 4000, 1800, 11.492),
            ('Motorola Edge 60 Fusion', 'Motorola Edge 60 fusion', 4096, 2304, 12.465),
            ('Samsung A52', 'SM-A525F', 9248, 6936, 26.33)]
TRAIN_CAMS = [('Motorola_Edge', 11.492), ('Motorola_Edge_60_fusion', 12.465)]


def curve_for(d50, spread):
    """Smooth cumulative curve (log-normal) with median d50 mm."""
    from scipy.stats import norm
    p = norm.cdf((np.log10(SIZES_MM) - np.log10(d50)) / spread) * 100
    p[-1] = 100.0
    return np.round(p, 2)


def photo(d50, ppm, rng, size=1100):
    img = np.full((size, size, 3), rng.integers(90, 140), np.uint8)
    r_px = max(1, int(d50 * ppm / 2))
    n = int(min(4000, 0.6 * size * size / (np.pi * r_px ** 2 + 1)))
    for _ in range(n):
        c = tuple(int(v) for v in rng.integers(0, size, 2))
        r = max(1, int(r_px * rng.lognormal(0, 0.4)))
        col = tuple(int(v) for v in rng.integers(40, 220, 3))
        cv2.circle(img, c, r, col, -1)
    return cv2.GaussianBlur(img, (3, 3), 0)


def main(out):
    out = Path(out)
    rng = np.random.default_rng(0)
    tr = out / 'Training-All_Photos_updated' / 'Training-All_Photos_updated'
    te = out / 'Test_All_Photos' / 'Test_All_Photos'
    tr.mkdir(parents=True, exist_ok=True)
    te.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(PPM_ROWS, columns=['phone', 'camera', 'width', 'height', 'ppm']).to_csv(out / 'ppm_updated.csv', index=False)

    rows = []
    for i in range(25):
        sid = f'H{100 + i}'
        d50 = 10 ** rng.uniform(-1.5, 1.0)
        rows.append([sid, *curve_for(d50, rng.uniform(0.4, 0.9))])
        tag, ppm = TRAIN_CAMS[i % 2]
        for k in range(2):
            cv2.imwrite(str(tr / f'{tag}_{sid}_{k + 1:02d}.jpg'), photo(d50, ppm, rng))
    pd.DataFrame(rows, columns=['sample_id', *TARGET_COLUMNS]).to_csv(out / 'Training_labels_updated.csv', index=False)

    # sample IDs vs file names differ like the real data (ü -> ue, ',' -> '_')
    tests = {'HPC_Audorfring': 'iPhone14_HPC_Audorfring (1).JPG',
             'HPC_Muenster_BS6_9_0-10m': 'iPhone14_HPC_Münster_BS6_9,0-10m (1).JPG',
             'HPC_Airbus BS6-3': 'iPhone16_HPC_Airbus BS6-3 (2).JPG'}
    test_ids = list(tests)
    for sid, fname in tests.items():
        ok, buf = cv2.imencode('.jpg', photo(10 ** rng.uniform(-1.5, 1.0), 14.0, rng))
        (te / fname).write_bytes(buf.tobytes())   # imwrite can't handle 'ü' on Windows
    pd.DataFrame([[s, *[0] * 11] for s in test_ids], columns=['sample_id', *TARGET_COLUMNS]).to_csv(out / 'sample_submission.csv', index=False)
    print(f'Fake dataset written to {out}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'fake_data')
