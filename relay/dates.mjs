// compute_dates — the only place a date is ever calculated. The model never writes a date; it calls this.
// Rules are re-implemented here for the hackathon (not copied from the Duration Mapper). Each result names its rule id.
// "2027-05" (month only) → last day of that month, flagged approx so the note says "confirm the day on the I-20"
const d = (s) => { const m = /^(\d{4})-(\d{2})$/.exec(s); const x = m ? new Date(Date.UTC(+m[1], +m[2], 0)) : new Date(s + 'T00:00:00Z'); if (isNaN(x)) throw new Error('bad date ' + s); return x; };
const approx = (s) => /^\d{4}-\d{2}$/.test(s);
const iso = (x) => x.toISOString().slice(0, 10);
const add = (x, n) => new Date(x.getTime() + n * 86400000);

export const RULES = {
  opt_window: { id: 'OPT_WINDOW_8CFR214.2(f)(11)(i)(B)(2)', text: 'Post-completion OPT: USCIS must receive Form I-765 up to 90 days before and no later than 60 days after the program end date; DSO recommendation must be within 30 days before filing.' },
  grace_period: { id: 'GRACE_8CFR214.2(f)(5)(iv)', text: '60-day grace period after program completion (or after post-completion OPT ends).' },
  cpt_fulltime_counter: { id: 'CPT_FT_12MO_8CFR214.2(f)(10)(i)', text: 'Twelve months or more of full-time CPT eliminates eligibility for OPT at that degree level; part-time CPT does not count.' },
  program_end: { id: 'I20_PROGRAM_END', text: 'Program end date as printed on the Form I-20.' },
  extension: { id: 'PROGRAM_EXTENSION_8CFR214.2(f)(7)(iii)', text: 'A program extension must be granted by the DSO before the current program end date, for compelling academic or medical reasons.' },
  visa_reentry: { id: 'VISA_VALID_ON_ENTRY_INA212(a)(7)', text: 'A valid F-1 visa is required on the day of re-entry (not while inside the U.S.); an expired visa must be renewed abroad before returning.' },
  cpt_before_start: { id: 'CPT_AUTH_BEFORE_START_8CFR214.2(f)(10)(i)', text: 'CPT must be authorized by the DSO in SEVIS (new I-20 issued) before the employment begins.' },
};

/**
 * @param {{ program_end?: string, program_end_new?: string, today?: string, cpt_start?: string, cpt_end?: string, cpt_full_time?: boolean, prior_full_time_cpt_months?: number, visa_expiry?: string }} a
 */
export function computeDates(a = {}) {
  const today = a.today ? d(a.today) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const out = { today: iso(today), markers: [], windows: [], notes: [], deadlines: [] };
  if (a.program_end && a.program_end_new) {
    const old = d(a.program_end), pe = d(a.program_end_new);
    out.markers.push({ date: iso(old), label: 'Current program end date (to be extended)', rule: RULES.program_end.id });
    out.deadlines.push({ action: `Program extension entered in SEVIS before the current end date ${iso(old)}`, date: iso(old), rule: RULES.extension.id, owner: 'adviser' });
    out.notes.push({ text: `Program extension to ${iso(pe)} must be granted before the current end date ${iso(old)}; OPT window and grace period below are computed from the extended end date.`, rule: RULES.extension.id });
    a = { ...a, program_end: a.program_end_new };
  }
  if (a.program_end) {
    const pe = d(a.program_end);
    out.markers.push({ date: iso(pe), label: a.program_end_new ? 'Program end date (extended)' : approx(a.program_end) ? 'Program end date (month stated; confirm day on I-20)' : 'Program end date', rule: a.program_end_new ? RULES.extension.id : RULES.program_end.id, approx: approx(a.program_end) });
    if (approx(a.program_end)) out.notes.push({ text: `Only the month of the program end date was stated; ${iso(pe)} assumes the last day of that month. Confirm the exact date on the Form I-20.`, rule: RULES.program_end.id });
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
    out.deadlines.push({ action: 'CPT authorization entered in SEVIS and new I-20 issued before the start date', date: iso(s), rule: RULES.cpt_before_start.id, owner: 'adviser' });
    out.notes.push({ text: `CPT must be authorized in SEVIS before ${iso(s)}; the student may not begin work before the authorization is on the I-20.`, rule: RULES.cpt_before_start.id });
    if (a.program_end && e > d(a.program_end)) out.notes.push({ text: `CONFLICT: CPT end date ${iso(e)} is after the program end date ${iso(d(a.program_end))} — CPT cannot extend past program completion. Either the program end date must be extended on the I-20 (if the student needs more time to finish) or the CPT must end by program completion.`, rule: RULES.program_end.id });
  }
  if (a.visa_expiry) {
    const ve = d(a.visa_expiry);
    out.markers.push({ date: iso(ve), label: approx(a.visa_expiry) ? 'Visa expires (month stated)' : 'Visa expires', rule: RULES.visa_reentry.id, approx: approx(a.visa_expiry) });
    out.notes.push({ text: `The visa expires ${iso(ve)}. It must be valid on the day of re-entry; travel after that date requires renewal at a consulate abroad before returning.`, rule: RULES.visa_reentry.id });
  }
  return out;
}

export const computeDatesTool = {
  type: 'function', name: 'compute_dates', strict: true,
  description: 'Compute every date-driven window (OPT filing window, grace period, CPT dates, the full-time CPT counter) and every deadline from facts the student stated. Call this instead of calculating any date yourself, and call it again whenever a new date is stated. Pass only what was stated; use "" or false or 0 for unknowns.',
  parameters: { type: 'object', additionalProperties: false,
    required: ['program_end', 'program_end_new', 'cpt_start', 'cpt_end', 'cpt_full_time', 'prior_full_time_cpt_months', 'visa_expiry'],
    properties: {
      program_end: { type: 'string', description: 'YYYY-MM-DD as stated or on the I-20; YYYY-MM if only the month was said ("May 2027" → "2027-05"); "" if not stated' },
      program_end_new: { type: 'string', description: 'New program end date if the adviser decided to extend the program, else ""' },
      visa_expiry: { type: 'string', description: 'Visa expiration date if stated (YYYY-MM-DD or YYYY-MM), else ""' },
      cpt_start: { type: 'string', description: 'ISO date or ""' }, cpt_end: { type: 'string', description: 'ISO date or ""' },
      cpt_full_time: { type: 'boolean', description: 'true if more than 20 hours/week' },
      prior_full_time_cpt_months: { type: 'number' },
    } },
};
export function runComputeDates(args) {
  const a = { ...args }; for (const k of ['program_end', 'program_end_new', 'cpt_start', 'cpt_end', 'visa_expiry']) if (!a[k]) delete a[k];
  try { return computeDates(a); } catch (e) { return { error: e.message }; }
}
