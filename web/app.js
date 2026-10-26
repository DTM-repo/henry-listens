// Henry Listens — Day 1: live diarized transcript.
// mic → AudioWorklet (PCM16 24 kHz, 80 ms frames) → ws://relay/asr → Meta Voice Transcribe → events → this page.
const $ = (s) => document.querySelector(s);
const turnsEl = $('#turns'), liveEl = $('#live'), statusEl = $('#status'), logEl = $('#log'), btn = $('#toggle');
const ROLE = { A: 'Adviser', B: 'Student' };           // first voice heard = adviser (the demo opens with the adviser speaking)
const state = { ws: null, ctx: null, stream: null, node: null, running: false, frames: 0, t0: 0, speaker: null, turns: [] };

const setStatus = (t, cls = '') => { statusEl.textContent = t; statusEl.className = cls; };
const log = (o) => { const d = document.createElement('div'); d.textContent = typeof o === 'string' ? o : JSON.stringify(o); logEl.prepend(d); while (logEl.children.length > 200) logEl.lastChild.remove(); };
const label = (sp) => sp ? `${ROLE[sp] || 'Speaker ' + sp} (${sp})` : '…';
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function renderLive(text, sp) {
  liveEl.innerHTML = text ? `<span class="who ${sp || ''}">${label(sp)}</span> ${text}` : '';
}
function addTurn(ev) {
  const sp = ev.speaker ?? ev.speakerLabel ?? state.speaker;
  const turn = { id: ev.turnId, speaker: sp, text: (ev.transcript || '').trim(), at: ev.audioProcessedMs ?? 0 };
  if (!turn.text) return;
  state.turns.push(turn);
  const el = document.createElement('div');
  el.className = `turn ${sp || ''}`;
  el.innerHTML = `<span class="t">${mmss(turn.at)}</span><span class="who ${sp || ''}">${label(sp)}</span><span class="text"></span>`;
  el.querySelector('.text').textContent = turn.text;
  turnsEl.append(el); el.scrollIntoView({ block: 'end' });
  renderLive('');
  $('#count').textContent = `${state.turns.length} turn${state.turns.length === 1 ? '' : 's'}`;
}
function handle(ev) {
  switch (ev.type) {
    case 'relay': setStatus(ev.status === 'ready' ? `listening · ${ev.mode} · ${ev.sessionId.slice(-8)}` : `relay: ${ev.status}${ev.message ? ' — ' + ev.message : ''}`, ev.status === 'ready' ? 'ok' : 'warn'); if (ev.status !== 'ready') log(ev); break;
    case 'speaker': state.speaker = ev.label ?? ev.speaker; log(ev); break;
    case 'speechStart': state.speaker = ev.speaker ?? ev.speakerLabel ?? state.speaker; break;
    case 'transcript': if (!ev.final) renderLive(ev.transcript, ev.speaker ?? ev.speakerLabel ?? state.speaker); break;
    case 'speechComplete': addTurn(ev); break;
    case 'speechEnd': break;
    default: log(ev);
  }
}

async function start() {
  setStatus('asking for microphone…');
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  try { state.ctx = new AudioContext({ sampleRate: 24000 }); } catch { state.ctx = new AudioContext(); }
  await state.ctx.audioWorklet.addModule('/pcm-worklet.js');
  const src = state.ctx.createMediaStreamSource(state.stream);
  state.node = new AudioWorkletNode(state.ctx, 'pcm-frames');
  src.connect(state.node);                      // no connect to destination: we do not play the mic back

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/asr?mode=${$('#mode').value}`);
  ws.binaryType = 'arraybuffer';
  state.ws = ws;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('relay unreachable')); });
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { log('bad event ' + m.data); } };
  ws.onclose = (e) => { setStatus(`closed (${e.code})`, 'warn'); stop(false); };

  state.t0 = performance.now(); state.frames = 0;
  state.node.port.onmessage = (m) => { if (ws.readyState === 1) { ws.send(m.data); state.frames++; if (state.frames % 25 === 0) $('#clock').textContent = mmss(state.frames * 80); } };
  state.running = true; btn.textContent = 'Stop'; btn.className = 'stop';
  setStatus('connecting to Voice Transcribe…');
}
function stop(sendEnd = true) {
  if (!state.running) return;
  state.running = false;
  try { if (sendEnd && state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'end' })); } catch {}
  state.node?.disconnect(); state.stream?.getTracks().forEach((t) => t.stop()); state.ctx?.close();
  btn.textContent = 'Start listening'; btn.className = '';
  setStatus(`stopped · ${mmss(state.frames * 80)} of audio`);
}
btn.onclick = () => (state.running ? stop() : start().catch((e) => { setStatus(e.message, 'warn'); stop(false); }));
$('#copy').onclick = () => navigator.clipboard.writeText(state.turns.map((t) => `[${mmss(t.at)}] ${label(t.speaker)}: ${t.text}`).join('\n'));
