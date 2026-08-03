import { getClipSequence, preloadClips, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';

/**
 * VideoStegoDecoder — Web Worker architecture
 *
 * The heavy decode pipeline runs ENTIRELY off the main thread:
 *   Worker: getImageData → LSB extract → PRNG XOR decrypt → validate → return RGB
 *
 * Main thread only does (~1ms per frame):
 *   createImageBitmap(remoteVideo) → postMessage → receive decoded pixels → putImageData
 *
 * This matches the encoder's architecture (stego-frame-worker.js) and uses
 * sequential LSB extraction to match sequential LSB embedding.
 */
export class VideoStegoDecoder {
  private remoteVideoEl: HTMLVideoElement;
  private pin: string;
  private displayCanvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private onProgress: (pct: number) => void;
  private frameIndex: number;
  private clipSequence: number[];
  private videoEls: HTMLVideoElement[];
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;
  private onFrameProcessTime?: (durationMs: number) => void;
  private onFrameDecoded?: (base64: string, seq: number) => void;
  private lastDecodedFrameIndex: number;
  private invalidFrameCount: number = 0;

  // RAF + Worker
  private rafHandle: number | null = null;
  private lastFrameTime: number = 0;
  private targetFps: number = 30;
  private decodeWorker: Worker | null = null;
  private workerReady: boolean = false;
  private workerBusy: boolean = false;
  private isDispatching: boolean = false;

  // Temp canvas for upscaling decoded face (32x32 → display size)
  private thumbCanvas: HTMLCanvasElement | null = null;

  constructor(
    remoteVideoEl: HTMLVideoElement,
    pin: string,
    displayCanvas: HTMLCanvasElement,
    resolution: '240p' | '480p' | '1080p',
    onProgress: (pct: number) => void,
    onFrameProcessTime?: (durationMs: number) => void,
    onFrameDecoded?: (base64: string, seq: number) => void
  ) {
    this.remoteVideoEl = remoteVideoEl;
    this.pin = pin;
    this.displayCanvas = displayCanvas;
    if (resolution === '1080p') {
      this.width = 1920; this.height = 1080;
    } else if (resolution === '240p') {
      this.width = 320; this.height = 240;
    } else {
      this.width = 640; this.height = 480;
    }
    this.onProgress = onProgress;
    this.frameIndex = 0;
    this.clipSequence = getClipSequence(pin);
    this.videoEls = [];
    this.isRunning = false;
    this.wasmEngine = null;
    this.onFrameProcessTime = onFrameProcessTime;
    this.onFrameDecoded = onFrameDecoded;
    this.lastDecodedFrameIndex = -1;
  }

  async init(): Promise<void> {
    // 1. Preload cover video clips (shown while no stego face decoded yet)
    this.videoEls = await preloadClips();

    // 2. WASM engine (kept for future use)
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit({ module_or_path: wasmBuffer });
      this.wasmEngine = new StealthEngine();
      console.log('[Stealth-Video-Decoder] Rust WASM Engine active.');
    } catch (err) {
      console.warn('[Stealth-Video-Decoder] Rust WASM Engine failed:', err);
    }

    // 3. Size display canvas
    this.displayCanvas.width  = this.width;
    this.displayCanvas.height = this.height;

    // 4. Thumbnail upscale canvas (32×32 face → display size)
    this.thumbCanvas = document.createElement('canvas');
    this.thumbCanvas.width  = 32;
    this.thumbCanvas.height = 32;

    // 5. Spawn the decode worker
    await new Promise<void>((resolve, reject) => {
      this.decodeWorker = new Worker('/stego-decode-worker.js');

      this.decodeWorker.onmessage = (e) => {
        const { type } = e.data;

        if (type === 'READY') {
          this.workerReady = true;
          console.log('[Stealth-Video-Decoder] Decode worker ready. Main thread fully unblocked.');
          resolve();

        } else if (type === 'DECODE_SUCCESS') {
          this.workerBusy = false;
          if (this.onFrameProcessTime) this.onFrameProcessTime(e.data.duration);

          const blob = new Blob([e.data.jpegBuffer], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const displayCtx = this.displayCanvas.getContext('2d');
            if (displayCtx) {
              displayCtx.imageSmoothingEnabled = true;
              displayCtx.imageSmoothingQuality = 'high';
              displayCtx.drawImage(img, 0, 0, this.displayCanvas.width, this.displayCanvas.height);
            }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
          };
          img.src = url;

          this.lastDecodedFrameIndex = e.data.frameIndex;
          this.frameIndex = e.data.frameIndex;
          this.invalidFrameCount = 0;

        } else if (type === 'DECODE_INVALID' || type === 'DECODE_NO_FRAME') {
          this.workerBusy = false;
          this.invalidFrameCount++;
          // Show cover video when we can't decode face (fallback)
          this.showCoverVideoFrame();
          this.frameIndex++;

        } else if (type === 'DECODE_DUPLICATE') {
          // Same frame again — do nothing
          this.workerBusy = false;

        } else if (type === 'DECODE_SKIPPED') {
          this.workerBusy = false;

        } else if (type === 'DECODE_ERROR') {
          this.workerBusy = false;
          console.error('[Stealth-Video-Decoder] Worker error:', e.data.error);
        }
      };

      this.decodeWorker.onerror = (err) => {
        console.error('[Stealth-Video-Decoder] Worker fatal error:', err);
        reject(err);
      };

      this.decodeWorker.postMessage({
        type: 'INIT',
        width: this.width,
        height: this.height,
        pin: this.pin
      });

      setTimeout(() => {
        if (!this.workerReady) reject(new Error('[Stealth-Video-Decoder] Worker init timed out'));
      }, 8000);
    });

    console.log(`[Stealth-Video-Decoder] WebWorker pipeline active (${this.width}x${this.height}).`);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.workerBusy = false;
    this.invalidFrameCount = 0;
    this.rafHandle = requestAnimationFrame(this.rafLoop);
    console.log('[Stealth-Video-Decoder] Started decoder loop reading from remote video element.');
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.videoEls.forEach(vid => {
      try { if (!vid.paused) vid.pause(); } catch(_) {}
    });
    if (this.decodeWorker) {
      this.decodeWorker.terminate();
      this.decodeWorker = null;
      this.workerReady = false;
      this.workerBusy  = false;
    }
  }

  /** Shows local cover video on the display canvas (fallback when no stego face) */
  private showCoverVideoFrame(): void {
    const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
    const coverVideo = this.videoEls[clipIdx];
    if (coverVideo) {
      if (coverVideo.paused && !coverVideo.error) coverVideo.play().catch(() => {});
      const displayCtx = this.displayCanvas.getContext('2d');
      if (displayCtx) {
        displayCtx.drawImage(coverVideo, 0, 0, this.displayCanvas.width, this.displayCanvas.height);
      }
    }
  }

  /**
   * RAF loop — main thread. Zero heavy work. Only dispatches frames to worker.
   */
  private rafLoop = (timestamp: number): void => {
    if (!this.isRunning) return;

    const targetMs = 1000 / this.targetFps;
    if (timestamp - this.lastFrameTime >= targetMs) {
      this.lastFrameTime = timestamp;
      this.dispatchFrameToWorker();
    }

    this.rafHandle = requestAnimationFrame(this.rafLoop);
  };

  private dispatchFrameToWorker = (): void => {
    if (!this.workerReady || this.workerBusy || this.isDispatching) return;
    if (!this.decodeWorker) return;
    const video = this.remoteVideoEl;
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    this.isDispatching = true;

    // createImageBitmap: GPU-native, transferable, ~0.5ms
    createImageBitmap(video).then((frameBitmap) => {
      this.isDispatching = false;
      if (!this.isRunning || !this.decodeWorker) {
        frameBitmap.close();
        return;
      }
      this.workerBusy = true;
      this.decodeWorker.postMessage(
        { type: 'DECODE_FRAME', frameBitmap },
        [frameBitmap as any]
      );
    }).catch(err => {
      this.isDispatching = false;
      console.warn('[Stealth-Video-Decoder] createImageBitmap failed:', err);
    });
  };

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') { this.width = 320; this.height = 240; }
    else                        { this.width = 640; this.height = 480; }

    if (this.displayCanvas) {
      this.displayCanvas.width  = this.width;
      this.displayCanvas.height = this.height;
    }
    if (this.decodeWorker && this.workerReady) {
      this.decodeWorker.postMessage({ type: 'RESIZE', width: this.width, height: this.height });
    }
    console.log(`[Stealth-Video-Decoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  // Legacy method kept for compatibility — not used in new architecture
  public decodeFrameFromImage(_img: HTMLImageElement): void {
    // No-op: new architecture uses RAF + worker
  }
}
