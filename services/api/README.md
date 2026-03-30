# services/api

API service for history, analytics, replay context, and operator summaries.

Data priority:

- `BANANAS31_DB_PATH` when set explicitly
- `services/api/data/aggdash.db` when a recovered local copy exists
- `/app/data/aggdash.db` inside the preview container

`services/api/data/sample.db` remains an explicit seed artifact for scripted cold starts only. Runtime code no longer falls back to it automatically.

Planned responsibilities:

- normalized history endpoints
- replay context endpoints
- derived analytics endpoints
- health and release smoke endpoints
