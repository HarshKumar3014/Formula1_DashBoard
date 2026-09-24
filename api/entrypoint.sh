#!/bin/sh
set -e

# Seed the JSON caches shipped in the image so a cold container serves real data at once.
# Existing files win: on a host with a persistent volume the live cache is newer.
mkdir -p "$F1_DATA_DIR/jsoncache"
for f in seed/jsoncache/*.json; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    [ -e "$F1_DATA_DIR/jsoncache/$name" ] || cp "$f" "$F1_DATA_DIR/jsoncache/$name"
done

# Render (and most PaaS) inject $PORT; locally we default to 8000.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
