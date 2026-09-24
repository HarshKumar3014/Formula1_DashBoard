FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HOME=/home/user \
    F1_DATA_DIR=/home/user/data

# Spaces run the container as uid 1000; everything it writes must be owned by that user.
RUN useradd -m -u 1000 user

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY seed ./seed
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x entrypoint.sh \
    && mkdir -p "$F1_DATA_DIR" \
    && chown -R user:user /srv /home/user

USER user
EXPOSE 7860
CMD ["./entrypoint.sh"]
