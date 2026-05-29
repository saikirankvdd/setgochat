/**
 * Audio Steganography Utility
 * Includes Legacy 4-bit encoding for old backups, and new 1-bit scattered music-tiered encoding.
 */

export const encodeLSB = (audioBuffer: ArrayBuffer, data: string): ArrayBuffer => {
  const view = new DataView(audioBuffer);
  const dataBinary = data + '0000000000000000'; // Null terminator (16 bits)
  
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;

  if (dataBinary.length > availableSamples) {
    throw new Error('Data too large for this audio file');
  }

  const newBuffer = audioBuffer.slice(0);
  const newView = new DataView(newBuffer);

  for (let i = 0; i < dataBinary.length; i++) {
    const offset = headerSize + i * 2;
    let sample = newView.getInt16(offset, true);
    if (dataBinary[i] === '1') sample |= 1;
    else sample &= ~1;
    newView.setInt16(offset, sample, true);
  }

  return newBuffer;
};

export const decodeLSB = (audioBuffer: ArrayBuffer): string => {
  const view = new DataView(audioBuffer);
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2;

  let binaryData = '';
  let nullCounter = 0;

  for (let i = 0; i < availableSamples; i++) {
    const offset = headerSize + i * 2;
    const sample = view.getInt16(offset, true);
    const bit = (sample & 1).toString();
    binaryData += bit;

    if (bit === '0') nullCounter++;
    else nullCounter = 0;

    if (nullCounter === 16) return binaryData.slice(0, -16);
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
// MUSIC GENERATION — Richer, more realistic audio
// ==========================================

export async function generateMusicCarrier(payloadBitLength: number): Promise<{ buffer: ArrayBuffer, type: string }> {
  const sampleRate = 44100;
  // 1-bit LSB requires 1 sample per bit. Multiply by 8 for extra scatter space + natural audio headroom.
  // This lowers the modification density to ~12.5%, easily defeating RS analysis.
  const requiredSamples = payloadBitLength * 8 + 32;
  let duration = Math.ceil(requiredSamples / sampleRate);
  
  let type = '';
  if (duration < 10) { duration = 10; type = 'ringtone'; }
  else if (duration < 60) { duration = 60; type = 'ambient'; }
  else if (duration < 300) { duration = 300; type = 'song'; }
  else { type = 'playlist'; }
  
  const AudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio API not supported in this browser");
  
  const ctx = new AudioContextClass(1, sampleRate * duration, sampleRate);
  
  if (type === 'ringtone') generateRingtone(ctx, duration);
  else generateAmbientTrack(ctx, duration);
  
  const renderedBuffer = await ctx.startRendering();
  return { buffer: audioBufferToWav(renderedBuffer), type };
}

function generateRingtone(ctx: OfflineAudioContext, duration: number) {
  // Melodic ringtone: a repeating 4-bar phrase with harmonic layers
  const melodyNotes = [
    523.25, 659.25, 783.99, 659.25, // C5 E5 G5 E5
    587.33, 698.46, 880.00, 698.46, // D5 F5 A5 F5
    523.25, 783.99, 1046.50, 783.99, // C5 G5 C6 G5
    440.00, 523.25, 659.25, 523.25  // A4 C5 E5 C5
  ];
  const noteLen = 0.15;
  
  // Bass drone for richness
  const bassOsc = ctx.createOscillator();
  const bassGain = ctx.createGain();
  bassOsc.type = 'sine';
  bassOsc.frequency.value = 130.81; // C3
  bassGain.gain.value = 0.08;
  bassOsc.connect(bassGain);
  bassGain.connect(ctx.destination);
  bassOsc.start(0);
  bassOsc.stop(duration);
  
  // Main melody loop
  let t = 0;
  while (t < duration) {
    for (let n = 0; n < melodyNotes.length && t < duration; n++) {
      const freq = melodyNotes[n];
      
      // Lead voice (square with slight detuning for richness)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc1.type = 'square';
      osc1.frequency.value = freq;
      osc2.type = 'sawtooth';
      osc2.frequency.value = freq * 1.003; // slight detune
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      gain.gain.setValueAtTime(0.15, t + noteLen * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteLen);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(t);
      osc1.stop(t + noteLen);
      osc2.start(t);
      osc2.stop(t + noteLen);
      
      t += noteLen;
    }
    // Small gap between loops
    t += 0.3;
  }
}

function generateAmbientTrack(ctx: OfflineAudioContext, duration: number) {
  // Rich ambient with multiple harmonic layers
  
  // Layer 1: Deep evolving pad
  const padFreqs = [130.81, 164.81, 196.00]; // C3, E3, G3 chord
  padFreqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Slow LFO on frequency for warmth
    osc.frequency.setValueAtTime(freq, 0);
    osc.frequency.linearRampToValueAtTime(freq * 1.01, duration / 3);
    osc.frequency.linearRampToValueAtTime(freq * 0.99, (duration * 2) / 3);
    osc.frequency.linearRampToValueAtTime(freq, duration);
    
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.12, 3 + idx);
    gain.gain.setValueAtTime(0.12, duration - 3);
    gain.gain.linearRampToValueAtTime(0, duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    osc.stop(duration);
  });
  
  // Layer 2: Sparse melodic plucks
  const scaleNotes = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25]; // C major scale
  const pluckPRNG = new PRNG('ambient_melody_seed');
  for (let t = 1; t < duration - 1; t += 0.4) {
    if (pluckPRNG.next() > 0.55) {
      const noteIdx = Math.floor(pluckPRNG.next() * scaleNotes.length);
      const octave = pluckPRNG.next() > 0.5 ? 2 : 1;
      const freq = scaleNotes[noteIdx] * octave;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      const vol = 0.04 + pluckPRNG.next() * 0.06;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  }
  
  // Layer 3: Sub-bass heartbeat (adds natural low-end energy)
  for (let t = 0; t < duration; t += 2) {
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.value = 55; // A1
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(0.05, t + 0.1);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(t);
    subOsc.stop(t + 1);
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

  const numSamples = Math.ceil((binaryLength + 16) * 1.15);
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
  for (let i = 0; i < numSamples; i += 2) {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random(); 
    while (u2 === 0) u2 = Math.random();

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

    const s0 = Math.max(-32768, Math.min(32767, Math.floor(z0 * stdDev)));
    const s1 = Math.max(-32768, Math.min(32767, Math.floor(z1 * stdDev)));

    view.setInt16(44 + i * 2, s0, true);
    if (i + 1 < numSamples) {
      view.setInt16(44 + (i + 1) * 2, s1, true);
    }
  }

  return buffer;
};

export const createDynamicCarrier4Bit = (binaryLength: number): ArrayBuffer => {
  const numSamples = Math.ceil(((binaryLength + 16) / 4) * 1.15);
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
