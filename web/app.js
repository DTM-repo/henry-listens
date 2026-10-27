// Henry Listens — the stage. Mic (or ?src= replay) → relay → Meta Voice Transcribe → relay agent (Spark + tools) → this page.
// What the room sees: the record building itself. The transcript lives in a drawer, already redacted.
const $ = (s) => document.querySelector(s);
const state = { ws: null, ctx: null, stream: null, node: null, audio: null, running: false, frames: 0, phase: 'idle', roles: {}, turns: [], record: null };
const ROLE_LABEL = { student: 'Student', adviser: 'Adviser', other: 'Other' };
const CATS = ['Employment', 'Enrollment', 'Program end', 'Travel', 'Status', 'Other'];

const RITUAL = {
  open: "This is Henry Listens. Don't mind me. I'll sit in on the meeting and take notes, then give you a complete assessment to take with you. I keep it private: no names, no personal details. I'm here so nothing gets missed and nobody has to take notes. Before we start, let's check the mics. Could each of you introduce yourself as a student, an adviser, or something else?",
  name: "I'll just write 'student' so we don't keep personal information.",
  go: "We're all set. Go ahead. Forget about me. I'm furniture.",
};
function speak(text) {
  $('#henry-says').textContent = text;
  if (!('speechSynthesis' in window) || $('#mute').checked) return Promise.resolve();
  return new Promise((res) => { const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.onend = res; u.onerror = res; speechSynthesis.cancel(); speechSynthesis.speak(u); });
}
const setStatus = (t, cls = '') => { $('#status').textContent = t; $('#status').className = cls; };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- stage rendering ----------
function renderCards() {
  const wrap = $('#cards'); const seen = new Set();
  for (const c of state.record?.cards || []) {
    seen.add(c.id);
    let el = wrap.querySelector(`[data-id="${CSS.escape(c.id)}"]`);
    const fresh = !el;
    if (fresh) { el = document.createElement('article'); el.className = 'card enter'; el.dataset.id = c.id; wrap.append(el); setTimeout(() => el.classList.remove('enter'), 900); }
    const cites = c.citations.map((ci) => ci.source_url ? `<a class="cite" href="${esc(ci.source_url)}" target="_blank" title="${esc(ci.claim)}">${esc(ci.citation)}</a>` : `<span class="cite none" title="${esc(ci.claim)}">${esc(ci.citation)}</span>`).join('');
    const html = `<div class="cat">${esc(c.category)}</div><h3>${esc(c.title)}</h3><p>${esc(c.detail)}</p><div class="cites">${cites}</div><div class="st ${c.status}">${c.status.replace('_', ' ')}</div>`;
    if (el.innerHTML !== html) { el.innerHTML = html; if (!fresh) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 900); } }
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
    row.innerHTML = `<div class="tl-track"><div class="tl-bar ${single ? 'mark' : ''} ${t.source === 'stated' ? 'stated' : ''}" style="left:${pct(t.start)}%;width:${single ? 0.6 : Math.max(0.6, pct(t.end) - pct(t.start))}%"></div></div><div class="tl-label">${esc(t.label)} <span class="dim">${esc(t.start)}${single ? '' : ' → ' + esc(t.end)}</span></div>`;
    el.append(row);
  }
  const today = document.createElement('div'); today.className = 'tl-today'; today.style.left = pct(new Date().toISOString().slice(0, 10)) + '%'; el.append(today);
}
function renderChecklist() {
  const el = $('#checklist'); el.innerHTML = '';
  for (const k of state.record?.sevis_checklist || []) { const li = document.createElement('li'); li.innerHTML = `<span class="owner ${k.owner}">${esc(k.owner)}</span> ${esc(k.action)} ${k.deadline && k.deadline !== 'none' ? `<span class="dl">by ${esc(k.deadline)}</span>` : ''}`; el.append(li); }
  const q = $('#questions'); q.innerHTML = '';
  for (const s of state.record?.open_questions || []) { const li = document.createElement('li'); li.textContent = s; q.append(li); }
}
function renderTranscript() {
  const el = $('#transcript'); el.innerHTML = '';
  for (const t of state.turns) { const d = document.createElement('div'); d.className = `turn ${t.role}`; d.innerHTML = `<span class="t">${mmss(t.start)}</span><span class="who">${esc(ROLE_LABEL[t.role] || t.role)}</span><span class="text">${esc(t.text).replace(/\[([A-Z_0-9]+)\]/g, '<mark>[$1]</mark>')}</span>`; el.append(d); }
  $('#turn-count').textContent = `${state.turns.length} turns`;
}
function activity(a) {
  const el = $('#activity'); const d = document.createElement('div'); d.className = `act ${a.kind}`;
  d.textContent = a.kind === 'tool' ? `${a.name}(${Object.values(a.args).filter(Boolean).join(', ').slice(0, 80)})` : a.kind === 'tool_result' ? `↳ ${a.name}: ${a.summary} · ${a.ms} ms` : a.kind === 'thinking' ? `Henry ${a.text}` : a.text;
  el.prepend(d); while (el.children.length > 12) el.lastChild.remove();
  $('#henry-mark').classList.toggle('busy', a.kind === 'thinking' || a.kind === 'tool');
}

// ---------- events from the relay ----------
async function handle(ev) {
  switch (ev.type) {
    case 'relay': if (ev.status === 'ready') { setStatus('listening', 'ok'); if (state.phase === 'idle') { state.phase = 'intro'; speak(RITUAL.open); } } else setStatus(`relay: ${ev.status}`, 'warn'); break;
    case 'role_bound': state.roles[ev.label] = ev.role; $('#roles').textContent = Object.values(state.roles).map((r) => ROLE_LABEL[r] || r).join(' · '); if (ev.said_name) speak(RITUAL.name); break;
    case 'phase': state.phase = ev.phase; $('body').dataset.phase = ev.phase; if (ev.phase === 'meeting') speak(RITUAL.go); if (ev.phase === 'review') { setStatus('meeting over — finishing the record', 'ok'); $('#henry-says').textContent = 'Here is what I have. Walk through it together; nothing leaves until the adviser signs.'; } break;
    case 'partial': $('#live').textContent = ev.text ? `${ROLE_LABEL[ev.role] || ev.role}: ${ev.text}` : ''; break;
    case 'turn': state.turns.push(ev); renderTranscript(); $('#live').textContent = ''; break;
    case 'activity': activity(ev); break;
    case 'record': state.record = ev.record; renderCards(); renderTimeline(); renderChecklist(); $('#usage').textContent = `${ev.usage.calls} calls · ${(ev.usage.input / 1000).toFixed(1)}k in / ${(ev.usage.output / 1000).toFixed(1)}k out`; $('#henry-mark').classList.remove('busy'); break;
    case 'speechStart': $('#henry-mark').classList.add('hearing'); break;
    case 'speechEnd': $('#henry-mark').classList.remove('hearing'); break;
  }
}

// ---------- audio capture ----------
async function start() {
  const replay = new URLSearchParams(location.search).get('src');
  try { state.ctx = new AudioContext({ sampleRate: 24000 }); } catch { state.ctx = new AudioContext(); }
  await state.ctx.audioWorklet.addModule('/pcm-worklet.js');
  let src;
  if (replay) { state.audio = new Audio(replay); src = state.ctx.createMediaElementSource(state.audio); state.audio.onended = () => setTimeout(() => stop(), 1500); }
  else { setStatus('asking for microphone…'); state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); src = state.ctx.createMediaStreamSource(state.stream); }
  state.node = new AudioWorkletNode(state.ctx, 'pcm-frames'); src.connect(state.node);
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/asr`); ws.binaryType = 'arraybuffer'; state.ws = ws;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('relay unreachable')); });
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  ws.onclose = (e) => { if (state.phase !== 'review') setStatus(`closed (${e.code})`, 'warn'); stop(false); };
  state.frames = 0;
  state.node.port.onmessage = (m) => {
    if (ws.readyState === 1) { ws.send(m.data); state.frames++; if (state.frames % 25 === 0) $('#clock').textContent = mmss(state.frames * 80); }
    if (state.frames % 5 === 0) { const v = new Int16Array(m.data); let sum = 0; for (let i = 0; i < v.length; i += 4) sum += v[i] * v[i]; $('#level').style.width = Math.min(100, Math.sqrt(sum / (v.length / 4)) / 32768 * 400) + '%'; }
  };
  state.running = true; $('#toggle').textContent = 'End meeting'; $('#toggle').className = 'stop'; $('#begin').style.display = '';
  setStatus('connecting…');
  if (state.audio) { if (replay.includes('dialog2')) ws.send(JSON.stringify({ type: 'begin' })); await state.audio.play(); }
}
function stop(sendEnd = true) {
  if (!state.running) return; state.running = false;
  try { if (sendEnd && state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'end' })); } catch {}
  state.node?.disconnect(); state.stream?.getTracks().forEach((t) => t.stop()); state.audio?.pause(); state.ctx?.close();
  $('#toggle').textContent = 'Start'; $('#toggle').className = ''; $('#begin').style.display = 'none';
}
$('#toggle').onclick = () => (state.running ? stop() : start().catch((e) => { setStatus(e.message, 'warn'); stop(false); }));
$('#begin').onclick = () => state.ws?.send(JSON.stringify({ type: 'begin' }));
$('#drawer-toggle').onclick = () => $('body').classList.toggle('drawer-open');
$('#export').onclick = () => { const blob = new Blob([JSON.stringify(state.record, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'henry-record.json'; a.click(); };
