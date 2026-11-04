// Deterministic redaction ledger. No model decides what is identifying.
// The ledger (token → original) lives only in the relay process for the session and is never sent anywhere.
// Names are learned from the setup ritual ("I'm Amara Osei, the student") and from an optional seed list.
const PATTERNS = [
  { token: 'SEVIS_ID', re: /\bN[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4}\b|\bN\d{10}\b/gi },
  { token: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { token: 'PHONE', re: /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { token: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { token: 'PASSPORT', re: /\b(?:passport(?:\s+number)?\s*(?:is|:)?\s*)([A-Z]{1,2}\d{6,9})\b/gi, group: 1 },
  { token: 'EMPLID', re: /\b(?:emplid|student id|id number)\s*(?:is|:)?\s*(\d{7,9})\b/gi, group: 1 },
];
// spoken digit runs ("N zero zero one two…") are normalized before matching
const WORDS = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

export class Redactor {
  constructor({ names = [] } = {}) {
    this.ledger = new Map();      // token → original
    this.byValue = new Map();     // lowercase original → token
    this.counts = {};
    this.nameRes = [];
    for (const n of names) this.addName(n, 'PERSON');
  }
  token(kind, original) {
    const key = original.toLowerCase().replace(/\s+/g, ' ');
    if (this.byValue.has(key)) return this.byValue.get(key);
    this.counts[kind] = (this.counts[kind] || 0) + 1;
    const t = `[${kind}${this.counts[kind] > 1 ? '_' + this.counts[kind] : ''}]`;
    this.ledger.set(t, original); this.byValue.set(key, t);
    return t;
  }
  /** Learn a person's name (full or partial); every later mention of any part ≥3 letters becomes the role token. */
  addName(name, role = 'PERSON') {
    const parts = name.trim().split(/\s+/).filter((p) => p.length >= 3);
    if (!parts.length) return null;
    const t = this.token(role, name.trim());
    for (const p of [name.trim(), ...parts]) this.nameRes.push({ re: new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), token: t });
    return t;
  }
  spokenDigits(text) {
    return text.replace(/\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s-]+){4,}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (m) => m.split(/[\s-]+/).map((w) => WORDS[w.toLowerCase()] ?? w).join(''));
  }
  redact(text) {
    let out = this.spokenDigits(text);
    for (const { token, re, group } of PATTERNS) {
      out = out.replace(re, (m, g1) => group ? m.replace(g1, this.token(token, g1)) : this.token(token, m));
    }
    for (const { re, token } of this.nameRes) out = out.replace(re, token);
    return out;
  }
  /** Same patterns, but nothing is minted into the ledger: for partial (unfinished) transcripts shown on the stage. */
  preview(text) {
    let out = this.spokenDigits(text);
    for (const { token, re, group } of PATTERNS) out = out.replace(re, (m, g1) => group ? m.replace(g1, `[${token}]`) : `[${token}]`);
    for (const { re, token } of this.nameRes) out = out.replace(re, token);
    return out;
  }
  /** "I'm Amara Osei, the student" / "my name is X" → learn X. Returns the detected role word if any. */
  learnFromIntro(text, roleToken = 'PERSON') {
    const m = text.replace(/[’‘]/g, "'").match(/\b(?:[Ii]'m|[Ii] am|[Mm]y name is|[Tt]his is|[Ii]t's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
    if (m && !/^(The|And|Here|Just|Also|Not|Your|Student|Adviser|Advisor)$/i.test(m[1].split(' ')[0])) { this.addName(m[1], roleToken); return m[1]; }
    return null;
  }
  snapshot() { return Object.fromEntries(this.ledger); }   // relay-only; never serialized to the browser or the model
}
