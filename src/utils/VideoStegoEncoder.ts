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

  constructor(
    localStream: MediaStream,
    pin: string,
    resolution: '480p' | '1080p',
    onProgress: (pct: number) => void
  ) {
    this.localStream = localStream;
    this.pin = pin;
    this.width = resolution === '1080p' ? 1920 : 640;
    this.height = resolution === '1080p' ? 1080 : 480;
    this.onProgress = onProgress;
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
      console.log("[Stealth-Video-Encoder] Rust WASM Engine active.");
    } catch (err) {
      console.warn("[Stealth-Video-Encoder] Rust WASM Engine failed, falling back to JS:", err);
    }
    
    // 3. Create hidden video element to read localStream (webcam)
    this.webcamVideoEl = document.createElement('video');
    this.webcamVideoEl.srcObject = this.localStream;
    this.webcamVideoEl.muted = true;
    this.webcamVideoEl.playsInline = true;
    await this.webcamVideoEl.play();

    // 4. Create helper canvases
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = this.width;
    this.captureCanvas.height = this.height;

    this.coverCanvas = document.createElement('canvas');
    this.coverCanvas.width = this.width;
    this.coverCanvas.height = this.height;

    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.width = this.width;
    this.outputCanvas.height = this.height;

    // 5. Capture output stream at 30 fps
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
    }
  }

  private processFrame = (): void => {
    if (!this.isRunning) return;

    try {
      const webcam = this.webcamVideoEl;
      const captureCanvas = this.captureCanvas;
      const coverCanvas = this.coverCanvas;
      const outputCanvas = this.outputCanvas;

      if (!webcam || !captureCanvas || !coverCanvas || !outputCanvas) return;

      const capCtx = captureCanvas.getContext('2d');
      const outCtx = outputCanvas.getContext('2d');
      if (!capCtx || !outCtx) return;

      // 1. Draw webcam to capture canvas
      capCtx.drawImage(webcam, 0, 0, this.width, this.height);

      // 2. Compress webcam frame to JPEG base64
      const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.80);
      const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);

      // 3. Encrypt base64 with PIN + frameIndex
      const encrypted = encryptData(base64, this.pin + '_' + this.frameIndex);
      const dataBits = stringToBinary(encrypted);

      // 4. Get active cover clip and extract its frame
      const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
      const coverVideo = this.videoEls[clipIdx];
      const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
      const pixels = coverImageData.data;

      const totalPixels = this.width * this.height;
      const totalChannels = totalPixels * 3; // Red, Green, Blue (skip Alpha)

      if (this.wasmEngine) {
        // Use high-performance Rust WASM LSB embedding
        const pixelBytes = new Uint8Array(pixels.buffer);
        this.wasmEngine.process_video_frame(pixelBytes, dataBits, this.pin, this.frameIndex);
      } else {
        // Fallback: Use JS LSB embedding
        const encLength = this.encryptLengthHeaderJS(dataBits.length, this.pin + '_' + this.frameIndex);
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

        const usableChannels = totalChannels - 32;
        const dataLength = Math.min(dataBits.length, usableChannels);
        
        if (dataLength > 0) {
          const stride = Math.floor(usableChannels / dataLength);
          const prng = new JS_PRNG(this.pin + '_scatter_' + this.frameIndex);

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

      // 5. Draw modified cover pixels to output canvas
      outCtx.putImageData(coverImageData, 0, 0);

      // 6. Update progress percentage
      const totalBitsNeeded = 32 + dataBits.length;
      const usagePct = (totalBitsNeeded / totalChannels) * 100;
      this.onProgress(Math.min(100, Math.round(usagePct)));

      // 7. Advance frame index
      this.frameIndex++;
    } catch (e) {
      console.error("Error encoding video stego frame:", e);
    }

    // Loop
    requestAnimationFrame(this.processFrame);
  };

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
