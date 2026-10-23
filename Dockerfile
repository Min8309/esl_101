# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app

COPY requirements-youtube.txt ./
# Optional trust bundle is used only by managed build environments, never saved.
RUN --mount=type=secret,id=proxy_ca \
    apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && python3 -m venv /opt/venv \
    && if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements-youtube.txt \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node package.json index.html server.mjs server-path.mjs youtube-transcript.mjs ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node scripts/youtube_transcript.py ./scripts/youtube_transcript.py

ENV NODE_ENV=production \
    PORT=10000 \
    PYTHON_BIN=/opt/venv/bin/python
USER node
EXPOSE 10000
CMD ["node", "server.mjs"]
