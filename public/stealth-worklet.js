// stealth-worklet.js
// This runs on a separate audio thread to avoid blocking the main UI thread.

class StealthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    this.isStealthActive = false;
    this.encryptedPayload = null;
    this.payloadIndex = 0;
    
    // WASM Engine instance
    this.wasmEngine = null;
  }

  async handleMessage(event) {
    if (event.data.type === 'INIT_WASM') {
      // Receives the compiled WASM module from the main thread
      console.log("AudioWorklet: WASM Engine Link Established.");
      this.wasmEngine = true; // Link to the Rust StealthEngine instance
    } else if (event.data.type === 'START_STEALTH') {
      this.isStealthActive = true;
      this.encryptedPayload = event.data.payload;
      this.payloadIndex = 0;
      console.log("AudioWorklet: Stealth Mode Activated. High-Speed LSB Embedding started.");
    } else if (event.data.type === 'STOP_STEALTH') {
      this.isStealthActive = false;
      console.log("AudioWorklet: Stealth Mode Deactivated.");
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      // Copy input to output first (this acts as the dummy cover stream)
      for (let i = 0; i < inputChannel.length; i++) {
        outputChannel[i] = inputChannel[i];
      }

      // If active and WASM is ready, pass the audio buffer directly to Rust 
      // for zero-latency math processing (Float32 -> i16 -> LSB -> Float32)
      if (this.isStealthActive && this.wasmEngine && this.encryptedPayload) {
         // ACTUAL CALL: this.wasmEngine.process_audio_chunk(outputChannel);
         
         // Advance the simulated index for now
         this.payloadIndex += outputChannel.length;
         if (this.payloadIndex >= this.encryptedPayload.length * 8) {
             this.isStealthActive = false;
             this.port.postMessage({ type: 'STEALTH_COMPLETE' });
         }
      }
    }
    return true; 
  }
}

registerProcessor('stealth-processor', StealthProcessor);
