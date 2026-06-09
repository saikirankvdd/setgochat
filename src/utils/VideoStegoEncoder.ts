import { encryptData, stringToBinary } from './crypto';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';

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
  private stegoStream: MediaStream | null;
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;
  private onStegoFrame?: (pngBuffer: Uint8Array, frameIndex: number) => void;
  private onFrameProcessTime?: (durationMs: number) => void;
  private targetFps: number = 30; // Default to 30 FPS for smooth video

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
    this.processFrame();
  }

  stop(): void {
    this.isRunning = false;
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

  private processFrame = (): void => {
    if (!this.isRunning) return;
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
          // Skip frame: schedule next frame quickly
          setTimeout(this.processFrame, Math.max(10, Math.floor(1000 / this.targetFps)));
          return;
        }
      }
      this.lastFrameHash = hashStr;
      this.frameSkipCounter = 0;

      // 2. Adaptively compress webcam frame. Start at 20% quality, hard cap at 35%.
      const totalPixels = this.width * this.height;
      const totalChannels = totalPixels * 3; // Red, Green, Blue (skip Alpha)
      const maxPayloadBits = totalChannels - 32; // Reserve 32 bits for length header

      let base64 = '';
      let encrypted = '';
      let dataBits = '';
      let jpegQuality = 0.20; // Tight starting quality

      for (let attempt = 0; attempt < 4; attempt++) {
        const dataUrl = captureCanvas.toDataURL('image/jpeg', jpegQuality);
        base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        encrypted = encryptData(base64, this.pin + '_' + this.frameIndex);
        dataBits = stringToBinary(encrypted);

        if (dataBits.length <= maxPayloadBits) {
          break; // Payload fits — proceed
        }

        // Reduce quality slightly and retry (unlikely to need this, but good safety)
        jpegQuality = Math.max(0.10, jpegQuality - 0.05);
        if (attempt === 3) {
          console.warn(`[Stealth-Video] Frame ${this.frameIndex} too large even at ${jpegQuality * 100}% quality. Skipping.`);
          this.frameIndex++;
          setTimeout(this.processFrame, Math.max(10, Math.floor(1000 / this.targetFps)));
          return;
        }
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

      if (this.videoWorker && this.workerReady) {
        // Use high-performance Web Worker LSB embedding
        const pixelBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        
        this.videoWorker.onmessage = (e) => {
          if (!this.isRunning) return;
          if (e.data.type === 'EMBED_DONE') {
            if (e.data.pixels) {
              const modifiedPixels = new Uint8Array(e.data.pixels);
              outCtx.putImageData(
                new ImageData(new Uint8ClampedArray(modifiedPixels.buffer), this.width, this.height),
                0, 0
              );
              triggerStegoFrameCallback();
            } else {
              // Fail-safe pass-through if worker embedding failed
              outCtx.putImageData(coverImageData, 0, 0);
            }

            // Update progress percentage
            const totalBitsNeeded = 32 + dataBits.length;
            const usagePct = (totalBitsNeeded / totalChannels) * 100;
            this.onProgress(Math.min(100, Math.round(usagePct)));

            // Advance frame index
            this.frameIndex++;

            const duration = performance.now() - startTime;
            if (this.onFrameProcessTime) {
              this.onFrameProcessTime(duration);
            }

            // Loop at dynamic target FPS
            setTimeout(this.processFrame, Math.max(10, Math.floor(1000 / this.targetFps)));
          }
        };

        this.videoWorker.postMessage(
          { type: 'EMBED_FRAME', pixels: pixelBytes.buffer, dataBits, pin: this.pin, frameIndex: currentFrameIdx },
          [pixelBytes.buffer] // Transfer ownership (zero-copy)
        );

      } else {
        // Fallback: Use Main Thread JS or WASM embedding if worker is not initialized
        if (this.wasmEngine) {
          const pixelBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
          this.wasmEngine.process_video_frame(pixelBytes, dataBits, this.pin, currentFrameIdx);
        } else {
          // JS Fallback
          const usableChannels = totalChannels - 32;
          const dataLength = Math.min(dataBits.length, usableChannels);
          const encLength = this.encryptLengthHeaderJS(dataLength, this.pin + '_' + currentFrameIdx);
          let channelIdx = 0;
          for (let i = 0; i < 32; i++) {
            if (channelIdx % 4 === 3) channelIdx++; // skip alpha
            const byteIdx = Math.floor(i / 8);
            const bitIdx = 7 - (i % 8);
            const bit = (encLength[byteIdx] >>> bitIdx) & 1;
            let val = pixels[channelIdx];
            if ((val & 1) !== bit) {
              if (val === 255) val -= 1;
              else if (val === 0) val += 1;
              else val += (Math.random() < 0.5 ? 1 : -1);
            }
            pixels[channelIdx] = val;
            channelIdx++;
          }
          if (dataLength > 0) {
            const stride = Math.floor(usableChannels / dataLength);
            const prng = new JS_PRNG(this.pin + '_scatter_' + currentFrameIdx);
            for (let i = 0; i < dataLength; i++) {
              const relativeLogicalIdx = i * stride + Math.floor(prng.next() * stride);
              const targetLogicalIdx = 32 + relativeLogicalIdx;
              const actualIdx = targetLogicalIdx + Math.floor(targetLogicalIdx / 3);
              const bitToEmbed = parseInt(dataBits[i]);
              let val = pixels[actualIdx];
              if ((val & 1) !== bitToEmbed) {
                if (val === 255) val -= 1;
                else if (val === 0) val += 1;
                else val += (Math.random() < 0.5 ? 1 : -1);
              }
              pixels[actualIdx] = val;
            }
          }
        }

        // Draw modified cover pixels to output canvas
        outCtx.putImageData(coverImageData, 0, 0);
        triggerStegoFrameCallback();

        // Update progress percentage
        const totalBitsNeeded = 32 + dataBits.length;
        const usagePct = (totalBitsNeeded / totalChannels) * 100;
        this.onProgress(Math.min(100, Math.round(usagePct)));

        // Advance frame index
        this.frameIndex++;

        const duration = performance.now() - startTime;
        if (this.onFrameProcessTime) {
          this.onFrameProcessTime(duration);
        }

        // Loop at dynamic target FPS
        setTimeout(this.processFrame, Math.max(10, Math.floor(1000 / this.targetFps)));
      }
    } catch (e) {
      console.error("Error encoding video stego frame:", e);
      // Fail-safe schedule next frame
      setTimeout(this.processFrame, Math.max(10, Math.floor(1000 / this.targetFps)));
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
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  getTargetFps(): number {
    return this.targetFps;
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
