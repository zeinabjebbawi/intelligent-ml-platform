# PRISM Auto Mode

A LangGraph agentic pipeline that runs the same ML workflow Manual Mode's
pages walk through by hand — an LLM reasons over real, already-computed
numbers at ~12 big-decision points, then the SAME production FastAPI
routers Manual Mode uses execute those decisions in-process. Every real
transformation registers into the SAME Django `DatasetVersion`/`STEP_ORDER`
system Manual Mode uses, so an Auto Mode run is fully visible in the normal
VersionsBar and fully roll-back-able — never a black box.

See `docs/` (the plan this was built from is
`C:\Users\theka\.claude\plans\merry-beaming-whistle.md` if it's still
around) for the full architecture writeup — this file is just the
practical "how do I run it" reference.

## Install

Already installed into `backend-fastapi/venv` as part of building this —
if setting up a fresh environment:

```
pip install -r requirements.txt
```

(`langgraph`, `langgraph-checkpoint-sqlite`, `langchain-core`,
`langchain-anthropic`, `langchain-openai`, `httpx` were added on top of the
pre-existing dependencies.)

## Configure

Add to `backend-fastapi/.env` (already gitignored — never commit real keys;
this repo's `.env` currently has a real Gemini key in it, see below):

```
AUTOMODE_LLM_PROVIDER=anthropic        # or "openai" or "gemini"
ANTHROPIC_API_KEY=sk-ant-...           # if provider=anthropic
# AUTOMODE_ANTHROPIC_MODEL=claude-sonnet-4-5   (optional override)
OPENAI_API_KEY=sk-...                  # if provider=openai
# AUTOMODE_OPENAI_MODEL=gpt-4o-mini            (optional override)
GOOGLE_API_KEY=...                     # if provider=gemini (Google AI Studio)
# AUTOMODE_GEMINI_MODEL=gemini-3.6-flash       (optional override)
```

Currently configured provider in this repo: **deepseek**, model
`deepseek-v4-flash` (switch `AUTOMODE_LLM_PROVIDER` back to `gemini` to
use the other live-tested key already in `.env` — both work).

### A real, non-obvious finding: structured-output method is provider-specific

`with_structured_output()`'s right `method` argument is NOT one-size-fits-all
— found empirically by actually running the same `GoalDecision` schema
against each real key added to this project, not assumed:

- **gemini**: both the library default and explicit `method="function_calling"`
  work fine.
- **deepseek** (`deepseek-v4-flash` specifically is a reasoning/"thinking"
  model): the default strict-JSON-schema mode fails outright
  (`"This response_format type is unavailable now"`), and
  `method="function_calling"` *also* fails (`"Thinking mode does not
  support this tool_choice"` — DeepSeek's thinking models reject a
  *forced* tool choice, which is exactly how function-calling mode
  guarantees structured output). Only `method="json_mode"` works — and
  even then, only once the exact field names are spelled out in the
  prompt text itself via `PydanticOutputParser.get_format_instructions()`,
  since `json_mode` (unlike a tool call) carries no schema alongside the
  request — without that, the model returns valid JSON with genuinely
  good reasoning but *invented* field names (e.g. `"metric"` instead of
  `"optimization_goal"`).

`llm.py`'s `decide()` now keys the right method off `AUTOMODE_LLM_PROVIDER`
via `_STRUCTURED_METHOD`. **anthropic/openai are still unverified** — no
real key for either has been tested against this project yet — defaulted
to `"function_calling"` as the most broadly-supported guess; verify
empirically the same way before trusting it, if either is used for real.

The pre-existing `DEEPSEEK_API_KEY` placeholder in `.env.example` predates
Auto Mode — it's the same variable name Auto Mode itself now reads, so
that placeholder is accurate, just previously unused by any real code.

## Run

Same three servers as always (Django :8080, FastAPI :8001, React :5173) —
Auto Mode is a router registered on the existing FastAPI app, not a
separate service. Restart FastAPI after adding the `.env` keys above.

```
POST http://127.0.0.1:8001/auto-mode/run
{
  "project_id": "<uuid>", "jwt_token": "<access_token from localStorage>",
  "file_path": "<the uploaded CSV's path>", "task_type": "classification",
  "target_column": "Outcome", "user_intent": "optional free text"
}
→ { "run_id": "<uuid>" }

GET http://127.0.0.1:8001/auto-mode/status/{run_id}
→ { status, interrupt, current_node, completed_nodes, final_summary, error }
  status ∈ running | paused_hitl | paused_restart | completed | aborted | failed

POST http://127.0.0.1:8001/auto-mode/resume/{run_id}
{ "jwt_token": "...", "action": "approve" | "edit" | "reject", "payload": {}, "reason": "" }
```

From the frontend: click "🤖 Run Auto Mode" on the Upload page once a
dataset + target/task are set — see `frontend/src/components/AutoModePanel.jsx`.

## What's structurally verified vs. what still needs a live run

Verified directly during development (see the conversation this was built
in for the exact commands):
- Every router function tools.py calls exists with the exact signature
  used (confirmed by `main.py` importing cleanly — a wrong name/signature
  would have failed at import time).
- The LangGraph `interrupt()` / `Command(resume=...)` mechanics used in
  `nodes.py`/`runner.py` were tested against the actually-installed
  `langgraph` version with a minimal standalone graph before writing the
  real one — `graph.invoke()` returns `{"__interrupt__": [Interrupt(value=...)]}`
  when paused, `graph.invoke(Command(resume=value), config)` resumes it.
- The full 20-node graph compiles, and its edge list matches the intended
  design exactly (`diagnose → clean_duplicates → ... → eval_metrics
  →{retry_train|sample|feature_select|explain}`, etc. — printed and
  checked node-by-node, not just "it didn't error").
- Django migration applied cleanly to the real dev Postgres database; the
  4 new REST endpoints' URL names resolve correctly (`reverse()` tested).
- Frontend (`npm run build`) compiles cleanly with the new panel + api.js
  additions wired into `App.jsx`.

**Verified live with two real keys** — Gemini (`gemini-3.6-flash`, Google
AI Studio) and DeepSeek (`deepseek-v4-flash`): `get_llm()` authenticates
and responds for both; `decide()`'s real structured-output path returns a
correctly-typed Pydantic instance for both, tested against the actual
`GoalDecision` schema/prompt — given a synthetic severely-imbalanced
`is_fraud` target, both independently proposed `maximize_recall`, citing
the real evenness/minority-count numbers they were given, not generic
advice. This confirms the one mechanism every one of the ~12 decision
nodes depends on actually works end to end — and, in the process,
surfaced that the *method* has to differ per provider (see above).

**Not yet verified — needs a full run against a real dataset through the
frontend panel**:
- A complete pipeline run start-to-finish (all ~12 decision points, not
  just one in isolation), and the full HITL approve/edit/reject flow
  through the real `AutoModePanel.jsx`.
- The `paused_restart` recovery path (kill FastAPI mid-run, restart it,
  confirm the run reappears as `paused_restart` rather than silently
  vanishing or double-resuming).
- Whether the elbow-knn/elbow-kmeans computation stays comfortably fast
  enough on a real, larger dataset to not make the "context gathering
  before the LLM call" pattern feel slow.

Recommended first real test: a small (few hundred row), clean-ish
classification dataset with an obvious target — minimizes how many of the
~12 decision points actually have something interesting to decide, so a
first pass mostly exercises the plumbing rather than judging the LLM's
judgement calls.
