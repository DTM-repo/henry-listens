// compute_dates — the only place a date is ever calculated. The model never writes a date; it calls this.
// Rules are re-implemented here for the hackathon (not copied from the Duration Mapper). Each result names its rule id.
const d = (s) => { const x = new Date(s + 'T00:00:00Z'); if (isNaN(x)) throw new Error('bad date ' + s); return x; };
const iso = (x) => x.toISOString().slice(0, 10);
const add = (x, n) => new Date(x.getTime() + n * 86400000);

export const RULES = {
  opt_window: { id: 'OPT_WINDOW_8CFR214.2(f)(11)(i)(B)(2)', text: 'Post-completion OPT: USCIS must receive Form I-765 up to 90 days before and no later than 60 days after the program end date; DSO recommendation must be within 30 days before filing.' },
  grace_period: { id: 'GRACE_8CFR214.2(f)(5)(iv)', text: '60-day grace period after program completion (or after post-completion OPT ends).' },
  cpt_fulltime_counter: { id: 'CPT_FT_12MO_8CFR214.2(f)(10)(i)', text: 'Twelve months or more of full-time CPT eliminates eligibility for OPT at that degree level; part-time CPT does not count.' },
  program_end: { id: 'I20_PROGRAM_END', text: 'Program end date as printed on the Form I-20.' },
};

/**
 * @param {{ program_end?: string, today?: string, cpt_start?: string, cpt_end?: string, cpt_full_time?: boolean, prior_full_time_cpt_months?: number }} a
 */
export function computeDates(a = {}) {
  const today = a.today ? d(a.today) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const out = { today: iso(today), markers: [], windows: [], notes: [] };
  if (a.program_end) {
    const pe = d(a.program_end);
    out.markers.push({ date: iso(pe), label: 'Program end date', rule: RULES.program_end.id });
    const open = add(pe, -90), close = add(pe, 60);
    out.windows.push({ start: iso(open), end: iso(close), label: 'OPT filing window (USCIS receipt)', rule: RULES.opt_window.id });
    out.windows.push({ start: iso(add(pe, 1)), end: iso(close), label: '60-day grace period', rule: RULES.grace_period.id });
    out.notes.push({ text: `Post-completion OPT application may be received by USCIS from ${iso(open)} through ${iso(close)}.`, rule: RULES.opt_window.id });
    out.days_until_program_end = Math.round((pe - today) / 86400000);
  }
  if (a.cpt_start && a.cpt_end) {
    const s = d(a.cpt_start), e = d(a.cpt_end);
    const months = (e - s) / (86400000 * 30.4375);
    out.windows.push({ start: iso(s), end: iso(e), label: `CPT ${a.cpt_full_time ? 'full-time' : 'part-time'}`, rule: RULES.cpt_fulltime_counter.id });
    if (a.cpt_full_time) {
      const total = (a.prior_full_time_cpt_months || 0) + months;
      out.notes.push({ text: `Full-time CPT counter after this authorization: ${total.toFixed(1)} months of 12 (OPT eligibility lost at 12 or more).`, rule: RULES.cpt_fulltime_counter.id });
      out.cpt_full_time_months_total = +total.toFixed(1);
    } else out.notes.push({ text: 'Part-time CPT does not count toward the 12-month full-time CPT limit.', rule: RULES.cpt_fulltime_counter.id });
    if (a.program_end && e > d(a.program_end)) out.notes.push({ text: 'CPT end date is after the program end date — CPT cannot extend past program completion.', rule: RULES.program_end.id });
  }
  return out;
}

export const computeDatesTool = {
  type: 'function', name: 'compute_dates', strict: true,
  description: 'Compute every date-driven window (OPT filing window, grace period, CPT dates and the full-time CPT counter) from facts the student stated. Call this instead of calculating any date yourself. Pass only what was stated; use "" or false or 0 for unknowns.',
  parameters: { type: 'object', additionalProperties: false,
    required: ['program_end', 'cpt_start', 'cpt_end', 'cpt_full_time', 'prior_full_time_cpt_months'],
    properties: {
      program_end: { type: 'string', description: 'ISO date YYYY-MM-DD as stated or on the I-20, else ""' },
      cpt_start: { type: 'string', description: 'ISO date or ""' }, cpt_end: { type: 'string', description: 'ISO date or ""' },
      cpt_full_time: { type: 'boolean', description: 'true if more than 20 hours/week' },
      prior_full_time_cpt_months: { type: 'number' },
    } },
};
export function runComputeDates(args) {
  const a = { ...args }; for (const k of ['program_end', 'cpt_start', 'cpt_end']) if (!a[k]) delete a[k];
  try { return computeDates(a); } catch (e) { return { error: e.message }; }
}
