#!/bin/sh
set -e

# Free Spaces have no persistent disk: the container starts empty every time.
# Seed the JSON cache baked into the image so the dashboard has data immediately;
# the scheduler refreshes it and the Fast-F1 cache rebuilds from the network on demand.
mkdir -p "$F1_DATA_DIR/jsoncache"
for f in seed/jsoncache/*.json; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    [ -e "$F1_DATA_DIR/jsoncache/$name" ] || cp "$f" "$F1_DATA_DIR/jsoncache/$name"
done

exec uvicorn app.main:app --host 0.0.0.0 --port 7860
