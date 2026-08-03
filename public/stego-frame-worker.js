'use strict';
/**
 * stego-frame-worker.js
 *
 * Runs ENTIRELY off the browser main thread.
 * Uses robust block-based differential brightness steganography.
 * Compresses the thumbnail to JPEG format to achieve high clarity.
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

function embedBitsBlockDifferential(pixelData, allBits, width, height) {
  const cols = Math.floor(width / 8);
  const rows = Math.floor(height / 4);
  const targetDiff = 120.0;
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

      let shiftR = 0, shiftG = 0, shiftB = 0;

      if (blockPairIdx < 320) {
        const lumaA = (avgAr + avgAg + avgAb) / 3.0;
        const lumaB = (avgBr + avgBg + avgBb) / 3.0;
        const diff = lumaA - lumaB;
        const targetBit = blockPairIdx < allBits.length ? allBits[blockPairIdx] : 0;
        let shift = 0;
        if (targetBit === 1 && diff <= targetDiff) {
          shift = Math.ceil((targetDiff - diff) / 2.0);
        } else if (targetBit === 0 && diff >= -targetDiff) {
          shift = -Math.ceil((diff + targetDiff) / 2.0);
        }
        shiftR = shift;
        shiftG = shift;
        shiftB = shift;
      } else {
        const diffR = avgAr - avgBr;
        const targetBitR = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        if (targetBitR === 1 && diffR <= targetDiff) {
          shiftR = Math.ceil((targetDiff - diffR) / 2.0);
        } else if (targetBitR === 0 && diffR >= -targetDiff) {
          shiftR = -Math.ceil((diffR + targetDiff) / 2.0);
        }

        const diffG = avgAg - avgBg;
        const targetBitG = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        if (targetBitG === 1 && diffG <= targetDiff) {
          shiftG = Math.ceil((targetDiff - diffG) / 2.0);
        } else if (targetBitG === 0 && diffG >= -targetDiff) {
          shiftG = -Math.ceil((diffG + targetDiff) / 2.0);
        }

        const diffB = avgAb - avgBb;
        const targetBitB = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        if (targetBitB === 1 && diffB <= targetDiff) {
          shiftB = Math.ceil((targetDiff - diffB) / 2.0);
        } else if (targetBitB === 0 && diffB >= -targetDiff) {
          shiftB = -Math.ceil((diffB + targetDiff) / 2.0);
        }
      }

      for (let y = 0; y < 4; y++) {
        const rowOffset = (startYA + y) * width;
        for (let x = 0; x < 4; x++) {
          const idxA = (rowOffset + startXA + x) * 4;
          pixelData[idxA]     = Math.max(0, Math.min(255, pixelData[idxA]     + shiftR));
          pixelData[idxA + 1] = Math.max(0, Math.min(255, pixelData[idxA + 1] + shiftG));
          pixelData[idxA + 2] = Math.max(0, Math.min(255, pixelData[idxA + 2] + shiftB));

          const idxB = (rowOffset + startXB + x) * 4;
          pixelData[idxB]     = Math.max(0, Math.min(255, pixelData[idxB]     - shiftR));
          pixelData[idxB + 1] = Math.max(0, Math.min(255, pixelData[idxB + 1] - shiftG));
          pixelData[idxB + 2] = Math.max(0, Math.min(255, pixelData[idxB + 2] - shiftB));
        }
      }
    }
  }
}

let outputCanvas = null;
let thumbCanvas  = null;
let coverCanvas  = null;
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
    coverCanvas  = new OffscreenCanvas(width, height);
    self.postMessage({ type: 'READY' });
    return;
  }

  if (type === 'RESIZE') {
    width  = e.data.width;
    height = e.data.height;
    if (outputCanvas) { outputCanvas.width = width; outputCanvas.height = height; }
    coverCanvas = new OffscreenCanvas(width, height);
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
      const THUMB_W = width <= 320 ? 80 : 160;
      const THUMB_H = width <= 320 ? 60 : 120;
      if (thumbCanvas.width !== THUMB_W || thumbCanvas.height !== THUMB_H) {
        thumbCanvas.width = THUMB_W;
        thumbCanvas.height = THUMB_H;
      }

      // ── 1. Draw webcam onto dynamic canvas ─────────
      const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
      thumbCtx.drawImage(webcamBitmap, 0, 0, THUMB_W, THUMB_H);
      webcamBitmap.close();

      // ── 2. Compress to high-efficiency JPEG ────────
      const blob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.4 });
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

      // ── 5. Convert to bit array ────────────────────
      const dataBitsArr = new Uint8Array(cipherBytes.length * 8);
      for (let i = 0; i < cipherBytes.length; i++) {
        const b = cipherBytes[i];
        for (let bit = 7; bit >= 0; bit--) {
          dataBitsArr[i * 8 + (7 - bit)] = (b >>> bit) & 1;
        }
      }

      // ── 6. Build 5x redundant headers ──────────────
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

      // ── 7. Get cover frame pixels ──────────────────
      const cctx = coverCanvas.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(coverBitmap, 0, 0, width, height);
      const coverImageData = cctx.getImageData(0, 0, width, height);
      coverBitmap.close();

      // ── 8. Embed using differential brightness ──────
      embedBitsBlockDifferential(coverImageData.data, allBits, width, height);

      // ── 9. Draw output to OffscreenCanvas ──────────
      const outCtx = outputCanvas.getContext('2d', { willReadFrequently: false });
      outCtx.putImageData(coverImageData, 0, 0);

      const duration = performance.now() - t0;
      self.postMessage({ type: 'FRAME_DONE', frameIndex, duration });

    } catch (err) {
      self.postMessage({ type: 'FRAME_ERROR', error: String(err) });
    }

    isProcessing = false;
  }
};
