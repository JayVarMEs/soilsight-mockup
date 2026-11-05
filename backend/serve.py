"""SoilSight API + web app.

    python serve.py            # http://localhost:8000

GET  /api/health    is the model loaded? + its CV scores
POST /api/inspect   form-data: files -> photo info, automatic scale, photo warnings (fast)
POST /api/predict   form-data: files (1-10 photos of ONE sample); optional ppm or ppms
                    (px/mm; left out = worked out automatically from each photo)

    set HOST=0.0.0.0 && python serve.py    # also reachable from phones on the same Wi-Fi
Everything else serves the web app from the folder above this one.
"""
import json
import logging
import os
import socket
import sys
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from soilsight.features import analyse_photo  # noqa: E402
from soilsight.photo import estimate_scale, open_photo, photo_info, quality_checks  # noqa: E402
from soilsight.constants import RELIABILITY_AT_80  # noqa: E402
from soilsight.model import MODEL_NAME, MODEL_VERSION, SoilModel  # noqa: E402

MODEL_PATH = Path(os.environ.get('SOILSIGHT_MODEL', HERE / 'artifacts' / 'model.joblib'))
WEB_DIR = HERE.parent
MAX_FILES, MAX_BYTES = 10, 20 * 1024 * 1024
logging.basicConfig(level=logging.INFO, format='%(asctime)s  %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('soilsight')

@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=get_model, daemon=True).start()   # load the model in the background
    yield


app = FastAPI(title='SoilSight API', version=MODEL_VERSION, lifespan=lifespan)
# Lets the app on GitHub Pages call a locally running API
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['GET', 'POST'], allow_headers=['*'])

_state = {'model': None, 'encoder': None, 'error': None}
_lock = threading.Lock()


def get_model():
    with _lock:
        if _state['model'] is None and _state['error'] is None:
            if not MODEL_PATH.exists():
                _state['error'] = f'No trained model at {MODEL_PATH}. Run train.py first.'
            else:
                try:
                    from soilsight.features import DeepEncoder
                    _state['model'] = SoilModel.load(MODEL_PATH)
                    _state['encoder'] = DeepEncoder()
                    log.info('model ready')
                except Exception as e:  # e.g. no internet for the first ResNet download
                    log.exception('could not load the model')
                    _state['model'] = None
                    _state['error'] = f'Could not load the model: {e}'
    return _state['model'], _state['encoder']


@app.get('/api/health')
def health():
    # Never wait here: while the model is still loading, say so and let the app ask again
    if _state['model'] is None:
        if _state['error']:
            return {'ok': False, 'error': _state['error']}
        if _lock.locked():
            return {'ok': False, 'loading': True, 'error': 'The model is still loading…'}
    model, _ = get_model()
    if model is None:
        return {'ok': False, 'error': _state['error']}
    r = model.report
    return {
        'ok': True, 'model': f'{MODEL_NAME} v{MODEL_VERSION}',
        'trained_at': r.get('trained_at'), 'n_samples': r.get('n_samples'),
        'cv_emd': r.get('cv_emd', {}).get('blend_constrained'),
        'cv_emd_baseline': r.get('cv_emd', {}).get('baseline_mean_curve'),
        'cv_type_accuracy': r.get('cv_type_accuracy'),
        'reliability_at_80': RELIABILITY_AT_80,
    }


def _read_files(files):
    if not 1 <= len(files) <= MAX_FILES:
        raise HTTPException(422, f'Send 1 to {MAX_FILES} photos')
    out = []
    for f in files:
        data = f.file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f'{f.filename} is larger than 20 MB')
        out.append((data, f.filename or 'photo.jpg'))
    return out


def _parse_ppms(ppm, ppms, n):
    """One px/mm for all photos (ppm), or one per photo (ppms = JSON list, 0/null = automatic)."""
    if ppms:
        try:
            vals = [float(v) if v else None for v in json.loads(ppms)]
        except Exception:
            raise HTTPException(422, 'ppms must be a JSON list of numbers')
        if len(vals) != n:
            raise HTTPException(422, 'ppms needs one value per photo')
    else:
        vals = [ppm] * n
    for v in vals:
        if v is not None and not 0.5 <= v <= 200:
            raise HTTPException(422, 'Scale must be between 0.5 and 200 px/mm')
    return vals


# Plain "def" (not async): FastAPI runs these in a worker thread, so one slow
# prediction does not freeze the rest of the app.
@app.post('/api/inspect')
def inspect(files: list[UploadFile] = File(...)):
    """Fast check of photos before predicting: photo info, automatic scale, warnings."""
    out = []
    for data, name in _read_files(files):
        try:
            im, exif = open_photo(data)
        except ValueError as e:
            out.append({'file': name, 'error': str(e)})
            continue
        info = photo_info(exif)
        scale = estimate_scale(im.size, name, info)
        out.append({'file': name, 'width': im.width, 'height': im.height, 'info': info,
                    'scale': scale, 'checks': quality_checks(im, scale['ppm'])})
    return {'photos': out}


@app.post('/api/predict')
def predict(files: list[UploadFile] = File(...), ppm: Optional[float] = Form(None), ppms: Optional[str] = Form(None)):
    model, encoder = get_model()
    if model is None:
        raise HTTPException(503, _state['error'] or 'Model not loaded')
    photos = _read_files(files)
    vals = _parse_ppms(ppm, ppms, len(photos))
    t0 = time.time()
    vecs, details = [], []
    for (data, name), v in zip(photos, vals):
        try:
            x, scale, info, checks = analyse_photo(data, encoder, v, name)
        except ValueError as e:
            raise HTTPException(422, f'Could not read {name}: {e}')
        except Exception as e:  # never fail silently
            log.exception('prediction failed on %s', name)
            raise HTTPException(500, f'Something went wrong with {name}: {e}')
        vecs.append(x)
        details.append({'file': name, 'scale': scale, 'info': info, 'checks': checks})
    out = model.predict(np.mean(vecs, axis=0), n_photos=len(vecs))
    out['model'] = f'{MODEL_NAME} v{MODEL_VERSION}'
    out['photos'] = details
    log.info('predicted %d photo(s) in %.1fs -> %s %s%%', len(photos), time.time() - t0, out['type'], out['confidence'])
    return out


# Web app: only index.html, favicon, css/ and js/ (never backend/ or the model file)
app.mount('/css', StaticFiles(directory=WEB_DIR / 'css'), name='css')
app.mount('/js', StaticFiles(directory=WEB_DIR / 'js'), name='js')


@app.get('/', include_in_schema=False)
def index():
    return FileResponse(WEB_DIR / 'index.html')


@app.get('/favicon.svg', include_in_schema=False)
def favicon():
    return FileResponse(WEB_DIR / 'favicon.svg')


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))   # no data is sent; just picks the Wi-Fi address
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == '__main__':
    import uvicorn
    host, port = os.environ.get('HOST', '127.0.0.1').strip(), int(os.environ.get('PORT', 8000))
    print(f'\n  SoilSight on this computer:  http://localhost:{port}')
    if host == '0.0.0.0' and lan_ip():
        print(f'  SoilSight on your phone:     http://{lan_ip()}:{port}   (same Wi-Fi)')
    print('  Keep this window open. Press Ctrl+C to stop.\n')
    uvicorn.run(app, host=host, port=port, log_level='warning')
