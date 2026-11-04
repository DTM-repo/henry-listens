// Code-side fact extraction from redacted turns, so dates land on the stage the moment they are spoken.
// Deliberately narrow: program end, program extension, CPT/employment dates and hours, visa expiry, travel.
// The model still writes the record; this only decides what compute_dates is called with, and when.
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const MON = '(january|february|march|april|may|june|july|august|september|october|november|december)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|twenty[- ]?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth))';
const pad = (n) => String(n).padStart(2, '0');
const dayNum = (d, w) => d ? +d : ORD[w] ?? (w?.startsWith('twenty') ? 20 + ORD[w.replace(/^twenty[- ]?/, '')] : NaN);

/** Find "May 15th, 2027" / "May fifteenth 2027" / "May 2027" / "May 15" (year inferred: next occurrence after today). */
function findDates(text, today) {
  const out = [];
  const re = new RegExp(`\\b${MON}(?:\\s+(?:${DAY}))?(?:,?\\s+(?:of\\s+)?(20\\d{2}))?\\b`, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()]; const day = dayNum(m[2], m[3]?.toLowerCase()); let year = m[4] ? +m[4] : null; let assumed = false;
    if (!year) { year = today.getUTCFullYear(); const probe = new Date(Date.UTC(year, month - 1, isNaN(day) ? 28 : day)); if (probe < today) year++; assumed = true; }
    out.push({ iso: isNaN(day) ? `${year}-${pad(month)}` : `${year}-${pad(month)}-${pad(day)}`, index: m.index, text: m[0], assumedYear: assumed });
  }
  return out;
}

export class Facts {
  constructor() { this.f = {}; this.today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'); }
  /** @returns {boolean} true if a date-bearing fact changed */
  learn(role, text) {
    text = text.replace(new RegExp(`\\b(${MON})(?:\\s+\\1)+\\b`, 'gi'), '$1');   // transcription stutter: "August August 15th" → "August 15th" (before both passes, so indexes agree)
    const t = text.toLowerCase(); const dates = findDates(text, this.today); const before = JSON.stringify(this.f);
    const near = (re, win = 80) => { const i = t.search(re); if (i < 0) return null; return dates.find((d) => Math.abs(d.index - i) < win) || null; };
    // program end / extension
    if (/\b(extend|extension)\b/.test(t) && dates.length) { const d = dates.find((x) => x.index > t.search(/\b(extend|extension)\b/)) || dates[0]; this.f.program_end_new = d.iso; }
    else { const d = near(/program (end|ends|ending)|end date|i-?20 (says|ends)|graduat/); if (d && !this.f.program_end) this.f.program_end = d.iso; }
    // employment dates: "June 1st to August 15th"
    const span = /\b(to|through|until|-)\b/.test(t) && dates.length >= 2 && /\b(intern|job|work|employ|offer|letter|dates|start|cpt|opt|hours|week|summer|position)\b/.test(t) ? dates.slice(0, 2) : null;
    if (span && !this.f.cpt_start) { this.f.cpt_start = span[0].iso; this.f.cpt_end = span[1].iso; this.f.cpt_year_assumed = span[0].assumedYear; }
    const hrs = t.match(/\b(\d{1,2}|forty|thirty|twenty|ten)\s+hours\s+(a|per)\s+week/); if (hrs) { const n = { forty: 40, thirty: 30, twenty: 20, ten: 10 }[hrs[1]] ?? +hrs[1]; this.f.cpt_full_time = n > 20; }
    if (/\bfull[- ]time\b/.test(t) && this.f.cpt_full_time === undefined && role === 'student') this.f.cpt_full_time = true;
    // visa, travel
    const v = near(/\bvisa\b/); if (v && /expir/.test(t)) this.f.visa_expiry = v.iso;
    if (/\b(winter|summer|spring) break\b/.test(t) && /\b(go home|travel|visit|trip|leave the (country|us))\b/.test(t)) this.f.travel = t.match(/\b(winter|summer|spring) break\b/)[0];
    return JSON.stringify(this.f) !== before;
  }
  /** arguments for compute_dates */
  args() { const f = this.f; return { program_end: f.program_end || '', program_end_new: f.program_end_new || '', cpt_start: f.cpt_start || '', cpt_end: f.cpt_end || '', cpt_full_time: !!f.cpt_full_time, prior_full_time_cpt_months: 0, visa_expiry: f.visa_expiry || '' }; }
  /** one-line hint for the agent prompt */
  hint() { const f = this.f; const parts = []; if (f.program_end) parts.push(`program end ${f.program_end}`); if (f.program_end_new) parts.push(`program extended to ${f.program_end_new}`); if (f.cpt_start) parts.push(`employment ${f.cpt_start} to ${f.cpt_end}${f.cpt_year_assumed ? ' (year assumed)' : ''}${f.cpt_full_time === undefined ? '' : f.cpt_full_time ? ', full-time' : ', part-time'}`); if (f.visa_expiry) parts.push(`visa expires ${f.visa_expiry}`); if (f.travel) parts.push(`travel planned over ${f.travel}`); return parts.join('; '); }
}
