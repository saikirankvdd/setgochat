// stealth-mic-worklet.js
// Runs on the dedicated AudioWorklet thread — completely separate from React/main JS thread.
// Captures raw mic samples, accumulates them into 2040-sample voice packets,
// downsamples 48000→8000 Hz, converts to Int16, and posts to main thread.
// Main thread then does: gzip → encrypt → dc.send (all <1ms, no thread blocking).

class StealthMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.accumulator = new Float32Array(0);
    this.targetLength = 0; // set once we know sampleRate
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];

    // Determine packet accumulation size from sampleRate (global in AudioWorklet)
    if (this.targetLength === 0) {
      // At 48kHz → downsample to 8kHz = 1/6 ratio.
      // We want 255 output samples per packet (matches original logic).
      // 255 * 6 = 1530 input samples. Use 2040 at 48kHz or 2048 otherwise.
      this.targetLength = sampleRate === 48000 ? 2040 : 2048;
      this.downsampleRatio = sampleRate / 8000;
    }

    // Append input to accumulator
    const newAcc = new Float32Array(this.accumulator.length + inputChannel.length);
    newAcc.set(this.accumulator);
    newAcc.set(inputChannel, this.accumulator.length);
    this.accumulator = newAcc;

    // Process all full packets from accumulator
    while (this.accumulator.length >= this.targetLength) {
      const chunk = this.accumulator.slice(0, this.targetLength);
      this.accumulator = this.accumulator.slice(this.targetLength);

      // Downsample: simple averaging (equivalent to downsampleAudio on main thread)
      const ratio = this.downsampleRatio;
      const outLen = Math.round(chunk.length / ratio);
      const downsampled = new Int16Array(outLen);

      for (let i = 0; i < outLen; i++) {
        const start = Math.round(i * ratio);
        const end = Math.round((i + 1) * ratio);
        let sum = 0;
        let count = 0;
        for (let j = start; j < end && j < chunk.length; j++) {
          sum += chunk[j];
          count++;
        }
        const sample = count > 0 ? sum / count : 0;
        // Clamp and convert to Int16
        const clamped = Math.max(-1.0, Math.min(1.0, sample));
        downsampled[i] = Math.max(-32768, Math.min(32767, Math.floor(clamped * 32767)));
      }

      // Transfer the Int16Array buffer (zero-copy) to the main thread
      this.port.postMessage({ type: 'MIC_CHUNK_READY', samples: downsampled }, [downsampled.buffer]);
    }

    return true;
  }
}

registerProcessor('stealth-mic-processor', StealthMicProcessor);
