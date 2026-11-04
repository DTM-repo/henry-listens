// Henry Listens — the stage. Mic (or ?src= replay) → relay → Meta Voice Transcribe → relay agent (Spark + tools) → this page.
// What the room sees: the record building itself. The transcript lives in a drawer, already redacted.
// Modes: live (mic) · ?src=/test/x.wav (replay a recording through the real relay) · ?sample=cpt (static: recorded event stream, no relay, no cost)
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const MODE = params.get('sample') ? 'sample' : params.get('src') ? 'replay' : 'live';
const RELAY = (window.RELAY_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`).replace(/\/$/, '');
const state = { ws: null, ctx: null, stream: null, node: null, audio: null, running: false, frames: 0, phase: 'idle', roles: {}, turns: [], record: null, review: {}, signed: null, timers: [], activity: [] };
const ROLE_LABEL = { student: 'Student', adviser: 'Adviser', other: 'Other' };

const RITUAL = {
  open: "This is Henry Listens. Don't mind me. I'll sit in on the meeting and take notes, then give you a complete assessment to take with you. I keep it private: no names, no personal details. I'm here so nothing gets missed and nobody has to take notes. Before we start, let's check the mics. Could each of you introduce yourself as a student, an adviser, or something else?",
  name: "I'll just write 'student' so we don't keep personal information.",
  go: "We're all set. Go ahead. Forget about me. I'm furniture.",
  review: "Here is what I have. Walk through it together; nothing leaves until the adviser signs.",
};
// Henry's voice = recorded lines in /voice/<id>.webm (record them at /record.html). Text always shows; audio plays if the file exists.
let henryAudio = null;
function speak(id) {
  const text = RITUAL[id] || id; $('#henry-says').textContent = text;
  if ($('#mute').checked || !RITUAL[id]) return Promise.resolve();
  return new Promise((res) => { try { henryAudio?.pause(); } catch {} const a = new Audio(`/voice/${id}.webm`); henryAudio = a; a.onended = res; a.onerror = res; a.play().catch(res); });
}
const setStatus = (t, cls = '') => { $('#status').textContent = t; $('#status').className = cls; };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inReview = () => state.phase === 'review' && !state.running;

// ---------- stage rendering ----------
function renderCards() {
  const wrap = $('#cards'); const seen = new Set();
  for (const c of state.record?.cards || []) {
    seen.add(c.id);
    let el = wrap.querySelector(`[data-id="${CSS.escape(c.id)}"]`);
    const fresh = !el;
    if (fresh) { el = document.createElement('article'); el.className = 'card enter'; el.dataset.id = c.id; wrap.append(el); setTimeout(() => el.classList.remove('enter'), 900); }
    const cites = c.citations.map((ci) => ci.source_url ? `<a class="cite" href="${esc(ci.source_url)}" target="_blank" rel="noopener" title="${esc(ci.claim)}">${esc(ci.citation)}</a>` : `<span class="cite none" title="${esc(ci.claim)}">${esc(ci.citation)}</span>`).join('');
    const rv = state.review[c.id];
    const controls = inReview() && !state.signed ? `<div class="rv"><button data-act="confirm" class="${rv === 'confirmed' ? 'on' : ''}">Confirm</button><button data-act="edit" class="${rv === 'edited' ? 'on' : ''}">Edit</button><button data-act="strike" class="${rv === 'struck' ? 'on' : ''}">Strike</button></div>` : rv ? `<div class="rv done">${rv}</div>` : '';
    const html = `<div class="cat">${esc(c.category)}</div><h3>${esc(c.title)}</h3><p class="detail">${esc(c.detail)}</p><div class="cites">${cites}</div><div class="st ${c.status}">${c.status.replace('_', ' ')}</div>${controls}`;
    el.classList.toggle('struck', rv === 'struck');
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; if (!fresh) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 900); } }
  }
  $('#cards-empty').style.display = seen.size ? 'none' : '';
}
function renderTimeline() {
  const tl = state.record?.timeline || []; const el = $('#timeline'); el.innerHTML = '';
  if (!tl.length) { el.innerHTML = '<div class="empty">Dates will land here as they are said.</div>'; return; }
  const ds = tl.flatMap((t) => [new Date(t.start), new Date(t.end)]).filter((d) => !isNaN(d));
  const min = new Date(Math.min(...ds, Date.now())), max = new Date(Math.max(...ds));
  const span = Math.max(1, max - min + 30 * 86400000); const pct = (d) => ((new Date(d) - min) / span * 100).toFixed(2);
  for (const t of tl) {
    const row = document.createElement('div'); row.className = 'tl-row';
    const single = t.start === t.end;
    row.innerHTML = `<div class="tl-track"><div class="tl-bar ${single ? 'mark' : ''} ${t.source === 'stated' ? 'stated' : ''}" style="left:${pct(t.start)}%;width:${single ? 0.6 : Math.max(0.6, pct(t.end) - pct(t.start))}%" title="${esc(t.source)}"></div></div><div class="tl-label">${esc(t.label)} <span class="dim">${esc(t.start)}${single ? '' : ' → ' + esc(t.end)}</span></div>`;
    el.append(row);
  }
  const today = document.createElement('div'); today.className = 'tl-today'; today.style.left = pct(new Date().toISOString().slice(0, 10)) + '%'; el.append(today);
}
function renderChecklist() {
  const el = $('#checklist'); el.innerHTML = '';
  for (const k of state.record?.sevis_checklist || []) { const li = document.createElement('li'); li.innerHTML = `<span class="owner ${k.owner}">${esc(k.owner)}</span> ${esc(k.action)} ${k.deadline && k.deadline !== 'none' ? `<span class="dl" title="${esc(k.deadline_source)}">by ${esc(k.deadline)}</span>` : ''}`; el.append(li); }
  const q = $('#questions'); q.innerHTML = '';
  for (const s of state.record?.open_questions || []) { const li = document.createElement('li'); li.textContent = s; q.append(li); }
}
function renderTranscript() {
  const el = $('#transcript'); el.innerHTML = '';
  for (const t of state.turns) { const d = document.createElement('div'); d.className = `turn ${t.role}`; d.innerHTML = `<span class="t">${mmss(t.start)}</span><span class="who">${esc(ROLE_LABEL[t.role] || t.role)}</span><span class="text">${esc(t.text).replace(/\[([A-Z_0-9]+)\]/g, '<mark>[$1]</mark>')}</span>`; el.append(d); }
  $('#turn-count').textContent = `${state.turns.length} turns`;
}
function activity(a) {
  state.activity.push(a);
  const el = $('#activity'); const d = document.createElement('div'); d.className = `act ${a.kind}`;
  d.textContent = a.kind === 'tool' ? `${a.name}(${Object.values(a.args).filter(Boolean).join(', ').slice(0, 80)})` : a.kind === 'tool_result' ? `↳ ${a.name}: ${a.summary} · ${a.ms} ms` : a.kind === 'thinking' ? `Henry ${a.text}` : a.text;
  el.prepend(d); while (el.children.length > 12) el.lastChild.remove();
  $('#henry-mark').classList.toggle('busy', a.kind === 'thinking' || a.kind === 'tool');
}
function renderAll() { renderCards(); renderTimeline(); renderChecklist(); }

// ---------- events from the relay (or from the sample log) ----------
async function handle(ev) {
  switch (ev.type) {
    case 'relay':
      if (ev.status === 'ready') { setStatus('listening', 'ok'); if (state.phase === 'idle') { state.phase = 'intro'; $('body').dataset.phase = 'intro'; await speak('open'); if (MODE === 'replay' && state.audio) { state.ws?.send(JSON.stringify({ type: 'mark', name: 'audio_start' })); state.audio.play(); } } }
      else if (ev.status === 'upstream_closed' && state.phase === 'review') { /* normal end */ }
      else if (ev.status === 'capped') setStatus('Henry has reached today\'s session limit. Watch the sample appointment instead.', 'warn');
      else if (ev.status === 'time_cap') setStatus('20-minute session limit reached; finishing the record', 'warn');
      else setStatus(`relay: ${ev.status}`, 'warn');
      break;
    case 'mark': if (ev.name === 'audio_start' && MODE === 'sample') state.audio?.play(); break;
    case 'role_bound': state.roles[ev.label] = ev.role; $('#roles').textContent = Object.values(state.roles).map((r) => ROLE_LABEL[r] || r).join(' · '); if (ev.said_name) speak('name'); break;
    case 'phase': state.phase = ev.phase; $('body').dataset.phase = ev.phase; if (ev.phase === 'meeting') speak('go'); if (ev.phase === 'review') { setStatus('meeting over — finishing the record', 'ok'); speak('review'); } break;
    case 'partial': $('#live').textContent = ev.text ? `${ROLE_LABEL[ev.role] || ev.role}: ${ev.text}` : ''; break;
    case 'turn': state.turns.push(ev); renderTranscript(); $('#live').textContent = ''; break;
    case 'activity': activity(ev); break;
    case 'record': state.record = ev.record; renderAll(); $('#usage').textContent = `${ev.usage.calls} calls · ${(ev.usage.input / 1000).toFixed(1)}k in / ${(ev.usage.output / 1000).toFixed(1)}k out`; $('#henry-mark').classList.remove('busy'); break;
    case 'speechStart': $('#henry-mark').classList.add('hearing'); break;
    case 'speechEnd': $('#henry-mark').classList.remove('hearing'); break;
  }
}

// ---------- live / replay: audio capture through the relay ----------
async function start() {
  const replay = params.get('src');
  try { state.ctx = new AudioContext({ sampleRate: 24000 }); } catch { state.ctx = new AudioContext(); }
  await state.ctx.audioWorklet.addModule('/pcm-worklet.js');
  let src;
  if (replay) { state.audio = new Audio(replay); src = state.ctx.createMediaElementSource(state.audio); src.connect(state.ctx.destination); state.audio.onended = () => setTimeout(() => stop(), 1500); }
  else { setStatus('asking for microphone…'); state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); src = state.ctx.createMediaStreamSource(state.stream); }
  state.node = new AudioWorkletNode(state.ctx, 'pcm-frames'); src.connect(state.node);
  setStatus('connecting to Henry…');
  const ws = new WebSocket(`${RELAY}/asr`); ws.binaryType = 'arraybuffer'; state.ws = ws;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Henry\'s relay is not reachable right now. Watch the sample appointment instead.')); });
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  ws.onclose = (e) => { if (state.phase !== 'review') setStatus(`closed (${e.code})`, 'warn'); stop(false); if (state.phase === 'review' && state.record) enterReview(); };
  state.frames = 0;
  state.node.port.onmessage = (m) => {
    if (ws.readyState === 1) { ws.send(m.data); state.frames++; if (state.frames % 25 === 0) $('#clock').textContent = mmss(state.frames * 80); }
    if (state.frames % 5 === 0) { const v = new Int16Array(m.data); let sum = 0; for (let i = 0; i < v.length; i += 4) sum += v[i] * v[i]; $('#level').style.width = Math.min(100, Math.sqrt(sum / (v.length / 4)) / 32768 * 400) + '%'; }
  };
  running(true);
}

// ---------- sample: a recorded appointment replayed from its event log (no relay, no mic, no cost) ----------
async function startSample(name) {
  const events = await (await fetch(`/samples/${name}.json`)).json();
  state.audio = new Audio(`/samples/${name}.m4a`);
  state.audio.ontimeupdate = () => { $('#clock').textContent = mmss(state.audio.currentTime * 1000); $('#level').style.width = (state.audio.paused ? 0 : 35 + 30 * Math.abs(Math.sin(state.audio.currentTime * 7))) + '%'; };
  running(true);
  setStatus('sample appointment', 'ok');
  for (const ev of events) state.timers.push(setTimeout(() => handle(ev), ev.t));
  const last = events[events.length - 1]?.t || 0;
  state.timers.push(setTimeout(() => { state.phase = 'review'; stop(false); enterReview(); }, last + 800));
}

function running(on) {
  state.running = on;
  $('#toggle').textContent = on ? (MODE === 'sample' ? 'Stop sample' : 'End meeting') : 'Start';
  $('#toggle').className = on ? 'stop' : '';
  $('#begin').style.display = on && MODE !== 'sample' ? '' : 'none';
  $('#sample').style.display = on || MODE === 'sample' ? 'none' : '';
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
function enterReview() {
  $('body').dataset.phase = 'review';
  $('#review-bar').style.display = '';
  setStatus('review together — confirm, edit or strike each card; then the adviser signs', 'ok');
  renderCards();
}
$('#cards').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b || state.signed) return;
  const card = b.closest('.card'); const id = card.dataset.id; const c = state.record.cards.find((x) => x.id === id);
  if (b.dataset.act === 'edit') { const p = card.querySelector('.detail'); p.contentEditable = 'true'; p.focus(); p.onblur = () => { p.contentEditable = 'false'; c.detail = p.textContent.trim(); state.review[id] = 'edited'; renderCards(); }; return; }
  state.review[id] = b.dataset.act === 'confirm' ? 'confirmed' : 'struck'; renderCards();
});
$('#sign').onclick = () => {
  const open = (state.record?.cards || []).filter((c) => !state.review[c.id]);
  if (open.length && !confirm(`${open.length} card(s) not reviewed yet. Sign anyway?`)) return;
  state.signed = { at: new Date().toISOString(), reviewed: { ...state.review } };
  $('#sign').disabled = true; $('#sign').textContent = `Signed ${new Date(state.signed.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('#exports').style.display = '';
  setStatus('record signed — export below', 'ok'); $('#henry-says').textContent = 'Signed. The record is yours to keep.';
  renderCards();
};
function signedRecord() {
  const r = structuredClone(state.record);
  r.cards = r.cards.filter((c) => state.review[c.id] !== 'struck');
  return r;
}
function exportDoc(kind) {
  const r = signedRecord(); const signed = state.signed ? new Date(state.signed.at).toLocaleString() : 'unsigned draft';
  const roles = Object.values(state.roles).map((x) => ROLE_LABEL[x] || x).join(', ');
  const cite = (ci) => ci.source_url ? `<a href="${esc(ci.source_url)}">${esc(ci.citation)}</a>` : `${esc(ci.citation)} <em>(no source found)</em>`;
  const li = (xs, f = esc) => xs.length ? `<ul>${xs.map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '<p class="dim">None.</p>';
  let title, body;
  if (kind === 'case_note') {
    title = 'Advising case note';
    body = `<h2>Issues raised</h2>${r.cards.map((c) => `<h3>${esc(c.title)} <small>${esc(c.category)} · ${esc(c.status.replace('_', ' '))}${state.review[c.id] === 'edited' ? ' · edited by adviser' : ''}</small></h3><p>${esc(c.detail)}</p>${c.citations.length ? `<p class="cites">${c.citations.map((ci) => `${esc(ci.claim)} — ${cite(ci)}`).join('<br>')}</p>` : ''}`).join('')}
      <h2>Facts stated by the student</h2>${li(r.case_note.facts_stated_by_student)}
      <h2>Advice given</h2>${li(r.case_note.advice_given)}
      <h2>Regulatory basis</h2>${li(r.case_note.regulatory_basis, (ci) => `${esc(ci.claim)} — ${cite(ci)}`)}
      <h2>Dates</h2>${li(r.timeline, (t) => `${esc(t.label)}: ${esc(t.start)}${t.start !== t.end ? ' to ' + esc(t.end) : ''} <small>[${esc(t.source)}]</small>`)}
      <h2>Still to confirm</h2>${li(r.open_questions)}`;
  } else if (kind === 'student_summary') {
    title = 'Summary for the student';
    body = `<p class="big">${esc(r.student_summary)}</p><h2>Dates to remember</h2>${li(r.timeline, (t) => `${esc(t.label)}: ${esc(t.start)}${t.start !== t.end ? ' to ' + esc(t.end) : ''}`)}
      <h2>What you need to do</h2>${li(r.sevis_checklist.filter((k) => k.owner !== 'adviser'), (k) => `${esc(k.action)}${k.deadline !== 'none' ? ` (by ${esc(k.deadline)})` : ''}`)}
      <p class="dim">This summarises what your adviser told you in the meeting. It is not legal advice and nothing here changes your record until your adviser acts on it.</p>`;
  } else {
    title = 'SEVIS action checklist';
    body = `<table><tr><th></th><th>Action</th><th>Owner</th><th>Deadline</th><th>Rule</th></tr>${r.sevis_checklist.map((k) => `<tr><td>☐</td><td>${esc(k.action)}</td><td>${esc(k.owner)}</td><td>${esc(k.deadline)}</td><td><small>${esc(k.deadline_source)}</small></td></tr>`).join('')}</table>
      <h2>Still to confirm</h2>${li(r.open_questions)}`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Henry Listens</title><style>
    body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px} h1{font-size:22px;margin:0} h2{font-size:15px;margin:22px 0 6px;letter-spacing:.04em;text-transform:uppercase;color:#444} h3{font-size:15px;margin:14px 0 2px} h3 small{color:#777;font-weight:400;font-size:12px}
    .meta{color:#555;font-size:12.5px;margin:4px 0 18px;border-bottom:1px solid #ddd;padding-bottom:10px} .cites{font-size:12.5px;color:#333;margin:4px 0 0} a{color:#1a4fb4} .big{font-size:16px} .dim{color:#777;font-size:12.5px} ul{padding-left:20px} li{margin:3px 0}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px} th{background:#f3f3f3} td:first-child{width:20px;font-size:16px}
    .foot{margin-top:30px;border-top:1px solid #ddd;padding-top:8px;color:#777;font-size:11.5px} @media print{body{margin:0}}</style></head><body>
    <h1>${title}</h1><div class="meta">Henry Listens · appointment on ${new Date().toLocaleDateString()} · present: ${esc(roles)} · adviser signature: <b>${esc(signed)}</b></div>${body}
    <div class="foot">Identifiers were replaced by tokens before any model saw the conversation; this document contains none. Regulatory statements link to primary sources via HenryKnows. Every date was computed by code from facts stated in the meeting (rule ids shown). Synthetic demo; no real student.</div>
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
$('#drawer-toggle').onclick = () => $('body').classList.toggle('drawer-open');
if (MODE === 'sample') { $('#henry-says').textContent = 'Sample appointment (recorded, synthetic voices). Press Start to watch the record build itself.'; $('#sample').style.display = 'none'; if (params.get('autoplay')) $('#toggle').click(); }
