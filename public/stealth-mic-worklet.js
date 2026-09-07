// stealth-mic-worklet.js
// Runs on the dedicated AudioWorklet thread — completely separate from React/main JS thread.
// Captures raw mic samples from any hardware sample rate (48000Hz, 44100Hz, 32000Hz, etc.),
// downsamples accurately to 16000 Hz using linear interpolation, converts to Int16, and posts to main thread.
// Main thread then does: gzip → encrypt → dc.send (all <1ms, no thread blocking).

class StealthMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.accumulator = new Float32Array(0);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];
    // Send audio chunks of 960 samples @ 16kHz (60ms audio per packet)
    const outputChunkSize = 960;
    const requiredInputSamples = Math.round(outputChunkSize * (inRate / 16000));

    // Append input to accumulator
    const newAcc = new Float32Array(this.accumulator.length + inputChannel.length);
    newAcc.set(this.accumulator);
    newAcc.set(inputChannel, this.accumulator.length);
    this.accumulator = newAcc;

    // Safety cap: if accumulator exceeds 4x required input samples (backlog > 240ms), trim old samples
    // to prevent memory bloat and keep packet transmission real-time and under 3,000 bytes.
    const maxAccumulator = 4 * requiredInputSamples;
    if (this.accumulator.length > maxAccumulator) {
      this.accumulator = this.accumulator.slice(this.accumulator.length - maxAccumulator);
    }

    while (this.accumulator.length >= requiredInputSamples) {
      const inputChunk = this.accumulator.subarray(0, requiredInputSamples);
      this.accumulator = this.accumulator.slice(requiredInputSamples);

      const downsampled = new Int16Array(outputChunkSize);
      const ratio = (inputChunk.length - 1) / (outputChunkSize - 1 || 1);

      for (let i = 0; i < outputChunkSize; i++) {
        const srcPos = i * ratio;
        const idx = Math.floor(srcPos);
        const frac = srcPos - idx;
        const s0 = inputChunk[idx] || 0;
        const s1 = (idx + 1 < inputChunk.length) ? inputChunk[idx + 1] : s0;
        
        // Exact linear interpolation for true 16000 Hz output
        const interpolated = s0 + (s1 - s0) * frac;
        const clamped = Math.max(-1.0, Math.min(1.0, interpolated));
        downsampled[i] = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
      }

      // Transfer the Int16Array buffer (zero-copy) to the main thread
      this.port.postMessage({ type: 'MIC_CHUNK_READY', samples: downsampled }, [downsampled.buffer]);
    }

    return true;
  }
}

registerProcessor('stealth-mic-processor', StealthMicProcessor);

