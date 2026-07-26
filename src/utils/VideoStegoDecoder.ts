import { decryptData, binaryToString, getSha256Key, fastDecrypt, base64ToUint8, uint8ToWordArray, wordArrayToUint8 } from './crypto';
import { gunzipSync } from 'fflate';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';
import CryptoJS from 'crypto-js';

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
  private tempCanvas: HTMLCanvasElement | null = null;
  private decImageData: ImageData | null = null;
  private isRunning: boolean;
  private wasmEngine: StealthEngine | null;
  private onFrameProcessTime?: (durationMs: number) => void;
  private onFrameDecoded?: (base64: string, seq: number) => void;
  private lastDecodedFrameIndex: number;
  private masterKey: CryptoJS.lib.WordArray | null = null;


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
    this.frameIndex = 0;
    this.clipSequence = getClipSequence(pin);
    this.videoEls = [];
    this.decodeCanvas = null;
    this.coverCanvas = null;
    this.isRunning = false;
    this.wasmEngine = null;
    this.onFrameProcessTime = onFrameProcessTime;
    this.onFrameDecoded = onFrameDecoded;
    this.lastDecodedFrameIndex = -1;
  }

  async init(): Promise<void> {
    // Pre-hash PIN once to get master key for fast stream decryption
    this.masterKey = getSha256Key(this.pin);

    // 1. Preload cover videos
    this.videoEls = await preloadClips();

    // 2. Initialize WASM Engine
    try {
      const response = await fetch('/stealth-engine/stealth_engine_bg.wasm');
      const wasmBuffer = await response.arrayBuffer();
      await wasmInit({ module_or_path: wasmBuffer });
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

    this.tempCanvas = document.createElement('canvas');
    this.tempCanvas.width = 32;
    this.tempCanvas.height = 24;

    const tempCtx = this.tempCanvas.getContext('2d');
    if (tempCtx) {
      this.decImageData = tempCtx.createImageData(32, 24);
    }

    // Size display canvas to ensure drawing scales correctly
    this.displayCanvas.width = this.width;
    this.displayCanvas.height = this.height;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    this.processFrame();
    console.log("[Stealth-Video-Decoder] Started decoder loop reading from remote video element.");
  }

  stop(): void {
    this.isRunning = false;
    // Pause all cover videos to save CPU
    this.videoEls.forEach(vid => {
      try {
        if (!vid.paused) vid.pause();
      } catch (e) {}
    });
  }

  public decodeFrameFromImage(img: HTMLImageElement): void {
    if (!this.isRunning) return;
    try {
      const decodeCanvas = this.decodeCanvas;
      const coverCanvas = this.coverCanvas;
      const displayCanvas = this.displayCanvas;
      if (!decodeCanvas || !coverCanvas || !displayCanvas) return;

      const decCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
      if (!decCtx) return;

      // 1. Draw received stego image to decode canvas
      decCtx.drawImage(img, 0, 0, this.width, this.height);
      const receivedImageData = decCtx.getImageData(0, 0, this.width, this.height);
      const pixels = receivedImageData.data;

      const totalChannels = this.width * this.height * 3;

      // 2. Extract frame index
      const encFrameBytes = new Uint8Array(4);
      let channelIdxIdx = 0;
      for (let i = 0; i < 32; i++) {
        if (channelIdxIdx % 4 === 3) channelIdxIdx++;
        const bit = pixels[channelIdxIdx] & 1;
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        encFrameBytes[byteIdx] |= (bit << bitIdx);
        channelIdxIdx++;
      }
      const frameIndex = this.decryptFrameIndexJS(encFrameBytes, this.pin);

      const isValidFrameIndex = frameIndex >= 0 && frameIndex < 1000000;
      if (!isValidFrameIndex) {
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
        const displayCtx = displayCanvas.getContext('2d');
        displayCtx?.putImageData(coverImageData, 0, 0);
        this.frameIndex++;
        return;
      }

      let bitString = '';
      if (this.wasmEngine) {
        const pixelBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        bitString = this.wasmEngine.extract_video_frame(pixelBytes, this.pin, frameIndex);
      } else {
        const maxUsable = totalChannels - 64;
        let channelIdx = 0;
        for (let i = 0; i < 32; i++) {
          if (channelIdx % 4 === 3) channelIdx++;
          channelIdx++;
        }
        const encLenBytes = new Uint8Array(4);
        for (let i = 0; i < 32; i++) {
          if (channelIdx % 4 === 3) channelIdx++;
          const bit = pixels[channelIdx] & 1;
          const byteIdx = Math.floor(i / 8);
          const bitIdx = 7 - (i % 8);
          encLenBytes[byteIdx] |= (bit << bitIdx);
          channelIdx++;
        }
        const dataLength = this.decryptLengthHeaderJS(encLenBytes, this.pin + '_' + frameIndex);

        if (dataLength > 0 && dataLength <= maxUsable) {
          const stride = Math.floor(maxUsable / dataLength);
          const prng = new JS_PRNG(this.pin + '_scatter_' + frameIndex);
          for (let i = 0; i < dataLength; i++) {
            const relativeLogicalIdx = i * stride + Math.floor(prng.next() * stride);
            const targetLogicalIdx = 64 + relativeLogicalIdx;
            const actualIdx = targetLogicalIdx + Math.floor(targetLogicalIdx / 3);
            const bit = pixels[actualIdx] & 1;
            bitString += bit.toString();
          }
        }
      }

      let decryptedBase64 = '';
      if (bitString && bitString.length > 0) {
        const encrypted = binaryToString(bitString);
        const iv = CryptoJS.lib.WordArray.create([0, 0, 0, frameIndex]);
        decryptedBase64 = fastDecrypt(encrypted, this.masterKey!, iv);

        if (decryptedBase64) {
          const faceImg = new Image();
          faceImg.onload = () => {
            const displayCtx = displayCanvas.getContext('2d');
            displayCtx?.drawImage(faceImg, 0, 0, displayCanvas.width, displayCanvas.height);
          };
          faceImg.src = 'data:image/jpeg;base64,' + decryptedBase64;
        }
      }

      if (decryptedBase64) {
        this.lastDecodedFrameIndex = frameIndex;
        this.frameIndex = frameIndex;
      } else {
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        const coverImageData = getFrameAtIndex(coverVideo, this.frameIndex, coverCanvas);
        const displayCtx = displayCanvas.getContext('2d');
        displayCtx?.putImageData(coverImageData, 0, 0);
        this.frameIndex++;
      }
    } catch (e) {
      console.error("Error decoding socket stego frame:", e);
    }
  }

  setResolution(resolution: '240p' | '480p'): void {
    if (resolution === '240p') {
      this.width = 320;
      this.height = 240;
    } else {
      this.width = 640;
      this.height = 480;
    }
    if (this.decodeCanvas) {
      this.decodeCanvas.width = this.width;
      this.decodeCanvas.height = this.height;
    }
    if (this.coverCanvas) {
      this.coverCanvas.width = this.width;
      this.coverCanvas.height = this.height;
    }
    if (this.displayCanvas) {
      this.displayCanvas.width = this.width;
      this.displayCanvas.height = this.height;
    }
    console.log(`[Stealth-Video-Decoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
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

      // Check if resolution is ramping up / too low
      if (video.videoWidth < 320 || video.videoHeight < 240) {
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        if (coverVideo) {
          if (coverVideo.paused && !coverVideo.error) {
            coverVideo.play().catch(() => {});
          }
          const displayCtx = displayCanvas.getContext('2d');
          if (displayCtx) {
            displayCtx.drawImage(coverVideo, 0, 0, displayCanvas.width, displayCanvas.height);
          }
        }
        // Do not increment this.frameIndex when skipping frames due to low resolution (<320x240)
        setTimeout(this.processFrame, 66);
        return;
      }

      // Check if incoming resolution changed/mismatches decoder resolution
      if (video.videoWidth !== this.width || video.videoHeight !== this.height) {
        if (video.videoWidth === 320) {
          this.setResolution('240p');
        } else if (video.videoWidth === 640) {
          this.setResolution('480p');
        } else {
          // Skip processing this frame and wait for video track resolution to stabilize
          setTimeout(this.processFrame, 66);
          return;
        }
      }

      const decCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
      if (!decCtx) return;

      // 1. Draw received stego video to decode canvas
      decCtx.drawImage(video, 0, 0, this.width, this.height);
      const receivedImageData = decCtx.getImageData(0, 0, this.width, this.height);
      const pixels = receivedImageData.data;

      const totalPixels = this.width * this.height;
      const totalChannels = totalPixels * 3;
      
      // Helper function for 2x2 block stego
      const getBlockGreen = (pixArr: Uint8ClampedArray, w: number, x: number, y: number): number => {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const idx = ((y + dy) * w + (x + dx)) * 4 + 1;
            sum += pixArr[idx];
          }
        }
        return sum / 4;
      };

      const cols = Math.floor(this.width / 4);

      // 1. Extract frame index in JS from first 32 blocks (i = 0..31)
      const encFrameBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        const rowIdx = Math.floor(i / cols);
        const colIdx = i % cols;
        const colA = colIdx * 4;
        const rowA = rowIdx * 2;
        const colB = colIdx * 4 + 2;
        const rowB = rowIdx * 2;

        const valA = getBlockGreen(pixels, this.width, colA, rowA);
        const valB = getBlockGreen(pixels, this.width, colB, rowB);
        const bit = (valA - valB) > 0 ? 1 : 0;

        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        encFrameBytes[byteIdx] |= (bit << bitIdx);
      }
      const frameIndex = this.decryptFrameIndexJS(encFrameBytes, this.pin);

      // Sanity check: is the decrypted frameIndex valid?
      const isValidFrameIndex = 
        frameIndex >= 0 && 
        frameIndex < 1000000;

      if (!isValidFrameIndex) {
        // Draw the cover frame using our current local frameIndex
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        if (coverVideo) {
          if (coverVideo.paused && !coverVideo.error) {
            coverVideo.play().catch(() => {});
          }
          const displayCtx = displayCanvas.getContext('2d');
          if (displayCtx) {
            displayCtx.drawImage(coverVideo, 0, 0, displayCanvas.width, displayCanvas.height);
          }
        }
        this.frameIndex++;
        setTimeout(this.processFrame, 66);
        return;
      }

      if (frameIndex === this.lastDecodedFrameIndex) {
        // Skip decoding that loop to save CPU and prevent duplicate processing.
        setTimeout(this.processFrame, 66);
        return;
      }

      let bitString = '';
      const maxUsable = Math.floor(totalPixels / 8) - 64;

      // 2. Extract length header from next 32 blocks (logical channels 32-63)
      const encLenBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        const bitIdxGlobal = 32 + i;
        const rowIdx = Math.floor(bitIdxGlobal / cols);
        const colIdx = bitIdxGlobal % cols;
        const colA = colIdx * 4;
        const rowA = rowIdx * 2;
        const colB = colIdx * 4 + 2;
        const rowB = rowIdx * 2;

        const valA = getBlockGreen(pixels, this.width, colA, rowA);
        const valB = getBlockGreen(pixels, this.width, colB, rowB);
        const bit = (valA - valB) > 0 ? 1 : 0;

        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        encLenBytes[byteIdx] |= (bit << bitIdx);
      }
      const dataLength = this.decryptLengthHeaderJS(encLenBytes, this.pin + '_' + frameIndex);

      if (dataLength > 0 && dataLength <= maxUsable) {
        for (let i = 0; i < dataLength; i++) {
          const bitIdxGlobal = 64 + i;
          const rowIdx = Math.floor(bitIdxGlobal / cols);
          const colIdx = bitIdxGlobal % cols;
          const colA = colIdx * 4;
          const rowA = rowIdx * 2;
          const colB = colIdx * 4 + 2;
          const rowB = rowIdx * 2;

          const valA = getBlockGreen(pixels, this.width, colA, rowA);
          const valB = getBlockGreen(pixels, this.width, colB, rowB);
          const bit = (valA - valB) > 0 ? 1 : 0;
          bitString += bit.toString();
        }
      }

      let frameDecodedSuccess = false;
      if (bitString && bitString.length > 0) {
        // 4. Convert bits to ciphertext byte array, decrypt with AES WordArray, and decompress raw RGB
        const numBytes = Math.floor(bitString.length / 8);
        const ciphertextBytes = new Uint8Array(numBytes);
        for (let i = 0; i < numBytes; i++) {
          let b = 0;
          const offset = i * 8;
          for (let j = 0; j < 8; j++) {
            if (bitString.charCodeAt(offset + j) === 49) {
              b |= (1 << (7 - j));
            }
          }
          ciphertextBytes[i] = b;
        }

        const cipherWA = uint8ToWordArray(ciphertextBytes);
        const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: cipherWA });
        const iv = CryptoJS.lib.WordArray.create([0, 0, 0, frameIndex]);
        const decryptedWA = CryptoJS.AES.decrypt(cipherParams, this.masterKey!, { iv: iv });

        const sigBytes = decryptedWA.sigBytes;
        if (sigBytes > 4 && sigBytes < 500000) {
          try {
            const compressed = wordArrayToUint8(decryptedWA);
            const decompressed = gunzipSync(compressed);
            
            // Check 4-byte magic header 'STEG' [0x53, 0x54, 0x45, 0x47]
            if (
              decompressed.length >= 4 &&
              decompressed[0] === 0x53 &&
              decompressed[1] === 0x54 &&
              decompressed[2] === 0x45 &&
              decompressed[3] === 0x47
            ) {
              const rgbBytes = decompressed.subarray(4);
              const W = 32;
              const H = 24;
              const tempCanvas = this.tempCanvas || document.createElement('canvas');
              const tempCtx = tempCanvas.getContext('2d');
              if (tempCtx) {
                const imgData = this.decImageData || tempCtx.createImageData(W, H);
                let rgbIdx = 0;
                for (let i = 0; i < imgData.data.length; i += 4) {
                  if (rgbIdx + 2 >= rgbBytes.length) break;
                  imgData.data[i]     = rgbBytes[rgbIdx++]; // R
                  imgData.data[i + 1] = rgbBytes[rgbIdx++]; // G
                  imgData.data[i + 2] = rgbBytes[rgbIdx++]; // B
                  imgData.data[i + 3] = 255;                // A
                }
                tempCtx.putImageData(imgData, 0, 0);
                
                const displayCtx = displayCanvas.getContext('2d');
                if (displayCtx) {
                  displayCtx.drawImage(tempCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
                }
              }
              frameDecodedSuccess = true;
            }
          } catch (err) {
            // Silently drop H.264 corrupted frame — no console flood or tab crash
          }

          if (this.onFrameDecoded && frameDecodedSuccess) {
            this.onFrameDecoded('SUCCESS', frameIndex);
          }
        }
      }

      if (frameDecodedSuccess) {
        this.lastDecodedFrameIndex = frameIndex;
        this.frameIndex = frameIndex;

        // Update progress percentage
        const usagePct = ((64 + bitString.length) / totalChannels) * 100;
        this.onProgress(Math.min(100, Math.round(usagePct)));
      } else {
        // If decryption failed or is corrupted, show cover frame
        const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
        const coverVideo = this.videoEls[clipIdx];
        if (coverVideo) {
          if (coverVideo.paused && !coverVideo.error) {
            coverVideo.play().catch(() => {});
          }
          const displayCtx = displayCanvas.getContext('2d');
          if (displayCtx) {
            displayCtx.drawImage(coverVideo, 0, 0, displayCanvas.width, displayCanvas.height);
          }
        }
        this.frameIndex++;
      }
    } catch (e) {
      // Silently catch unexpected errors
    }

    setTimeout(this.processFrame, 66);
  };

  private decryptFrameIndexJS(encBytes: Uint8Array, pin: string): number {
    const prng = new JS_PRNG('VID_IDX_' + pin);
    const decrypted = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      decrypted[i] = encBytes[i] ^ Math.floor(prng.next() * 256);
    }
    return (decrypted[0] << 24) | (decrypted[1] << 16) | (decrypted[2] << 8) | decrypted[3];
  }

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
