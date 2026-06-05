/**
 * Audio Steganography Utility
 * Includes Legacy 4-bit encoding for old backups, and new 1-bit scattered music-tiered encoding.
 */

export const encodeLSB = (audioBuffer: ArrayBuffer, data: string): ArrayBuffer => {
  const view = new DataView(audioBuffer);
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;

  const totalBitsNeeded = 32 + data.length;
  if (totalBitsNeeded > availableSamples) {
    throw new Error('Data too large for this audio file');
  }

  const newBuffer = audioBuffer.slice(0);
  const newView = new DataView(newBuffer);

  // 1. Write data length (32-bit unsigned integer) in the first 32 samples
  const length = data.length;
  for (let i = 0; i < 32; i++) {
    const bit = (length >>> (31 - i)) & 1;
    const offset = headerSize + i * 2;
    let sample = newView.getInt16(offset, true);
    if (bit === 1) sample |= 1;
    else sample &= ~1;
    newView.setInt16(offset, sample, true);
  }

  // 2. Write payload bits sequentially
  for (let i = 0; i < data.length; i++) {
    const offset = headerSize + (32 + i) * 2;
    let sample = newView.getInt16(offset, true);
    if (data[i] === '1') sample |= 1;
    else sample &= ~1;
    newView.setInt16(offset, sample, true);
  }

  return newBuffer;
};

export const decodeLSB = (audioBuffer: ArrayBuffer): string => {
  const view = new DataView(audioBuffer);
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;

  if (availableSamples < 32) return '';

  // 1. Read data length from the first 32 samples
  let dataLength = 0;
  for (let i = 0; i < 32; i++) {
    const offset = headerSize + i * 2;
    const sample = view.getInt16(offset, true);
    const bit = sample & 1;
    dataLength = (dataLength << 1) | bit;
  }

  // 2. Bound check
  if (dataLength <= 0 || dataLength > availableSamples - 32) {
    return '';
  }

  // 3. Read payload bits sequentially
  let binaryData = '';
  for (let i = 0; i < dataLength; i++) {
    const offset = headerSize + (32 + i) * 2;
    const sample = view.getInt16(offset, true);
    binaryData += (sample & 1).toString();
  }

  return binaryData;
};

// ==========================================
// PRNG - Deterministic pseudo-random number generator
// seeded by the password for reproducible scatter patterns
// ==========================================

class PRNG {
  private seed: number;
  constructor(seedString: string) {
    // Use a better hash (DJB2 variant) for more entropy
    let hash = 5381;
    for (let i = 0; i < seedString.length; i++) {
      hash = ((hash << 5) + hash) ^ seedString.charCodeAt(i);
      hash |= 0;
    }
    this.seed = hash >>> 0;
  }
  next(): number {
    // xorshift32 — much better distribution than LCG
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    this.seed = this.seed >>> 0;
    return this.seed / 4294967296;
  }
  /** Generate a deterministic byte stream for XOR masking */
  nextByte(): number {
    return Math.floor(this.next() * 256);
  }
}

function generateScatterPattern(totalSamples: number, dataLength: number, password: string): number[] {
  const prng = new PRNG(password);
  // Fisher-Yates partial shuffle — pick dataLength unique indices from [0, totalSamples)
  // This guarantees no collisions and perfectly uniform distribution
  const pool: number[] = [];
  for (let i = 0; i < totalSamples; i++) pool.push(i);
  
  const indices: number[] = [];
  for (let i = 0; i < dataLength; i++) {
    const j = i + Math.floor(prng.next() * (totalSamples - i));
    // Swap
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    indices.push(pool[i]);
  }
  
  // Sort indices so we write in order (prevents any access pattern leaks)
  indices.sort((a, b) => a - b);
  return indices;
}

/**
 * XOR-encrypt the length header using the password so it's not stored in plaintext.
 * The 32-bit length is XOR'd with 4 deterministic PRNG bytes derived from password + salt.
 */
function encryptLengthHeader(length: number, password: string): Uint8Array {
  const prng = new PRNG('STEGO_HDR_' + password);
  const lengthBytes = new Uint8Array(4);
  lengthBytes[0] = (length >>> 24) & 0xFF;
  lengthBytes[1] = (length >>> 16) & 0xFF;
  lengthBytes[2] = (length >>> 8) & 0xFF;
  lengthBytes[3] = length & 0xFF;
  
  for (let i = 0; i < 4; i++) {
    lengthBytes[i] ^= prng.nextByte();
  }
  return lengthBytes;
}

function decryptLengthHeader(encBytes: Uint8Array, password: string): number {
  const prng = new PRNG('STEGO_HDR_' + password);
  const decrypted = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    decrypted[i] = encBytes[i] ^ prng.nextByte();
  }
  return (decrypted[0] << 24) | (decrypted[1] << 16) | (decrypted[2] << 8) | decrypted[3];
}

export const encodeLSB1Bit = (audioBuffer: ArrayBuffer, data: string, password: string): ArrayBuffer => {
  const newBuffer = audioBuffer.slice(0);
  const view = new DataView(newBuffer);
  const dataBits = data;
  const numSamples = (view.byteLength - 44) / 2;
  
  // Header: 32 bits for encrypted length
  const totalBitsNeeded = 32 + dataBits.length;
  if (totalBitsNeeded > numSamples) throw new Error("Audio carrier too small for data");
  
  // 1. Write ENCRYPTED data length in the first 32 samples
  const encLength = encryptLengthHeader(dataBits.length, password);
  for (let i = 0; i < 32; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    const bit = (encLength[byteIdx] >>> bitIdx) & 1;
    
    let sample = view.getInt16(44 + i * 2, true);
    if ((sample & 1) !== bit) {
      if (sample === 32767) sample -= 1;
      else if (sample === -32768) sample += 1;
      else sample += (Math.random() < 0.5 ? 1 : -1);
    }
    view.setInt16(44 + i * 2, sample, true);
  }
  
  // 2. Generate scatter pattern for the rest (Fisher-Yates, perfectly uniform)
  const usableSamples = numSamples - 32;
  const indices = generateScatterPattern(usableSamples, dataBits.length, password);
  
  // 3. Write scattered bits
  for (let i = 0; i < dataBits.length; i++) {
    const targetSampleIdx = 32 + indices[i];
    let sample = view.getInt16(44 + targetSampleIdx * 2, true);
    const bitToEmbed = parseInt(dataBits[i]);
    if ((sample & 1) !== bitToEmbed) {
      if (sample === 32767) sample -= 1;
      else if (sample === -32768) sample += 1;
      else sample += (Math.random() < 0.5 ? 1 : -1);
    }
    view.setInt16(44 + targetSampleIdx * 2, sample, true);
  }
  
  return newBuffer;
};

export const decodeLSB1Bit = (audioBuffer: ArrayBuffer, password: string): string => {
  const view = new DataView(audioBuffer);
  const numSamples = (view.byteLength - 44) / 2;
  
  // 1. Read encrypted length from the first 32 samples
  const encBytes = new Uint8Array(4);
  for (let i = 0; i < 32; i++) {
    const sample = view.getInt16(44 + i * 2, true);
    const bit = sample & 1;
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    encBytes[byteIdx] |= (bit << bitIdx);
  }
  const dataLength = decryptLengthHeader(encBytes, password);
  
  if (dataLength <= 0 || dataLength > numSamples - 32) {
    throw new Error("Invalid stego file or wrong password");
  }
  
  // 2. Generate scatter pattern
  const usableSamples = numSamples - 32;
  const indices = generateScatterPattern(usableSamples, dataLength, password);
  
  // 3. Read scattered bits
  let dataBits = '';
  for (let i = 0; i < dataLength; i++) {
    const targetSampleIdx = 32 + indices[i];
    const sample = view.getInt16(44 + targetSampleIdx * 2, true);
    dataBits += (sample & 1).toString();
  }
  
  return dataBits;
};

// ==========================================
// MUSIC GENERATION — 6 Genre System (random pick per export)
// Genres: Lo-fi Chill, Epic Orchestral, Jazz, Synthwave, Nature Ambient, EDM Pulse
// Pure Web Audio API — no external API needed, works offline
// ==========================================

const MUSIC_GENRES = ['lofi', 'orchestral', 'jazz', 'synthwave', 'nature', 'edm'] as const;
export type MusicGenre = typeof MUSIC_GENRES[number];

export async function generateMusicCarrier(payloadBitLength: number): Promise<{ buffer: ArrayBuffer, type: string }> {
  const sampleRate = 44100;
  const requiredSamples = payloadBitLength * 8 + 32;
  let duration = Math.ceil(requiredSamples / sampleRate);

  // Enforce minimum durations per tier
  if (duration < 10) duration = 10;
  else if (duration < 60) duration = 60;
  else if (duration < 300) duration = 300;

  const AudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API not supported in this browser');

  // Pick a random genre each time so every export sounds different
  const genre: MusicGenre = MUSIC_GENRES[Math.floor(Math.random() * MUSIC_GENRES.length)];
  const ctx = new AudioContextClass(1, sampleRate * duration, sampleRate);

  switch (genre) {
    case 'lofi':        generateLofi(ctx, duration);        break;
    case 'orchestral':  generateOrchestral(ctx, duration);  break;
    case 'jazz':        generateJazz(ctx, duration);        break;
    case 'synthwave':   generateSynthwave(ctx, duration);   break;
    case 'nature':      generateNature(ctx, duration);      break;
    case 'edm':         generateEDM(ctx, duration);         break;
  }

  const renderedBuffer = await ctx.startRendering();
  return { buffer: audioBufferToWav(renderedBuffer), type: genre };
}

// ------------------------------------------------------------------
// Genre 1: Lo-fi Chill
// Warm vinyl-esque pads, laid-back plucks, soft kick, gentle hiss
// ------------------------------------------------------------------
export function generateLofi(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('lofi_' + duration);

  // Soft vinyl hiss (filtered white noise)
  const bufSize = ctx.sampleRate * 2;
  const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.015;
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuf;
  noiseSource.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 3000;
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(ctx.destination);
  noiseSource.start(0);
  noiseSource.stop(duration);

  // Warm chord pad (Cmaj7: C E G B)
  const padFreqs = [130.81, 164.81, 196.00, 246.94];
  padFreqs.forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lpf = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    lpf.type = 'lowpass';
    lpf.frequency.value = 800;
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.09, 2);
    gain.gain.setValueAtTime(0.09, duration - 2);
    gain.gain.linearRampToValueAtTime(0, duration);
    osc.connect(lpf); lpf.connect(gain); gain.connect(ctx.destination);
    osc.start(0); osc.stop(duration);
  });

  // Lazy pluck melody (pentatonic: C D E G A)
  const penta = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
  for (let t = 1.5; t < duration - 1; t += 0.5 + prng.next() * 0.8) {
    if (prng.next() > 0.4) {
      const freq = penta[Math.floor(prng.next() * penta.length)] * (prng.next() > 0.7 ? 2 : 1);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const lpf = ctx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      lpf.type = 'lowpass'; lpf.frequency.value = 1200;
      const vol = 0.06 + prng.next() * 0.05;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(lpf); lpf.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.5);
    }
  }

  // Soft kick on every 2 beats
  for (let t = 0; t < duration; t += 0.5) {
    if (Math.round(t / 0.5) % 4 === 0) {
      const kick = ctx.createOscillator();
      const kGain = ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(120, t);
      kick.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      kGain.gain.setValueAtTime(0.3, t);
      kGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      kick.connect(kGain); kGain.connect(ctx.destination);
      kick.start(t); kick.stop(t + 0.3);
    }
  }
}

// ------------------------------------------------------------------
// Genre 2: Epic Orchestral
// Swelling strings, brass stabs, rising tension, cinematic feel
// ------------------------------------------------------------------
export function generateOrchestral(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('orch_' + duration);

  // String pads (Dm chord: D F A)
  const stringFreqs = [73.42, 87.31, 110.00, 146.83, 174.61, 220.00]; // D2 F2 A2 D3 F3 A3
  stringFreqs.forEach((freq, idx) => {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'sawtooth'; osc1.frequency.value = freq;
    osc2.type = 'sawtooth'; osc2.frequency.value = freq * 1.005; // detune for ensemble
    const attack = 2 + idx * 0.3;
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.07, attack);
    gain.gain.linearRampToValueAtTime(0.11, duration * 0.5);
    gain.gain.linearRampToValueAtTime(0.07, duration - 2);
    gain.gain.linearRampToValueAtTime(0, duration);
    osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
    osc1.start(0); osc1.stop(duration);
    osc2.start(0); osc2.stop(duration);
  });

  // Brass stabs every 4 beats
  const brassNotes = [146.83, 174.61, 196.00, 220.00, 246.94];
  for (let t = 4; t < duration - 1; t += 2) {
    if (prng.next() > 0.5) {
      const freq = brassNotes[Math.floor(prng.next() * brassNotes.length)];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.setValueAtTime(0.15, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 1);
    }
  }

  // Timpani-like low thuds
  for (let t = 0; t < duration; t += 1) {
    if (prng.next() > 0.6) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.4);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.7);
    }
  }
}

// ------------------------------------------------------------------
// Genre 3: Jazz Improvisation
// Walking bass, syncopated chords, swung melody
// ------------------------------------------------------------------
export function generateJazz(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('jazz_' + duration);

  // Walking bass (E Dorian-ish: E F# G A B D)
  const bassWalk = [82.41, 92.50, 98.00, 110.00, 123.47, 146.83, 164.81];
  const beatLen = 0.5;
  for (let t = 0; t < duration - beatLen; t += beatLen) {
    const freq = bassWalk[Math.floor(prng.next() * bassWalk.length)];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lpf = ctx.createBiquadFilter();
    osc.type = 'triangle'; osc.frequency.value = freq;
    lpf.type = 'lowpass'; lpf.frequency.value = 500;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.04);
    gain.gain.setValueAtTime(0.18, t + beatLen * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, t + beatLen);
    osc.connect(lpf); lpf.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + beatLen);
  }

  // Swung chord comping (Cmaj9 cluster)
  const chordFreqs = [261.63, 329.63, 392.00, 493.88, 587.33];
  for (let t = 0.25; t < duration - 0.5; t += 1 + prng.next() * 0.5) {
    if (prng.next() > 0.35) {
      chordFreqs.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq * (prng.next() > 0.8 ? 2 : 1);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.35);
      });
    }
  }

  // Bebop melody (swung 8th notes)
  const bebop = [261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, 440.00, 466.16, 493.88];
  for (let t = 0.5; t < duration - 0.5; t += 0.22 + prng.next() * 0.15) {
    if (prng.next() > 0.45) {
      const freq = bebop[Math.floor(prng.next() * bebop.length)] * (prng.next() > 0.6 ? 2 : 1);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      const vol = 0.05 + prng.next() * 0.05;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.22);
    }
  }
}

// ------------------------------------------------------------------
// Genre 4: Synthwave / Retrowave
// Pulsing arpeggios, thick bass, detuned lead synth, 80s feel
// ------------------------------------------------------------------
export function generateSynthwave(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('synth_' + duration);

  // Thick pulsing bass (sawtooth + sub)
  const bassFreq = 55; // A1
  const bassOsc = ctx.createOscillator();
  const bassSub = ctx.createOscillator();
  const bassGain = ctx.createGain();
  const bassLpf = ctx.createBiquadFilter();
  bassOsc.type = 'sawtooth'; bassOsc.frequency.value = bassFreq;
  bassSub.type = 'sine'; bassSub.frequency.value = bassFreq / 2;
  bassLpf.type = 'lowpass'; bassLpf.frequency.value = 400;
  bassLpf.Q.value = 8;
  bassGain.gain.setValueAtTime(0, 0);
  bassGain.gain.linearRampToValueAtTime(0.22, 1);
  bassGain.gain.setValueAtTime(0.22, duration - 1);
  bassGain.gain.linearRampToValueAtTime(0, duration);
  bassOsc.connect(bassLpf); bassSub.connect(bassLpf);
  bassLpf.connect(bassGain); bassGain.connect(ctx.destination);
  bassOsc.start(0); bassOsc.stop(duration);
  bassSub.start(0); bassSub.stop(duration);

  // Arpeggio (Am pentatonic: A C D E G)
  const arpNotes = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99];
  const arpStep = 0.125; // 16th notes at ~120bpm
  let arpIdx = 0;
  for (let t = 0; t < duration; t += arpStep) {
    const freq = arpNotes[arpIdx % arpNotes.length];
    arpIdx++;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + arpStep * 0.9);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + arpStep);
  }

  // Detuned lead (two oscillators slightly apart)
  const leadNotes = [440.00, 493.88, 523.25, 587.33, 659.25, 698.46, 783.99, 880.00];
  for (let t = 2; t < duration - 0.5; t += 0.4 + prng.next() * 0.4) {
    if (prng.next() > 0.4) {
      const freq = leadNotes[Math.floor(prng.next() * leadNotes.length)];
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const gain = ctx.createGain();
      o1.type = 'sawtooth'; o1.frequency.value = freq;
      o2.type = 'sawtooth'; o2.frequency.value = freq * 1.008;
      const vol = 0.08 + prng.next() * 0.05;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.03);
      gain.gain.setValueAtTime(vol, t + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o1.connect(gain); o2.connect(gain); gain.connect(ctx.destination);
      o1.start(t); o1.stop(t + 0.4);
      o2.start(t); o2.stop(t + 0.4);
    }
  }

  // Kick on the 4-on-the-floor grid
  for (let t = 0; t < duration; t += 0.5) {
    const kick = ctx.createOscillator();
    const kGain = ctx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(150, t);
    kick.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    kGain.gain.setValueAtTime(0.35, t);
    kGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    kick.connect(kGain); kGain.connect(ctx.destination);
    kick.start(t); kick.stop(t + 0.3);
  }
}

// ------------------------------------------------------------------
// Genre 5: Nature Ambient
// Wind, water flow, bird-like calls, slow evolving drones
// ------------------------------------------------------------------
export function generateNature(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('nature_' + duration);

  // Wind (low-passed white noise)
  const bufSize = ctx.sampleRate * 3;
  const windBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const windData = windBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) windData[i] = (Math.random() * 2 - 1);
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = windBuf;
  windSrc.loop = true;
  const windLpf = ctx.createBiquadFilter();
  windLpf.type = 'lowpass'; windLpf.frequency.value = 300;
  const windGain = ctx.createGain();
  windGain.gain.setValueAtTime(0, 0);
  windGain.gain.linearRampToValueAtTime(0.08, 4);
  windGain.gain.setValueAtTime(0.08, duration - 4);
  windGain.gain.linearRampToValueAtTime(0, duration);
  windSrc.connect(windLpf); windLpf.connect(windGain); windGain.connect(ctx.destination);
  windSrc.start(0); windSrc.stop(duration);

  // Water trickle (band-pass filtered noise bursts)
  for (let t = 0; t < duration; t += 0.15 + prng.next() * 0.2) {
    const bufW = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const wd = bufW.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = (Math.random() * 2 - 1);
    const ws = ctx.createBufferSource();
    ws.buffer = bufW;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 800 + prng.next() * 2000; bpf.Q.value = 3;
    const wg = ctx.createGain();
    const vol = 0.02 + prng.next() * 0.04;
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(vol, t + 0.02);
    wg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    ws.connect(bpf); bpf.connect(wg); wg.connect(ctx.destination);
    ws.start(t); ws.stop(t + 0.12);
  }

  // Bird-like calls (frequency sweeping sine)
  for (let t = 1; t < duration - 1; t += 3 + prng.next() * 5) {
    if (prng.next() > 0.4) {
      const baseFreq = 1200 + prng.next() * 2000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.linearRampToValueAtTime(baseFreq * 1.5, t + 0.1);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + 0.25);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.3);
    }
  }

  // Deep earth drone
  const droneFreqs = [55, 82.41, 110.00];
  droneFreqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    osc.frequency.linearRampToValueAtTime(freq * 1.005, duration / 2);
    osc.frequency.linearRampToValueAtTime(freq, duration);
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.06 - i * 0.01, 5);
    gain.gain.setValueAtTime(0.06 - i * 0.01, duration - 5);
    gain.gain.linearRampToValueAtTime(0, duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(0); osc.stop(duration);
  });
}

// ------------------------------------------------------------------
// Genre 6: EDM / Dance
// Four-on-the-floor kick, driving bass, synth stabs, hi-hats
// ------------------------------------------------------------------
export function generateEDM(ctx: OfflineAudioContext, duration: number) {
  const prng = new PRNG('edm_' + duration);
  const BPM = 128;
  const beat = 60 / BPM;

  // Kick every beat
  for (let t = 0; t < duration; t += beat) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + beat * 0.45);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.5);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + beat * 0.6);
  }

  // Hi-hat (filtered noise) every 8th note
  for (let t = 0; t < duration; t += beat / 2) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 8000;
    const gain = ctx.createGain();
    const isOpen = prng.next() > 0.75;
    gain.gain.setValueAtTime(isOpen ? 0.12 : 0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isOpen ? 0.12 : 0.03));
    src.connect(hpf); hpf.connect(gain); gain.connect(ctx.destination);
    src.start(t); src.stop(t + 0.15);
  }

  // Driving bass (sawtooth, side-chain ducks on beats)
  const bassOsc = ctx.createOscillator();
  const bassGain = ctx.createGain();
  const bassLpf = ctx.createBiquadFilter();
  bassOsc.type = 'sawtooth'; bassOsc.frequency.value = 55;
  bassLpf.type = 'lowpass'; bassLpf.frequency.value = 300; bassLpf.Q.value = 6;
  // Sidechain simulation: drop gain on each beat, rise between beats
  for (let t = 0; t < duration; t += beat) {
    bassGain.gain.setValueAtTime(0.01, t);
    bassGain.gain.linearRampToValueAtTime(0.28, t + beat * 0.7);
  }
  bassOsc.connect(bassLpf); bassLpf.connect(bassGain); bassGain.connect(ctx.destination);
  bassOsc.start(0); bassOsc.stop(duration);

  // Synth stabs (every 2 beats, random chord voicing)
  const stabNotes = [220.00, 261.63, 311.13, 349.23, 415.30, 440.00];
  for (let t = beat * 2; t < duration - beat; t += beat * 2) {
    if (prng.next() > 0.35) {
      const freq = stabNotes[Math.floor(prng.next() * stabNotes.length)];
      [1, 1.26, 1.5].forEach(ratio => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = freq * ratio;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.setValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.3);
      });
    }
  }
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const data = buffer.getChannelData(0);
  
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;
  const dataSize = data.length * blockAlign;
  const bufferSize = 44 + dataSize;
  
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);
  
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);
  
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  
  return arrayBuffer;
}


// ==========================================
// LEGACY: 4-BIT SEQUENTIAL WITH WHITE NOISE
// (Kept for backward compatibility imports)
// ==========================================

export const createDynamicCarrier = (binaryLength: number): ArrayBuffer => {
  const sampleRate    = 44100;
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign    = numChannels * (bitsPerSample / 8);

  const numSamples = Math.ceil((binaryLength + 48) * 1.15); // Safety padding for 32-bit header
  const dataSize   = numSamples * 2; 
  const fileSize   = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false); 
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); 
  view.setUint32(12, 0x666d7420, false); 
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); 
  view.setUint32(40, dataSize, true);

  const stdDev = 1500;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.floor((Math.random() - 0.5) * 2 * stdDev)));
    view.setInt16(44 + i * 2, s, true);
  }

  return buffer;
};

export const createDynamicCarrier4Bit = (binaryLength: number): ArrayBuffer => {
  const numSamples = Math.ceil(((binaryLength + 48) / 4) * 1.15);
  return createDynamicCarrier(numSamples * 4); 
};

export const encodeLSB4Bit = (audioBuffer: ArrayBuffer, data: string): ArrayBuffer => {
  const view = new DataView(audioBuffer);
  let paddedData = data;
  while (paddedData.length % 4 !== 0) paddedData += '0';
  paddedData += '0000000000000000'; 

  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;
  const requiredSamples = paddedData.length / 4;

  if (requiredSamples > availableSamples) throw new Error('Data too large for this audio file');

  const newBuffer = audioBuffer.slice(0);
  const newView = new DataView(newBuffer);

  for (let i = 0; i < requiredSamples; i++) {
    const offset = headerSize + i * 2;
    let sample = newView.getInt16(offset, true);
    const chunk = paddedData.slice(i * 4, i * 4 + 4);
    const val = parseInt(chunk, 2);
    sample = (sample & ~15) | val;
    newView.setInt16(offset, sample, true);
  }
  return newBuffer;
};

export const decodeLSB4Bit = (audioBuffer: ArrayBuffer): string => {
  const view = new DataView(audioBuffer);
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;

  let binaryData = '';
  let nullCounter = 0;

  for (let i = 0; i < availableSamples; i++) {
    const offset = headerSize + i * 2;
    const sample = view.getInt16(offset, true);
    const val = sample & 15;
    const bits = val.toString(2).padStart(4, '0');
    binaryData += bits;

    if (bits === '0000') nullCounter++;
    else nullCounter = 0;

    if (nullCounter === 4) return binaryData.slice(0, -16);
  }
  return binaryData;
};
