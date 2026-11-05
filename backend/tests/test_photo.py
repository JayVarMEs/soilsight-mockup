"""Automatic scale.  Run: python -m pytest tests"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soilsight.photo import estimate_scale  # noqa: E402


def test_known_camera_is_corrected_for_downsized_photos():
    # dataset Samsung photos are 1599x1200, the table value 26.33 is for 9248 px wide
    s = estimate_scale((1599, 1200), 'Samsung_A52_F827_01.jpg')
    assert s['source'] == 'camera' and abs(s['ppm'] - 4.55) < 0.05
    s = estimate_scale((1600, 720), 'Motorola_Edge_H030_01.jpg')
    assert abs(s['ppm'] - 4.60) < 0.05
    assert estimate_scale((4096, 2304), 'Motorola_Edge_60_fusion_H374_01.jpg')['ppm'] == 12.465


def test_photo_info_estimate_close_to_table():
    # an iPhone 14 photo with only the EXIF lens info (26 mm) -> within 5 % of 13.942
    s = estimate_scale((3024, 4032), 'IMG_0001.JPG', {'focal_35mm': 26.0})
    assert s['source'] == 'photo_info' and abs(s['ppm'] / 13.942 - 1) < 0.05


def test_guess_without_any_info():
    s = estimate_scale((4000, 3000), 'photo.jpg', {})
    assert s['source'] == 'guess' and 5 < s['ppm'] < 25
