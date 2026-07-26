import { encryptData, stringToBinary, getSha256Key, fastEncrypt, uint8ToBase64, uint8ToWordArray, wordArrayToUint8 } from './crypto';
import { gzipSync } from 'fflate';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';
import CryptoJS from 'crypto-js';

export class VideoStegoEncoder {
  private localStream: MediaStream;
  private pin: string;
  private width: number;
  private height: number;
  private onProgress: (pct: number) => void;
  private frameIndex: number;
  private clipSequence: number[];
  private videoEls: HTMLVideoElement[];
  private webcamVideoEl: HTMLVideoElement | null;
  private captureCanvas: HTMLCanvasElement | null;
  private coverCanvas: HTMLCanvasElement | null;
  private outputCanvas: HTMLCanvasElement | null;
  private downscaledCanvas: HTMLCanvasElement | null = null;
  private stegoStream: MediaStream | null;
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;
  private onStegoFrame?: (pngBuffer: Uint8Array, frameIndex: number) => void;
  private onFrameProcessTime?: (durationMs: number) => void;
  private targetFps: number = 30; // Default to 30 FPS for smooth video
  private masterKey: CryptoJS.lib.WordArray | null = null;
  private isProcessingFrame: boolean = false; // Re-entrancy guard to prevent timer queue flooding
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Web Worker for non-blocking pixel LSB embedding
  private videoWorker: Worker | null = null;
  private workerReady: boolean = false;

  // Frame diff skipping to optimize CPU on static frames
  private lastFrameHash: string = '';
  private frameSkipCounter: number = 0;

  constructor(
    localStream: MediaStream,
    pin: string,
    resolution: '240p' | '480p' | '1080p',
    onProgress: (pct: number) => void,
    onStegoFrame?: (pngBuffer: Uint8Array, frameIndex: number) => void,
    onFrameProcessTime?: (durationMs: number) => void
  ) {
    this.localStream = localStream;
    this.pin = pin;
    if (resolution === '1080p') {
      this.width = 1920;
      this.height = 1080;
    } else if (resolution === '240p') {
      this.width = 320;
      this.height = 240;
    } else {
      this.width = 640;
      this.height = 480;
    }
    this.onProgress = onProgress;
    this.onStegoFrame = onStegoFrame;
    this.frameIndex = 0;
    this.clipSequence = getClipSequence(pin);
    this.videoEls = [];
    this.webcamVideoEl = null;
    this.captureCanvas = null;
    this.coverCanvas = null;
    this.outputCanvas = null;
    this.stegoStream = null;
    this.isRunning = false;
    this.wasmEngine = null;
    this.onFrameProcessTime = onFrameProcessTime;
  }

  async init(): Promise<void> {
    // Pre-hash PIN once to get master key for fast stream encryption
    this.masterKey = getSha256Key(this.pin);

    // 1. Preload cover videos
    this.videoEls = await preloadClips();

    // 2. Initialize WASM Engine (fallback)
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit({ module_or_path: wasmBuffer });
      this.wasmEngine = new StealthEngine();
      console.log("[Stealth-Video-Encoder] Rust WASM Engine active (fallback).");
    } catch (err) {
      console.warn("[Stealth-Video-Encoder] Rust WASM Engine failed, falling back to JS:", err);
    }

    // 3. Initialize Web Worker
    try {
      this.videoWorker = new Worker('/stego-video-worker.js', { type: 'module' });
      this.videoWorker.onmessage = (e) => {
        if (e.data.type === 'WORKER_READY') {
          this.workerReady = true;
          console.log("[Stealth-Video-Encoder] Web Worker ready.");
        } else if (e.data.type === 'WORKER_ERROR') {
          console.error("[Stealth-Video-Encoder] Web Worker initialization failed:", e.data.error);
        }
      };
    } catch (workerErr) {
      console.error("[Stealth-Video-Encoder] Failed to spawn Web Worker:", workerErr);
    }
    
    // 4. Create hidden video element to read localStream (webcam)
    this.webcamVideoEl = document.createElement('video');
    this.webcamVideoEl.srcObject = this.localStream;
    this.webcamVideoEl.muted = true;
    this.webcamVideoEl.playsInline = true;
    
    if (typeof document !== 'undefined') {
      let container = document.getElementById('stealth-video-preload-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'stealth-video-preload-container';
        Object.assign(container.style, {
          position: 'fixed',
          width: '1px',
          height: '1px',
          opacity: '0.01',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: '-9999',
          top: '0',
          left: '0'
        });
        document.body.appendChild(container);
      }
      container.appendChild(this.webcamVideoEl);
    }

    await this.webcamVideoEl.play();

    // 5. Create helper canvases
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = this.width;
    this.captureCanvas.height = this.height;

    this.coverCanvas = document.createElement('canvas');
    this.coverCanvas.width = this.width;
    this.coverCanvas.height = this.height;

    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.width = this.width;
    this.outputCanvas.height = this.height;

    this.downscaledCanvas = document.createElement('canvas');
    this.downscaledCanvas.width = 20;
    this.downscaledCanvas.height = 15;

    // 6. Capture output stream at 30 fps
    this.stegoStream = (this.outputCanvas as any).captureStream(30);
  }

  getStegoStream(): MediaStream {
    if (!this.stegoStream) {
      throw new Error('VideoStegoEncoder not initialized');
    }
    return this.stegoStream;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    // Use setInterval instead of recursive setTimeout to prevent async chain memory growth
    const intervalMs = Math.max(100, Math.floor(1000 / this.targetFps));
    this.intervalId = setInterval(this.processFrame, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.webcamVideoEl) {
      this.webcamVideoEl.pause();
      this.webcamVideoEl.srcObject = null;
      if (this.webcamVideoEl.parentNode) {
        this.webcamVideoEl.parentNode.removeChild(this.webcamVideoEl);
      }
    }
    // Pause all cover videos to save CPU
    this.videoEls.forEach(vid => {
      try {
        if (!vid.paused) vid.pause();
      } catch (e) {}
    });
    // Terminate worker to free up resources
    if (this.videoWorker) {
      this.videoWorker.terminate();
      this.videoWorker = null;
      this.workerReady = false;
    }
  }

  private processFrame = async (): Promise<void> => {
    if (!this.isRunning) return;
    // Re-entrancy guard: skip this tick if previous frame still processing
    if (this.isProcessingFrame) return;
    this.isProcessingFrame = true;
    const startTime = performance.now();

    try {
      const webcam = this.webcamVideoEl;
      const captureCanvas = this.captureCanvas;
      const coverCanvas = this.coverCanvas;
      const outputCanvas = this.outputCanvas;

      if (!webcam || !captureCanvas || !coverCanvas || !outputCanvas) return;

      const capCtx = captureCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (!capCtx || !outCtx) return;

      // 1. Draw webcam to capture canvas
      capCtx.drawImage(webcam, 0, 0, this.width, this.height);

      // --- 1a. Frame Diff Skipping ---
      const cx = Math.floor(this.width / 2) - 16;
      const cy = Math.floor(this.height / 2) - 16;
      const sampleData = capCtx.getImageData(cx, cy, 32, 32);
      let quickHash = 0;
      for (let i = 0; i < sampleData.data.length; i += 16) {
        quickHash = ((quickHash << 5) + quickHash) ^ sampleData.data[i];
        quickHash |= 0;
      }
      const hashStr = quickHash.toString(16);

      if (hashStr === this.lastFrameHash) {
        this.frameSkipCounter++;
        if (this.frameSkipCounter < 3) {
          // Skip identical frame — just release the lock, interval will fire next tick
          this.isProcessingFrame = false;
          return;
        }
      }
      this.lastFrameHash = hashStr;
      this.frameSkipCounter = 0;

      // 2. Extract and compress raw RGB bytes (60x45) using gzipSync
      const totalPixels = this.width * this.height;
      const maxPayloadBits = Math.floor(totalPixels / 8) - 64; // 4x4 Luma block stego capacity; 24x18 face fits within budget

      let base64 = '';
      let encrypted = '';
      let dataBits = '';

      // Encode face as JPEG (quality 30) — gives ~1000 bytes for 160x120, fitting our 9,536-bit budget
      // This is 44x more pixels than raw RGB at 24x18!
      const W = 160;
      const H = 120;
      const downscaledCanvas = this.downscaledCanvas || document.createElement('canvas');
      if (!this.downscaledCanvas) {
        this.downscaledCanvas = downscaledCanvas;
        downscaledCanvas.width = W;
        downscaledCanvas.height = H;
      }
      const downCtx = downscaledCanvas.getContext('2d', { willReadFrequently: true });

      if (!downCtx) {
        this.isProcessingFrame = false;
        return;
      }

      downscaledCanvas.width = W;
      downscaledCanvas.height = H;
      downCtx.drawImage(captureCanvas, 0, 0, W, H);

      // Get JPEG bytes asynchronously via toBlob (most efficient path)
      const jpegBytes = await new Promise<Uint8Array>((resolve) => {
        downscaledCanvas.toBlob((blob) => {
          if (!blob) { resolve(new Uint8Array(0)); return; }
          blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
        }, 'image/jpeg', 0.30); // quality 0.30 = very small file, still recognisable face
      });

      if (jpegBytes.length === 0) {
        this.isProcessingFrame = false;
        return;
      }

      // Add 4-byte magic header 'STEG' before encryption (no gzip needed — JPEG is already compressed)
      const rawWithHeader = new Uint8Array(4 + jpegBytes.length);
      rawWithHeader[0] = 0x53; // 'S'
      rawWithHeader[1] = 0x54; // 'T'
      rawWithHeader[2] = 0x45; // 'E'
      rawWithHeader[3] = 0x47; // 'G'
      rawWithHeader.set(jpegBytes, 4);

      // AES encrypt directly without gzip (JPEG is already compressed)
      const payloadWA = uint8ToWordArray(rawWithHeader);
      const iv = CryptoJS.lib.WordArray.create([0, 0, 0, this.frameIndex]);
      const encryptedWA = CryptoJS.AES.encrypt(payloadWA, this.masterKey!, { iv: iv });
      const cipherWA = encryptedWA.ciphertext;

      // Convert encrypted bytes directly to a Uint8Array of bits (0 or 1) — avoids string allocation
      const words = cipherWA.words;
      const sigBytes = cipherWA.sigBytes;
      const dataBitsArr = new Uint8Array(sigBytes * 8);
      for (let i = 0; i < sigBytes; i++) {
        const wordIdx = i >>> 2;
        const byteIdx = 3 - (i % 4);
        const b = (words[wordIdx] >>> (byteIdx * 8)) & 0xff;
        for (let bit = 7; bit >= 0; bit--) {
          dataBitsArr[i * 8 + (7 - bit)] = (b >>> bit) & 1;
        }
      }

      if (dataBitsArr.length > maxPayloadBits) {
        console.warn(`[Stealth-Video] Frame ${this.frameIndex} too large (${dataBitsArr.length} bits). Max is ${maxPayloadBits}. Skipping.`);
        this.frameIndex++;
        this.isProcessingFrame = false;
        return; // interval will fire next tick
      }

      // 3. Get active cover clip and extract its frame
      const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
      
      // Pause all inactive cover videos, and play the active one
      this.videoEls.forEach((vid, idx) => {
        try {
          if (idx === clipIdx) {
            if (vid.paused) {
              vid.play().catch(() => {});
            }
          } else {
            if (!vid.paused) {
              vid.pause();
            }
          }
        } catch (vidErr) {}
      });

      const coverVideo = this.videoEls[clipIdx];
      const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
      const pixels = coverImageData.data;

      // Send the stego frame losslessly as a PNG via callback asynchronously (if enabled)
      const currentFrameIdx = this.frameIndex;
      const triggerStegoFrameCallback = () => {
        if (this.onStegoFrame) {
          outputCanvas.toBlob((blob) => {
            if (blob && this.isRunning) {
              blob.arrayBuffer().then((buffer) => {
                if (this.isRunning && this.onStegoFrame) {
                  this.onStegoFrame(new Uint8Array(buffer), currentFrameIdx);
                }
              });
            }
          }, 'image/png');
        }
      };

      if (false) {
        // Web Worker LSB disabled to force robust differential fallback
      } else {
        // Spatial 2x2 Block Differential Steganography (survives H.264 & YUV420p compression)
        const cols = Math.floor(this.width / 8);
        const rows = Math.floor(this.height / 4);
        const maxUsable = (cols * rows) - 64;
        const dataLength = Math.min(dataBitsArr.length, maxUsable);

        // Helper functions for 4x4 Luma block stego
        const getBlockLuma = (pixArr: Uint8ClampedArray, w: number, x: number, y: number): number => {
          let sum = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const idx = ((y + dy) * w + (x + dx)) * 4;
              sum += (pixArr[idx] + pixArr[idx+1] + pixArr[idx+2]) / 3;
            }
          }
          return sum / 16;
        };

        const setBlockLumaAbsolute = (pixArr: Uint8ClampedArray, w: number, x: number, y: number, val: number) => {
          const clamped = Math.min(255, Math.max(0, val));
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const idx = ((y + dy) * w + (x + dx)) * 4;
              pixArr[idx] = clamped;
              pixArr[idx+1] = clamped;
              pixArr[idx+2] = clamped;
            }
          }
        };

        // 1. Generate encrypted frame index bits
        const encFrameIndex = this.encryptFrameIndexJS(currentFrameIdx, this.pin);

        // 2. Generate encrypted length header bits
        const encLength = this.encryptLengthHeaderJS(dataLength, this.pin + '_' + currentFrameIdx);

        // 3. Assemble all bits sequentially into a flat Uint8Array (no intermediate arrays)
        const totalBitsCount = 32 + 32 + dataBitsArr.length;
        const allBits = new Uint8Array(totalBitsCount);
        for (let i = 0; i < 32; i++) {
          const byteIdx = Math.floor(i / 8);
          const bitIdx = 7 - (i % 8);
          allBits[i] = (encFrameIndex[byteIdx] >>> bitIdx) & 1;
        }
        for (let i = 0; i < 32; i++) {
          const byteIdx = Math.floor(i / 8);
          const bitIdx = 7 - (i % 8);
          allBits[32 + i] = (encLength[byteIdx] >>> bitIdx) & 1;
        }
        allBits.set(dataBitsArr, 64);

        // 4. Embed using Luma relative differential modulation on adjacent 4x4 blocks (8x4 pair)
        const targetDiff = 100; // Enforce minimum Luma difference of 100 to survive heavy WebRTC compression
        for (let i = 0; i < allBits.length; i++) {
          const bit = allBits[i];
          const rowIdx = Math.floor(i / cols);
          const colIdx = i % cols;

          const colA = colIdx * 8;
          const rowA = rowIdx * 4;
          const colB = colIdx * 8 + 4;
          const rowB = rowIdx * 4;

          const valA = getBlockLuma(pixels, this.width, colA, rowA);
          const valB = getBlockLuma(pixels, this.width, colB, rowB);

          if (bit === 1) {
            let currentDiff = valA - valB;
            if (currentDiff < targetDiff) {
              const shortfall = targetDiff - currentDiff;
              let newValA = valA + Math.ceil(shortfall / 2);
              let newValB = valB - Math.floor(shortfall / 2);
              
              // Shift shortfall if clipping occurs
              if (newValA > 255) {
                newValB -= (newValA - 255);
                newValA = 255;
              } else if (newValB < 0) {
                newValA += (0 - newValB);
                newValB = 0;
              }
              setBlockLumaAbsolute(pixels, this.width, colA, rowA, newValA);
              setBlockLumaAbsolute(pixels, this.width, colB, rowB, newValB);
            } else {
              // Homogenize block to survive compression even if diff is already good
              setBlockLumaAbsolute(pixels, this.width, colA, rowA, valA);
              setBlockLumaAbsolute(pixels, this.width, colB, rowB, valB);
            }
          } else {
            let currentDiff = valB - valA;
            if (currentDiff < targetDiff) {
              const shortfall = targetDiff - currentDiff;
              let newValB = valB + Math.ceil(shortfall / 2);
              let newValA = valA - Math.floor(shortfall / 2);
              
              // Shift shortfall if clipping occurs
              if (newValB > 255) {
                newValA -= (newValB - 255);
                newValB = 255;
              } else if (newValA < 0) {
                newValB += (0 - newValA);
                newValA = 0;
              }
              setBlockLumaAbsolute(pixels, this.width, colA, rowA, newValA);
              setBlockLumaAbsolute(pixels, this.width, colB, rowB, newValB);
            } else {
              // Homogenize block
              setBlockLumaAbsolute(pixels, this.width, colA, rowA, valA);
              setBlockLumaAbsolute(pixels, this.width, colB, rowB, valB);
            }
          }
        }

        // Draw modified cover pixels to output canvas
        outCtx.putImageData(coverImageData, 0, 0);
        triggerStegoFrameCallback();

        // Update progress percentage
        const totalBitsNeeded = 32 + dataBitsArr.length;
        const usagePct = (totalBitsNeeded / maxUsable) * 100;
        this.onProgress(Math.min(100, Math.round(usagePct)));

        // Advance frame index
        this.frameIndex++;

        const duration = performance.now() - startTime;
        if (this.onFrameProcessTime) {
          this.onFrameProcessTime(duration);
        }
        // Release guard — interval will fire next tick automatically
        this.isProcessingFrame = false;
      }
    } catch (e) {
      // Fail-safe: release lock, interval will continue
      this.isProcessingFrame = false;
    }
  };

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') {
      this.width = 320;
      this.height = 240;
    } else {
      this.width = 640;
      this.height = 480;
    }
    if (this.captureCanvas) {
      this.captureCanvas.width = this.width;
      this.captureCanvas.height = this.height;
    }
    if (this.coverCanvas) {
      this.coverCanvas.width = this.width;
      this.coverCanvas.height = this.height;
    }
    if (this.outputCanvas) {
      this.outputCanvas.width = this.width;
      this.outputCanvas.height = this.height;
    }
    console.log(`[Stealth-Video-Encoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    console.log(`[Stealth-Video-Encoder] Target FPS dynamically adjusted to ${fps}`);
    // Restart interval at new rate if currently running
    if (this.isRunning && this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(this.processFrame, Math.max(100, Math.floor(1000 / fps)));
    }
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  getTargetFps(): number {
    return this.targetFps;
  }

  private encryptFrameIndexJS(frameIndex: number, pin: string): Uint8Array {
    const prng = new JS_PRNG('VID_IDX_' + pin);
    const indexBytes = new Uint8Array(4);
    indexBytes[0] = (frameIndex >>> 24) & 0xFF;
    indexBytes[1] = (frameIndex >>> 16) & 0xFF;
    indexBytes[2] = (frameIndex >>> 8) & 0xFF;
    indexBytes[3] = frameIndex & 0xFF;
    
    for (let i = 0; i < 4; i++) {
      indexBytes[i] ^= Math.floor(prng.next() * 256);
    }
    return indexBytes;
  }

  private encryptLengthHeaderJS(length: number, pin: string): Uint8Array {
    const prng = new JS_PRNG('VID_HDR_' + pin);
    const lengthBytes = new Uint8Array(4);
    lengthBytes[0] = (length >>> 24) & 0xFF;
    lengthBytes[1] = (length >>> 16) & 0xFF;
    lengthBytes[2] = (length >>> 8) & 0xFF;
    lengthBytes[3] = length & 0xFF;
    
    for (let i = 0; i < 4; i++) {
      lengthBytes[i] ^= Math.floor(prng.next() * 256);
    }
    return lengthBytes;
  }
}

class JS_PRNG {
  private seed: number;
  constructor(seedString: string) {
    let hash = 5381;
    for (let i = 0; i < seedString.length; i++) {
      hash = ((hash << 5) + hash) ^ seedString.charCodeAt(i);
      hash |= 0;
    }
    this.seed = hash >>> 0;
  }
  next(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    this.seed = this.seed >>> 0;
    return this.seed / 4294967296;
  }
}
