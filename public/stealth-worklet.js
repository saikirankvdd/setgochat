// stealth-worklet.js
// This runs on a separate audio thread to avoid blocking the main UI thread.

class StealthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    
    // State variables
    this.coverSamples = null;       // Float32Array of the 2-minute cover song
    this.coverIndex = 0;            // Current position in the cover song
    this.mode = 'idle';             // 'encode' | 'decode' | 'idle'
    this.encryptedVoiceBits = [];   // Queue of bits waiting to embed (encode mode)
    this.collectedBits = [];        // Bits extracted from received audio (decode mode)
    this.expectedBitsLength = 0;    // Expected length of the current packet being decoded
    this.pin = '';                  // Session PIN
    
    // Playback buffer for incoming voice samples
    this.playbackQueue = [];
    
    // WASM Engine instance (to be initialized in Stage 9)
    this.wasmEngine = null;
  }

  async handleMessage(event) {
    const data = event.data;
    if (data.type === 'INIT_WASM') {
      try {
        // Dynamic import inside AudioWorklet (supported in modern browsers)
        const initModule = await import('/stealth-engine/stealth_engine.js');
        await initModule.default(data.module);
        this.wasmEngine = new initModule.StealthEngine();
        console.log("AudioWorklet: WASM Engine Link Established.");
      } catch (err) {
        console.error("AudioWorklet: Failed to initialize WASM Engine:", err);
      }
    } else if (data.type === 'SET_COVER') {
      // Accept either a transferable ArrayBuffer (fast) or legacy Float32Array
      if (data.buffer instanceof ArrayBuffer) {
        this.coverSamples = new Float32Array(data.buffer);
      } else if (data.samples) {
        this.coverSamples = data.samples;
      }
      this.coverIndex = 0;
      console.log("AudioWorklet: Cover song buffer set. Length:", this.coverSamples ? this.coverSamples.length : 0);
    } else if (data.type === 'SET_PIN') {
      this.pin = data.pin;
      console.log("AudioWorklet: Session PIN loaded.");
    } else if (data.type === 'SET_MODE_ENCODE') {
      this.mode = 'encode';
      this.encryptedVoiceBits = [];
      console.log("AudioWorklet: Mode set to ENCODE.");
    } else if (data.type === 'SET_MODE_DECODE') {
      this.mode = 'decode';
      this.collectedBits = [];
      this.expectedBitsLength = 0;
      console.log("AudioWorklet: Mode set to DECODE.");
    } else if (data.type === 'SET_MODE_PLAYBACK') {
      this.mode = 'playback';
      this.playbackQueue = [];
      console.log("AudioWorklet: Mode set to PLAYBACK.");
    } else if (data.type === 'PUSH_PLAYBACK') {
      if (this.playbackQueue.length < 96000) { // Limit queue size to 2 seconds to prevent memory leaks
        this.playbackQueue.push(...data.samples);
      }
    } else if (data.type === 'PUSH_VOICE_BITS') {
      if (this.encryptedVoiceBits.length < 100000) { // Safety limit to avoid memory leaks
        this.encryptedVoiceBits.push(...data.bits);
      }
    } else if (data.type === 'STOP') {
      this.mode = 'idle';
      this.coverSamples = null;
      this.encryptedVoiceBits = [];
      this.collectedBits = [];
      this.expectedBitsLength = 0;
      this.playbackQueue = [];
      console.log("AudioWorklet: Stealth Mode Stopped.");
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // If there is no output buffer, we cannot do anything
    if (!output || !output.length) return true;

    const numChannels = output.length;
    const outputLength = output[0].length;

    if (this.mode === 'encode') {
      const outputChannel0 = output[0];
      
      // If cover samples are not loaded, just copy input to output as a fallback
      if (!this.coverSamples) {
        if (input && input[0]) {
          const inputChannel = input[0];
          for (let i = 0; i < outputLength; i++) {
            outputChannel0[i] = inputChannel[i];
          }
        } else {
          for (let i = 0; i < outputLength; i++) {
            outputChannel0[i] = 0;
          }
        }
      } else {
        // Fill output with cover song samples, embedding voice bits into LSBs
        if (this.wasmEngine) {
          // In Stage 9, use the Rust engine if it is active.
          // Copy cover song samples to outputChannel0
          for (let i = 0; i < outputLength; i++) {
            outputChannel0[i] = this.coverSamples[this.coverIndex];
            this.coverIndex++;
            if (this.coverIndex >= this.coverSamples.length) {
              this.coverIndex = 0;
            }
          }
          
          // Pull next bits from JS queue and set as WASM payload
          if (this.encryptedVoiceBits.length > 0) {
            const count = Math.min(outputLength, this.encryptedVoiceBits.length);
            const bits = this.encryptedVoiceBits.splice(0, count);
            
            // Set payload as byte array to WASM
            const bytes = new Uint8Array(Math.ceil(bits.length / 8));
            for (let b = 0; b < bits.length; b++) {
              const byteIdx = Math.floor(b / 8);
              const bitIdx = 7 - (b % 8);
              if (bits[b] === 1) {
                bytes[byteIdx] |= (1 << bitIdx);
              }
            }
            this.wasmEngine.set_payload(bytes);
            this.wasmEngine.process_audio_chunk(outputChannel0);
          }
        } else {
          // Use high-performance JS LSB embedding
          for (let i = 0; i < outputLength; i++) {
            let sample = this.coverSamples[this.coverIndex];
            
            if (this.encryptedVoiceBits.length > 0) {
              const bit = this.encryptedVoiceBits.shift();
              let s16 = Math.round(sample * 32767);
              s16 = bit === 1 ? (s16 | 1) : (s16 & ~1);
              sample = s16 / 32767;
            }
            
            outputChannel0[i] = sample;
            
            this.coverIndex++;
            if (this.coverIndex >= this.coverSamples.length) {
              this.coverIndex = 0; // Loop cover song
            }
          }
        }
      }

      // Copy channel 0 to all other channels
      for (let channel = 1; channel < numChannels; channel++) {
        const outputChannel = output[channel];
        for (let i = 0; i < outputLength; i++) {
          outputChannel[i] = outputChannel0[i];
        }
      }

    } else if (this.mode === 'decode') {
      // Decode mode: read from input (received WebRTC stream), extract bits
      if (!input || !input[0]) return true;
      const inputChannel0 = input[0];
      const outputChannel0 = output[0];

      for (let i = 0; i < outputLength; i++) {
        const sampleVal = inputChannel0[i];
        outputChannel0[i] = sampleVal;

        // Extract LSB
        const s16 = Math.round(sampleVal * 32767);
        const bit = s16 & 1;
        this.collectedBits.push(bit);
      }

      // Copy to other output channels
      for (let channel = 1; channel < numChannels; channel++) {
        const outputChannel = output[channel];
        for (let i = 0; i < outputLength; i++) {
          outputChannel[i] = outputChannel0[i];
        }
      }

      // Process stream packets using the 32-bit length header framing
      while (true) {
        if (this.expectedBitsLength === 0) {
          if (this.collectedBits.length >= 32) {
            // Read 32-bit length header
            let len = 0;
            for (let i = 0; i < 32; i++) {
              const bit = this.collectedBits[i];
              len = (len << 1) | bit;
            }
            this.expectedBitsLength = len;
            this.collectedBits.splice(0, 32);
          } else {
            break;
          }
        }

        if (this.expectedBitsLength > 0) {
          if (this.collectedBits.length >= this.expectedBitsLength) {
            const chunk = this.collectedBits.splice(0, this.expectedBitsLength);
            this.port.postMessage({ type: 'VOICE_BITS_READY', bits: chunk });
            this.expectedBitsLength = 0; // Reset for the next packet
          } else {
            break;
          }
        } else {
          // If expected length is 0 (after reading a 0-length header), reset it
          this.expectedBitsLength = 0;
          break;
        }
      }

    } else if (this.mode === 'playback') {
      const outputChannel0 = output[0];
      const chunkToPlay = this.playbackQueue.splice(0, outputLength);
      
      for (let i = 0; i < outputLength; i++) {
        outputChannel0[i] = i < chunkToPlay.length ? chunkToPlay[i] : 0;
      }
      
      // Copy to other channels
      for (let channel = 1; channel < numChannels; channel++) {
        const outputChannel = output[channel];
        for (let i = 0; i < outputLength; i++) {
          outputChannel[i] = outputChannel0[i];
        }
      }

    } else {
      // Idle/pass-through mode: copy input directly to output
      if (input && input[0]) {
        for (let channel = 0; channel < numChannels; channel++) {
          const inputChannel = input[channel] || input[0];
          const outputChannel = output[channel];
          if (outputChannel) {
            for (let i = 0; i < outputLength; i++) {
              outputChannel[i] = inputChannel[i];
            }
          }
        }
      } else {
        for (let channel = 0; channel < numChannels; channel++) {
          const outputChannel = output[channel];
          if (outputChannel) {
            for (let i = 0; i < outputLength; i++) {
              outputChannel[i] = 0;
            }
          }
        }
      }
    }

    return true;
  }
}

registerProcessor('stealth-processor', StealthProcessor);
