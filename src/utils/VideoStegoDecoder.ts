import { decryptData, binaryToString, getSha256Key, fastDecrypt, base64ToUint8, uint8ToWordArray, wordArrayToUint8, fastVideoDecrypt } from './crypto';
import { gunzipSync } from 'fflate';
import { getClipSequence, preloadClips, getFrameAtIndex, getCurrentClipIndex } from './clipFrameLoader';
import wasmInit, { StealthEngine } from '../../stealth-engine/pkg/stealth_engine';
import CryptoJS from 'crypto-js';
import { WebGLStego } from './WebGLStego';

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
  private isProcessingFrame: boolean = false; // Re-entrancy guard to prevent timer queue flooding
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private webglStego: WebGLStego | null = null;

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
    try {
      this.webglStego = new WebGLStego(this.width, this.height);
      console.log("[Stealth-Video-Decoder] WebGL GPU Engine active.");
    } catch (err) {
      console.error("[Stealth-Video-Decoder] WebGL GPU Engine failed:", err);
    }
    this.decodeCanvas = document.createElement('canvas');
    this.decodeCanvas.width = this.width;
    this.decodeCanvas.height = this.height;

    this.coverCanvas = document.createElement('canvas');
    this.coverCanvas.width = this.width;
    this.coverCanvas.height = this.height;

    this.tempCanvas = document.createElement('canvas');
    this.tempCanvas.width = 20;
    this.tempCanvas.height = 15;
    const tempCtx = this.tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (tempCtx) {
      this.decImageData = tempCtx.createImageData(20, 15);
    }

    // Size display canvas to ensure drawing scales correctly
    this.displayCanvas.width = this.width;
    this.displayCanvas.height = this.height;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.frameIndex = 0;
    // Use setInterval (not recursive setTimeout) to prevent async chain memory growth in Chrome
    this.intervalId = setInterval(this.processFrame, 100); // 10fps polling; guard skips if busy
    console.log("[Stealth-Video-Decoder] Started decoder loop reading from remote video element.");
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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
    try {
      this.webglStego = new WebGLStego(this.width, this.height);
    } catch(err) {
      console.error("[Stealth-Video-Decoder] Failed to resize WebGL GPU Engine:", err);
    }
    console.log(`[Stealth-Video-Decoder] Resolution dynamically adjusted to ${resolution} (${this.width}x${this.height})`);
  }

  getResolution(): '240p' | '480p' {
    return this.width === 320 ? '240p' : '480p';
  }

  private processFrame = async (): Promise<void> => {
    if (!this.isRunning) return;
    // Re-entrancy guard: if previous frame is still processing, skip this tick
    if (this.isProcessingFrame) return;
    this.isProcessingFrame = true;

    try {
      const video = this.remoteVideoEl;
      const decodeCanvas = this.decodeCanvas;
      const coverCanvas = this.coverCanvas;
      const displayCanvas = this.displayCanvas;

      if (!video || !decodeCanvas || !coverCanvas || !displayCanvas || video.readyState < 2) {
        this.isProcessingFrame = false;
        return; // interval will retry next tick
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
        this.isProcessingFrame = false;
        return; // interval will retry next tick
      }

      // Check if incoming resolution changed/mismatches decoder resolution
      if (video.videoWidth !== this.width || video.videoHeight !== this.height) {
        if (video.videoWidth === 320) {
          this.setResolution('240p');
        } else if (video.videoWidth === 640) {
          this.setResolution('480p');
        } else {
          // Skip processing this frame and wait for video track resolution to stabilize
          this.isProcessingFrame = false;
          return; // interval will retry next tick
        }
      }

      const decCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
      if (!decCtx) {
        this.isProcessingFrame = false;
        return; // interval will retry next tick
      }

      // 1. Draw received stego video to decode canvas
      decCtx.drawImage(video, 0, 0, this.width, this.height);
      const receivedImageData = decCtx.getImageData(0, 0, this.width, this.height);
      const pixels = receivedImageData.data;

      // Extract all bits instantly via GPU WebGL Shaders
      let extractedBits: Uint8Array;
      if (this.webglStego) {
        extractedBits = this.webglStego.decode(receivedImageData);
      } else {
        console.error("WebGLStego unavailable on decoder!");
        this.isProcessingFrame = false;
        return;
      }

      // Display the LOCAL cover video frame (not the stego stream which has visible pixel artifacts)
      // This is the correct steganography behavior: receiver sees the innocent cover video
      const clipIdx = getCurrentClipIndex(this.frameIndex, this.clipSequence);
      const localCoverVideo = this.videoEls[clipIdx];
      if (localCoverVideo) {
        if (localCoverVideo.paused && !localCoverVideo.error) {
          localCoverVideo.play().catch(() => {});
        }
        const displayCtx = displayCanvas.getContext('2d');
        if (displayCtx) {
          displayCtx.drawImage(localCoverVideo, 0, 0, displayCanvas.width, displayCanvas.height);
        }
      }


      // 1. Parse frame index (bits 0..31)
      const encFrameBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        encFrameBytes[byteIdx] |= (extractedBits[i] << bitIdx);
      }
      const frameIndex = this.decryptFrameIndexJS(encFrameBytes, this.pin);

      // Sanity check: is the decrypted frameIndex valid?
      const isValidFrameIndex = 
        frameIndex >= 0 && 
        frameIndex < 1000000;

      if (!isValidFrameIndex) {
        console.log(`[Stealth-Video-Decoder] Invalid frameIndex: ${frameIndex}`);
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
        this.isProcessingFrame = false;
        return; // interval will retry next tick
      }

      console.log(`[Stealth-Video-Decoder] Processing frameIndex: ${frameIndex}`);

      if (frameIndex === this.lastDecodedFrameIndex) {
        // Skip decoding — same frame already decoded
        this.isProcessingFrame = false;
        return; // interval will retry next tick
      }

      // 3-channel capacity: data region uses R/G/B = 3 bits per block pair
      const maxUsable = ((cols * rows) - 64) * 3; // ~28,608 bits at 640x480

      // DEBUG: Count how many bits are 1 vs 0 in header
      const headerBitCount = Array.from(extractedBits.slice(0, 64)).filter(b => b === 1).length;
      console.log(`[Stego-Debug] Frame ${frameIndex}: Header bits (0-63) = ${headerBitCount} ones out of 64. maxUsable=${maxUsable}`);

      // 2. Parse length header (bits 32..63)
      const encLenBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        encLenBytes[byteIdx] |= (extractedBits[32 + i] << bitIdx);
      }
      const rawEncLen = Array.from(encLenBytes).map(b => b.toString(16).padStart(2,'0')).join(' ');
      let dataLength = this.decryptLengthHeaderJS(encLenBytes, this.pin + '_' + frameIndex);
      console.log(`[Stego-Debug] Frame ${frameIndex}: encLenBytes=[${rawEncLen}] decryptedDataLength=${dataLength} pin_key='${this.pin}_${frameIndex}'`);

      let frameDecodedSuccess = false;
      if (dataLength > 0 && dataLength <= maxUsable) {
        console.log(`[Stealth-Video-Decoder] Extracted dataLength: ${dataLength}`);
        
        // 3. Parse data bits
        const numBytes = Math.floor(dataLength / 8);
        const ciphertextBytes = new Uint8Array(numBytes);
        for (let i = 0; i < dataLength; i++) {
          const byteIdx = Math.floor(i / 8);
          const bitIdx = 7 - (i % 8);
          ciphertextBytes[byteIdx] |= (extractedBits[64 + i] << bitIdx);
        }

        // 4. Decrypt with AES WebCrypto and decompress raw RGB

        const decryptedBytes = await fastVideoDecrypt(ciphertextBytes, this.pin, frameIndex);

        if (decryptedBytes.length > 4 && decryptedBytes.length < 500000) {
          try {
            // Check 4-byte magic header 'STEG' [0x53, 0x54, 0x45, 0x47]
            if (
              decryptedBytes.length >= 4 &&
              decryptedBytes[0] === 0x53 &&
              decryptedBytes[1] === 0x54 &&
              decryptedBytes[2] === 0x45 &&
              decryptedBytes[3] === 0x47
            ) {
              // Payload is a compressed image blob (WebP or JPEG)
              const imgBytes = decryptedBytes.subarray(4);
              // createImageBitmap automatically detects format from binary headers
              const blob = new Blob([imgBytes]);
              // Use browser-native high-quality upscaling by requesting target resolution directly
              const bitmapOptions: ImageBitmapOptions = {
                resizeWidth: displayCanvas.width,
                resizeHeight: displayCanvas.height,
                resizeQuality: 'high', // Uses Lanczos or equivalent for best quality
              };
              createImageBitmap(blob, bitmapOptions).then((bmp) => {
                const displayCtx = displayCanvas.getContext('2d');
                if (displayCtx) {
                  displayCtx.imageSmoothingEnabled = true;
                  displayCtx.imageSmoothingQuality = 'high';
                  displayCtx.drawImage(bmp, 0, 0, displayCanvas.width, displayCanvas.height);
                }
                bmp.close();
                this.isProcessingFrame = false;
              }).catch(() => {
                // Fallback: try without resize options if browser doesn't support them
                createImageBitmap(blob).then((bmp) => {
                  const displayCtx = displayCanvas.getContext('2d');
                  if (displayCtx) {
                    displayCtx.imageSmoothingEnabled = true;
                    displayCtx.imageSmoothingQuality = 'high';
                    displayCtx.drawImage(bmp, 0, 0, displayCanvas.width, displayCanvas.height);
                  }
                  bmp.close();
                  this.isProcessingFrame = false;
                }).catch(() => {
                  this.isProcessingFrame = false;
                });
              });
              frameDecodedSuccess = true;
              return; // We return early here because the bitmap decode is async
            }

          } catch (err) {
            // Temporarily log errors to debug decoding failure
            console.error('[Stealth-Video-Decoder] Payload decryption/decompression failed:', err);
          }

          if (this.onFrameDecoded && frameDecodedSuccess) {
            this.onFrameDecoded('SUCCESS', frameIndex);
          }
        }
      } else {
         console.log(`[Stealth-Video-Decoder] Invalid dataLength: ${dataLength} (max: ${maxUsable})`);
      }

      if (frameDecodedSuccess) {
        this.lastDecodedFrameIndex = frameIndex;
        this.frameIndex = frameIndex;

        // Update progress percentage
        const usagePct = ((64 + dataLength) / totalPairs) * 100;
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

    this.isProcessingFrame = false;
    // interval handles next tick automatically
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
