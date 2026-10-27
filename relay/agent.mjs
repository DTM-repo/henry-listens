// The agent: after every completed turn, Spark re-reads the (redacted) meeting so far and rewrites the record.
// It decides which tools to call (HenryKnows for sources, compute_dates for every date) and returns the record
// as strict JSON. We diff it against the previous record and emit only what changed, so the stage can animate.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { henryTools, runHenryTool } from './henry.mjs';
import { computeDatesTool, runComputeDates } from './dates.mjs';

const SCHEMA = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'docs', 'record.schema.json'), 'utf8'));
const BASE = 'https://api.meta.ai/v1';
const MODEL = process.env.AGENT_MODEL || 'muse-spark-1.3';

const INSTRUCTIONS = `You are Henry Listens, a compliance note-taker sitting in on an F-1 international-student advising appointment at a U.S. university. You hear the conversation as it happens (transcript so far, speakers labeled by role). Identifiers are already replaced by tokens like [STUDENT] or [SEVIS_ID]; never try to guess what they were.

Your job after each turn: update the record (strict JSON per the schema).
- cards: one card per distinct issue the conversation raises (an internship, a course-load question, a travel plan, a program-end question...). Keep ids stable across turns; update status and detail as the adviser decides things. Category must fit. Do not invent issues nobody raised.
- citations / regulatory_basis: every regulatory statement must cite a source_url returned by search_sources in THIS session. If you have not searched for it, search first. If search finds nothing relevant, set source_url to "" and say so in detail. Never cite from memory.
- timeline and every deadline: never calculate a date. Call compute_dates with ALL the facts stated so far (program end date whenever it has been stated, CPT dates, full-time or not). Copy its windows, markers and notes verbatim; a date the student merely stated may appear with source "stated".
- Today's date is given at the top of the transcript. A month or day said without a year means its next occurrence after today; when you assume a year, say so in open_questions ("Confirm internship dates are June 1 – August 15, 2027").
- If compute_dates returns a note that something conflicts (for example CPT dates after the program end date), make it a card with status needs_followup and put the exact note in detail.
- facts_stated_by_student: only what the student actually said. advice_given: only what the adviser actually said. Do not add advice of your own.
- student_summary: plain second-person language the student can take home; no citations; nothing the adviser did not say.
- open_questions: what the adviser still needs to confirm (documents, dates, department sign-off).
Be economical: call search_sources once per new regulatory point, not every turn. If nothing new was said since the last record, return the previous record unchanged.`;

export class Agent extends EventEmitter {
  constructor({ key, log = () => {} }) {
    super();
    this.key = key; this.log = log;
    this.turns = [];            // { role, text } redacted
    this.record = null;         // last record
    this.running = false; this.pending = false;
    this.sources = new Map();   // url → {title, excerpt}
    this.usage = { input: 0, output: 0, calls: 0 };
    this.tools = [...henryTools, computeDatesTool];
  }
  async post(body) {
    const r = await fetch(BASE + '/responses', { method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, ...body }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    this.usage.calls++; this.usage.input += j.usage?.input_tokens || 0; this.usage.output += j.usage?.output_tokens || 0;
    return j;
  }
  addTurn(role, text) { this.turns.push({ role, text }); this.kick(); }
  kick() { if (this.running) { this.pending = true; return; } this.run().catch((e) => { this.log('agent error', e.message); this.emit('activity', { kind: 'error', text: e.message }); }); }

  async run() {
    this.running = true; this.pending = false;
    try {
      const transcript = `Today: ${new Date().toISOString().slice(0, 10)}\n` + this.turns.map((t, i) => `${i + 1}. ${t.role.toUpperCase()}: ${t.text}`).join('\n');
      const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text:
        `Transcript so far:\n${transcript}\n\nPrevious record (update it; keep ids):\n${this.record ? JSON.stringify(this.record) : 'none yet'}` }] }];
      this.emit('activity', { kind: 'thinking', text: `reading turn ${this.turns.length}` });
      let r = await this.post({ instructions: INSTRUCTIONS, input, tools: this.tools, text: { format: { type: 'json_schema', name: 'record', strict: true, schema: SCHEMA } }, reasoning: { effort: 'low' } });
      for (let hop = 0; hop < 8; hop++) {
        const calls = (r.output || []).filter((o) => o.type === 'function_call');
        if (!calls.length) break;
        const outputs = await Promise.all(calls.map(async (c) => {
          const args = JSON.parse(c.arguments || '{}');
          this.emit('activity', { kind: 'tool', name: c.name, args });
          const t0 = Date.now();
          const out = c.name === 'compute_dates' ? runComputeDates(args) : await runHenryTool(c.name, args);
          if (out?.sources) for (const s of out.sources) this.sources.set(s.url, s);
          this.emit('activity', { kind: 'tool_result', name: c.name, ms: Date.now() - t0, summary: out?.sources ? `${out.sources.length} sources` : out?.windows ? `${out.windows.length} windows` : 'ok' });
          return { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) };
        }));
        r = await this.post({ previous_response_id: r.id, input: outputs, tools: this.tools, text: { format: { type: 'json_schema', name: 'record', strict: true, schema: SCHEMA } }, reasoning: { effort: 'low' } });
      }
      const text = (r.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
      const rec = JSON.parse(text);
      // guard: a citation must point at a URL we actually got from HenryKnows this session
      for (const c of rec.cards) for (const ci of c.citations) if (ci.source_url && !this.sources.has(ci.source_url)) { ci.citation += ' (unverified)'; ci.source_url = ''; }
      for (const ci of rec.case_note.regulatory_basis) if (ci.source_url && !this.sources.has(ci.source_url)) { ci.citation += ' (unverified)'; ci.source_url = ''; }
      const delta = diff(this.record, rec);
      this.record = rec;
      this.emit('record', { record: rec, delta, usage: { ...this.usage } });
    } finally {
      this.running = false;
      if (this.pending) this.kick();
    }
  }
}

function diff(prev, next) {
  const key = (x) => JSON.stringify(x);
  const d = { cards_added: [], cards_updated: [], timeline_added: [], checklist_added: [], questions_added: [] };
  const pc = new Map((prev?.cards || []).map((c) => [c.id, c]));
  for (const c of next.cards) { const o = pc.get(c.id); if (!o) d.cards_added.push(c); else if (key(o) !== key(c)) d.cards_updated.push(c); }
  const pt = new Set((prev?.timeline || []).map((t) => t.start + t.end + t.label));
  for (const t of next.timeline) if (!pt.has(t.start + t.end + t.label)) d.timeline_added.push(t);
  const pk = new Set((prev?.sevis_checklist || []).map((k) => k.action));
  for (const k of next.sevis_checklist) if (!pk.has(k.action)) d.checklist_added.push(k);
  const pq = new Set(prev?.open_questions || []);
  for (const q of next.open_questions) if (!pq.has(q)) d.questions_added.push(q);
  return d;
}
