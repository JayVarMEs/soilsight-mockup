# SoilSight: web app + model API in one container (used by Hugging Face Spaces, works anywhere).
#   docker build -t soilsight . && docker run -p 7860:7860 soilsight   ->  http://localhost:7860
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    TORCH_HOME=/app/.torch HOST=0.0.0.0 PORT=7860
WORKDIR /app

# CPU-only PyTorch (much smaller than the default GPU build)
COPY backend/requirements.txt backend/requirements.txt
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r backend/requirements.txt

# Download the ResNet-34 weights at build time, so the app starts fast
RUN python -c "import torchvision.models as m; m.resnet34(weights=m.ResNet34_Weights.IMAGENET1K_V1)"

COPY index.html favicon.svg ./
COPY css css
COPY js js
COPY backend backend

# Hugging Face runs the container as user 1000
RUN useradd -m -u 1000 app && chown -R app /app
USER app
EXPOSE 7860
CMD ["python", "backend/serve.py"]
