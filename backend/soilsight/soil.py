"""Soil maths: physical fix-ups, EMD score, fractions and soil type naming."""
import numpy as np

from .constants import LOG_WIDTHS, SIZES_MM, CLAY_MAX, SILT_MAX, SAND_MAX, GRAVEL_MAX


def apply_constraints(pred):
    """Make curves physically valid: 0-100 %, never going down, 100 % at 200 mm.

    Same rule as the notebook (clip -> running max -> last point = 100).
    Works on one curve (shape [11]) or many (shape [n, 11]).
    """
    p = np.clip(np.array(pred, dtype=float), 0.0, 100.0)
    p = np.maximum.accumulate(p, axis=-1)
    p[..., -1] = 100.0
    return p


def emd(y_true, y_pred):
    """Log-weighted Earth Mover's Distance per sample (lower is better).

    Area between the true and predicted curve on a log10 grain-size axis,
    using the trapezoid rule over the 10 intervals (as in the notebook).
    """
    err = np.abs(np.atleast_2d(y_true) - np.atleast_2d(y_pred))
    return ((err[:, :-1] + err[:, 1:]) / 2.0 * LOG_WIDTHS).sum(axis=1)


def passing_at(curve, d):
    """% passing at grain size d (mm), log-linear interpolation."""
    return float(np.interp(np.log10(d), np.log10(SIZES_MM), curve))


def fractions(curve):
    """Mass % of each ISO 14688 fraction from a cumulative curve."""
    clay = passing_at(curve, CLAY_MAX)
    silt_top = passing_at(curve, SILT_MAX)
    sand_top = passing_at(curve, SAND_MAX)
    gravel_top = passing_at(curve, GRAVEL_MAX)
    return {
        'clay': clay,
        'silt': silt_top - clay,
        'sand': sand_top - silt_top,
        'gravel': gravel_top - sand_top,
        'cobbles': 100.0 - gravel_top,
    }


_NOUN = {'clay': 'Clay', 'silt': 'Silt', 'sand': 'Sand', 'gravel': 'Gravel', 'cobbles': 'Cobbles'}
_ADJ = {'clay': 'Clayey', 'silt': 'Silty', 'sand': 'Sandy', 'gravel': 'Gravelly', 'cobbles': 'Cobbly'}
SECONDARY_MIN = 15.0  # a 2nd fraction above this % gives the name an adjective


def soil_type(curve):
    """Simple ISO-style name: main fraction, plus an adjective for a big 2nd one.

    e.g. 'Sand', 'Silty sand', 'Sandy gravel'.
    """
    f = fractions(curve)
    ranked = sorted(f, key=f.get, reverse=True)
    main, second = ranked[0], ranked[1]
    if f[second] >= SECONDARY_MIN:
        return f'{_ADJ[second]} {_NOUN[main].lower()}'
    return _NOUN[main]


def soil_group(curve):
    """Main soil group only: Gravel, Sand, Silt or Clay (cobbles count as gravel).
    Coarser question than soil_type(), so the model can answer it with much more confidence."""
    f = fractions(curve)
    f['gravel'] += f.pop('cobbles')
    return _NOUN[max(f, key=f.get)]


def coarse_or_fine(curve):
    """Engineering split: coarse soil if less than 50 % passes 0.063 mm."""
    return 'Coarse' if passing_at(curve, SILT_MAX) < 50 else 'Fine'
