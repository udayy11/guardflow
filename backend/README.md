# GuardFlow Backend

FastAPI backend for Android event ingestion, browser-extension page analysis,
and deterministic fraud-risk scoring.

## Active flow

1. Android posts events to `POST /api/v1/events`.
2. URL events are dispatched to the browser extension over `/ws` as
   `ANALYZE_URL`.
3. The extension returns its unchanged `PAGE_ANALYSIS` structured JSON.
4. The backend stores the full JSON in `Event.payload`.
5. `POST /api/v1/score/{session_id}` selects the latest page analysis and
   calculates an explainable score from URL, content, recent behaviour, and
   transaction evidence.

Ollama is paused and is not imported or called by the active scoring route.
The dormant adapter remains in `app/services/llm_service.py` for later use.

## Services

```text
app/services/
├── event_processor.py     # event persistence
├── feature_extractor.py   # normalize extension JSON + Android events
├── website_analyzer.py    # deterministic website observations
├── risk_engine.py         # only scoring authority
└── llm_service.py         # paused future adapter
```

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

For macOS/Linux activation, use `source .venv/bin/activate`.

## Test

```bash
python -m unittest -v
```

The database schema, Android request/response contracts, existing REST paths,
and browser-extension WebSocket protocol are unchanged.
