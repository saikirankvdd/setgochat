import {
  generateLofi,
  generateOrchestral,
  generateJazz,
  generateSynthwave,
  generateNature,
  generateEDM,
  MusicGenre
} from './stego';

/**
 * Deterministic djb2 hash of a PIN string
 */
export function hashPin(pin: string): number {
  let hash = 5381;
  for (let i = 0; i < pin.length; i++) {
    hash = ((hash << 5) + hash) ^ pin.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

/**
 * Selects 4 music genres in a deterministic order based on session PIN
 */
export function selectGenreOrder(pin: string): MusicGenre[] {
  const genres: MusicGenre[] = ['lofi', 'nature', 'edm', 'jazz', 'synthwave', 'orchestral'];
  const seed = hashPin(pin);
  
  // Use a simple deterministic LCG for shuffling
  let currentSeed = seed;
  const nextRandom = () => {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
  };

  const pool = [...genres];
  const chosen: MusicGenre[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(nextRandom() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

/**
 * Generates a 2-minute cover song (4 genres, 30s each) deterministically from a PIN
 */
export async function generateCoverSong(pin: string): Promise<Float32Array> {
  const genres = selectGenreOrder(pin);
  const sampleRate = 44100;
  const segmentDuration = 30; // 30 seconds
  const segmentSamples = sampleRate * segmentDuration;
  const totalSamples = segmentSamples * 4;
  const coverSong = new Float32Array(totalSamples);

  const AudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!AudioContextClass) throw new Error('OfflineAudioContext not supported');

  for (let i = 0; i < 4; i++) {
    const genre = genres[i];
    const ctx = new AudioContextClass(1, segmentSamples, sampleRate);

    switch (genre) {
      case 'lofi':
        generateLofi(ctx, segmentDuration);
        break;
      case 'orchestral':
        generateOrchestral(ctx, segmentDuration);
        break;
      case 'jazz':
        generateJazz(ctx, segmentDuration);
        break;
      case 'synthwave':
        generateSynthwave(ctx, segmentDuration);
        break;
      case 'nature':
        generateNature(ctx, segmentDuration);
        break;
      case 'edm':
        generateEDM(ctx, segmentDuration);
        break;
    }

    const rendered = await ctx.startRendering();
    const channelData = rendered.getChannelData(0);
    coverSong.set(channelData, i * segmentSamples);
  }

  return coverSong;
}
