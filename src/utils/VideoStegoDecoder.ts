import { getClipSequence, preloadClips, getCurrentClipIndex } from './clipFrameLoader';

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

/**
 * VideoStegoDecoder
 *
 * Plays clean cover frames directly to the display canvas on requestAnimationFrame.
 * When a P2P video packet is received, decrypts the JPEG face payload on the main thread
 * and draws it over the display canvas. High clarity, zero latency, zero worker overhead.
 */
export class VideoStegoDecoder {
  private remoteVideoEl: HTMLVideoElement;
  private pin: string;
  private displayCanvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private onFrameProcessTime?: (durationMs: number) => void;
  private targetFps: number = 30;

  private isRunning: boolean = false;
  private frameIndex: number = 0;
  private clipSequence: number[];
  private videoEls: HTMLVideoElement[] = [];

  private lastDecodedFaceImage: HTMLImageElement | null = null;
  private lastDecodedFaceUrl: string | null = null;
  private invalidFrameCount: number = 0;

  // RAF-based cover frame rendering
  private rafHandle: number | null = null;
  private lastFrameTime: number = 0;

  constructor(
    remoteVideoEl: HTMLVideoElement,
    pin: string,
    displayCanvas: HTMLCanvasElement,
    resolution: '240p' | '480p',
    onProgress: (pct: number) => void,
    onFrameProcessTime?: (durationMs: number) => void,
    onDecodedFrame?: (base64: string, seq: number) => void
  ) {
    this.remoteVideoEl = remoteVideoEl;
    this.pin = pin;
    this.displayCanvas = displayCanvas;
    if (resolution === '240p') {
      this.width = 320; this.height = 240;
    } else {
      this.width = 640; this.height = 480;
    }
    this.clipSequence = getClipSequence(pin);
    this.onFrameProcessTime = onFrameProcessTime;
  }

  async init(): Promise<void> {
    // 1. Preload local cover video clips (in case of fallback/background presentation)
    this.videoEls = await preloadClips();

    // 2. Size display canvas
    this.displayCanvas.width  = this.width;
    this.displayCanvas.height = this.height;

    console.log(`[Stealth-Video-Decoder] Main thread P2P decoder initialized (${this.width}x${this.height}).`);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.invalidFrameCount = 0;
    this.rafHandle = requestAnimationFrame(this.rafLoop);
    console.log('[Stealth-Video-Decoder] Started P2P decoder presentation loop.');
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.lastDecodedFaceUrl) {
      URL.revokeObjectURL(this.lastDecodedFaceUrl);
      this.lastDecodedFaceUrl = null;
    }
    this.lastDecodedFaceImage = null;
    this.videoEls.forEach(vid => {
      try { if (!vid.paused) vid.pause(); } catch(_) {}
    });
  }

  /**
   * Decrypts and processes the JPEG face buffer received from the RTCDataChannel.
   */
  public decodeP2pFrame(frameIndex: number, encryptedJpegBytes: Uint8Array): void {
    const t0 = performance.now();
    try {
      const decPrng = new JS_PRNG('VID_ENC_' + this.pin + '_' + frameIndex);
      const decryptedBytes = new Uint8Array(encryptedJpegBytes.length);
      for (let i = 0; i < encryptedJpegBytes.length; i++) {
        decryptedBytes[i] = encryptedJpegBytes[i] ^ Math.floor(decPrng.next() * 256);
      }

      // Verify magic header with tolerance
      let magicMismatches = 0;
      if (decryptedBytes.length < 4) return;
      if (decryptedBytes[0] !== 0x53) magicMismatches++;
      if (decryptedBytes[1] !== 0x54) magicMismatches++;
      if (decryptedBytes[2] !== 0x45) magicMismatches++;
      if (decryptedBytes[3] !== 0x47) magicMismatches++;

      if (magicMismatches > 2) {
        console.warn("[Stealth-Video-Decoder] Bad magic mismatch:", magicMismatches);
        return;
      }

      const jpegBytes = decryptedBytes.subarray(4);
      const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        img.decode().then(() => {
          if (this.lastDecodedFaceUrl) {
            URL.revokeObjectURL(this.lastDecodedFaceUrl);
          }
          this.lastDecodedFaceImage = img;
          this.lastDecodedFaceUrl = url;
          this.invalidFrameCount = 0;
          this.frameIndex = frameIndex;

          if (this.onFrameProcessTime) {
            this.onFrameProcessTime(performance.now() - t0);
          }
        }).catch((err) => {
          console.warn("[Stealth-Video-Decoder] Asynchronous image decode failed:", err);
          URL.revokeObjectURL(url);
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (err) {
      console.error("[Stealth-Video-Decoder] Decryption error:", err);
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
   * RAF loop — runs on main thread to present the active frames.
   */
  private rafLoop = (timestamp: number): void => {
    if (!this.isRunning) return;

    const targetMs = 1000 / this.targetFps;
    if (timestamp - this.lastFrameTime >= targetMs) {
      this.lastFrameTime = timestamp;
      this.renderFrame();
    }

    this.rafHandle = requestAnimationFrame(this.rafLoop);
  };

  private renderFrame = (): void => {
    const displayCtx = this.displayCanvas.getContext('2d');
    if (!displayCtx) return;

    if (this.lastDecodedFaceImage) {
      displayCtx.imageSmoothingEnabled = true;
      displayCtx.imageSmoothingQuality = 'high';
      displayCtx.drawImage(this.lastDecodedFaceImage, 0, 0, this.width, this.height);
    } else {
      // Show a premium dark "Camera Off" screen instead of showing the raw cover video to the local user
      displayCtx.fillStyle = '#0f172a'; // Deep slate background
      displayCtx.fillRect(0, 0, this.width, this.height);
      
      displayCtx.fillStyle = '#64748b';
      displayCtx.font = '14px sans-serif';
      displayCtx.textAlign = 'center';
      displayCtx.fillText('Camera Off', this.width / 2, this.height / 2);
    }
  };

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') { this.width = 320; this.height = 240; }
    else                        { this.width = 640; this.height = 480; }

    if (this.displayCanvas) {
      this.displayCanvas.width  = this.width;
      this.displayCanvas.height = this.height;
    }
    console.log(`[Stealth-Video-Decoder] Resolution adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  setTargetFps(fps: number): void {
    this.targetFps = fps;
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  // Legacy method kept for compatibility
  public decodeFrameFromImage(_img: HTMLImageElement): void {
    // No-op
  }
}
