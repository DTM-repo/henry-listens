# Build plan — 9 days

Rules that shape this: public repo, new work only, 3-minute video, judges may use the live product.
Judging: Impact 30 · Meta tooling 25 · Technical depth 20 · Demo 25. Bonus targets: Best Agentic ($5K), Best Open-Weight ($10K, needs Glimmer on Modal), Community Vote, Most Viral (X post).

| Day | Build | Proof it works |
|---|---|---|
| Oct 27 Tue | Relay: WebSocket to Voice Transcribe, diarization, browser mic → PCM 24k. Transcript with A/B labels on screen. | Live transcript of a two-person conversation with correct speaker splits. |
| Oct 28 Wed | Redaction layer (names from booking, `N\d{10}`, passport shapes, DOB). Spark agent: tools `search_sources`, `ask_henry`, `compute_dates`; structured output schema v1. | Scripted transcript → three JSON objects with citations. |
| Oct 29 Thu | I-20 PDF in the session (`input_file`). Case note UI: note / student summary / SEVIS checklist, each citation clickable to source. | Demo appointment end to end, no voice yet. |
| Oct 30 Fri | Voice + agent joined: appointment → record. Adviser sign-off, revision, export (Markdown + PDF). | 90-second mock appointment produces a signed record. |
| Oct 31 Sat | Relay on Modal (ASGI WebSocket). Deployed front end on Netlify. | Works from a phone on cellular. |
| Nov 1 Sun | Glimmer on Modal as add-only redactor (bonus track). Measure. | Side-by-side: code-only vs code+Glimmer redaction. |
| Nov 2 Mon | Hardening: reconnect, 60-min cap, empty-turn handling, error states. Second synthetic case (OPT, not CPT). | Both cases clean; nothing breaks on bad audio. |
| Nov 3 Tue | Video (3:00), README final, submission draft, X post draft. | Video reviewed by David. |
| Nov 4 Wed | Submit by 6 PM ET (3-hour margin). | Confirmation on CV platform. |

## Non-negotiables
- No real student data anywhere, including test fixtures. Synthetic case files in `docs/cases/`.
- The agent never writes a date; `compute_dates` does, with the citation.
- Every regulatory sentence in the note carries a `source` from HenryKnows.
- On free Meta credits, content "may be used for product improvement" (billing page). Synthetic only, and say so in the README.

## Decisions David owns
- Which X account posts the demo (identity rule). HenryKnows account vs personal.
- Whether to request Modal credit (his form; needed for the relay + Glimmer).
- Team: solo.
