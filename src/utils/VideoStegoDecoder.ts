import { decryptData, binaryToString } from './crypto';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';

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
  private decodeCanvas: HTMLCanvasElement | null;
  private coverCanvas: HTMLCanvasElement | null;
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;

  constructor(
    remoteVideoEl: HTMLVideoElement,
    pin: string,
    displayCanvas: HTMLCanvasElement,
    resolution: '480p' | '1080p',
    onProgress: (pct: number) => void
  ) {
    this.remoteVideoEl = remoteVideoEl;
    this.pin = pin;
    this.displayCanvas = displayCanvas;
    this.width = resolution === '1080p' ? 1920 : 640;
    this.height = resolution === '1080p' ? 1080 : 480;
    this.onProgress = onProgress;
    this.frameIndex = 0;
    this.clipSequence = getClipSequence(pin);
    this.videoEls = [];
    this.decodeCanvas = null;
    this.coverCanvas = null;
    this.isRunning = false;
    this.wasmEngine = null;
  }

  async init(): Promise<void> {
    // 1. Preload cover videos
    this.videoEls = await preloadClips();

    // 2. Initialize WASM Engine
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit(wasmBuffer);
      this.wasmEngine = new StealthEngine();
      console.log("[Stealth-Video-Decoder] Rust WASM Engine active.");
    } catch (err) {
      console.warn("[Stealth-Video-Decoder] Rust WASM Engine failed, falling back to JS:", err);
    }

    // 3. Create canvases
    this.decodeCanvas = document.createElement('canvas');
    this.decodeCanvas.width = this.width;
    this.decodeCanvas.height = this.height;

    this.coverCanvas = document.createElement('canvas');
    this.coverCanvas.width = this.width;
    this.coverCanvas.height = this.height;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    this.processFrame();
  }

  stop(): void {
    this.isRunning = false;
  }

  private processFrame = (): void => {
    if (!this.isRunning) return;

    try {
      const video = this.remoteVideoEl;
      const decodeCanvas = this.decodeCanvas;
      const coverCanvas = this.coverCanvas;
      const displayCanvas = this.displayCanvas;

      if (!video || !decodeCanvas || !coverCanvas || !displayCanvas || video.readyState < 2) {
        requestAnimationFrame(this.processFrame);
        return;
      }

      const decCtx = decodeCanvas.getContext('2d');
      if (!decCtx) return;

      // 1. Draw received stego video to decode canvas
      decCtx.drawImage(video, 0, 0, this.width, this.height);
      const receivedImageData = decCtx.getImageData(0, 0, this.width, this.height);
      const pixels = receivedImageData.data;

      const totalPixels = this.width * this.height;
      const totalChannels = totalPixels * 3;
      const maxUsable = totalChannels - 32;

      let bitString = '';

      if (this.wasmEngine) {
        // Use high-performance Rust WASM LSB extraction
        const pixelBytes = new Uint8Array(pixels.buffer);
        bitString = this.wasmEngine.extract_video_frame(pixelBytes, this.pin, this.frameIndex);
      } else {
        // Fallback: Use JS LSB extraction
        const encBytes = new Uint8Array(4);
        let channelIdx = 0;
        for (let i = 0; i < 32; i++) {
          if (channelIdx % 4 === 3) channelIdx++; // skip alpha
          
          const bit = pixels[channelIdx] & 1;
          const byteIdx = Math.floor(i / 8);
          const bitIdx = 7 - (i % 8);
          encBytes[byteIdx] |= (bit << bitIdx);
          
          channelIdx++;
        }

        const dataLength = this.decryptLengthHeaderJS(encBytes, this.pin + '_' + this.frameIndex);

        if (dataLength > 0 && dataLength <= maxUsable) {
          const stride = Math.floor(maxUsable / dataLength);
          const prng = new JS_PRNG(this.pin + '_scatter_' + this.frameIndex);

          for (let i = 0; i < dataLength; i++) {
            const relativeLogicalIdx = i * stride + Math.floor(prng.next() * stride);
            const targetLogicalIdx = 32 + relativeLogicalIdx;
            const actualIdx = targetLogicalIdx + Math.floor(targetLogicalIdx / 3);

            const bit = pixels[actualIdx] & 1;
            bitString += bit.toString();
          }
        }
      }

      if (bitString && bitString.length > 0) {
        // 4. Convert bits to encrypted string, decrypt, and display image
        const encrypted = binaryToString(bitString);
        const base64 = decryptData(encrypted, this.pin + '_' + this.frameIndex);

        if (base64) {
          const img = new Image();
          img.onload = () => {
            const displayCtx = displayCanvas.getContext('2d');
            displayCtx?.drawImage(img, 0, 0, displayCanvas.width, displayCanvas.height);
          };
          img.src = 'data:image/jpeg;base64,' + base64;
        }

        // Update progress percentage
        const usagePct = ((32 + bitString.length) / totalChannels) * 100;
        this.onProgress(Math.min(100, Math.round(usagePct)));
      } else {
        // If decryption failed or is corrupted, clear local display or show cover frame
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
        const displayCtx = displayCanvas.getContext('2d');
        displayCtx?.putImageData(coverImageData, 0, 0);
      }

      this.frameIndex++;
    } catch (e) {
      console.error("Error decoding video stego frame:", e);
    }

    requestAnimationFrame(this.processFrame);
  };

  private decryptLengthHeaderJS(encBytes: Uint8Array, pin: string): number {
    const prng = new JS_PRNG('VID_HDR_' + pin);
    const decrypted = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      decrypted[i] = encBytes[i] ^ Math.floor(prng.next() * 256);
    }
    return (decrypted[0] << 24) | (decrypted[1] << 16) | (decrypted[2] << 8) | decrypted[3];
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
