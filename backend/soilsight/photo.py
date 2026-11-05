"""Reading phone photos: orientation, photo info (EXIF), automatic scale, quality checks.

Scale = pixels per millimetre (px/mm) of the soil surface in the photo.
People don't know it, so we work it out, best source first:

  1. measured   - the user clicked across a coin / card / ruler in the photo
  2. camera     - a phone from the Kaggle camera table (ppm table), corrected for the
                  photo's real pixel size (the dataset's Motorola/Samsung photos are
                  downsized, so the table value must be scaled down too)
  3. photo info - lens focal length (35 mm equivalent) from EXIF + the dataset's shooting
                  distance (about 21.5 cm, worked out from the camera table)
  4. guess      - a typical phone lens (26 mm) at the same distance
"""
import io
import math
import re
import unicodedata
from datetime import datetime

import numpy as np
from PIL import Image, ImageOps

try:  # optional: iPhone HEIC photos
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover
    pass

# Kaggle ppm_updated.csv (ppm is for photos at full size: width x height)
CAMERA_TABLE = [
    {'name': 'iPhone 14', 'keys': ['iphone 14'], 'width': 4032, 'height': 3024, 'ppm': 13.942},
    {'name': 'iPhone 16', 'keys': ['iphone 16'], 'width': 5712, 'height': 4284, 'ppm': 19.525},
    {'name': 'Motorola Edge 20', 'keys': ['motorola edge', 'motorola edge 20'], 'width': 4000, 'height': 1800, 'ppm': 11.492},
    {'name': 'Motorola Edge 60 Fusion', 'keys': ['motorola edge 60 fusion'], 'width': 4096, 'height': 2304, 'ppm': 12.465},
    {'name': 'Samsung A52', 'keys': ['samsung a52', 'sm-a525f'], 'width': 9248, 'height': 6936, 'ppm': 26.33},
]
SHOOT_DISTANCE_MM = 215.0   # iPhone 14: 217, iPhone 16: 220, Edge 60 Fusion: 209 (from the table + EXIF)
DEFAULT_FOCAL_35MM = 26.0   # typical phone main camera
FULL_FRAME_DIAG_MM = math.hypot(36.0, 24.0)


def _squash(text):
    t = unicodedata.normalize('NFC', str(text)).lower()
    return re.sub(r'[^a-z0-9]', '', t)


def _clean(v):
    return str(v).replace('\x00', '').strip() if v is not None else ''


# ------------------------------------------------------------------ reading
def open_photo(data):
    """bytes -> (RGB PIL image turned the right way up, raw EXIF dict)."""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:
        raise ValueError('not a readable image (JPG, PNG or WebP; HEIC needs the pillow-heif package)') from e
    exif = im.getexif()
    im = ImageOps.exif_transpose(im).convert('RGB')
    return im, exif


def photo_info(exif):
    """Camera, lens, date and GPS from EXIF (any of them may be missing)."""
    sub = exif.get_ifd(0x8769) if exif else {}
    gps = exif.get_ifd(0x8825) if exif else {}
    info = {
        'make': _clean(exif.get(271)) if exif else '',
        'model': _clean(exif.get(272)) if exif else '',
        'focal_35mm': float(sub.get(41989)) if sub.get(41989) else None,
        'taken_at': None,
        'gps': None,
    }
    dt = sub.get(36867) or (exif.get(306) if exif else None)
    if dt:
        try:
            info['taken_at'] = datetime.strptime(_clean(dt), '%Y:%m:%d %H:%M:%S').isoformat()
        except ValueError:
            pass
    try:
        def deg(v):
            return float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
        if gps.get(2) and gps.get(4):
            lat, lon = deg(gps[2]), deg(gps[4])
            if _clean(gps.get(1)).upper() == 'S':
                lat = -lat
            if _clean(gps.get(3)).upper() == 'W':
                lon = -lon
            info['gps'] = {'lat': round(lat, 6), 'lon': round(lon, 6)}
    except Exception:
        pass
    return info


# ------------------------------------------------------------------ scale
def find_camera(filename='', info=None):
    """Known dataset camera from the EXIF model or the file name (longest name wins)."""
    text = _squash(f"{(info or {}).get('make', '')} {(info or {}).get('model', '')} {filename}")
    best, best_len = None, 0
    for cam in CAMERA_TABLE:
        for k in cam['keys']:
            n = _squash(k)
            if n in text and len(n) > best_len:
                best, best_len = cam, len(n)
    return best


def estimate_scale(size, filename='', info=None):
    """(width, height) of the upright photo -> {'ppm', 'source', 'camera', 'note'}."""
    w, h = size
    long_px, short_px = max(w, h), min(w, h)
    info = info or {}
    cam = find_camera(filename, info)
    if cam:
        ppm = cam['ppm'] * long_px / max(cam['width'], cam['height'])
        return {'ppm': round(ppm, 3), 'source': 'camera', 'camera': cam['name'],
                'note': f"{cam['name']} is a known camera; scale adjusted to this photo's size ({long_px} px)."}
    focal = info.get('focal_35mm')
    source = 'photo_info' if focal else 'guess'
    focal = focal or DEFAULT_FOCAL_35MM
    # width of the long side in "35 mm equivalent" millimetres for this aspect ratio
    long_equiv = FULL_FRAME_DIAG_MM * long_px / math.hypot(long_px, short_px)
    view_mm = SHOOT_DISTANCE_MM * long_equiv / focal      # real width the photo covers
    ppm = long_px / view_mm
    name = ' '.join(x for x in (info.get('make'), info.get('model')) if x) or None
    note = (f'Estimated from the photo info (lens {focal:g} mm, photo taken about '
            f'{SHOOT_DISTANCE_MM / 10:.0f} cm above the soil).' if source == 'photo_info' else
            f'No lens info in the photo, so a typical phone lens is assumed (about '
            f'{SHOOT_DISTANCE_MM / 10:.0f} cm above the soil).')
    return {'ppm': round(ppm, 3), 'source': source, 'camera': name, 'note': note, 'view_mm': round(view_mm)}


# ------------------------------------------------------------------ quality
def quality_checks(im, ppm):
    """Plain-language warnings about the photo. Returns a list of {'level', 'text'}."""
    small = np.asarray(im.convert('L').resize((max(1, im.width * 800 // max(im.size)),
                                               max(1, im.height * 800 // max(im.size)))), dtype=float)
    out = []
    # sharpness: variance of a Laplacian-like filter
    lap = (np.roll(small, 1, 0) + np.roll(small, -1, 0) + np.roll(small, 1, 1) + np.roll(small, -1, 1) - 4 * small)[2:-2, 2:-2]
    if lap.var() < 25:
        out.append({'level': 'warn', 'text': 'The photo looks blurry. Hold the phone still and tap the soil on the screen to focus.'})
    mean = small.mean()
    if mean < 45:
        out.append({'level': 'warn', 'text': 'The photo is very dark. Take it in daylight or a bright room, without flash.'})
    if (small > 245).mean() > 0.15:
        out.append({'level': 'warn', 'text': 'Part of the photo is too bright (glare). Avoid direct sun or flash on the soil.'})
    short_mm = min(im.size) / ppm
    if short_mm < 100:
        out.append({'level': 'warn', 'text': f'The photo only shows about {short_mm:.0f} mm of soil. Hold the phone higher (about 20 cm) so more soil fits.'})
    if short_mm > 600:
        out.append({'level': 'warn', 'text': 'The photo shows a very large area. Hold the phone closer (about 20 cm above the soil).'})
    if ppm < 4:
        out.append({'level': 'warn', 'text': 'The photo has too few pixels for its size, so small grains are lost. '
                                             'Use the full camera resolution and don\'t zoom out or send a compressed copy.'})
    return out
