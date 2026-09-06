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
      // At 48kHz -> downsample to 16kHz = 1/3 ratio.
      // 16kHz preserves all human speech (up to 8kHz Nyquist) — eliminates robotic consonant distortion.
      // 480 output samples × 3 = 1440 input samples per packet.
      this.targetLength = sampleRate === 48000 ? 1440 : 1024;
      this.downsampleRatio = sampleRate / 16000;
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

      // Downsample 48kHz->16kHz with a 3-tap FIR low-pass filter [0.25, 0.5, 0.25].
      // Proper anti-aliasing prevents the robotic metallic buzz from box-filter aliasing.
      const ratio = Math.round(this.downsampleRatio); // = 3 for 48kHz->16kHz
      const outLen = Math.floor(chunk.length / ratio);
      const downsampled = new Int16Array(outLen);

      for (let i = 0; i < outLen; i++) {
        const center = i * ratio;
        const s0 = center > 0 ? chunk[center - 1] : chunk[center];
        const s1 = chunk[center];
        const s2 = (center + 1 < chunk.length) ? chunk[center + 1] : chunk[center];
        const filtered = 0.25 * s0 + 0.5 * s1 + 0.25 * s2;
        const clamped = Math.max(-1.0, Math.min(1.0, filtered));
        downsampled[i] = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
      }

      // Transfer the Int16Array buffer (zero-copy) to the main thread
      this.port.postMessage({ type: 'MIC_CHUNK_READY', samples: downsampled }, [downsampled.buffer]);
    }

    return true;
  }
}

registerProcessor('stealth-mic-processor', StealthMicProcessor);
