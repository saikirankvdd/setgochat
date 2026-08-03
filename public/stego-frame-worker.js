'use strict';
/**
 * stego-frame-worker.js
 *
 * Runs ENTIRELY off the browser main thread.
 * Captures the webcam frame, compresses it to JPEG, encrypts it,
 * and passes it back to the main thread to send over the P2P Data Channel.
 * Renders the cover video completely clean (no visual noise, no CPU overhead).
 */

class JS_PRNG {
  constructor(seedString) {
    let hash = 5381;
    for (let i = 0; i < seedString.length; i++) {
      hash = ((hash << 5) + hash) ^ seedString.charCodeAt(i);
      hash |= 0;
    }
    this.seed = hash >>> 0;
  }
  next() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    this.seed = this.seed >>> 0;
    return this.seed / 4294967296;
  }
}

let outputCanvas = null;
let thumbCanvas  = null;
let width  = 640;
let height = 480;
let isProcessing = false;

self.onmessage = async function(e) {
  const { type } = e.data;

  if (type === 'INIT') {
    width        = e.data.width  || 640;
    height       = e.data.height || 480;
    outputCanvas = e.data.outputCanvas;
    thumbCanvas  = new OffscreenCanvas(160, 120);
    self.postMessage({ type: 'READY' });
    return;
  }

  if (type === 'RESIZE') {
    width  = e.data.width;
    height = e.data.height;
    if (outputCanvas) { outputCanvas.width = width; outputCanvas.height = height; }
    self.postMessage({ type: 'RESIZE_DONE' });
    return;
  }

  if (type === 'PROCESS_FRAME') {
    if (isProcessing) {
      try { e.data.webcamBitmap.close(); } catch(_) {}
      try { e.data.coverBitmap.close();  } catch(_) {}
      self.postMessage({ type: 'FRAME_SKIPPED' });
      return;
    }
    isProcessing = true;
    const t0 = performance.now();

    const { webcamBitmap, coverBitmap, frameIndex, pin } = e.data;

    try {
      // Dynamic high-clarity JPEG thumbnail size selection
      const THUMB_W = width <= 320 ? 160 : 320;
      const THUMB_H = width <= 320 ? 120 : 240;
      if (thumbCanvas.width !== THUMB_W || thumbCanvas.height !== THUMB_H) {
        thumbCanvas.width = THUMB_W;
        thumbCanvas.height = THUMB_H;
      }

      // ── 1. Draw webcam onto dynamic canvas ─────────
      const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
      thumbCtx.drawImage(webcamBitmap, 0, 0, THUMB_W, THUMB_H);
      webcamBitmap.close();

      // ── 2. Compress to high-efficiency JPEG ────────
      const blob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const arrayBuffer = await blob.arrayBuffer();
      const jpegBytes = new Uint8Array(arrayBuffer);

      // ── 3. Pack payload with 'STEG' magic ──────────
      const payload = new Uint8Array(4 + jpegBytes.length);
      payload[0] = 0x53; payload[1] = 0x54; // 'ST'
      payload[2] = 0x45; payload[3] = 0x47; // 'EG'
      payload.set(jpegBytes, 4);

      // ── 4. PRNG XOR encrypt ────────────────────────
      const encPrng = new JS_PRNG('VID_ENC_' + pin + '_' + frameIndex);
      const cipherBytes = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) {
        cipherBytes[i] = payload[i] ^ Math.floor(encPrng.next() * 256);
      }

      // ── 5. Draw cover frame directly to outputCanvas (completely clean) ──
      const outCtx = outputCanvas.getContext('2d', { willReadFrequently: false });
      outCtx.drawImage(coverBitmap, 0, 0, width, height);
      coverBitmap.close();

      const duration = performance.now() - t0;

      // Post the encrypted JPEG buffer back to the main thread (zero copy)
      self.postMessage({
        type: 'FRAME_DONE',
        frameIndex,
        duration,
        jpegBuffer: cipherBytes.buffer
      }, [cipherBytes.buffer]);

    } catch (err) {
      try { coverBitmap.close(); } catch(_) {}
      self.postMessage({ type: 'FRAME_ERROR', error: String(err) });
    }

    isProcessing = false;
  }
};
