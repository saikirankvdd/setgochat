'use strict';
/**
 * stego-frame-worker.js
 *
 * Runs ENTIRELY off the browser main thread.
 * Receives: webcamBitmap + coverBitmap (transferable ImageBitmaps, zero-copy)
 * Outputs: encoded frame drawn to OffscreenCanvas (main thread calls requestFrame)
 *
 * This eliminates ALL setInterval violations because the heavy CPU work
 * (pixel manipulation, PRNG, bit-packing, getImageData) no longer blocks
 * the main thread — freeing it for audio, UI, and WebRTC processing.
 */

// ─────────────────────────────────────────────────────────────
// JS PRNG  (exact mirror of VideoStegoEncoder.ts JS_PRNG)
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Header encryption helpers  (mirror VideoStegoEncoder.ts)
// ─────────────────────────────────────────────────────────────
function encryptFrameIndexJS(frameIndex, pin) {
  const prng = new JS_PRNG('VID_IDX_' + pin);
  const b = new Uint8Array(4);
  b[0] = (frameIndex >>> 24) & 0xFF;
  b[1] = (frameIndex >>> 16) & 0xFF;
  b[2] = (frameIndex >>>  8) & 0xFF;
  b[3] =  frameIndex         & 0xFF;
  for (let i = 0; i < 4; i++) b[i] ^= Math.floor(prng.next() * 256);
  return b;
}

function encryptLengthHeaderJS(length, seedPin) {
  const prng = new JS_PRNG('VID_HDR_' + seedPin);
  const b = new Uint8Array(4);
  b[0] = (length >>> 24) & 0xFF;
  b[1] = (length >>> 16) & 0xFF;
  b[2] = (length >>>  8) & 0xFF;
  b[3] =  length         & 0xFF;
  for (let i = 0; i < 4; i++) b[i] ^= Math.floor(prng.next() * 256);
  return b;
}

// ─────────────────────────────────────────────────────────────
// LSB bit embedding  (CPU, but runs in worker = no main thread block)
// Each pixel: R bit, G bit, B bit embedded into LSBs
// ─────────────────────────────────────────────────────────────
function embedBitsLSB(pixelData, allBits) {
  // pixelData is a Uint8ClampedArray [R,G,B,A, R,G,B,A, ...]
  let bitIdx = 0;
  const totalBits = allBits.length;
  for (let i = 0; i < pixelData.length && bitIdx < totalBits; i += 4) {
    if (bitIdx < totalBits) pixelData[i]   = (pixelData[i]   & 0xFE) | allBits[bitIdx++]; // R
    if (bitIdx < totalBits) pixelData[i+1] = (pixelData[i+1] & 0xFE) | allBits[bitIdx++]; // G
    if (bitIdx < totalBits) pixelData[i+2] = (pixelData[i+2] & 0xFE) | allBits[bitIdx++]; // B
    // Alpha (i+3) left untouched
  }
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let outputCanvas = null;   // OffscreenCanvas transferred from main thread
let thumbCanvas  = null;   // OffscreenCanvas 32×32  (webcam thumbnail)
let coverCanvas  = null;   // OffscreenCanvas w×h    (cover frame)
let width  = 640;
let height = 480;
let isProcessing = false;  // guard: skip if previous frame still running

// ─────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────
self.onmessage = async function(e) {
  const { type } = e.data;

  // ── INIT ─────────────────────────────────────────────────
  if (type === 'INIT') {
    width        = e.data.width  || 640;
    height       = e.data.height || 480;
    outputCanvas = e.data.outputCanvas;   // transferred OffscreenCanvas
    thumbCanvas  = new OffscreenCanvas(32, 32);
    coverCanvas  = new OffscreenCanvas(width, height);
    self.postMessage({ type: 'READY' });
    return;
  }

  // ── RESIZE ───────────────────────────────────────────────
  if (type === 'RESIZE') {
    width  = e.data.width;
    height = e.data.height;
    if (outputCanvas) { outputCanvas.width = width; outputCanvas.height = height; }
    coverCanvas = new OffscreenCanvas(width, height);
    self.postMessage({ type: 'RESIZE_DONE' });
    return;
  }

  // ── PROCESS_FRAME ─────────────────────────────────────────
  if (type === 'PROCESS_FRAME') {
    if (isProcessing) {
      // Still processing previous frame — drop this one and free GPU memory
      try { e.data.webcamBitmap.close(); } catch(_) {}
      try { e.data.coverBitmap.close();  } catch(_) {}
      self.postMessage({ type: 'FRAME_SKIPPED' });
      return;
    }
    isProcessing = true;
    const t0 = performance.now();

    const { webcamBitmap, coverBitmap, frameIndex, pin } = e.data;

    try {
      // ── 1. Draw 32×32 webcam thumbnail ───────────────────
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.drawImage(webcamBitmap, 0, 0, 32, 32);
      const thumbData = thumbCtx.getImageData(0, 0, 32, 32);
      webcamBitmap.close();

      // ── 2. Pack raw RGB payload with 'STEG' header ────────
      const rawRgbLen = 32 * 32 * 3;                       // 3072 bytes
      const payload   = new Uint8Array(4 + rawRgbLen);     // 3076 bytes
      payload[0] = 0x53; payload[1] = 0x54;               // 'ST'
      payload[2] = 0x45; payload[3] = 0x47;               // 'EG'
      for (let i = 0, j = 4; i < thumbData.data.length; i += 4, j += 3) {
        payload[j]     = thumbData.data[i];                // R
        payload[j + 1] = thumbData.data[i + 1];           // G
        payload[j + 2] = thumbData.data[i + 2];           // B
      }

      // ── 3. PRNG XOR encrypt (same seed as decoder) ────────
      const encPrng   = new JS_PRNG('VID_ENC_' + pin + '_' + frameIndex);
      const cipherBytes = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i++) {
        cipherBytes[i] = payload[i] ^ Math.floor(encPrng.next() * 256);
      }

      // ── 4. Convert cipherBytes → flat bit array ───────────
      const dataBitsArr = new Uint8Array(cipherBytes.length * 8);
      for (let i = 0; i < cipherBytes.length; i++) {
        const b = cipherBytes[i];
        for (let bit = 7; bit >= 0; bit--) {
          dataBitsArr[i * 8 + (7 - bit)] = (b >>> bit) & 1;
        }
      }

      // ── 5. Build encrypted header (5× redundancy = 320 bits) ──
      const encFrameIndex = encryptFrameIndexJS(frameIndex, pin);
      const encLength     = encryptLengthHeaderJS(dataBitsArr.length, pin + '_' + frameIndex);

      const allBits = new Uint8Array(320 + dataBitsArr.length);
      for (let rep = 0; rep < 5; rep++) {
        const offset = rep * 64;
        for (let i = 0; i < 32; i++) {
          allBits[offset + i]      = (encFrameIndex[Math.floor(i / 8)] >>> (7 - (i % 8))) & 1;
          allBits[offset + 32 + i] = (encLength[Math.floor(i / 8)]     >>> (7 - (i % 8))) & 1;
        }
      }
      allBits.set(dataBitsArr, 320);

      // ── 6. Get cover frame pixels ──────────────────────────
      const cctx = coverCanvas.getContext('2d');
      cctx.drawImage(coverBitmap, 0, 0, width, height);
      const coverImageData = cctx.getImageData(0, 0, width, height);
      coverBitmap.close();

      // Capacity guard (should never fire with 32×32 at 480p)
      const cols = Math.floor(width / 4);   // Using 4px blocks for LSB (simpler than 8×4)
      // Each pixel carries 3 bits → capacity = pixels * 3
      const capacity = (width * height) * 3;
      if (allBits.length > capacity) {
        console.warn(`[Stealth-Worker] payload ${allBits.length} > capacity ${capacity}. Skipping.`);
        coverBitmap.close();
        isProcessing = false;
        self.postMessage({ type: 'FRAME_SKIPPED' });
        return;
      }

      // ── 7. Embed bits into cover pixels (LSB) ─────────────
      embedBitsLSB(coverImageData.data, allBits);

      // ── 8. Write result to output OffscreenCanvas ─────────
      const outCtx = outputCanvas.getContext('2d');
      outCtx.putImageData(coverImageData, 0, 0);

      const duration = performance.now() - t0;
      self.postMessage({ type: 'FRAME_DONE', frameIndex, duration });

    } catch (err) {
      self.postMessage({ type: 'FRAME_ERROR', error: String(err) });
    }

    isProcessing = false;
  }
};
