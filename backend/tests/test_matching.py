"""File-name matching on the real Kaggle naming style.  Run: python -m pytest tests"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train import match_ppm, match_sample  # noqa: E402

PPM = pd.DataFrame([('iPhone 14', 'iPhone 14', 13.942), ('iPhone 16', 'iPhone 16', 19.525),
                    ('Motorola Edge', 'motorola edge 20', 11.492),
                    ('Motorola Edge 60 Fusion', 'Motorola Edge 60 fusion', 12.465),
                    ('Samsung A52', 'SM-A525F', 26.33)], columns=['phone', 'camera', 'ppm'])


def test_camera_longest_name_wins():
    assert match_ppm('Motorola_Edge_60_fusion_H374_01.jpg', PPM)[0] == 12.465
    assert match_ppm('Motorola_Edge_H030_01.jpg', PPM)[0] == 11.492
    assert match_ppm('iPhone16_HPC_Airbus BS6-3 (2).JPG', PPM)[0] == 19.525
    assert match_ppm('Samsung_A52_X_01.jpg', PPM)[0] == 26.33


def test_sample_ids_with_umlaut_and_comma():
    ids = ['HPC_Muenster_BS6_9_0-10m', 'HPC_Audorfring', 'HPC_Airbus BS6-3']
    assert match_sample('iPhone14_HPC_Münster_BS6_9,0-10m (3).JPG', ids) == 'HPC_Muenster_BS6_9_0-10m'
    assert match_sample('iPhone16_HPC_Airbus BS6-3 (2).JPG', ids) == 'HPC_Airbus BS6-3'


def test_longest_id_wins():
    assert match_sample('Motorola_Edge_H374_01.jpg', ['H37', 'H374']) == 'H374'
