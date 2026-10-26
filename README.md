# Henry Listens

An advising appointment becomes the compliance record.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Indie track, theme "Build for Your World."

## The problem, firsthand

A Designated School Official (DSO) keeps international students in legal status and keeps the school's federal certification. Every advising appointment should end in a written note: what the student said, what the regulation says, what the adviser told them, what has to happen in SEVIS and by when. That note is the record the school stands on in a federal review. In practice it is the first thing cut when the line is out the door.

## What it does

1. **Listens.** Muse Voice Transcribe streams the appointment live with speaker labels (`DIARIZATION` mode), so the student's facts and the adviser's statements are separated as they are spoken.
2. **Redacts before anything leaves the room.** Names, SEVIS IDs, passport numbers, and dates of birth are replaced with tokens by deterministic code in the relay. The hosted model only ever sees tokens. (Stretch: a Muse Glimmer open-weight pass on Modal as a second, add-only redactor.)
3. **Drafts as an agent.** Muse Spark 1.3 runs with tools: `search_sources` and `ask_henry` (HenryKnows, a free regulatory reference over 500+ primary sources), `compute_dates` (a deterministic date engine), and the student's I-20 as a PDF in the same session.
4. **Returns the record, structured.** Three JSON objects to a schema: the adviser's case note with every regulatory claim cited, a plain-language summary for the student, and a SEVIS action checklist with deadlines.
5. **The adviser signs.** The model drafts and cites; it never decides. Every deadline and status consequence is computed in code and shown with its source. Nothing goes to SEVIS or the student automatically.

## What was built during the hackathon

Everything in this repository. HenryKnows (henryknows.info) is a pre-existing public service that the agent calls as an external tool, the same way it would call any API; none of its code is here. The date rules in `relay/dates.js` are re-implemented for this project from the regulation text they cite.

## Meta tooling used

- `muse-voice-transcribe-1.0` over `wss://api.meta.ai/v1/asr/realtime` (diarization, endpointing)
- `muse-spark-1.3` via the Responses API: parallel tool calls, `input_file` PDF, `text.format` JSON schema
- Stretch: Muse Glimmer 30B (open weight) on Modal as redactor

## Architecture

```
browser (mic, UI)  ──PCM 24k──▶  relay (Node, holds the key)  ──▶  wss://api.meta.ai/v1/asr/realtime
        ▲                              │ tokenizes identifiers
        │                              ▼
        └──── record JSON ◀──── Netlify Function ──▶ https://api.meta.ai/v1/responses (Spark + tools)
                                        │
                                        ├─▶ henryknows.info (search_sources, ask_henry)
                                        └─▶ relay/dates.js (compute_dates)
```

The relay runs locally for development and on Modal for the live demo. Netlify Functions cannot hold a WebSocket open, which is why the relay exists.

## Demo

`docs/DEMO_SCRIPT.md`. The student in the demo is fictional; every document is synthetic.

## License

MIT
