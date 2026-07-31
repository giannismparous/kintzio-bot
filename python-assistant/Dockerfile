# Adapted from chios-forum-app/Dockerfile. No OCR/PDF/TTS system deps — those
# modules were dropped (see ARCHITECTURE_NOTES.md §2).
FROM python:3.13-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app:/app/src

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build the index at image build time so the container starts ready. Corpus is
# baked in; re-deploy after corpus changes (or run `manage.py ingest` on boot).
RUN python manage.py ingest || echo "index build deferred to runtime"

EXPOSE 8020
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8020/api/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8020"]
