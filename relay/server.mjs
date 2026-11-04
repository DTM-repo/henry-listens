// Henry Listens relay — dev server.
//  * serves web/ as static files
//  * /asr  : WebSocket. Browser sends raw PCM16 mono 24 kHz frames; relay forwards them to
//           Meta Voice Transcribe (DIARIZATION) and streams the transcript events back as JSON.
//  The API key lives here (MODEL_API_KEY in .env) and never reaches the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { AsrUpstream } from './asr-upstream.mjs';
import { Session } from './session.mjs';
import { redactPdf, readI20 } from './i20.mjs';
const sessions = new Map();   // asr sessionId → Session (for the I-20 upload)

const PORT = Number(process.env.RELAY_PORT || 8787);
const KEY = process.env.MODEL_API_KEY;
if (!KEY) { console.error('MODEL_API_KEY missing (put it in .env; see .env.example)'); process.exit(1); }

const WEB = path.resolve(import.meta.dirname, '..', 'web');
// cost guard: the relay pays for every minute of Voice Transcribe and every Spark call
const MAX_SESSIONS_PER_DAY = Number(process.env.MAX_SESSIONS_PER_DAY || 60), MAX_SESSION_MS = Number(process.env.MAX_SESSION_MS || 20 * 60_000);
let dayKey = '', daySessions = 0;
const sessionAllowed = () => { const k = new Date().toISOString().slice(0, 10); if (k !== dayKey) { dayKey = k; daySessions = 0; } return daySessions < MAX_SESSIONS_PER_DAY; };
const EVENT_LOG = process.env.RECORD_EVENTS || '';   // write every browser-facing event with a timestamp (makes the static sample for /?sample=)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'audio/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

const VOICE = path.join(WEB, 'voice'); fs.mkdirSync(VOICE, { recursive: true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, sessions_today: daySessions, cap: MAX_SESSIONS_PER_DAY })); }
  if (req.method === 'PUT' && /^\/voice\/(open|name|go|review)\.webm$/.test(url.pathname)) {   // save a recorded Henry line
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { fs.writeFileSync(path.join(VOICE, path.basename(url.pathname)), Buffer.concat(chunks)); res.writeHead(204); res.end(); console.log('saved', url.pathname, Buffer.concat(chunks).length, 'bytes'); }); return;
  }
  if (req.method === 'POST' && url.pathname === '/i20') {   // the student's I-20: redacted here, then read by Spark
    const session = sessions.get(url.searchParams.get('session') || '');
    if (!session) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no such session"}'); }
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks); if (buf.length > 8_000_000) throw new Error('PDF too large');
        const red = await redactPdf(buf, session.redactor);
        session.emit('out', { type: 'i20', stage: 'redacted', boxes: red.boxes, pages: red.pages });
        const { fields, usage } = await readI20(red.pdf, KEY);
        session.attachI20(fields, red.boxes); session.agent.usage.calls++; session.agent.usage.input += usage?.input_tokens || 0; session.agent.usage.output += usage?.output_tokens || 0;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, boxes: red.boxes, fields }));
      } catch (e) { console.log('i20 error', e.message); session.emit('out', { type: 'i20', stage: 'error', message: e.message }); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (url.pathname === '/relay-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(`window.RELAY_URL=${JSON.stringify(process.env.PUBLIC_RELAY_URL || '')};`); }
  let file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/asr' });
let n = 0;
wss.on('connection', async (client, req) => {
  const id = ++n;
  const mode = new URL(req.url, 'http://x').searchParams.get('mode') || 'DIARIZATION';
  const log = (...a) => console.log(`[asr#${id}]`, ...a);
  const t0 = Date.now(); const events = [];
  const send = (o) => { if (EVENT_LOG) events.push({ t: Date.now() - t0, ...o }); if (client.readyState === client.OPEN) client.send(JSON.stringify(o)); };
  log('browser connected, mode', mode);
  if (!sessionAllowed()) { log('daily session cap reached'); send({ type: 'relay', status: 'capped' }); return client.close(1013); }
  daySessions++;
  const killer = setTimeout(() => { log('session cap', MAX_SESSION_MS, 'ms'); send({ type: 'relay', status: 'time_cap' }); up.end(); }, MAX_SESSION_MS);

  const session = new Session({ key: KEY, log });
  session.on('out', (o) => send(o));
  // speaker attribution (Meta rule: a speaker event labels the audio behind it, back to the previous speaker event / speechStart)
  const spans = [], open = new Map(); let spanFrom = 0, last = null;
  const labelFor = (a, b) => { const c = {}; for (const s of spans) { const o = Math.min(b, s.end) - Math.max(a, s.start); if (o > 0) c[s.label] = (c[s.label] || 0) + o; } const best = Object.entries(c).sort((x, y) => y[1] - x[1])[0]; return best ? best[0] : last; };

  const up = new AsrUpstream({ key: KEY, mode });
  up.on('event', (ev) => {
    if (ev.type === 'audioProgress') return;
    if (ev.type === 'speaker') { spans.push({ label: ev.label, start: spanFrom, end: ev.audioProcessedMs }); spanFrom = ev.audioProcessedMs; last = ev.label; }
    if (ev.type === 'speechStart') { open.set(ev.turnId, ev.audioProcessedMs); spanFrom = Math.max(spanFrom, ev.audioProcessedMs); }
    if (ev.type === 'speechComplete') { const a = open.get(ev.turnId) ?? 0; open.delete(ev.turnId); session.addTurn({ label: labelFor(a, ev.audioProcessedMs), text: ev.transcript, start: a, end: ev.audioProcessedMs }); return; }
    if (ev.type === 'transcript' && !ev.final) { send({ type: 'partial', text: ev.transcript, role: session.roleOf(last) }); return; }
    if (ev.type === 'speechStart' || ev.type === 'speechEnd') send({ type: ev.type, turnId: ev.turnId });
  });
  up.on('close', ({ code, reason }) => { log('upstream closed', code, reason || ''); send({ type: 'relay', status: 'upstream_closed', code, reason, sentMs: Math.round(up.sentMs) }); session.end();
    // keep the browser socket open until the agent finishes its last pass
    const wait = () => (session.agent.running || session.agent.pending) ? setTimeout(wait, 500) : client.close(1000); wait(); });
  up.on('error', (e) => { log('upstream error', e?.message || e); send({ type: 'relay', status: 'upstream_error' }); });

  try {
    const hs = await up.connect();
    log('upstream ready', hs.sessionId);
    sessions.set(hs.sessionId, session); send({ type: 'relay', status: 'ready', sessionId: hs.sessionId, mode });
  } catch (e) { log('upstream failed:', e.message); send({ type: 'relay', status: 'upstream_failed', message: e.message }); client.close(1011); return; }

  const dump = process.env.DUMP_PCM ? fs.createWriteStream(`${process.env.DUMP_PCM}/asr-${id}.pcm`) : null;
  client.on('message', (data, isBinary) => {
    if (isBinary) { dump?.write(data); return up.sendAudio(data); }
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === 'end') { log('browser ended stream after', Math.round(up.sentMs), 'ms audio'); up.end(); session.end(); }
    if (msg.type === 'begin') session.begin();
    if (msg.type === 'mark' && EVENT_LOG) events.push({ t: Date.now() - t0, type: 'mark', name: String(msg.name).slice(0, 40) });
  });
  client.on('close', () => { log('browser closed'); clearTimeout(killer); for (const [k, v] of sessions) if (v === session) sessions.delete(k); if (EVENT_LOG) fs.writeFileSync(EVENT_LOG, JSON.stringify(events)); dump?.end(); up.closed ? null : up.end(); setTimeout(() => up.abort(), 3000); });
});

server.listen(PORT, () => console.log(`Henry Listens relay  →  http://localhost:${PORT}   (ws /asr)`));
