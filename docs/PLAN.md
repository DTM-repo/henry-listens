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


## Pivot, Oct 26 evening (David): the demo must show the record building itself

Transcription on screen is dictation and a privacy cringe. The visible product is the **live record stage**:
- **Issue cards** surface as the conversation raises them, get a HenryKnows citation a beat later, then settle into categories (Employment, Program end, Travel, Status).
- **Calendar strip**: dates the student states land as markers; windows (OPT 90-day, CPT dates, grace period) draw themselves around them. Agent never computes a date; `compute_dates` does.
- **SEVIS checklist** fills in with deadline + owner as the adviser commits to actions.
- **Listening indicator** (waveform / breathing mark) so it is obvious Henry is live.
- The transcript becomes an **Evidence drawer**: closed by default; when opened it shows the *redacted* text (tokens in place of name/IDs).

Consequence: the agent runs **after every completed turn** (incremental record, diffed against the previous one so new items animate in), not once at the end.

Revised days: Oct 27 redaction ledger + incremental agent loop (Spark + tools + schema, diff engine). Oct 28 live record stage UI (cards, calendar strip, checklist, indicator). Oct 29 I-20 PDF + evidence drawer + sign-off/export. Rest of the schedule unchanged.

## Oct 26 late (David): setup ritual, shared review, solo mode

**Setup ritual (start of every session).** Henry speaks (browser speech synthesis; Meta has no TTS model) and shows the same text:
> "This is Henry Listens. Don't mind me. I'll sit in on the meeting and take notes, then give you a complete assessment to take with you. I keep it private: no names, no personal details. I'm here so nothing gets missed and nobody has to take notes. Before we start, let's check the mics. Can each of you introduce yourself as a student, an adviser, or something else?"
Each voice introduces itself → that voice's diarization label (A/B/C) is bound to a role. If someone says a name, Henry: "I'll just write *student* so we don't keep personal information" — and the name goes into the redaction ledger so every later mention becomes a token. Then: "We're all set. Go ahead. Forget about me. I'm furniture."
Demo video version ≈ 15 s; the full text lives on screen.

**Shared review (end of session).** Adviser and student click through the record together: each card = confirm / edit / strike. Export (PDFs: case note, student summary, SEVIS checklist) happens only after the adviser signs. This is the "human owns every regulatory sentence" moment.

**Solo prep mode (stretch, Nov 1–2).** Student alone. Same loop; Henry speaks and asks clarifying questions, builds the same record, and hands it to the adviser for the meeting. **Henry gathers, never advises** — no regulatory answers to a student without an adviser present (judges' anti-project list; DSO liability). Positioned as "prep", not "advice".

Card categories: Employment, **Enrollment** (course load, online-course limit, reduced course load — "comes up ALL the time"), Program end, Travel, Status. OPEN: David to list the others that recur (Todoist reminder set 10/26).

Henry's voice: browser speech synthesis is acceptable for the short setup lines in the main product; if Solo prep mode is built it needs a real TTS voice (not stretch-quality). Stretch only if time-rich at the end.
