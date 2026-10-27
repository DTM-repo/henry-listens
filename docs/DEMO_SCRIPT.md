# Demo script — 3:00 video, one continuous take if possible

**Case:** fictional student "STUDENT_A" (name on screen: "Amara Osei", invented), F-1 undergraduate, program end date May 15, 2027, asking about CPT for a summer internship and whether it affects OPT later. Synthetic I-20 PDF in `docs/cases/student_a/I-20.pdf`.

0:00 Title card, one line: "An advising appointment becomes the compliance record."
0:05 David at the desk, screen shows Henry Listens idle. "I'm a DSO. This is what every appointment should produce, and almost never does."
0:15 Click Start. The student (second voice: David's own recording played from a phone, or a colleague) begins: "Hi, I got an internship offer for the summer, it's paid, forty hours a week, and I wanted to know if I can do it."
0:30 Transcript appears live, labelled A (adviser) and B (student). Pause on the moment "Osei" and the SEVIS ID are spoken and appear as `[STUDENT_A]` and `[SEVIS_ID]` on screen. "Nothing identifying leaves this room. That's code, not a model."
0:50 Adviser: "That's CPT. It has to be integral to your curriculum. Is it for credit, and is it required by your program?" Student answers. Adviser: "And what's your program end date?" Student: "May 2027."
1:10 Click End appointment. Agent panel shows the tool calls as they happen: `search_sources("CPT integral part of established curriculum")`, `compute_dates(program_end=2027-05-15, ...)`, `ask_henry("full-time CPT 12 months OPT eligibility")`. Then the I-20 PDF is read: "Program end date on the I-20 matches what the student said."
1:40 Three panels render. Case note: each sentence with a citation chip (8 CFR 214.2(f)(10)(i)). Student summary in plain language. SEVIS checklist: "Add CPT authorization before start date; employer; dates; full-time; 12-month full-time CPT counter now at 0."
2:15 Click a citation chip: the source text from HenryKnows opens. "I didn't write that citation. I didn't trust the model to write it either. The model asked a reference that only quotes primary sources."
2:30 Adviser edits one line, clicks Sign. Record locks; export to PDF. "That's the record. It took the appointment to make it, not an hour after."
2:45 Closing card: Meta tooling used (Voice Transcribe diarization, Spark agent with parallel tools, PDF input, structured output, Glimmer on Modal if shipped). Repo URL.
3:00 End.

Rules check: everything shown was built in the hackathon; HenryKnows is named as an external service.


## Visual concept (Oct 26 pivot)
What the camera sees is never a transcript. It sees the stage: Henry's listening mark pulses, the student says "internship" and an Employment card slides in, a citation pins to it, the calendar strip grows a summer block, the checklist gains "Department sign-off — adviser — before start date". The evidence drawer opens once, for two seconds, to show the redacted transcript with STUDENT_A where the name was. Close on the signed record.
