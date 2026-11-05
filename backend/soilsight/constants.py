"""Shared constants. Sieve sizes follow the Kaggle task (DIN EN ISO 14688-1)."""
import numpy as np

# % passing is predicted at these 11 grain sizes (mm)
SIZES_MM = np.array([0.002, 0.0063, 0.02, 0.063, 0.2, 0.63, 2.0, 6.3, 20.0, 63.0, 200.0])
# Column names used in the Kaggle CSV files
TARGET_COLUMNS = ['0.002', '0.0063', '0.02', '0.063', '0.2', '0.63', '2', '6.3', '20', '63', '200']
# Width of each interval on a log10 axis (used by the EMD score)
LOG_WIDTHS = np.diff(np.log10(SIZES_MM))

# ISO 14688-1 fraction boundaries (mm)
CLAY_MAX, SILT_MAX, SAND_MAX, GRAVEL_MAX = 0.002, 0.063, 2.0, 63.0

SEED = 42
N_FOLDS = 5
RIDGE_ALPHA = 150.0
SVR_C, SVR_EPS = 10.0, 0.1
# Share of Ridge in the Ridge/SVR mix. 1.0 = Ridge only: it beat the 50/50 mix on 10 of 10
# random 5-fold splits (EMD 39.5 vs 47.3), so the SVR is switched off.
RIDGE_WEIGHT = 1.0
# Ridge predicts the curve on a logit scale (stretched near 0 % and 100 %), then converts back.
# Beat predicting % directly on 20 of 20 fresh random 5-fold splits (EMD 35.7 vs 39.0).
TARGET_TRANSFORM = 'logit'
# Confidence calibration: the error added to the curve is widened by this factor, chosen so that
# the % matches reality (CV on the 24 samples: answers shown at >= 80 % were right 98 % of the time).
NOISE_SCALE = 1.5
RELIABILITY_AT_80 = 98
# Fewer photos = bigger error (CV EMD: 1 photo 41.6, 2 photos 37.1, 3 photos 36.1, all 35.5),
# so the error used for the confidence is widened for 1-2 photos.
PHOTO_COUNT_NOISE = {1: 1.17, 2: 1.05}   # shown in the app; re-check with research/calibrate.py after retraining
N_CV_FEATURES = 24      # hand-made features per photo
N_DEEP_FEATURES = 512   # ResNet-34 embedding size
