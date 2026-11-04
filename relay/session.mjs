// One advising session: binds voices to roles during the setup ritual, redacts every turn, feeds the agent,
// and emits browser-facing events. Nothing identifying is ever emitted: the ledger stays in this object.
import { EventEmitter } from 'node:events';
import { Redactor } from './redact.mjs';
import { Agent } from './agent.mjs';
import { Facts } from './facts.mjs';
import { computeDates } from './dates.mjs';

const ROLE_WORDS = [[/\b(student)\b/i, 'student'], [/\b(advis[eo]r|dso|counsel[o]r)\b/i, 'adviser'], [/\b(parent|mother|father|friend|spouse|interpreter|someone else|something else|other)\b/i, 'other']];

export class Session extends EventEmitter {
  constructor({ key, log = () => {} }) {
    super();
    this.log = log;
    this.phase = 'intro';                 // intro → meeting → review
    this.roles = new Map();               // speaker label (A/B/C) → role
    this.redactor = new Redactor();
    this.agent = new Agent({ key, log });
    this.facts = new Facts();
    this.agent.on('activity', (a) => this.emit('out', { type: 'activity', ...a }));
    this.agent.on('record', (r) => this.emit('out', { type: 'record', ...r }));
    this.turns = [];
  }
  roleOf(label) { return this.roles.get(label) || (label ? `speaker ${label}` : 'unknown'); }

  /** a finished, labeled turn from the ASR */
  addTurn({ label, text, start, end }) {
    text = (text || '').trim(); if (!text) return;
    if (this.phase === 'intro') {
      const role = ROLE_WORDS.find(([re]) => re.test(text))?.[1];
      if (role && label) {
        this.roles.set(label, role);
        const name = this.redactor.learnFromIntro(text, role.toUpperCase());
        this.emit('out', { type: 'role_bound', label, role, said_name: !!name });   // the name itself never leaves
        this.log(`voice ${label} → ${role}${name ? ' (name learned, redacted)' : ''}`);
        if (new Set(this.roles.values()).has('student') && new Set(this.roles.values()).has('adviser')) this.begin();
        // anything said after the introduction sentence is real content, not ritual
        const rest = text.split(/(?<=[.!?])\s+/).slice(1).join(' ').trim();
        if (rest.split(/\s+/).length >= 6 && this.phase === 'meeting') text = rest; else return;
      }
    }
    const red = this.redactor.redact(text);
    const turn = { role: this.roleOf(label), label, text: red, start, end, n: this.turns.length + 1 };
    this.turns.push(turn);
    this.emit('out', { type: 'turn', ...turn });
    if (this.phase === 'meeting') {
      // code first: the moment a date is spoken, compute what follows from it and show it; the agent confirms later
      if (this.facts.learn(turn.role, red)) { try { const dates = computeDates(this.facts.args()); this.emit('out', { type: 'dates', ...dates, hint: this.facts.hint() }); this.log('dates:', this.facts.hint()); } catch (e) { this.log('dates error', e.message); } }
      this.agent.hint = this.facts.hint();
      this.agent.addTurn(turn.role, red);
    }
  }
  begin() { if (this.phase !== 'intro') return; this.phase = 'meeting'; this.emit('out', { type: 'phase', phase: 'meeting', roles: Object.fromEntries(this.roles) }); this.log('meeting begins', JSON.stringify(Object.fromEntries(this.roles))); }
  end() { if (this.phase === 'review') return; this.phase = 'review'; this.emit('out', { type: 'phase', phase: 'review' }); this.agent.final = true; if (this.agent.turns.length) this.agent.kick(); }
}
