# Build context is the repo root (so the precomputed JSON caches can be baked in):
#   docker build -f api/Dockerfile .
FROM python:3.12-slim

WORKDIR /srv

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app ./app
COPY api/entrypoint.sh ./entrypoint.sh
# Seed data: hosts without a persistent disk start empty on every deploy/restart.
COPY data/jsoncache ./seed/jsoncache

RUN chmod +x entrypoint.sh

ENV F1_DATA_DIR=/data
VOLUME /data

EXPOSE 8000
CMD ["./entrypoint.sh"]
