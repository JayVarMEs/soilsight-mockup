"""Unit tests for the soil maths.  Run: python -m pytest tests"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soilsight.soil import apply_constraints, emd, fractions, soil_type  # noqa: E402


def test_constraints_make_valid_curve():
    raw = np.array([-5, 10, 8, 30, 120, 50, 60, 70, 80, 90, 95.0])
    c = apply_constraints(raw)
    assert c.min() >= 0 and c.max() <= 100
    assert np.all(np.diff(c) >= 0)
    assert c[-1] == 100


def test_emd_zero_for_same_curve_and_positive_otherwise():
    a = np.linspace(0, 100, 11)
    assert emd(a, a)[0] == 0
    assert emd(a, a + 5)[0] > 0


def test_fractions_sum_to_100_and_type_names():
    sand = np.array([0, 1, 2, 3, 20, 70, 98, 100, 100, 100, 100.0])
    f = fractions(sand)
    assert abs(sum(f.values()) - 100) < 1e-6
    assert soil_type(sand) == 'Sand'
    silty_sand = np.array([5, 10, 18, 30, 55, 85, 99, 100, 100, 100, 100.0])
    assert soil_type(silty_sand) == 'Silty sand'
