"""Image features, based on the Kaggle notebook
"Soil Grain Size Prediction: Calibrated CV Ensemble" (avikdas567), made scale-aware.

v2 change: every photo is first resized to the SAME real scale (TARGET_PPM px per mm).
Then 1 pixel means the same size of grain for every phone, and photo size no longer matters.
(The notebook cut a fixed 1024-pixel square, which covers a different area of soil on
every phone, and padded the small 1600x720 training photos with black.)

Per photo: 24 hand-made features + 512 ResNet-34 features (averaged over 3 crops).
Photos of the same sample are averaged into one vector.
"""
import cv2
import numpy as np
from scipy.stats import kurtosis, skew

from .constants import N_CV_FEATURES
from .photo import estimate_scale, open_photo, photo_info, quality_checks

TARGET_PPM = 4.5      # px per mm after resizing (the dataset's coarsest photos are ~4.55)
CROP_MM = 150         # side of each square the CNN looks at (fits every training photo)
N_CROPS = 3           # crops along the long side of the photo


# ---------------------------------------------------------------- scale
def to_target_scale(im, ppm):
    """Resize a PIL image so that it has TARGET_PPM pixels per mm."""
    k = TARGET_PPM / ppm
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    return im.resize(size, resample=3 if k < 1 else 2)   # 3 = BICUBIC down, 2 = BILINEAR up


# ---------------------------------------------------------------- hand-made features
def _odd(px):
    px = max(3, int(round(px)))
    return px if px % 2 else px + 1


def surface_features(rgb):
    """24 numbers from an RGB array at TARGET_PPM: colour stats, edges at 1/3/5 mm, roughness."""
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    f = []
    for c in range(3):                      # colour: mean / std / skew of R, G, B   (9)
        ch = rgb[:, :, c].astype(float)
        f += [ch.mean(), ch.std(), skew(ch.ravel())]
    for c in range(3):                      # mean / std of H, S, V                 (6)
        ch = hsv[:, :, c].astype(float)
        f += [ch.mean(), ch.std()]
    for target_mm in (1.0, 3.0, 5.0):       # edges after a blur of 1, 3, 5 mm      (6)
        k = _odd(target_mm * TARGET_PPM)
        blurred = cv2.GaussianBlur(gray, (k, k), 0)
        gx = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=3)
        gy = cv2.Sobel(blurred, cv2.CV_64F, 0, 1, ksize=3)
        mag = np.sqrt(gx ** 2 + gy ** 2)
        f += [mag.mean(), mag.std()]
    g = gray.astype(float)                  # roughness: std in a ~1.5 mm window     (3)
    w = _odd(1.5 * TARGET_PPM)
    mean = cv2.blur(g, (w, w))
    sq = cv2.blur(g ** 2, (w, w))
    local_std = np.sqrt(np.clip(sq - mean ** 2, 0, None))
    f += [local_std.mean(), local_std.std(), kurtosis(local_std.ravel())]
    out = np.array(f, dtype=float)
    assert out.shape == (N_CV_FEATURES,)
    return out


def crops(rgb):
    """N_CROPS squares of CROP_MM (or the short side if smaller) spread along the long side."""
    h, w = rgb.shape[:2]
    s = min(int(CROP_MM * TARGET_PPM), h, w)
    out = []
    for t in np.linspace(0, 1, N_CROPS):
        y = int(round((h - s) * (t if h > w else 0.5)))
        x = int(round((w - s) * (t if w >= h else 0.5)))
        out.append(rgb[y:y + s, x:x + s])
    return out


# ---------------------------------------------------------------- deep features
class DeepEncoder:
    """Frozen ImageNet ResNet-34 -> 512 numbers per crop. No training."""

    def __init__(self, device=None):
        import torch
        import torchvision.models as models

        self.torch = torch
        self.device = torch.device(device or ('cuda' if torch.cuda.is_available() else 'cpu'))
        net = models.resnet34(weights=models.ResNet34_Weights.IMAGENET1K_V1)
        self.net = torch.nn.Sequential(*list(net.children())[:-1]).to(self.device).eval()
        for p in self.net.parameters():
            p.requires_grad = False
        self.mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)

    def encode(self, arrays):
        """List of same-size RGB uint8 arrays -> [n, 512]."""
        t = self.torch
        x = t.from_numpy(np.stack(arrays)).permute(0, 3, 1, 2).float().div(255)
        x = ((x - self.mean) / self.std).to(self.device)
        with t.no_grad():
            emb = self.net(x)
        return t.flatten(emb, 1).float().cpu().numpy()


# ---------------------------------------------------------------- one photo / one sample
def analyse_photo(data, encoder, ppm=None, filename=''):
    """One photo (bytes) -> (536 features, scale info, photo info, warnings).

    ppm: px/mm if the user measured it; otherwise it is worked out automatically.
    """
    im, exif = open_photo(data)
    info = photo_info(exif)
    if ppm:
        scale = {'ppm': round(float(ppm), 3), 'source': 'measured', 'camera': None,
                 'note': 'Scale measured by you (coin, card or ruler in the photo).'}
    else:
        scale = estimate_scale(im.size, filename, info)
    checks = quality_checks(im, scale['ppm'])
    rgb = np.asarray(to_target_scale(im, scale['ppm']))
    cv_f = surface_features(rgb)
    deep_f = encoder.encode(crops(rgb)).mean(axis=0)
    return np.concatenate([cv_f, deep_f]), scale, info, checks


def sample_features(photos, encoder, ppm=None):
    """photos: list of (bytes, filename) of ONE sample -> (averaged vector, per-photo details)."""
    vecs, details = [], []
    for data, name in photos:
        v, scale, info, checks = analyse_photo(data, encoder, ppm, name)
        vecs.append(v)
        details.append({'file': name, 'scale': scale, 'info': info, 'checks': checks})
    return np.mean(vecs, axis=0), details
