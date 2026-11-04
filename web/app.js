// Henry Listens — the stage. Mic (or ?src= replay) → relay → Meta Voice Transcribe → relay agent (Spark + tools) → this page.
// What the room sees: the record building itself. Cards fly in from Henry; dates take shape on a paper calendar and land on
// the story line (motion ported from the F-1 Journey app); the transcript lives in a drawer, already redacted.
// Modes: live (mic) · ?src=/test/x.wav (replay a recording through the real relay) · ?sample=cpt (static: recorded event stream, no relay, no cost)
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const MODE = params.get('sample') ? 'sample' : params.get('src') ? 'replay' : 'live';
const RELAY = (window.RELAY_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`).replace(/\/$/, '');
const RELAY_HTTP = RELAY.replace(/^ws/, 'http');
const state = { ws: null, ctx: null, stream: null, node: null, audio: null, running: false, frames: 0, phase: 'idle', roles: {}, turns: [], record: null, review: {}, signed: null, timers: [],
  dates: new Map(), checks: new Map(), questions: [], flag: null, mode: 'idle', sessionId: '', i20: null };
const ROLE_LABEL = { student: 'Student', adviser: 'Adviser', other: 'Other' };
const RITUAL = {
  open: "This is Henry Listens. Don't mind me. I'll sit in on the meeting and take notes, then give you a complete assessment to take with you. I keep it private: no names, no personal details. I'm here so nothing gets missed and nobody has to take notes. Before we start, let's check the mics. Could each of you introduce yourself as a student, an adviser, or something else?",
  name: "I'll just write 'student' so we don't keep personal information.",
  go: "We're all set. Go ahead. Forget about me. I'm furniture.",
  review: "Here is what I have. Walk through it together; nothing leaves until the adviser signs.",
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const human = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); if (!m) return iso; return d ? `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`; };
const setStatus = (t, cls = '') => { $('#status').textContent = t; $('#status').className = cls; };
const setMode = (m) => { state.mode = m; document.body.className = document.body.className.replace(/\bmode-\S+/g, '').trim() + ` mode-${m}`; };
const inReview = () => state.phase === 'review' && !state.running;
const ruleWords = (rule) => String(rule || '').split('_8CFR')[0].split('_INA')[0].replace(/_/g, ' ').toLowerCase();

// ---------- Henry's voice (David's recorded lines) ----------
let henryAudio = null;
function speak(id) {
  const text = RITUAL[id] || id; $('#henry-says').textContent = text;
  if ($('#mute').checked || !RITUAL[id]) return Promise.resolve();
  return new Promise((res) => { try { henryAudio?.pause(); } catch {} const a = new Audio(`/voice/${id}.webm`); henryAudio = a; const done = () => { if (state.mode === 'speaking') setMode(state.running ? 'listening' : 'idle'); res(); }; a.onended = done; a.onerror = done; setMode('speaking'); a.play().catch(done); });
}

// ---------- cards ----------
const CAT_VAR = (c) => `var(--cat-${String(c).replace(' ', '_')})`;
function cardHtml(c) {
  const short = (t) => String(t).replace(/^(Study in the States|ICE SEVP|USCIS Policy Manual|USCIS|SEVP)\s*[—–-]\s*/i, '').replace(/^\[dated [^\]]+\]\s*/i, '');
  const cites = c.citations.map((ci) => ci.source_url ? `<a class="cite" href="${esc(ci.source_url)}" target="_blank" rel="noopener" title="${esc(ci.citation)} — ${esc(ci.claim)}">${esc(short(ci.citation))}</a>` : ci.rule ? `<span class="cite rule" title="${esc(ci.claim)}">${esc(ci.citation)}</span>` : `<span class="cite none" title="${esc(ci.claim)}">${esc(ci.citation)}</span>`).join('');
  const rv = state.review[c.id];
  const controls = inReview() && !state.signed ? `<div class="rv"><button data-act="confirm" class="${rv === 'confirmed' ? 'on' : ''}">Confirm</button><button data-act="edit" class="${rv === 'edited' ? 'on' : ''}">Edit</button><button data-act="strike" class="${rv === 'struck' ? 'on' : ''}">Strike</button></div>` : rv ? `<div class="rv done">${rv}</div>` : '';
  const icon = c.status === 'resolved' ? '<svg viewBox="0 0 24 24"><path pathLength="1" d="M4 12.5l5 5L20 7"/></svg>' : c.status === 'needs_followup' ? '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-1.5 3.5L16 11H5"/></svg>' : '';
  return `<div class="cat" style="--c:${CAT_VAR(c.category)}">${esc(c.category)}</div><h3>${esc(c.title)}</h3><p class="detail">${esc(c.detail)}</p><div class="cites">${cites}</div><div class="st ${c.status}">${icon}${c.status.replace('_', ' ')}</div>${controls}`;
}
function allCards() { const cards = [...(state.record?.cards || [])]; if (state.flag) cards.unshift(state.flag); return cards; }
function renderCards() {
  const wrap = $('#cards'); const seen = new Set(); const orb = $('.orb').getBoundingClientRect();
  for (const c of allCards()) {
    seen.add(c.id);
    let el = wrap.querySelector(`[data-id="${CSS.escape(c.id)}"]`);
    if (!el) {
      el = document.createElement('article'); el.className = `card ${c.status}`; el.dataset.id = c.id; el.innerHTML = cardHtml(c); el.dataset.html = el.innerHTML; el.dataset.cites = c.citations.length; wrap.append(el);
      const r = el.getBoundingClientRect(); el.style.setProperty('--from', `translate(${orb.left + orb.width / 2 - (r.left + r.width / 2)}px, ${orb.top + orb.height / 2 - (r.top + r.height / 2)}px) scale(.25)`);
      el.classList.add('enter'); el.getBoundingClientRect(); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
      continue;
    }
    const html = cardHtml(c);
    if (el.dataset.html !== html) {
      const wasFlag = el.classList.contains('needs_followup') || el.classList.contains('was-flag');
      const oldCites = Number(el.dataset.cites || 0);
      el.dataset.html = html; el.innerHTML = html; el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 900);
      el.className = `card ${c.status} ${wasFlag && c.status === 'resolved' ? 'was-flag' : ''} ${state.review[c.id] === 'struck' ? 'struck' : ''}`;
      el.querySelectorAll('.cite').forEach((x, i) => { if (i < oldCites) x.style.animation = 'none'; });   // stamp only new citations
      el.dataset.cites = c.citations.length;
    }
    el.classList.toggle('struck', state.review[c.id] === 'struck');
  }
  for (const el of [...wrap.querySelectorAll('.card')]) if (!seen.has(el.dataset.id)) el.remove();
  $('#cards-empty').style.display = seen.size ? 'none' : '';
  $('#cards-count').textContent = seen.size ? `${seen.size}` : '';
}

// ---------- the dates: story line + calendar journey ----------
const SHORT = { 'OPT filing window (USCIS receipt)': 'OPT filing window', '60-day grace period': 'grace period', 'CPT full-time': 'CPT, full time', 'CPT part-time': 'CPT, part time', 'Program end date': 'program ends', 'Program end date (extended)': 'program ends (extended)', 'Current program end date (to be extended)': 'current program end', 'Visa expires (month stated)': 'visa expires', 'Visa expires': 'visa expires', 'Program end date (month stated; confirm day on I-20)': 'program ends (confirm day)' };
const journeyQueue = []; let journeyActive = null;
function addDate({ start, end, label, rule, source, approx }) {
  if (!/^\d{4}-\d{2}/.test(start)) return;
  end = end || start; const key = `${start}|${end}`; const short = SHORT[label] || String(label).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const existing = state.dates.get(key);
  if (existing) { if (existing.gone && source !== 'model') { existing.gone = false; renderTimeline(); } return; }
  if (source === 'model' && /8CFR|INA/.test(rule || '') && [...state.dates.values()].some((d) => d.gone && d.key === key)) return;
  const stated = /stated/i.test(source || '') || (/PROGRAM_END|I20|VISA/.test(rule || '') && !/EXTENSION/.test(rule || ''));
  const item = { key, start, end, label: short, rule: rule || '', precision: approx || start.length === 7 ? 'month' : 'day', kind: stated ? 'stated' : 'calculated', state: 'receiving', model: source === 'model' };
  state.dates.set(key, item); renderTimeline(); journeyQueue.push(item); pumpJourney();
}
function dropDates(pred) { let changed = false; for (const it of state.dates.values()) if (pred(it) && !it.gone) { it.gone = true; changed = true; setTimeout(() => { if (state.dates.get(it.key)?.gone) { state.dates.delete(it.key); renderTimeline(); } }, 4000); } if (changed) renderTimeline(); }
function renderTimeline() {
  const el = $('#timeline'); const items = [...state.dates.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (!items.length) return;
  el.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'date-story';
  for (const it of items) {
    const p = document.createElement('div'); p.className = `story-point ${it.precision === 'month' || it.end !== it.start ? 'story-range' : ''} ${it.state === 'receiving' ? 'story-receiving' : ''} ${it.state === 'landed' ? 'story-landed' : ''} ${it.gone ? 'story-gone' : ''}`; p.dataset.key = it.key;
    const kind = it.gone ? 'SUPERSEDED' : it.kind === 'stated' ? (it.precision === 'month' ? 'APPROXIMATE · STATED' : 'STATED IN THE MEETING') : 'CALCULATED · ' + ruleWords(it.rule);
    const shown = it.precision === 'month' && it.end === it.start ? human(it.start.slice(0, 7)) : human(it.start) + (it.end !== it.start ? ' – ' + human(it.end) : '');
    p.innerHTML = `<i class="story-dot"></i><div class="story-date-card"><span class="story-kind">${esc(kind)}</span><span class="story-date">${esc(shown)}</span><p class="story-label">${esc(it.label)}</p></div>`;
    wrap.append(p);
  }
  el.append(wrap);
}
function pumpJourney() {
  if (journeyActive || !journeyQueue.length) return;
  const item = journeyQueue.shift(); journeyActive = item;
  const dot = document.querySelector(`.story-point[data-key="${CSS.escape(item.key)}"] .story-dot`); const panel = $('#dates');
  if (!dot || !panel || matchMedia('(prefers-reduced-motion: reduce)').matches) { item.state = 'landed'; journeyActive = null; renderTimeline(); return pumpJourney(); }
  const [y, m, d] = item.start.split('-').map(Number);
  const pr = panel.getBoundingClientRect(), width = Math.min(300, innerWidth - 32), height = 360;
  const left = Math.max(16, Math.min(innerWidth - width - 16, pr.left + (pr.width - width) / 2)), top = Math.max(16, Math.min(innerHeight - height - 16, pr.top + 40));
  const dr = dot.getBoundingClientRect();
  const el = document.createElement('div'); el.className = 'calendar-journey phase-year'; el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `left:${left}px;top:${top}px;width:${width}px;--landing-x:${dr.left + dr.width / 2 - (left + width / 2)}px;--landing-y:${dr.top + dr.height / 2 - (top + height / 2)}px;--month-x:${((m - 1) % 3 + .5) / 3 * 100}%;--month-y:${(Math.floor((m - 1) / 3) + .5) / 4 * 100}%`;
  const mini = (mi) => { const start = new Date(y, mi, 1).getDay(), count = new Date(y, mi + 1, 0).getDate(); return `<div class="journey-mini-grid">${'<span></span>'.repeat(start)}${'<span><i></i></span>'.repeat(count)}</div>`; };
  const start = new Date(y, m - 1, 1).getDay(), count = new Date(y, m, 0).getDate();
  const endDay = item.end.startsWith(item.start.slice(0, 7)) && item.end !== item.start ? Number(item.end.split('-')[2]) : (item.end !== item.start ? count : null);
  const days = Array.from({ length: count }, (_, i) => { const day = i + 1; const sel = item.precision === 'day' && day === d; const span = item.precision === 'month' || (endDay && day > (d || 0) && day <= endDay); return `<span class="${sel ? 'journey-selected-day' : ''} ${span ? 'journey-uncertain-day' : ''}">${day}${sel ? '<svg class="journey-ink-circle" viewBox="0 0 52 44"><path pathLength="1" d="M43 8C33-1 7 3 4 20c-3 19 32 26 43 9C57 12 34-3 15 6"/></svg>' : ''}</span>`; }).join('');
  const precision = item.kind === 'stated' ? (item.precision === 'month' ? 'Approximate · said in the meeting' : 'Said in the meeting') : 'Calculated from the facts stated · ' + ruleWords(item.rule);
  el.innerHTML = `<div class="journey-paper"><div class="journey-year"><div class="journey-year-heading"><span>A DATE IN THE RECORD</span><b>${y}</b></div><div class="journey-year-months">${MONTHS.map((n, i) => `<div class="${i === m - 1 ? 'journey-chosen-month' : ''}"><strong>${n.slice(0, 3)}</strong>${mini(i)}</div>`).join('')}</div></div>
    <div class="journey-month"><div class="journey-month-heading"><span>${MONTHS[m - 1]}</span><small>${y}</small></div><div class="journey-days">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => `<small>${w}</small>`).join('')}${'<span></span>'.repeat(start)}${days}</div><div class="journey-handwriting"><span>${esc(item.label)}</span><svg viewBox="0 0 200 12"><path pathLength="1" d="M3 8 Q92 0 194 7"/></svg></div><div class="journey-precision">${esc(precision)}</div></div></div>`;
  document.body.append(el);
  const phase = (p) => { el.className = `calendar-journey phase-${p}`; };
  setTimeout(() => phase('zoom'), 500); setTimeout(() => phase('date'), 950); setTimeout(() => phase('ink'), 1400); setTimeout(() => phase('land'), 2150);
  setTimeout(() => { el.remove(); item.state = 'landed'; journeyActive = null; renderTimeline(); pumpJourney(); }, 2750);
}

// ---------- the I-20 ----------
function renderDoc(ev) {
  const el = $('#doc'); $('#doc-add').style.display = 'none';
  let card = el.querySelector('.doc-card'); if (!card) { card = document.createElement('div'); card.className = 'doc-card'; el.append(card); }
  if (ev.stage === 'redacted') { state.i20 = { boxes: ev.boxes }; card.innerHTML = `<div class="k">FORM I-20 · RECEIVED</div><div class="t">Reading a redacted copy</div><div class="m">${ev.boxes} identifying item${ev.boxes === 1 ? '' : 's'} removed by code before any model saw it <span class="boxes">${'<i></i>'.repeat(Math.min(5, ev.boxes))}</span></div>`; if (state.mode !== 'speaking') setMode('thinking'); }
  else if (ev.stage === 'read') { state.i20 = { ...ev.fields, boxes: ev.boxes, matches: ev.matches }; const f = ev.fields; const end = f.program_end ? human(f.program_end) : 'not found';
    const verdict = ev.matches === true ? '<b>matches what the student said</b>' : ev.matches === false ? `<b class="no">differs from what was said (${esc(human(ev.stated))})</b>` : 'no program end date was stated yet';
    card.innerHTML = `<div class="k">FORM I-20 · ON FILE</div><div class="t">Program ends ${esc(end)}</div><div class="m">${esc([f.education_level, f.major].filter(Boolean).join(' · '))}${f.program_start ? ` · from ${esc(human(f.program_start))}` : ''}<br>Read by Spark from a redacted copy · ${verdict}</div>`; if (state.mode === 'thinking') setMode('listening'); }
  else if (ev.stage === 'error') { card.innerHTML = `<div class="k">FORM I-20</div><div class="m">Could not read the document: ${esc(ev.message)}</div>`; $('#doc-add').style.display = ''; }
}
async function uploadI20(file) {
  if (!state.sessionId) { setStatus('start the meeting first', 'warn'); return; }
  $('#doc-add').textContent = 'Sending…';
  const r = await fetch(`${RELAY_HTTP}/i20?session=${encodeURIComponent(state.sessionId)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
  if (!r.ok) { const j = await r.json().catch(() => ({})); setStatus(`I-20: ${j.error || r.status}`, 'warn'); }
}
window.henryUploadI20 = uploadI20;
$('#doc-add').onclick = () => $('#doc-file').click();
$('#doc-file').onchange = (e) => { const f = e.target.files[0]; if (f) uploadI20(f); };

// ---------- checklist + questions ----------
function addCheck({ action, deadline, owner, rule, source }) {
  const key = `${deadline || 'none'}|${owner}`; const prev = state.checks.get(key);
  if (prev && source !== 'model') return;
  state.checks.set(key, { action, deadline, owner, rule: rule || '' }); renderChecklist();
}
function checkHtml(it) { return `<span class="who">${esc(it.owner)}</span>${esc(it.action)}${it.deadline && it.deadline !== 'none' ? ` <span class="dl" title="${esc(it.rule)}">by ${esc(human(it.deadline))}</span>` : ''}`; }
function renderChecklist() {
  const el = $('#checklist');
  const have = new Set([...el.children].map((li) => li.dataset.key));
  for (const [k, it] of state.checks) if (!have.has(k)) { const li = document.createElement('li'); li.className = 'check'; li.dataset.key = k; li.innerHTML = `<span class="box"></span><div>${checkHtml(it)}</div>`; el.append(li); }
  for (const li of [...el.children]) { const it = state.checks.get(li.dataset.key); if (!it) li.remove(); else { const txt = li.querySelector('div'); const html = checkHtml(it); if (txt.innerHTML !== html) txt.innerHTML = html; } }
  $('#checklist-empty').style.display = state.checks.size ? 'none' : '';
}
function renderQuestions() {
  const q = $('#questions'); const have = new Set([...q.children].map((li) => li.textContent));
  for (const s of state.questions) if (!have.has(s)) { const li = document.createElement('li'); li.className = 'q'; li.textContent = s; q.append(li); }
  for (const li of [...q.children]) if (!state.questions.includes(li.textContent)) li.remove();
  $('#qwrap').style.display = state.questions.length ? '' : 'none';
}
function renderTranscript() {
  const el = $('#transcript'); el.innerHTML = '';
  for (const t of state.turns) { const d = document.createElement('div'); d.className = `turn ${t.role}`; d.innerHTML = `<span class="t">${mmss(t.start)}</span><span class="who">${esc(ROLE_LABEL[t.role] || t.role)}</span><span class="text">${esc(t.text).replace(/\[([A-Z_0-9]+)\]/g, '<mark>[$1]</mark>')}</span>`; el.append(d); }
  $('#turn-count').textContent = `${state.turns.length} turns.`;
}
let actTimer = null;
function activity(a) {
  const el = $('#activity');
  el.textContent = a.kind === 'tool' ? `${a.name}(${Object.values(a.args).filter((v) => v && v !== true).join(', ').slice(0, 70)})` : a.kind === 'tool_result' ? `${a.name} → ${a.summary} in ${a.ms} ms` : a.kind === 'thinking' ? `Spark is ${a.text}` : a.kind === 'error' ? `error: ${a.text}` : '';
  el.style.opacity = 1; clearTimeout(actTimer); actTimer = setTimeout(() => { el.style.opacity = 0; }, 6000);
  if (state.mode !== 'speaking' && state.running) setMode(a.kind === 'thinking' || a.kind === 'tool' ? 'thinking' : 'listening');
}

// ---------- events from the relay (or from the sample log) ----------
function applyDates(ev) {
  const conflict = (ev.notes || []).find((n) => /CONFLICT/.test(n.text));
  for (const m of ev.markers || []) addDate({ start: m.date, end: m.date, label: m.label, rule: m.rule, approx: m.approx });
  for (const w of ev.windows || []) addDate({ start: w.start, end: w.end, label: w.label, rule: w.rule });
  const now = new Set([...(ev.markers || []).map((m) => `${m.date}|${m.date}`), ...(ev.windows || []).map((w) => `${w.start}|${w.end}`)]);
  dropDates((it) => it.kind === 'calculated' && !now.has(it.key));   // a recomputation supersedes the windows it no longer produces
  for (const d of ev.deadlines || []) addCheck({ action: d.action, deadline: d.date, owner: d.owner, rule: d.rule });
  if (conflict && !state.flag) state.flag = { id: 'code_conflict', category: 'Program end', title: 'CPT runs past the program end', status: 'needs_followup', detail: conflict.text.replace(/^CONFLICT:\s*/, ''), citations: [{ claim: 'Computed by code from the dates stated, not by the model.', citation: conflict.rule, source_url: '', rule: true }] };
  else if (!conflict && state.flag && state.flag.status !== 'resolved') state.flag = { ...state.flag, status: 'resolved', detail: 'Resolved: the program end date is being extended, so the CPT dates now fall inside the program.' };
  renderCards();
}
function applyRecord(rec) {
  for (const t of rec.timeline || []) addDate({ start: t.start, end: t.end, label: t.label, rule: t.source, source: 'model' });
  for (const k of rec.sevis_checklist || []) addCheck({ action: k.action, deadline: k.deadline, owner: k.owner, rule: k.deadline_source, source: 'model' });
  state.questions = rec.open_questions || []; renderQuestions();
  renderCards();
}
async function handle(ev) {
  switch (ev.type) {
    case 'relay':
      if (ev.status === 'ready') { state.sessionId = ev.sessionId || ''; setStatus('listening'); setMode('listening'); if (MODE !== 'sample') $('#doc-add').style.display = ''; if (state.phase === 'idle') { state.phase = 'intro'; document.body.dataset.phase = 'intro'; await speak('open'); if (MODE === 'replay' && state.audio) { state.ws?.send(JSON.stringify({ type: 'mark', name: 'audio_start' })); state.audio.play(); } } }
      else if (ev.status === 'upstream_closed' && state.phase === 'review') { /* normal end */ }
      else if (ev.status === 'capped') setStatus('Henry has reached today\'s session limit. Watch the sample appointment instead.', 'warn');
      else if (ev.status === 'time_cap') setStatus('20-minute limit reached; finishing the record', 'warn');
      else setStatus(`relay: ${ev.status}`, 'warn');
      break;
    case 'mark': if (ev.name === 'audio_start' && MODE === 'sample') state.audio?.play(); break;
    case 'role_bound': state.roles[ev.label] = ev.role; $('#roles').textContent = Object.values(state.roles).map((r) => ROLE_LABEL[r] || r).join(' · '); if (ev.said_name) speak('name'); break;
    case 'phase': state.phase = ev.phase; document.body.dataset.phase = ev.phase; if (ev.phase === 'meeting') speak('go'); if (ev.phase === 'review') { setStatus('meeting over — finishing the record'); speak('review'); } break;
    case 'partial': $('#live').textContent = ev.text ? `${ROLE_LABEL[ev.role] || ev.role}: ${ev.text}` : ''; break;
    case 'turn': state.turns.push(ev); renderTranscript(); $('#live').textContent = ''; break;
    case 'dates': applyDates(ev); break;
    case 'i20': renderDoc(ev); break;
    case 'activity': activity(ev); break;
    case 'record': state.record = ev.record; applyRecord(ev.record); $('#usage').textContent = `${ev.usage.calls} Spark calls`; if (state.mode === 'thinking') setMode(state.running ? 'listening' : 'idle'); break;
    case 'speechStart': if (state.mode === 'listening') setMode('hearing'); break;
    case 'speechEnd': if (state.mode === 'hearing') setMode('listening'); break;
  }
}

// ---------- live / replay: audio capture through the relay ----------
async function start() {
  const replay = params.get('src');
  try { state.ctx = new AudioContext({ sampleRate: 24000 }); } catch { state.ctx = new AudioContext(); }
  await state.ctx.audioWorklet.addModule('/pcm-worklet.js');
  let src;
  if (replay) { const blob = await (await fetch(replay)).blob(); state.audio = new Audio(URL.createObjectURL(blob)); /* fully loaded first: a network stall mid-file starves the ASR stream ("ingress below real-time") */ src = state.ctx.createMediaElementSource(state.audio); src.connect(state.ctx.destination); state.audio.onended = () => setTimeout(() => stop(), 1500); }
  else { setStatus('asking for microphone…'); state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); src = state.ctx.createMediaStreamSource(state.stream); }
  state.node = new AudioWorkletNode(state.ctx, 'pcm-frames'); src.connect(state.node);
  setStatus('connecting to Henry…');
  const ws = new WebSocket(`${RELAY}/asr`); ws.binaryType = 'arraybuffer'; state.ws = ws;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Henry\'s relay is not reachable right now. Watch the sample appointment instead.')); });
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  ws.onclose = (e) => { if (state.phase !== 'review') setStatus(`closed (${e.code})`, 'warn'); stop(false); if (state.phase === 'review' && state.record) enterReview(); };
  state.frames = 0;
  state.node.port.onmessage = (m) => { if (ws.readyState === 1) { ws.send(m.data); state.frames++; if (state.frames % 25 === 0) $('#clock').textContent = mmss(state.frames * 80); } };
  running(true);
}
// ---------- sample: a recorded appointment replayed from its event log (no relay, no mic, no cost) ----------
async function startSample(name) {
  const events = await (await fetch(`/samples/${name}.json`)).json();
  state.audio = new Audio(`/samples/${name}.m4a`);
  state.audio.ontimeupdate = () => { $('#clock').textContent = mmss(state.audio.currentTime * 1000); };
  running(true); setStatus('sample appointment');
  for (const ev of events) state.timers.push(setTimeout(() => handle(ev), ev.t));
  const last = events[events.length - 1]?.t || 0;
  state.timers.push(setTimeout(() => { state.phase = 'review'; stop(false); enterReview(); }, last + 800));
}
function running(on) {
  state.running = on;
  $('#toggle').textContent = on ? (MODE === 'sample' ? 'Stop sample' : 'End meeting') : 'Start';
  $('#toggle').className = `pill ${on ? 'stop' : 'primary'}`;
  $('#begin').style.display = on && MODE !== 'sample' ? '' : 'none';
  $('#sample').style.display = on || MODE === 'sample' ? 'none' : '';
  if (!on && state.mode !== 'speaking') setMode('idle');
}
function stop(sendEnd = true) {
  if (!state.running) return; state.running = false;
  try { if (sendEnd && state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'end' })); } catch {}
  for (const t of state.timers) clearTimeout(t); state.timers = [];
  state.node?.disconnect(); state.stream?.getTracks().forEach((t) => t.stop()); state.ctx?.close();
  if (MODE === 'sample' && state.phase !== 'review') state.audio?.pause();
  running(false);
}

// ---------- shared review → adviser signs → export ----------
function enterReview() { document.body.dataset.phase = 'review'; $('#review-bar').classList.add('on'); setStatus('review together, then the adviser signs'); renderCards(); }
$('#cards').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b || state.signed) return;
  const card = b.closest('.card'); const id = card.dataset.id; const c = allCards().find((x) => x.id === id);
  if (b.dataset.act === 'edit') { const p = card.querySelector('.detail'); p.contentEditable = 'true'; p.focus(); p.onblur = () => { p.contentEditable = 'false'; c.detail = p.textContent.trim(); state.review[id] = 'edited'; renderCards(); }; return; }
  state.review[id] = b.dataset.act === 'confirm' ? 'confirmed' : 'struck'; renderCards();
});
$('#sign').onclick = () => {
  const open = allCards().filter((c) => !state.review[c.id]);
  if (open.length && !confirm(`${open.length} card(s) not reviewed yet. Sign anyway?`)) return;
  state.signed = { at: new Date().toISOString(), reviewed: { ...state.review } };
  $('#sign').style.display = 'none'; const sig = $('#signature'); sig.querySelector('span').textContent = `Signed, adviser · ${new Date(state.signed.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; sig.classList.add('on');
  setTimeout(() => $('#exports').classList.add('on'), 900);
  setStatus('record signed'); $('#henry-says').textContent = 'Signed. The record is yours to keep.';
  renderCards();
};
function signedRecord() {
  const r = structuredClone(state.record || { cards: [], timeline: [], case_note: { facts_stated_by_student: [], advice_given: [], regulatory_basis: [] }, student_summary: '', sevis_checklist: [], open_questions: [] });
  r.cards = allCards().filter((c) => state.review[c.id] !== 'struck');
  r.timeline = [...state.dates.values()].filter((d) => !d.gone).sort((a, b) => a.start.localeCompare(b.start)).map((d) => ({ start: d.start, end: d.end, label: d.label, source: d.rule }));
  r.sevis_checklist = [...state.checks.values()].map((k) => ({ action: k.action, deadline: k.deadline || 'none', deadline_source: k.rule, owner: k.owner }));
  r.open_questions = state.questions;
  return r;
}
function exportDoc(kind) {
  const r = signedRecord(); const signed = state.signed ? new Date(state.signed.at).toLocaleString() : 'unsigned draft';
  const roles = Object.values(state.roles).map((x) => ROLE_LABEL[x] || x).join(', ');
  const cite = (ci) => ci.source_url ? `<a href="${esc(ci.source_url)}">${esc(ci.citation)}</a>` : ci.rule ? `<code>${esc(ci.citation)}</code>` : `${esc(ci.citation)} <em>(no source found)</em>`;
  const li = (xs, f = esc) => xs.length ? `<ul>${xs.map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '<p class="dim">None.</p>';
  let title, body;
  if (kind === 'case_note') {
    title = 'Advising case note';
    body = `<h2>Issues raised</h2>${r.cards.map((c) => `<h3>${esc(c.title)} <small>${esc(c.category)} · ${esc(c.status.replace('_', ' '))}${state.review[c.id] === 'edited' ? ' · edited by adviser' : ''}</small></h3><p>${esc(c.detail)}</p>${c.citations.length ? `<p class="cites">${c.citations.map((ci) => `${esc(ci.claim)} — ${cite(ci)}`).join('<br>')}</p>` : ''}`).join('')}
      <h2>Facts stated by the student</h2>${li(r.case_note.facts_stated_by_student)}<h2>Advice given</h2>${li(r.case_note.advice_given)}
      <h2>Regulatory basis</h2>${li(r.case_note.regulatory_basis, (ci) => `${esc(ci.claim)} — ${cite(ci)}`)}
      <h2>Dates</h2>${li(r.timeline, (t) => `${esc(t.label)}: ${esc(human(t.start))}${t.start !== t.end ? ' to ' + esc(human(t.end)) : ''} <small>[${esc(t.source)}]</small>`)}
      <h2>Still to confirm</h2>${li(r.open_questions)}`;
  } else if (kind === 'student_summary') {
    title = 'Summary for the student';
    body = `<p class="big">${esc(r.student_summary)}</p><h2>Dates to remember</h2>${li(r.timeline, (t) => `${esc(t.label)}: ${esc(human(t.start))}${t.start !== t.end ? ' to ' + esc(human(t.end)) : ''}`)}
      <h2>What you need to do</h2>${li(r.sevis_checklist.filter((k) => k.owner !== 'adviser'), (k) => `${esc(k.action)}${k.deadline !== 'none' ? ` (by ${esc(human(k.deadline))})` : ''}`)}
      <p class="dim">This summarises what your adviser told you in the meeting. It is not legal advice and nothing here changes your record until your adviser acts on it.</p>`;
  } else {
    title = 'SEVIS action checklist';
    body = `<table><tr><th></th><th>Action</th><th>Owner</th><th>Deadline</th><th>Rule</th></tr>${r.sevis_checklist.map((k) => `<tr><td>☐</td><td>${esc(k.action)}</td><td>${esc(k.owner)}</td><td>${esc(k.deadline === 'none' ? '' : human(k.deadline))}</td><td><small>${esc(k.deadline_source)}</small></td></tr>`).join('')}</table><h2>Still to confirm</h2>${li(r.open_questions)}`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Henry Listens</title><style>
    body{font:14px/1.5 'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;color:#1d2a22;max-width:760px;margin:40px auto;padding:0 24px} h1{font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0} h2{font-size:10px;margin:24px 0 6px;letter-spacing:1.6px;text-transform:uppercase;color:#6f7d67} h3{font-size:15px;margin:14px 0 2px} h3 small{color:#777;font-weight:400;font-size:12px}
    .meta{color:#555;font-size:12.5px;margin:4px 0 18px;border-bottom:1px solid #ddd;padding-bottom:10px} .cites{font-size:12.5px;color:#333;margin:4px 0 0} a{color:#365e4d} code{font-size:11px;color:#6f7d67} .big{font-size:16px} .dim{color:#777;font-size:12.5px} ul{padding-left:20px} li{margin:3px 0}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px} th{background:#f3f3f3} td:first-child{width:20px;font-size:16px}
    .foot{margin-top:30px;border-top:1px solid #ddd;padding-top:8px;color:#777;font-size:11.5px} @media print{body{margin:0}}</style></head><body>
    <h1>${title}</h1><div class="meta">Henry Listens · appointment on ${new Date().toLocaleDateString()} · present: ${esc(roles)} · adviser signature: <b>${esc(signed)}</b></div>${body}
    <div class="foot">Identifiers were replaced by tokens before any model heard the conversation; this document contains none. Regulatory statements link to primary sources via HenryKnows. Every date was computed by code from facts stated in the meeting (rule ids shown). Synthetic demo; no real student.</div>
    <script>setTimeout(()=>print(),300)</script></body></html>`;
  const w = window.open('', '_blank'); w.document.write(html); w.document.close();
}
$('#exports').addEventListener('click', (e) => { const k = e.target.dataset.doc; if (k === 'json') { const blob = new Blob([JSON.stringify({ ...signedRecord(), signed: state.signed, reviewed: state.review }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'henry-record.json'; a.click(); } else if (k) exportDoc(k); });

// ---------- controls ----------
$('#toggle').onclick = () => {
  if (state.running) return stop();
  if (MODE === 'sample') return startSample(params.get('sample')).catch((e) => setStatus(e.message, 'warn'));
  start().catch((e) => { setStatus(e.message, 'warn'); stop(false); });
};
$('#sample').onclick = () => { location.search = '?sample=cpt'; };
$('#begin').onclick = () => state.ws?.send(JSON.stringify({ type: 'begin' }));
$('#drawer-toggle').onclick = () => document.body.classList.toggle('drawer-open');
if (MODE === 'sample') { $('#henry-says').textContent = 'A recorded appointment, two synthetic voices. Press Start and watch the record build itself.'; $('#sample').style.display = 'none'; if (params.get('autoplay')) $('#toggle').click(); }
