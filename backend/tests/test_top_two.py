import numpy as np
from soilsight.model import SoilModel


def _fake(n=30, f=40, seed=0):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, f))
    base = np.linspace(5, 100, 11)
    Y = np.clip(base + rng.normal(scale=6, size=(n, 11)) + X[:, :1] * 4, 0, 100)
    Y = np.maximum.accumulate(np.clip(Y, 0, 100), axis=1)
    Y[:, -1] = 100
    return X, Y


def test_predict_has_top_two():
    X, Y = _fake()
    m = SoilModel().fit(X, Y, log=lambda *_: None)
    out = m.predict(X[0])
    t = out['top_two']
    assert 1 <= len(t['types']) <= 2
    assert 0 <= t['confidence'] <= 100
    if out['type'] in t['types']:
        assert t['types'][0] == out['type']
    # two groups together can never be less sure than the one group the app shows
    if len(t['types']) == 2 and out['type'] in t['types']:
        assert t['confidence'] >= out['confidence'] - 5
