// Mic-free test: stream an audio file to Voice Transcribe at real time and print the events.
//   node --env-file=.env relay/send-file.mjs path/to/audio.(wav|m4a|mp3|pcm) [MODE]
// Any format ffmpeg can read is converted on the fly to PCM16 mono 24 kHz. A .pcm is sent as is.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { AsrUpstream, FRAME_BYTES, FRAME_MS } from './asr-upstream.mjs';

const [file, mode = 'DIARIZATION'] = process.argv.slice(2);
if (!file) { console.error('usage: send-file.mjs <audio> [DIARIZATION|ENDPOINTING|PUSH_TO_TALK]'); process.exit(1); }

const pcm = file.endsWith('.pcm') ? fs.readFileSync(file)
  : await new Promise((res, rej) => {
      const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
      const chunks = []; p.stdout.on('data', (c) => chunks.push(c)); p.stderr.on('data', (c) => process.stderr.write(c));
      p.on('close', (c) => c === 0 ? res(Buffer.concat(chunks)) : rej(new Error('ffmpeg exit ' + c)));
    });
console.log(`audio: ${(pcm.length / 48000).toFixed(1)} s, ${Math.ceil(pcm.length / FRAME_BYTES)} frames, mode ${mode}`);

const up = new AsrUpstream({ key: process.env.MODEL_API_KEY, mode });
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6) + 's';
const turns = [];
up.on('event', (ev) => {
  if (ev.type === 'transcript' && !ev.final) { process.stdout.write(`\r${stamp()} … ${ev.transcript.slice(-70).padEnd(70)}`); return; }
  process.stdout.write('\r' + ' '.repeat(90) + '\r');
  if (ev.type === 'speechComplete') { turns.push(ev); console.log(`${stamp()} [${ev.speaker ?? ev.speakerLabel ?? '?'}] turn ${ev.turnId}: ${ev.transcript}`); }
  else console.log(`${stamp()} ${ev.type}`, JSON.stringify(ev).slice(0, 200));
});
up.on('close', ({ code }) => { console.log(`${stamp()} closed ${code}; ${turns.length} turns`); process.exit(0); });

const hs = await up.connect();
console.log(`${stamp()} session ${hs.sessionId}`);
// real-time pacing: one 80 ms frame every 80 ms
let i = 0;
const tick = setInterval(() => {
  if (i >= pcm.length) { clearInterval(tick); up.end(); return; }
  up.sendAudio(pcm.subarray(i, i + FRAME_BYTES)); i += FRAME_BYTES;
}, FRAME_MS);
setTimeout(() => { console.log('timeout'); up.abort(); process.exit(1); }, (pcm.length / 48) + 20000);
