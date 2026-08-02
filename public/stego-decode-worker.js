'use strict';
/**
 * stego-decode-worker.js
 *
 * Runs ENTIRELY off the browser main thread.
 * Uses robust block-based differential brightness steganography extraction.
 * Survives lossy WebRTC compression (VP8/H.264).
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

/**
 * Extracts bits using block-based differential brightness.
 * Block size: 8x4 pixels per block-pair.
 * Block A: left 4x4. Block B: right 4x4.
 */
function extractBitsBlockDifferential(pixelData, width, height, maxUsable) {
  const cols = Math.floor(width / 8);
  const rows = Math.floor(height / 4);
  const bits = new Uint8Array(maxUsable);
  let bitIdx = 320;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const blockPairIdx = r * cols + c;
      const startXA = c * 8;
      const startYA = r * 4;
      const startXB = startXA + 4;

      let sumAr = 0, sumAg = 0, sumAb = 0;
      let sumBr = 0, sumBg = 0, sumBb = 0;

      for (let y = 0; y < 4; y++) {
        const rowOffset = (startYA + y) * width;
        for (let x = 0; x < 4; x++) {
          const idxA = (rowOffset + startXA + x) * 4;
          sumAr += pixelData[idxA];
          sumAg += pixelData[idxA + 1];
          sumAb += pixelData[idxA + 2];

          const idxB = (rowOffset + startXB + x) * 4;
          sumBr += pixelData[idxB];
          sumBg += pixelData[idxB + 1];
          sumBb += pixelData[idxB + 2];
        }
      }

      const avgAr = sumAr / 16.0;
      const avgAg = sumAg / 16.0;
      const avgAb = sumAb / 16.0;

      const avgBr = sumBr / 16.0;
      const avgBg = sumBg / 16.0;
      const avgBb = sumBb / 16.0;

      if (blockPairIdx < 320) {
        // Header: 1 bit per block-pair, using Luma (R+G+B)/3
        const lumaA = (avgAr + avgAg + avgAb) / 3.0;
        const lumaB = (avgBr + avgBg + avgBb) / 3.0;
        const diff = lumaA - lumaB;
        bits[blockPairIdx] = diff > 0.0 ? 1 : 0;
      } else {
        // Data: 3 bits per block-pair (R, G, B independently)
        if (bitIdx < maxUsable) bits[bitIdx++] = (avgAr - avgBr) > 0.0 ? 1 : 0;
        if (bitIdx < maxUsable) bits[bitIdx++] = (avgAg - avgBg) > 0.0 ? 1 : 0;
        if (bitIdx < maxUsable) bits[bitIdx++] = (avgAb - avgBb) > 0.0 ? 1 : 0;
      }
    }
  }

  return bits;
}

let decodeCanvas  = null;
let width  = 640;
let height = 480;
let isProcessing = false;
let lastDecodedFrameIndex = -1;
let pin = '';

const HEADER_BITS = 320;

self.onmessage = async function(e) {
  const { type } = e.data;

  if (type === 'INIT') {
    width  = e.data.width  || 640;
    height = e.data.height || 480;
    pin    = e.data.pin    || '';
    decodeCanvas = new OffscreenCanvas(width, height);
    decodeCanvas.getContext('2d', { willReadFrequently: true });
    self.postMessage({ type: 'READY' });
    return;
  }

  if (type === 'SET_PIN') {
    pin = e.data.pin;
    return;
  }

  if (type === 'RESIZE') {
    width  = e.data.width;
    height = e.data.height;
    decodeCanvas = new OffscreenCanvas(width, height);
    decodeCanvas.getContext('2d', { willReadFrequently: true });
    self.postMessage({ type: 'RESIZE_DONE' });
    return;
  }

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
      const ctx = decodeCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(frameBitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      frameBitmap.close();

      const pixels = imageData.data;
      const cols = Math.floor(width / 8);
      const rows = Math.floor(height / 4);
      const totalCapacity = ((cols * rows) - 320) * 3 + 320;

      if (HEADER_BITS > totalCapacity) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_NO_FRAME' });
        return;
      }

      // ── 1. Extract block-based bits ────────────────────────
      const allBits = extractBitsBlockDifferential(pixels, width, height, totalCapacity);

      // ── 2. Majority vote over 5x redundant header ──────────
      const votedHeader = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        let sum = 0;
        for (let rep = 0; rep < 5; rep++) sum += allBits[rep * 64 + i];
        votedHeader[i] = sum >= 3 ? 1 : 0;
      }

      // ── 3. Parse frame index ───────────────────────────────
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

      // ── 4. Parse data length ───────────────────────────────
      const encLenBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        encLenBytes[Math.floor(i / 8)] |= (votedHeader[32 + i] << (7 - (i % 8)));
      }
      const dataLength = decryptLengthHeaderJS(encLenBytes, pin + '_' + frameIndex);

      if (dataLength <= 0 || (HEADER_BITS + dataLength) > totalCapacity) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'bad_data_length', dataLength });
        return;
      }

      // ── 5. Extract cipher bytes ────────────────────────────
      const numBytes = Math.ceil(dataLength / 8);
      const cipherBytes = new Uint8Array(numBytes);
      for (let i = 0; i < dataLength; i++) {
        cipherBytes[Math.floor(i / 8)] |= (allBits[HEADER_BITS + i] << (7 - (i % 8)));
      }

      // ── 6. Decrypt payload ─────────────────────────────────
      const decPrng = new JS_PRNG('VID_ENC_' + pin + '_' + frameIndex);
      const plainBytes = new Uint8Array(cipherBytes.length);
      for (let i = 0; i < cipherBytes.length; i++) {
        plainBytes[i] = cipherBytes[i] ^ Math.floor(decPrng.next() * 256);
      }

      // ── 7. Verify STEG magic ───────────────────────────────
      if (plainBytes.length < 4 ||
          plainBytes[0] !== 0x53 || plainBytes[1] !== 0x54 ||
          plainBytes[2] !== 0x45 || plainBytes[3] !== 0x47) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'bad_magic' });
        return;
      }

      // ── 8. Decode dynamic size RGB face (16x16 or 32x32) ──
      const rgbBytes = plainBytes.subarray(4);
      const numPixels = Math.floor(rgbBytes.length / 3);
      const THUMB_W = Math.round(Math.sqrt(numPixels));
      const THUMB_H = THUMB_W;
      const expectedLen = THUMB_W * THUMB_H * 3;

      if (rgbBytes.length < expectedLen) {
        isProcessing = false;
        self.postMessage({ type: 'DECODE_INVALID', reason: 'short_payload' });
        return;
      }

      const rgba = new Uint8ClampedArray(THUMB_W * THUMB_H * 4);
      for (let i = 0, j = 0; i < expectedLen; i += 3, j += 4) {
        rgba[j]     = rgbBytes[i];
        rgba[j + 1] = rgbBytes[i + 1];
        rgba[j + 2] = rgbBytes[i + 2];
        rgba[j + 3] = 255;
      }

      lastDecodedFrameIndex = frameIndex;
      const duration = performance.now() - t0;

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
