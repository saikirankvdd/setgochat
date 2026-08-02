'use strict';
/**
 * stego-decode-worker.js
 *
 * Runs ENTIRELY off the browser main thread.
 * Receives: remoteFrameBitmap (transferable ImageBitmap, zero-copy)
 * Outputs: decoded face as RGB bytes via postMessage back to main thread
 *
 * LSB extraction exactly mirrors stego-frame-worker.js embedding:
 *   Per pixel: R-bit, G-bit, B-bit extracted in sequential order.
 */

// ─────────────────────────────────────────────────────────────
// JS PRNG  (exact mirror of stego-frame-worker.js)
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
// Header decryption helpers  (mirror stego-frame-worker.js)
// ─────────────────────────────────────────────────────────────
function decryptFrameIndexJS(encBytes, pin) {
  const prng = new JS_PRNG('VID_IDX_' + pin);
  const dec = new Uint8Array(4);
  for (let i = 0; i < 4; i++) dec[i] = encBytes[i] ^ Math.floor(prng.next() * 256);
  return ((dec[0] << 24) | (dec[1] << 16) | (dec[2] << 8) | dec[3]) >>> 0;
}

function decryptLengthHeaderJS(encBytes, pin) {
  const prng = new JS_PRNG('VID_HDR_' + pin);
  const dec = new Uint8Array(4);
  for (let i = 0; i < 4; i++) dec[i] = encBytes[i] ^ Math.floor(prng.next() * 256);
  return ((dec[0] << 24) | (dec[1] << 16) | (dec[2] << 8) | dec[3]) >>> 0;
}

// ─────────────────────────────────────────────────────────────
// LSB bit extraction — MUST mirror embedBitsLSB in stego-frame-worker.js
// Sequential: pixel[0].R, pixel[0].G, pixel[0].B, pixel[1].R, ...
// ─────────────────────────────────────────────────────────────
function extractBitsLSB(pixelData, numBits) {
  const bits = new Uint8Array(numBits);
  let bitIdx = 0;
  for (let i = 0; i < pixelData.length && bitIdx < numBits; i += 4) {
    if (bitIdx < numBits) bits[bitIdx++] = pixelData[i]   & 1; // R
    if (bitIdx < numBits) bits[bitIdx++] = pixelData[i+1] & 1; // G
    if (bitIdx < numBits) bits[bitIdx++] = pixelData[i+2] & 1; // B
    // Alpha (i+3) not used
  }
  return bits;
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let decodeCanvas  = null;   // OffscreenCanvas for reading remote frame
let width  = 640;
let height = 480;
let isProcessing = false;
let lastDecodedFrameIndex = -1;
let pin = '';

const THUMB_W = 32;
const THUMB_H = 32;
const HEADER_BITS = 320;          // 5 × 64 bits redundancy
const PAYLOAD_BITS = (4 + THUMB_W * THUMB_H * 3) * 8; // 3076 bytes × 8 = 24608 bits
const TOTAL_BITS_TO_EXTRACT = HEADER_BITS + PAYLOAD_BITS;

// ─────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────
self.onmessage = async function(e) {
  const { type } = e.data;

  // ── INIT ─────────────────────────────────────────────────
  if (type === 'INIT') {
    width  = e.data.width  || 640;
    height = e.data.height || 480;
    pin    = e.data.pin    || '';
    decodeCanvas = new OffscreenCanvas(width, height);
    self.postMessage({ type: 'READY' });
    return;
  }

  // ── SET_PIN ───────────────────────────────────────────────
  if (type === 'SET_PIN') {
    pin = e.data.pin;
    return;
  }

  // ── RESIZE ───────────────────────────────────────────────
  if (type === 'RESIZE') {
    width  = e.data.width;
    height = e.data.height;
    decodeCanvas = new OffscreenCanvas(width, height);
    self.postMessage({ type: 'RESIZE_DONE' });
    return;
  }

  // ── DECODE_FRAME ──────────────────────────────────────────
  if (type === 'DECODE_FRAME') {
    if (isProcessing) {
      try { e.data.frameBitmap.close(); } catch(_) {}
      self.postMessage({ type: 'DECODE_SKIPPED' });
      return;
    }
    isProcessing = true;
    const t0 = performance.now();

    const { frameBitmap } = e.data;

    try {
      // ── 1. Draw remote frame to OffscreenCanvas ────────────
      const ctx = decodeCanvas.getContext('2d');
      ctx.drawImage(frameBitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      frameBitmap.close();

      const pixels = imageData.data;
      const totalCapacity = (width * height) * 3; // bits available via LSB

      if (TOTAL_BITS_TO_EXTRACT > totalCapacity) {
        // Frame too small — can't extract
        isProcessing = false;
        self.postMessage({ type: 'DECODE_NO_FRAME' });
        return;
      }

      // ── 2. Extract ALL bits we need in one pass ────────────
      const allBits = extractBitsLSB(pixels, TOTAL_BITS_TO_EXTRACT);

      // ── 3. Majority vote over 5× redundant header (320 bits) ──
      const votedHeader = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        let sum = 0;
        for (let rep = 0; rep < 5; rep++) sum += allBits[rep * 64 + i];
        votedHeader[i] = sum >= 3 ? 1 : 0;
      }

      // ── 4. Parse frame index (header bits 0..31) ───────────
      const encFrameBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        encFrameBytes[Math.floor(i / 8)] |= (votedHeader[i] << (7 - (i % 8)));
      }
      const frameIndex = decryptFrameIndexJS(encFrameBytes, pin);

      if (frameIndex < 0 || frameIndex >= 1000000) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'bad_frame_index' });
        return;
      }

      if (frameIndex === lastDecodedFrameIndex) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_DUPLICATE' });
        return;
      }

      // ── 5. Parse data length (header bits 32..63) ──────────
      const encLenBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        encLenBytes[Math.floor(i / 8)] |= (votedHeader[32 + i] << (7 - (i % 8)));
      }
      const dataLength = decryptLengthHeaderJS(encLenBytes, pin + '_' + frameIndex);

      if (dataLength <= 0 || dataLength > PAYLOAD_BITS) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'bad_data_length', dataLength });
        return;
      }

      // ── 6. Extract data bits and pack into bytes ────────────
      const numBytes = Math.ceil(dataLength / 8);
      const cipherBytes = new Uint8Array(numBytes);
      for (let i = 0; i < dataLength; i++) {
        cipherBytes[Math.floor(i / 8)] |= (allBits[HEADER_BITS + i] << (7 - (i % 8)));
      }

      // ── 7. PRNG XOR decrypt (mirror of encoder) ────────────
      const decPrng = new JS_PRNG('VID_ENC_' + pin + '_' + frameIndex);
      const plainBytes = new Uint8Array(cipherBytes.length);
      for (let i = 0; i < cipherBytes.length; i++) {
        plainBytes[i] = cipherBytes[i] ^ Math.floor(decPrng.next() * 256);
      }

      // ── 8. Verify 'STEG' magic header ─────────────────────
      if (plainBytes.length < 4 ||
          plainBytes[0] !== 0x53 || plainBytes[1] !== 0x54 ||
          plainBytes[2] !== 0x45 || plainBytes[3] !== 0x47) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'bad_magic' });
        return;
      }

      // ── 9. Decode 32×32 RGB face ───────────────────────────
      const rgbBytes = plainBytes.subarray(4);
      const expectedLen = THUMB_W * THUMB_H * 3;

      if (rgbBytes.length < expectedLen) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'short_payload' });
        return;
      }

      // Build RGBA ImageData for transfer back
      const rgba = new Uint8ClampedArray(THUMB_W * THUMB_H * 4);
      for (let i = 0, j = 0; i < expectedLen; i += 3, j += 4) {
        rgba[j]     = rgbBytes[i];
        rgba[j + 1] = rgbBytes[i + 1];
        rgba[j + 2] = rgbBytes[i + 2];
        rgba[j + 3] = 255;
      }

      lastDecodedFrameIndex = frameIndex;
      const duration = performance.now() - t0;

      // Transfer the pixel buffer zero-copy back to main thread
      self.postMessage({
        type: 'DECODE_SUCCESS',
        frameIndex,
        duration,
        thumbW: THUMB_W,
        thumbH: THUMB_H,
        rgba: rgba.buffer
      }, [rgba.buffer]);

    } catch (err) {
      self.postMessage({ type: 'DECODE_ERROR', error: String(err) });
    }

    isProcessing = false;
  }
};
