import { getClipSequence, preloadClips, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';

/**
 * VideoStegoEncoder — Web Worker + OffscreenCanvas architecture
 *
 * The heavy stego encoding pipeline runs ENTIRELY off the main thread:
 *   Worker: getImageData → PRNG XOR → bit-packing → LSB embed → putImageData
 *
 * Main thread only does (~1ms total per frame):
 *   createImageBitmap(webcam) + createImageBitmap(cover) → postMessage → requestFrame()
 *
 * This frees the main thread for audio callbacks, WebRTC, and UI rendering.
 */
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
  private outputCanvas: HTMLCanvasElement | null;
  private stegoStream: MediaStream | null;
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;
  private onStegoFrame?: (pngBuffer: Uint8Array, frameIndex: number) => void;
  private onFrameProcessTime?: (durationMs: number) => void;
  private targetFps: number = 30;

  // RAF-based frame scheduling (replaces setInterval)
  private rafHandle: number | null = null;
  private lastFrameTime: number = 0;

  // Web Worker state
  private frameWorker: Worker | null = null;
  private workerReady: boolean = false;
  private workerBusy: boolean = false;
  private isDispatching: boolean = false; // prevents double-dispatch races

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
      this.width = 1920; this.height = 1080;
    } else if (resolution === '240p') {
      this.width = 320; this.height = 240;
    } else {
      this.width = 640; this.height = 480;
    }
    this.onProgress = onProgress;
    this.onStegoFrame = onStegoFrame;
    this.frameIndex = 0;
    this.clipSequence = getClipSequence(pin);
    this.videoEls = [];
    this.webcamVideoEl = null;
    this.outputCanvas = null;
    this.stegoStream = null;
    this.isRunning = false;
    this.wasmEngine = null;
    this.onFrameProcessTime = onFrameProcessTime;
  }

  async init(): Promise<void> {
    // 1. Preload cover video clips
    this.videoEls = await preloadClips();

    // 2. WASM engine (kept for potential future use — not in hot path)
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit({ module_or_path: wasmBuffer });
      this.wasmEngine = new StealthEngine();
      console.log('[Stealth-Video-Encoder] Rust WASM Engine active (fallback).');
    } catch (err) {
      console.warn('[Stealth-Video-Encoder] Rust WASM Engine failed:', err);
    }

    // 3. Create hidden webcam video element
    this.webcamVideoEl = document.createElement('video');
    this.webcamVideoEl.srcObject = this.localStream;
    this.webcamVideoEl.muted = true;
    this.webcamVideoEl.playsInline = true;

    let container = document.getElementById('stealth-video-preload-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'stealth-video-preload-container';
      Object.assign(container.style, {
        position: 'fixed', width: '1px', height: '1px',
        opacity: '0.01', overflow: 'hidden', pointerEvents: 'none',
        zIndex: '-9999', top: '0', left: '0'
      });
      document.body.appendChild(container);
    }
    container.appendChild(this.webcamVideoEl);
    await this.webcamVideoEl.play();

    // 4. Create output canvas and capture WebRTC stream from it
    //    IMPORTANT: captureStream() MUST be called before transferControlToOffscreen()
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.width = this.width;
    this.outputCanvas.height = this.height;
    this.stegoStream = (this.outputCanvas as any).captureStream(0);

    // 5. Transfer canvas control to worker (zero GPU copy — worker owns rendering)
    const offscreen = (this.outputCanvas as any).transferControlToOffscreen();

    // 6. Spawn the frame worker and wait for READY
    await new Promise<void>((resolve, reject) => {
      this.frameWorker = new Worker('/stego-frame-worker.js');

      this.frameWorker.onmessage = (e) => {
        const { type } = e.data;

        if (type === 'READY') {
          this.workerReady = true;
          console.log('[Stealth-Video] Frame worker ready. Main thread fully unblocked.');
          resolve();

        } else if (type === 'FRAME_DONE') {
          this.workerBusy = false;
          // Signal WebRTC to grab the current frame from the (worker-owned) canvas
          const track = this.stegoStream?.getVideoTracks()[0] as any;
          if (track && typeof track.requestFrame === 'function') {
            track.requestFrame();
          }
          if (this.onFrameProcessTime) this.onFrameProcessTime(e.data.duration);

        } else if (type === 'FRAME_SKIPPED') {
          this.workerBusy = false;

        } else if (type === 'FRAME_ERROR') {
          this.workerBusy = false;
          console.error('[Stealth-Video] Worker frame error:', e.data.error);
        }
      };

      this.frameWorker.onerror = (err) => {
        console.error('[Stealth-Video] Worker fatal error:', err);
        reject(err);
      };

      // Send init message with OffscreenCanvas (transferred — zero copy)
      this.frameWorker.postMessage({
        type: 'INIT',
        width: this.width,
        height: this.height,
        outputCanvas: offscreen
      }, [offscreen]);

      // Safety timeout
      setTimeout(() => {
        if (!this.workerReady) reject(new Error('[Stealth-Video] Worker init timed out'));
      }, 8000);
    });

    console.log(`[Stealth-Video] WebWorker+OffscreenCanvas pipeline active (${this.width}x${this.height} @ ${this.targetFps}fps target).`);
  }

  getStegoStream(): MediaStream {
    if (!this.stegoStream) throw new Error('VideoStegoEncoder not initialized');
    return this.stegoStream;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.workerBusy = false;
    this.rafHandle = requestAnimationFrame(this.rafLoop);
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.webcamVideoEl) {
      this.webcamVideoEl.pause();
      this.webcamVideoEl.srcObject = null;
      if (this.webcamVideoEl.parentNode) {
        this.webcamVideoEl.parentNode.removeChild(this.webcamVideoEl);
      }
      this.webcamVideoEl = null;
    }
    this.videoEls.forEach(vid => {
      try { if (!vid.paused) vid.pause(); } catch(_) {}
    });
    if (this.frameWorker) {
      this.frameWorker.terminate();
      this.frameWorker = null;
      this.workerReady = false;
      this.workerBusy  = false;
    }
  }

  /**
   * RAF loop — runs on main thread but does ZERO heavy work.
   * Only checks timing and fires dispatchFrameToWorker() when needed.
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

  /**
   * Dispatch a frame to the worker.
   * Main thread work: ~0.5ms for createImageBitmap × 2
   * Worker work: all the heavy lifting (off main thread)
   */
  private dispatchFrameToWorker = (): void => {
    if (!this.workerReady || this.workerBusy || this.isDispatching) return;
    if (!this.frameWorker || !this.webcamVideoEl) return;
    if (this.webcamVideoEl.readyState < 2 || !this.webcamVideoEl.videoWidth) return;

    // Switch cover clip (main thread — video elements are DOM-bound)
    const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
    this.videoEls.forEach((vid, idx) => {
      try {
        if (idx === clipIdx) { if (vid.paused) vid.play().catch(() => {}); }
        else                 { if (!vid.paused) vid.pause(); }
      } catch(_) {}
    });
    const coverVideo = this.videoEls[clipIdx];
    if (!coverVideo || coverVideo.readyState < 2) return;

    this.isDispatching = true;

    // createImageBitmap: GPU-native, ~0.5ms, creates a transferable (zero-copy to worker)
    Promise.all([
      createImageBitmap(this.webcamVideoEl),
      createImageBitmap(coverVideo)
    ]).then(([webcamBitmap, coverBitmap]) => {
      this.isDispatching = false;

      if (!this.isRunning || !this.frameWorker) {
        webcamBitmap.close();
        coverBitmap.close();
        return;
      }

      this.workerBusy = true;
      // Transfer bitmaps to worker — zero-copy, no memory duplication
      this.frameWorker.postMessage({
        type: 'PROCESS_FRAME',
        webcamBitmap,
        coverBitmap,
        frameIndex: this.frameIndex++,
        pin: this.pin
      }, [webcamBitmap as any, coverBitmap as any]);

    }).catch(err => {
      this.isDispatching = false;
      console.warn('[Stealth-Video] createImageBitmap failed:', err);
    });
  };

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') { this.width = 320; this.height = 240; }
    else                        { this.width = 640; this.height = 480; }

    if (this.frameWorker && this.workerReady) {
      this.frameWorker.postMessage({ type: 'RESIZE', width: this.width, height: this.height });
    }
    console.log(`[Stealth-Video-Encoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
    console.log(`[Stealth-Video-Encoder] Target FPS dynamically adjusted to ${fps}`);
    // No interval to restart — RAF loop reads targetFps on each tick automatically
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  getTargetFps(): number {
    return this.targetFps;
  }
}
