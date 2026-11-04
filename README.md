# Henry Listens

**An advising appointment becomes the compliance record.**

Live: https://henry-listens.netlify.app — press **Watch a sample appointment** (no microphone needed), or **Start** to run a live one.

Built solo for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026), Indie track, theme "Build for Your World." Everything in this repository was built during the event.

## The problem, firsthand

I am a Designated School Official (DSO): the person at a university who keeps international students in legal status and keeps the school's federal certification. Every advising appointment should end in a written note: what the student said, what the regulation says, what I told them, what has to happen in SEVIS and by when. That note is the record the school stands on in a federal review. In practice it is the first thing cut when the line is out the door.

## What it does

Henry sits in on the meeting. The room never sees a transcript; it sees **the record building itself**:

1. **Listens.** Muse Voice Transcribe streams the appointment live with speaker labels (`DIARIZATION` mode). A short setup ritual binds each voice to a role (student, adviser) from the words people say, so nobody configures anything.
2. **Redacts before anything leaves the room.** A name spoken in the intro goes straight into a redaction ledger; SEVIS IDs, passport numbers, phone numbers, emails and spoken digit runs are caught by deterministic code in the relay. The hosted model only ever sees tokens like `[STUDENT]` and `[SEVIS_ID]`. The ledger never leaves the relay process.
3. **Drafts as an agent, after every turn.** Muse Spark 1.3 re-reads the redacted meeting so far and rewrites the record as strict JSON (structured output against `docs/record.schema.json`), calling tools in parallel as it needs them:
   - `search_sources` / `ask_henry` — [HenryKnows](https://henryknows.info), a free regulatory reference over 500+ primary sources (8 CFR, SEVP guidance, USCIS policy), called over MCP. A citation is accepted only if its URL actually came back from a search in this session; anything else is marked unverified.
   - `compute_dates` — a deterministic date engine. The model never writes a date. OPT filing window, grace period, CPT dates, the 12-month full-time CPT counter, the "authorize before the start date" deadline, and conflicts (CPT running past the program end date) all come from code, each tagged with the rule it applied.
4. **Shows the record as it grows.** Issue cards appear as issues come up and get their citation a beat later; dates land on a calendar strip; the SEVIS checklist fills in with owner and deadline; "still to confirm" collects what the adviser must check. The redacted transcript is one click away in the Evidence drawer.
5. **The adviser signs.** At the end, adviser and student click through the cards together (confirm, edit, strike). Only then does the adviser sign, and only then can anything be exported: the case note, a plain-language summary for the student, and the SEVIS action checklist, each as a printable PDF, plus the JSON record.

The rule that makes it safe: **the model drafts and cites; code computes every consequence; the adviser decides.** Nothing goes to SEVIS or to the student automatically.

## Meta tooling used

| Model / API | How |
|---|---|
| `muse-voice-transcribe-1.0`, realtime WebSocket | Live diarized transcription; speaker events are mapped to turns by audio span; role binding from the setup ritual |
| `muse-spark-1.3`, Responses API | Agent loop per completed turn: parallel function calls (`search_sources`, `ask_henry`, `compute_dates`), `previous_response_id` chaining, strict `json_schema` structured output, reasoning effort medium |

A typical 60-second appointment costs about nine Spark calls and ~35k tokens.

## Run it

```
cp .env.example .env        # MODEL_API_KEY=... (dev.meta.ai)
npm install
npm run dev                 # http://localhost:8787
```

- **Live:** press Start, allow the microphone, and let each person introduce themselves as student or adviser.
- **Replay a recording through the real pipeline:** `http://localhost:8787/?src=/test/dialog3.wav` (two synthetic macOS voices; this is also the test harness, because Chrome's fake-microphone flag delivers silence).
- **Static sample, no relay:** `http://localhost:8787/?sample=cpt` replays a recorded event stream and the same audio. This is what the public site plays when the relay is asleep or out of credit.
- **Mic-free transcription test:** `npm run test:voice -- web/test/dialog3.wav`.
- Record Henry's spoken lines in your own voice at `/record.html`.

The relay holds the API key; the browser never sees it. `MAX_SESSIONS_PER_DAY` (60) and a 20-minute session cap keep a public deployment inside the hackathon credit.

## Deploy

- **Stage (static):** Netlify, `netlify deploy --prod`. A one-line function (`netlify/functions/relay-config.mjs`) tells the page where the relay is via the `RELAY_URL` environment variable.
- **Relay (WebSocket):** any Node host. `Dockerfile` + `render.yaml` for Render's free tier; set `MODEL_API_KEY` there.

## Architecture

```
browser (mic or replay, the stage)  ──PCM16 24 kHz, 80 ms frames──▶  relay (Node, holds the key)
        ▲                                                                │
        │  events: turn (redacted), role_bound, activity, record+delta   ├─▶ wss://api.meta.ai/v1/asr/realtime  (Voice Transcribe, diarization)
        │                                                                ├─▶ redaction ledger (names from the intro, ID patterns, spoken digits)
        └────────────────────────────────────────────────────────────────┤
                                                                         └─▶ agent, per turn: POST /v1/responses (Spark 1.3, tools, json_schema)
                                                                                 ├─▶ henryknows.info/mcp  (search_sources, ask_henry)
                                                                                 └─▶ relay/dates.mjs     (compute_dates)
```

Files: `relay/server.mjs` (HTTP + WebSocket bridge, cost guard, event log) · `relay/asr-upstream.mjs` (one Voice Transcribe session) · `relay/session.mjs` (roles, redaction, phases) · `relay/redact.mjs` (ledger) · `relay/agent.mjs` (Spark loop + diff) · `relay/henry.mjs` (HenryKnows MCP client) · `relay/dates.mjs` (date rules) · `web/app.js` (the stage, review, exports, sample replay) · `docs/record.schema.json`.

## What was built during the hackathon, and what was not

Everything in this repository is new. [HenryKnows](https://henryknows.info) is a pre-existing public service the agent calls as an external tool, the same way it would call any API; none of its code is here. The date rules in `relay/dates.mjs` were re-implemented for this project from the regulation text they cite. Not built: reading the student's I-20 PDF into the session, and a Muse Glimmer open-weight redaction pass; both are listed in `docs/PLAN.md` as the next steps.

## Synthetic only

No real student appears anywhere, including test fixtures. The sample appointment is two macOS voices reading a script; the student's name in it is invented. On free Meta credits, content may be used for product improvement, which is another reason nothing real ever goes through this.

## License

MIT
