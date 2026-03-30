FROM node:24-alpine AS web-build

WORKDIR /repo

COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN corepack enable
RUN pnpm install --filter @bananas31/web...

COPY apps/web ./apps/web

RUN pnpm --filter @bananas31/web build


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV BANANAS31_WEB_DIST=/app/web-dist

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn

COPY services/api/app ./app
COPY --from=web-build /repo/apps/web/dist /app/web-dist

EXPOSE 8010

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
