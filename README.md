# SoilSight — soil grain size from photos (DES400)

A web app that predicts the **grain size distribution of soil from a phone photo**, plus the soil type in plain words and a confidence %.
Users don't need to know the scale, a ruler or any soil terms: SoilSight reads the photo and fills in the details.
It is built on the Kaggle task [Predicting Soil Grain Size Distributions from Images](https://www.kaggle.com/competitions/soil-grain-size-from-photos),
starting from the notebook
[Soil Grain Size Prediction: Calibrated CV Ensemble](https://www.kaggle.com/code/avikdas567/soil-grain-size-prediction-calibrated-cv-ensemble).

```
 phone photo(s) of ONE sample
        │
        ├─► photo info (EXIF): phone, lens, date, GPS  ──► auto-fill place + date
        ├─► scale (px per mm), best source first:
        │     1. measured: user taps across a coin / card in the photo
        │     2. known phone (Kaggle table), corrected for the photo's real size
        │     3. lens info + ~20 cm shooting distance   (within 3 % on the dataset's phones)
        │     4. typical phone lens guess
        ├─► photo checks: blurry, dark, glare, too close / too far
        ▼
 resize every photo to the SAME real scale: 4.5 px per mm
        ├─► 24 image features (colour, edges at 1/3/5 mm, roughness)
        ├─► 512 ResNet-34 features (ImageNet, frozen), average of 3 crops of 150 mm
        ▼
 average over the photos → 536 numbers
        ▼
 5 fold Ridge models (on a logit scale) → average → fix-ups (0–100 %, never down, 100 % at 200 mm)
        ▼
 % passing at 11 sizes (0.002 … 200 mm)
        ▼
 soil type + confidence: add realistic error 1000× (from cross-validation),
 count how often each soil type comes out
```

## Results (24 lab-tested samples, 5-fold cross-validation, EMD: lower is better)

| Version | EMD |
|---|---|
| Guess the average curve | 88.5 |
| v1: notebook method (fixed 1024 px crop, Ridge + SVR) | 58.3 |
| v2: same real scale for every photo, Ridge only | 41.9 |
| **v2.1: + predict the curve on a logit scale** | **37.6** |

**What else was tried** (10–20 random sample-grouped 5-fold splits, average EMD; v2 = 39.0):

| Idea | EMD | Kept? |
|---|---|---|
| Logit scale for the curve (stretched near 0 % / 100 %) | **35.7**, better on 20/20 splits | ✅ |
| One training row per photo instead of per sample | 36.2 | no (same, slower) |
| Grain-size spectrum features (band-pass energy 0.25–16 mm, morphological granulometry) | 35.7 | no (no gain on top of logit) |
| ResNet-34 middle layers (layer 2–3 texture statistics) | 36.9 | no |
| ResNet-50 / ConvNeXt-Tiny (ImageNet-22k) / DINOv2 ViT-S | 41.7 / 39.6 / 40.0 | no: bigger models are worse with 24 samples |

**Photos per sample matters:** 1 photo EMD 41.6, 2 photos 37.1, 3 photos 36.1, all ~5 photos 35.5. The app asks for 2–5 photos and widens the confidence for 1–2 photos.

Over 10 random 5-fold splits, Ridge alone beat the notebook's 50/50 Ridge + SVR mix 10 times out of 10 (39.5 vs 47.3), so the SVR is off (`RIDGE_WEIGHT` in `constants.py`).

**How much can you trust the confidence %?** Checked on the 24 lab samples, each predicted by a model that never saw it (5 random splits):

| Question the app answers | When it says ≥ 80 %, it was right | Samples where it is that sure |
|---|---|---|
| Main group: Gravel / Sand / Silt / Clay (**headline**) | **98 %** | 38 % |
| Coarse or fine soil | **98 %** | 50 % |
| Detailed name, e.g. *Sandy gravel* | – (never that sure) | 0 % |

So the app shows the main group as the big answer, with coarse/fine and the detailed name below it. The % is not pushed up artificially: it comes from adding the model's measured error (× 1.5, `NOISE_SCALE`, chosen so the % matches reality) to the curve 1000 times. Re-check after retraining with `python research/calibrate.py PATH_TO_DATA`.

**Does it work with any phone?** Same photo, made to look like a different phone (10 training photos, EMD change, lower = more stable):

| Test | v1 | v2 |
|---|---|---|
| phone with 2× the pixels | 36.8 | **6.1** |
| phone with half the pixels | 28.2 | 25.0 (too few pixels per mm, can't be fixed; the app warns) |
| scale wrong by −20 % / +20 % | – | 21 / 13 |

**Why v1 failed on new phones:** the dataset's training photos are downsized (Motorola 1600×720, Samsung 1599×1200), but the camera table gives the scale for the full-size photos (4000 and 9248 px wide). Their real scale is about 4.6 px/mm, not 11.5 / 26.3. Test photos (iPhones) are full size, at 14–20 px/mm. A fixed 1024-pixel crop then shows a different amount of soil on every phone. v2 corrects the scale for the photo size and resizes every photo to 4.5 px/mm first.

## Use it online (no install)

The app can run 24/7 on **Hugging Face Spaces** (free). After the one-time setup below, every `git push` to `main` updates the live app automatically.

```
 git push ──► GitHub Actions (.github/workflows/deploy.yml) ──► Hugging Face Space (Docker)
                                                                  └─► https://<hf-user>-soilsight.hf.space
```

**One-time setup (5 minutes):**
1. Make a free account at https://huggingface.co/join.
2. Go to https://huggingface.co/settings/tokens → **Create new token** → type **Write** → copy it (starts with `hf_`).
3. On GitHub, open this repo → **Settings → Secrets and variables → Actions → New repository secret**. Name: `HF_TOKEN`, value: the token.
4. Open the **Actions** tab → **Deploy to Hugging Face Spaces** → **Run workflow**.
5. When it's green, the log shows the app address, e.g. `https://yourname-soilsight.hf.space`. The first start takes about 3–5 minutes (Hugging Face builds the container).

Notes: the free Space sleeps after 48 hours without visitors and wakes up when someone opens it (about 1 minute). Photos are analysed in memory and not saved; history stays in each user's own browser.
## Run it with Docker (no Python install)

Every push to `main` also publishes a ready-made image to GitHub Packages (`.github/workflows/container.yml`), so you don't have to build it:

```bash
docker run -p 7860:7860 ghcr.io/jayvarmes/soilsight:latest     # then open http://localhost:7860
```

Or from this folder (Windows: double-click `backend\\start-docker.bat`):

```bash
docker compose up                                    # the app, http://localhost:7860
docker compose run --rm train                        # retrain on ../soil-grain-size-from-photos
set SOIL_DATA=C:\\400\\data && docker compose run --rm train   # photos somewhere else (Windows cmd)
```

Training in the container gives the same model as on the PC (CV EMD 37.6). The new model is saved to `backend/artifacts/` and the app uses it after a restart.

## Run it on your own computer

**Easiest (Windows):** double-click `backend\start.bat`. The first time it installs the Python packages (a few minutes), then it opens http://localhost:8000. Keep the black window open.

**From a phone:** double-click `backend\start-phone.bat` instead. The window shows an address like `http://192.168.1.20:8000`. Open it on a phone on the same Wi-Fi and tap **Take photo**. (If Windows asks about the firewall, allow *Private networks*.)

**By hand** (Python 3.10+):

```bash
cd backend
pip install -r requirements.txt
python serve.py                 # this computer only
set HOST=0.0.0.0 && python serve.py   # also phones on the same Wi-Fi (Windows cmd)
```

To read iPhone HEIC photos directly, also `pip install pillow-heif` (phones usually send JPG anyway).

### Train again (only needed if you change the model)

**1. Get the data** — sign in to Kaggle, open the
[competition data page](https://www.kaggle.com/competitions/soil-grain-size-from-photos/data),
accept the rules, click **Download all** and unzip it, for example to `C:\400\data`.

**2. Train** (a few minutes on CPU; ResNet weights download the first time)

```bash
python train.py --data C:\400\data --submission
```

It prints the cross-validation score and saves `backend/artifacts/model.joblib`,
`report.json` and a Kaggle `submission.csv`.

The badge in the top bar says **Live model** when the server works, **Starting…** while the model loads, and **Demo mode** when the server is off (results are then marked **simulated**).

To use the GitHub Pages copy with your local API, open
`https://<user>.github.io/soilsight-mockup/?api=http://localhost:8000`.

**Try it without the Kaggle data** (checks that the code runs; scores mean nothing):

```bash
python tests/make_fake_data.py fake_data
python train.py --data fake_data
python -m pytest tests
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Is the model loaded? + CV scores |
| POST | `/api/inspect` | Form-data `files` → per photo: size, photo info (phone, lens, date, GPS), automatic `scale` (`ppm`, `source`, `note`), `checks` (plain-language warnings). Fast, no model. |
| POST | `/api/predict` | Form-data `files` (1–10 photos of one sample, ≤ 20 MB each); optional `ppm` (one px/mm for all) or `ppms` (JSON list, one per photo, `null` = automatic) → `curve`, `band` (10–90 % range), `type`, `confidence`, `alternatives`, `photos` (scale + checks used) |

## Reading the scores

`train.py` prints EMD for each step (lower is better):

| Line | Meaning |
|---|---|
| `baseline_mean_curve` | Always guess the average curve. The model must beat this. |
| `ridge`, `blend` | Ridge alone, and the Ridge/SVR mix set by `RIDGE_WEIGHT` (1.0 = Ridge only) |
| `blend_constrained` | Final model after the fix-ups. This is the main number. |

With only 24 training samples the score moves a lot between runs and folds. Treat it as rough.

## Changes from the notebook

- **Scale-aware:** every photo is resized to 4.5 px/mm before features, and the camera-table scale is corrected for downsized photos (see *Results*). Edges are measured at real 1/3/5 mm sizes, the CNN sees 3 crops of 150 mm.
- **Ridge only** instead of the Ridge + SVR mix (better on 10/10 random splits).
- **Automatic scale for any phone** from the photo info, plus a coin/card tool in the app; photo quality checks.
- One shared feature code for training and the app, so a photo is handled the same way in both.
- Works with the **updated Kaggle data (Nov 2026)**: `Training_labels_updated.csv` (24 samples), `ppm_updated.csv`, `Training-All_Photos_updated/`.
- Camera → px/mm: picks the **longest** camera name in the file name, so `Motorola_Edge_60_fusion_…` gets 12.465 px/mm, not the Edge 20's 11.492 (the notebook's rule mixes them up).
- Photo → sample: names are compared without spaces/commas/umlauts, so `iPhone14_HPC_Münster_BS6_9,0-10m (1).JPG` matches the ID `HPC_Muenster_BS6_9_0-10m` (the notebook's rule misses it). The longest ID wins, so `H37` can't take photos of `H374`.
- Photos are read as bytes, so names with `ü` also work on Windows.
- Fixed: on a bad image the notebook returned 25 zeros while real vectors have 24 features.
- Test samples with no photo fall back to the average training curve (notebook used a straight line).
- Added soil type naming (ISO 14688 style, e.g. *Silty sand*), confidence %, and a likely-range band.
- The notebook's text mentions "nested CV" and "isotonic" fitting. The code actually does plain 5-fold CV and a running max. This repo does the same as the code.

## Project structure

```
index.html, css/, js/       web app (no build step)
  js/data.js                soil maths, API client, demo fallback, history storage
  js/chart.js               SVG curve + likely-range band
  js/app.js                 screens: home, upload (auto-fill, coin tool), result (plain words), history
backend/
  start.bat, start-phone.bat  double-click to run with Python (this PC / also phones on Wi-Fi)
  start-docker.bat          double-click to run with Docker Desktop
  soilsight/photo.py        photo info (EXIF), automatic scale, photo quality checks
  soilsight/features.py     image features at a fixed real scale (based on the notebook)
  soilsight/model.py        Ridge fold ensemble, confidence
  soilsight/soil.py         fix-ups, EMD score, fractions, soil type
  train.py                  train on the Kaggle data
  serve.py                  FastAPI: /api/* + serves the web app
  tests/                    unit tests + fake data maker
design-system/soilsight/    design system (ui-ux-pro-max)
docs/screenshots/           screenshots
```

## Design

Generated with the **ui-ux-pro-max** skill (see `design-system/soilsight/MASTER.md`): earth green `#15803D`,
harvest gold `#A16207`, Fira Sans + Fira Code, 44 px touch targets, visible focus, chart with a data-table fallback,
responsive 375 → 1440 px.
