// Upstream connection to Meta Muse Voice Transcribe (realtime WebSocket).
// One instance = one transcription session. The API key never leaves this process.
//
// Protocol (dev.meta.ai docs, verified by smoke test 2026-10-26):
//   1. open wss://api.meta.ai/v1/asr/realtime
//   2. first frame = JSON handshake carrying the key and the mode
//   3. then raw PCM16 mono 24 kHz audio as binary frames, 80 ms (3,840 bytes) each, at real time
//   4. events back as JSON text frames: speechStart, transcript (partial/final), speaker, speechEnd, speechComplete
//   5. {"type":"endStream"} to finish; server closes with 1000
import { EventEmitter } from 'node:events';

export const ASR_URL = 'wss://api.meta.ai/v1/asr/realtime';
export const SAMPLE_RATE = 24_000;
export const FRAME_MS = 80;
export const FRAME_BYTES = (SAMPLE_RATE * 2 * FRAME_MS) / 1000; // 3,840

export class AsrUpstream extends EventEmitter {
  /** @param {{ key: string, mode?: 'DIARIZATION'|'ENDPOINTING'|'PUSH_TO_TALK', model?: string }} opts */
  constructor({ key, mode = 'DIARIZATION', model = 'muse-voice-transcribe-1.0' }) {
    super();
    if (!key) throw new Error('MODEL_API_KEY missing');
    this.key = key; this.mode = mode; this.model = model;
    this.ws = null; this.ready = false; this.queue = []; this.sentBytes = 0; this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(ASR_URL);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        ws.send(JSON.stringify({
          authorization: { accessToken: `Bearer ${this.key}` },
          audioEncoding: 'PCM_24KHZ', model: this.model, mode: this.mode,
        }));
      };
      ws.onmessage = (m) => {
        let ev; try { ev = JSON.parse(String(m.data)); } catch { this.emit('raw', m.data); return; }
        if (!this.ready && ev.sessionId) {           // handshake accepted
          this.ready = true; this.sessionId = ev.sessionId;
          for (const f of this.queue) ws.send(f); this.queue = [];
          this.emit('ready', ev); resolve(ev); return;
        }
        this.emit('event', ev);
      };
      ws.onerror = (e) => { this.emit('error', e); if (!this.ready) reject(new Error('upstream error before handshake')); };
      ws.onclose = (e) => { this.closed = true; this.emit('close', { code: e.code, reason: e.reason }); if (!this.ready) reject(new Error(`upstream closed ${e.code} before handshake`)); };
    });
  }

  /** @param {ArrayBuffer|Buffer|Uint8Array} frame raw PCM16 mono 24 kHz */
  sendAudio(frame) {
    if (this.closed) return;
    const buf = frame instanceof ArrayBuffer ? frame : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    this.sentBytes += buf.byteLength;
    if (this.ready) this.ws.send(buf); else this.queue.push(buf);
  }

  end() {
    if (this.closed) return;
    try { this.ws.send(JSON.stringify({ type: 'endStream' })); } catch {}
  }

  abort() { try { this.ws?.close(1000); } catch {} }

  get sentMs() { return (this.sentBytes / (SAMPLE_RATE * 2)) * 1000; }
}
