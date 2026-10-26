// AudioWorklet: microphone float samples → PCM16 mono 24 kHz, posted in 80 ms frames (1,920 samples).
// If the AudioContext could not be opened at 24 kHz, we resample linearly here (good enough for speech).
class PcmFrames extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = 24000;
    this.ratio = sampleRate / this.target;     // sampleRate = the context's real rate (global in worklet scope)
    this.frame = 1920;
    this.buf = new Int16Array(this.frame);
    this.n = 0;
    this.pos = 0;                               // fractional read position for resampling
    this.carry = new Float32Array(0);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    // concat carry + new samples, then step through at this.ratio
    const src = new Float32Array(this.carry.length + ch.length);
    src.set(this.carry); src.set(ch, this.carry.length);
    let i = this.pos;
    while (i + 1 < src.length) {
      const i0 = i | 0, f = i - i0;
      const s = src[i0] * (1 - f) + src[i0 + 1] * f;
      this.buf[this.n++] = s < 0 ? Math.max(-1, s) * 0x8000 : Math.min(1, s) * 0x7fff;
      if (this.n === this.frame) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(this.frame); this.n = 0; }
      i += this.ratio;
    }
    const keep = i | 0;
    this.carry = src.subarray(keep);
    this.pos = i - keep;
    return true;
  }
}
registerProcessor('pcm-frames', PcmFrames);
