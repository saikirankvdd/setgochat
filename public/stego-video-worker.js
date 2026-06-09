// public/stego-video-worker.js
let wasmEngine = null;
let workerReady = false;

async function initWasm() {
  try {
    const { default: wasmInit, StealthEngine } = await import('/stealth-engine/stealth_engine.js');
    const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
    const wasmBuffer = await response.arrayBuffer();
    await wasmInit({ module_or_path: wasmBuffer });
    wasmEngine = new StealthEngine();
    workerReady = true;
    self.postMessage({ type: 'WORKER_READY' });
  } catch (err) {
    console.error("Worker failed to initialize WASM:", err);
    self.postMessage({ type: 'WORKER_ERROR', error: err.message });
  }
}

initWasm();

self.onmessage = (event) => {
  const { type, pixels, dataBits, pin, frameIndex } = event.data;

  if (type === 'EMBED_FRAME') {
    if (!workerReady || !wasmEngine) {
      self.postMessage({ type: 'EMBED_DONE', frameIndex, pixels: null, error: 'WASM not ready' });
      return;
    }
    const pixelBytes = new Uint8Array(pixels);
    wasmEngine.process_video_frame(pixelBytes, dataBits, pin, frameIndex);
    // Transfer ownership back (zero-copy — no ArrayBuffer duplication)
    self.postMessage(
      { type: 'EMBED_DONE', frameIndex, pixels: pixelBytes.buffer },
      [pixelBytes.buffer]
    );
  }

  if (type === 'EXTRACT_FRAME') {
    if (!workerReady || !wasmEngine) {
      self.postMessage({ type: 'EXTRACT_DONE', frameIndex, bitString: '' });
      return;
    }
    const pixelBytes = new Uint8Array(pixels);
    const bitString = wasmEngine.extract_video_frame(pixelBytes, pin, frameIndex);
    self.postMessage({ type: 'EXTRACT_DONE', frameIndex, bitString });
  }
};
