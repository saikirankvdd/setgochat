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
  videoEl: HTMLVideoElement | null | undefined,
  frameIndex: number,
  canvas: HTMLCanvasElement
): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('No canvas 2D context');

  const width = canvas.width;
  const height = canvas.height;

  // Fallback check: if the video is not ready, has an error, or is null/undefined (e.g. WebM on iOS)
  if (!videoEl || videoEl.readyState < 2 || videoEl.error) {
    // Draw a beautiful procedural fallback (moving ambient gradient)
    const time = frameIndex * 0.04;
    const r = Math.floor(128 + 127 * Math.sin(time));
    const g = Math.floor(128 + 127 * Math.sin(time + 2.0));
    const b = Math.floor(128 + 127 * Math.sin(time + 4.0));
    
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, width, height);

    // Evolving ambient overlay shapes
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    const cx1 = width / 2 + Math.cos(time) * (width / 5);
    const cy1 = height / 2 + Math.sin(time) * (height / 5);
    ctx.beginPath();
    ctx.arc(cx1, cy1, width / 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    const cx2 = width / 2 + Math.sin(time * 0.7) * (width / 4);
    const cy2 = height / 2 + Math.cos(time * 0.7) * (height / 4);
    ctx.beginPath();
    ctx.arc(cx2, cy2, width / 8, 0, Math.PI * 2);
    ctx.fill();
    
    return ctx.getImageData(0, 0, width, height);
  }

  // Ensure the video is playing to progress naturally
  if (videoEl.paused) {
    videoEl.play().catch(() => {});
  }

  ctx.drawImage(videoEl, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
