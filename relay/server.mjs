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

const PORT = Number(process.env.RELAY_PORT || 8787);
const KEY = process.env.MODEL_API_KEY;
if (!KEY) { console.error('MODEL_API_KEY missing (put it in .env; see .env.example)'); process.exit(1); }

const WEB = path.resolve(import.meta.dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
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
  const send = (o) => { if (client.readyState === client.OPEN) client.send(JSON.stringify(o)); };
  log('browser connected, mode', mode);

  const up = new AsrUpstream({ key: KEY, mode });
  up.on('event', (ev) => send(ev));
  up.on('close', ({ code, reason }) => { log('upstream closed', code, reason || ''); send({ type: 'relay', status: 'upstream_closed', code, reason, sentMs: Math.round(up.sentMs) }); client.close(1000); });
  up.on('error', (e) => { log('upstream error', e?.message || e); send({ type: 'relay', status: 'upstream_error' }); });

  try {
    const hs = await up.connect();
    log('upstream ready', hs.sessionId);
    send({ type: 'relay', status: 'ready', sessionId: hs.sessionId, mode });
  } catch (e) { log('upstream failed:', e.message); send({ type: 'relay', status: 'upstream_failed', message: e.message }); client.close(1011); return; }

  client.on('message', (data, isBinary) => {
    if (isBinary) return up.sendAudio(data);
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === 'end') { log('browser ended stream after', Math.round(up.sentMs), 'ms audio'); up.end(); }
  });
  client.on('close', () => { log('browser closed'); up.closed ? null : up.end(); setTimeout(() => up.abort(), 3000); });
});

server.listen(PORT, () => console.log(`Henry Listens relay  →  http://localhost:${PORT}   (ws /asr)`));
