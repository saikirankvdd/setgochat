import { hashPin } from './coverSongGenerator';

/**
 * Generates a deterministic sequence of the 6 cover clips based on the session PIN
 */
export function getClipSequence(pin: string): number[] {
  const clips = [0, 1, 2, 3, 4, 5];
  const seed = hashPin(pin);
  
  let currentSeed = seed;
  const nextRandom = () => {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
  };

  const pool = [...clips];
  const chosen: number[] = [];
  while (pool.length > 0) {
    const idx = Math.floor(nextRandom() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

/**
 * Preloads the 6 cover videos into off-screen video elements
 */
export async function preloadClips(): Promise<HTMLVideoElement[]> {
  const promises = Array.from({ length: 6 }, (_, i) => {
    return new Promise<HTMLVideoElement>((resolve) => {
      const video = document.createElement('video');
      video.src = `/cover-clips/clip_${i}.webm`;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      
      let resolved = false;
      const handleLoad = () => {
        if (!resolved) {
          resolved = true;
          resolve(video);
        }
      };
      
      video.oncanplay = handleLoad;
      video.onloadeddata = handleLoad;
      video.load();
      
      // Fallback timeout of 3 seconds to avoid blocking the call in case of network issues
      setTimeout(handleLoad, 3000);
    });
  });
  return Promise.all(promises);
}

/**
 * Determines which clip index should be active based on the current frame index
 */
export function getCurrentClipIndex(frameIndex: number, clipSequence: number[]): number {
  const slot = Math.floor(frameIndex / 900) % clipSequence.length;
  return clipSequence[slot];
}

/**
 * Extracts the frame from the video element matching the current frameIndex
 */
export function getFrameAtIndex(
  videoEl: HTMLVideoElement,
  frameIndex: number,
  canvas: HTMLCanvasElement
): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('No canvas 2D context');

  const width = canvas.width;
  const height = canvas.height;

  // Make sure the video is playing
  if (videoEl.paused) {
    videoEl.play().catch(() => {});
  }

  // Calculate target time within the 30-second clip loop
  const duration = videoEl.duration || 5;
  const targetTime = ((frameIndex % 900) / 30) % duration;
  
  // Sync playhead if it drifts by more than 0.5s
  if (Math.abs(videoEl.currentTime - targetTime) > 0.5) {
    videoEl.currentTime = targetTime;
  }

  ctx.drawImage(videoEl, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}
