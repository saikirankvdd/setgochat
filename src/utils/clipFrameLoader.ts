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
  let container = typeof document !== 'undefined' ? document.getElementById('stealth-video-preload-container') : null;
  if (!container && typeof document !== 'undefined') {
    container = document.createElement('div');
    container.id = 'stealth-video-preload-container';
    Object.assign(container.style, {
      position: 'fixed',
      width: '160px',
      height: '120px',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '-9999',
      top: '-2000px',
      left: '-2000px'
    });
    document.body.appendChild(container);
  }

  const promises = Array.from({ length: 6 }, (_, i) => {
    return new Promise<HTMLVideoElement>((resolve) => {
      const video = document.createElement('video');
      video.src = `/cover-clips/clip_${i}.webm`;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.width = 160;
      video.height = 120;
      
      if (container) {
        container.appendChild(video);
      }
      
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
      video.play().catch(() => {}); // Warm up video element to avoid delay in readyState transition
      
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
  if (frameIndex < 0 || isNaN(frameIndex)) {
    frameIndex = 0;
  }
  let slot = Math.floor(frameIndex / 900) % clipSequence.length;
  if (slot < 0 || isNaN(slot)) {
    slot = 0;
  }
  return clipSequence[slot] ?? 0;
}

/**
 * Extracts the frame from the video element matching the current frameIndex
 */
export function getFrameAtIndex(
  videoEl: HTMLVideoElement | null | undefined,
  frameIndex: number,
  canvas: HTMLCanvasElement
): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('No canvas 2D context');

  const width = canvas.width;
  const height = canvas.height;

  // Ensure the video is playing to progress naturally and transition to readyState >= 2
  if (videoEl && videoEl.paused && !videoEl.error) {
    videoEl.play().catch(() => {});
  }

  // Fallback check: if the video is not ready, has an error, or is null/undefined (e.g. WebM on iOS)
  if (!videoEl || videoEl.readyState < 2 || videoEl.error) {
    // Draw a professional solid dark charcoal/slate fallback background
    ctx.fillStyle = '#0b141a';
    ctx.fillRect(0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }

  ctx.drawImage(videoEl, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
