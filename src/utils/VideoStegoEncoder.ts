import { getSha256Key, fastVideoEncrypt } from './crypto';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';
import CryptoJS from 'crypto-js';
import { WebGLStego } from './WebGLStego';

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
  private targetFps: number = 30;
  private masterKey: CryptoJS.lib.WordArray | null = null;
  private isProcessingFrame: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private webglStego: WebGLStego | null = null;

  // Web Worker (kept for compatibility but not used in hot path)
  private videoWorker: Worker | null = null;
  private workerReady: boolean = false;

  // Frame diff skipping
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
    this.masterKey = getSha256Key(this.pin);

    // 1. Preload cover videos
    this.videoEls = await preloadClips();

    // 2. Initialize WASM Engine (fallback, not used in hot path)
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit({ module_or_path: wasmBuffer });
      this.wasmEngine = new StealthEngine();
      console.log("[Stealth-Video-Encoder] Rust WASM Engine active (fallback).");
    } catch (err) {
      console.warn("[Stealth-Video-Encoder] Rust WASM Engine failed:", err);
    }

    // 3. Initialize Web Worker (kept for compatibility)
    try {
      this.videoWorker = new Worker('/stego-video-worker.js', { type: 'module' });
      this.videoWorker.onmessage = (e) => {
        if (e.data.type === 'WORKER_READY') {
          this.workerReady = true;
          console.log("[Stealth-Video-Encoder] Web Worker ready.");
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
    this.downscaledCanvas.width = 32;
    this.downscaledCanvas.height = 32;

    // 6. Capture output stream at manually-triggered rate (0 = manual via requestFrame)
    this.stegoStream = (this.outputCanvas as any).captureStream(0);

    try {
      this.webglStego = new WebGLStego(this.width, this.height);
      console.log("[Stealth-Video] WebGL GPU Engine initialized successfully.");
    } catch (err) {
      console.error("[Stealth-Video] Failed to initialize WebGL GPU Engine:", err);
    }
  }

  getStegoStream(): MediaStream {
    if (!this.stegoStream) throw new Error('VideoStegoEncoder not initialized');
    return this.stegoStream;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    const intervalMs = Math.max(33, Math.floor(1000 / this.targetFps)); // min 33ms = 30fps cap
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
    this.videoEls.forEach(vid => {
      try { if (!vid.paused) vid.pause(); } catch (e) {}
    });
    if (this.videoWorker) {
      this.videoWorker.terminate();
      this.videoWorker = null;
      this.workerReady = false;
    }
    if (this.webglStego) {
      this.webglStego.destroy();
      this.webglStego = null;
    }
  }

  /**
   * SYNCHRONOUS processFrame — no toBlob, no async WebCrypto.
   * Target latency: ~2–5ms per frame (previously 120–260ms).
   *
   * Approach:
   *   1. Capture a fixed 100x75 thumbnail of the webcam (raw pixels).
   *   2. XOR-encrypt with a per-frame PRNG stream (pin + frameIndex) — same
   *      algorithm as the decoder will use to reverse it.
   *   3. Embed bits via WebGL GPU shaders into the cover video frame.
   *   4. Push resulting canvas to WebRTC via requestFrame().
   *
   * The decoder mirrors step 2 exactly using 'VID_ENC_' + pin + '_' + frameIndex.
   */
  private processFrame = (): void => {
    if (!this.isRunning) return;
    if (this.isProcessingFrame) return;
    this.isProcessingFrame = true;
    const startTime = performance.now();

    try {
      const webcam = this.webcamVideoEl;
      const captureCanvas = this.captureCanvas;
      const coverCanvas = this.coverCanvas;
      const outputCanvas = this.outputCanvas;

      if (!webcam || !captureCanvas || !coverCanvas || !outputCanvas) {
        this.isProcessingFrame = false;
        return;
      }

      const capCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
      const outCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
      if (!capCtx || !outCtx) { this.isProcessingFrame = false; return; }

      // Step 1: Draw webcam to capture canvas
      capCtx.drawImage(webcam, 0, 0, this.width, this.height);

      // Step 1a: Frame diff skipping (cheap 32x32 center hash — ~0.1ms)
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
        if (this.frameSkipCounter < 3) { this.isProcessingFrame = false; return; }
      }
      this.lastFrameHash = hashStr;
      this.frameSkipCounter = 0;

      // Step 2: Compute stego capacity from cover frame block structure
      const cols = Math.floor(this.width / 8);
      const rows = Math.floor(this.height / 4);
      const maxPayloadBits = ((cols * rows) - 320) * 3;

      // Step 3: SYNCHRONOUS payload — capture 32x32 thumbnail + XOR encrypt (~1-2ms total)
      // Capacity at 480p = ((80*120)-320)*3 = 27,840 bits = 3,480 bytes.
      // 32x32 RGB + 4 header = 3,076 bytes = 24,608 bits — fits comfortably.
      const THUMB_W = 32;
      const THUMB_H = 32;
      if (!this.downscaledCanvas) {
        this.downscaledCanvas = document.createElement('canvas');
        this.downscaledCanvas.width = THUMB_W;
        this.downscaledCanvas.height = THUMB_H;
      }
      const thumbCanvas = this.downscaledCanvas;
      const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
      thumbCtx.drawImage(captureCanvas, 0, 0, THUMB_W, THUMB_H);
      const thumbData = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H);

      // Pack RGB only (skip alpha) with STEG magic header
      const rawRgbLen = THUMB_W * THUMB_H * 3;
      const rawWithHeader = new Uint8Array(4 + rawRgbLen);
      rawWithHeader[0] = 0x53; rawWithHeader[1] = 0x54; // 'ST'
      rawWithHeader[2] = 0x45; rawWithHeader[3] = 0x47; // 'EG'
      for (let i = 0, j = 4; i < thumbData.data.length; i += 4, j += 3) {
        rawWithHeader[j]     = thumbData.data[i];
        rawWithHeader[j + 1] = thumbData.data[i + 1];
        rawWithHeader[j + 2] = thumbData.data[i + 2];
      }

      // PRNG XOR encryption — decoder mirrors this with same seed
      const encPrng = new JS_PRNG('VID_ENC_' + this.pin + '_' + this.frameIndex);
      const cipherBytes = new Uint8Array(rawWithHeader.length);
      for (let i = 0; i < rawWithHeader.length; i++) {
        cipherBytes[i] = rawWithHeader[i] ^ Math.floor(encPrng.next() * 256);
      }

      // Convert to flat bit array
      const dataBitsArr = new Uint8Array(cipherBytes.length * 8);
      for (let i = 0; i < cipherBytes.length; i++) {
        const b = cipherBytes[i];
        for (let bit = 7; bit >= 0; bit--) {
          dataBitsArr[i * 8 + (7 - bit)] = (b >>> bit) & 1;
        }
      }

      if (dataBitsArr.length > maxPayloadBits) {
        // Shouldn't happen with 100x75 thumbnail at 480p, but guard anyway
        console.warn(`[Stealth-Video] payload ${dataBitsArr.length} > capacity ${maxPayloadBits}. Skipping frame.`);
        this.frameIndex++;
        this.isProcessingFrame = false;
        return;
      }

      // Step 4: Get active cover clip frame
      const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
      this.videoEls.forEach((vid, idx) => {
        try {
          if (idx === clipIdx) { if (vid.paused) vid.play().catch(() => {}); }
          else { if (!vid.paused) vid.pause(); }
        } catch (_) {}
      });
      const coverVideo = this.videoEls[clipIdx];
      const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
      const currentFrameIdx = this.frameIndex;

      // Step 5: Build encrypted header bits (synchronous PRNG — same as decoder)
      const encFrameIndex = this.encryptFrameIndexJS(currentFrameIdx, this.pin);
      const encLength = this.encryptLengthHeaderJS(dataBitsArr.length, this.pin + '_' + currentFrameIdx);

      // 5x redundancy for header (320 bits = 5 × 64 bits)
      const allBits = new Uint8Array(320 + dataBitsArr.length);
      for (let rep = 0; rep < 5; rep++) {
        const offset = rep * 64;
        for (let i = 0; i < 32; i++) {
          allBits[offset + i] = (encFrameIndex[Math.floor(i / 8)] >>> (7 - (i % 8))) & 1;
        }
        for (let i = 0; i < 32; i++) {
          allBits[offset + 32 + i] = (encLength[Math.floor(i / 8)] >>> (7 - (i % 8))) & 1;
        }
      }
      allBits.set(dataBitsArr, 320);

      // Step 6: GPU encode — renders directly to WebGL canvas (NO readPixels at all!)
      if (this.webglStego) {
        this.webglStego.encode(coverImageData, allBits);
        // Copy WebGL canvas → output canvas → WebRTC stream
        outCtx.drawImage(this.webglStego.getCanvas(), 0, 0, this.width, this.height);
        const track = this.stegoStream?.getVideoTracks()[0] as any;
        if (track && typeof track.requestFrame === 'function') {
          track.requestFrame();
        }
      }

      this.frameIndex++;
      const duration = performance.now() - startTime;
      if (this.onFrameProcessTime) this.onFrameProcessTime(duration);

    } catch (e) {
      console.error('[Stealth-Video-Encoder] processFrame error:', e);
    }
    this.isProcessingFrame = false;
  };

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') {
      this.width = 320;
      this.height = 240;
    } else {
      this.width = 640;
      this.height = 480;
    }
    if (this.captureCanvas) { this.captureCanvas.width = this.width; this.captureCanvas.height = this.height; }
    if (this.coverCanvas)   { this.coverCanvas.width   = this.width; this.coverCanvas.height   = this.height; }
    if (this.outputCanvas)  { this.outputCanvas.width  = this.width; this.outputCanvas.height  = this.height; }
    try {
      if (this.webglStego) this.webglStego.destroy();
      this.webglStego = new WebGLStego(this.width, this.height);
    } catch (err) {
      console.error("[Stealth-Video-Encoder] Failed to resize WebGL GPU Engine:", err);
    }
    console.log(`[Stealth-Video-Encoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    console.log(`[Stealth-Video-Encoder] Target FPS dynamically adjusted to ${fps}`);
    if (this.isRunning && this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(this.processFrame, Math.max(33, Math.floor(1000 / fps)));
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
