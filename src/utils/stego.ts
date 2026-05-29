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

class PRNG {
  private seed: number;
  constructor(seedString: string) {
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
      hash = ((hash << 5) - hash) + seedString.charCodeAt(i);
      hash |= 0;
    }
    this.seed = hash >>> 0; // ensure positive 32-bit uint
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

function generateScatterPattern(totalSamples: number, dataLength: number, password: string): number[] {
  const prng = new PRNG(password);
  const indices: number[] = [];
  const gapBase = Math.floor(totalSamples / dataLength);
  
  let currentIdx = 0;
  for (let i = 0; i < dataLength; i++) {
    const jitter = Math.floor((prng.next() - 0.5) * (gapBase / 2));
    let nextIdx = currentIdx + gapBase + jitter;
    
    if (nextIdx <= currentIdx) nextIdx = currentIdx + 1;
    if (nextIdx >= totalSamples - (dataLength - i)) {
       nextIdx = currentIdx + 1;
    }
    indices.push(nextIdx);
    currentIdx = nextIdx;
  }
  return indices;
}

export const encodeLSB1Bit = (audioBuffer: ArrayBuffer, data: string, password: string): ArrayBuffer => {
  const newBuffer = audioBuffer.slice(0);
  const view = new DataView(newBuffer);
  const dataBits = data;
  const numSamples = (view.byteLength - 44) / 2; // 16-bit PCM Mono
  
  const totalBitsNeeded = 32 + dataBits.length;
  if (totalBitsNeeded > numSamples) throw new Error("Audio carrier too small for data");
  
  // 1. Write data length in the first 32 samples
  const lengthStr = dataBits.length.toString(2).padStart(32, '0');
  for (let i = 0; i < 32; i++) {
    let sample = view.getInt16(44 + i * 2, true);
    sample = (sample & ~1) | parseInt(lengthStr[i]);
    view.setInt16(44 + i * 2, sample, true);
  }
  
  // 2. Generate scatter pattern for the rest
  const usableSamples = numSamples - 32;
  const indices = generateScatterPattern(usableSamples, dataBits.length, password);
  
  // 3. Write scattered bits
  for (let i = 0; i < dataBits.length; i++) {
    const targetSampleIdx = 32 + indices[i];
    let sample = view.getInt16(44 + targetSampleIdx * 2, true);
    sample = (sample & ~1) | parseInt(dataBits[i]);
    view.setInt16(44 + targetSampleIdx * 2, sample, true);
  }
  
  return newBuffer;
};

export const decodeLSB1Bit = (audioBuffer: ArrayBuffer, password: string): string => {
  const view = new DataView(audioBuffer);
  const numSamples = (view.byteLength - 44) / 2;
  
  // 1. Read data length from the first 32 samples
  let lengthStr = '';
  for (let i = 0; i < 32; i++) {
    const sample = view.getInt16(44 + i * 2, true);
    lengthStr += (sample & 1).toString();
  }
  const dataLength = parseInt(lengthStr, 2);
  
  if (dataLength <= 0 || dataLength > numSamples - 32) {
    throw new Error("Invalid stego file or password");
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

// MUSIC GENERATION
export async function generateMusicCarrier(payloadBitLength: number): Promise<{ buffer: ArrayBuffer, type: string }> {
  const sampleRate = 44100;
  // 1-bit LSB requires 1 sample per bit. Multiply by 3 for plenty of scatter space.
  const requiredSamples = payloadBitLength * 3 + 32;
  let duration = Math.ceil(requiredSamples / sampleRate);
  
  let type = '';
  // Tiers
  if (duration < 10) { duration = 10; type = 'ringtone'; }
  else if (duration < 60) { duration = 60; type = 'ambient'; }
  else if (duration < 300) { duration = 300; type = 'song'; }
  else { type = 'playlist'; } // whatever duration it mathematically needs
  
  const AudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio API not supported in this browser");
  
  const ctx = new AudioContextClass(1, sampleRate * duration, sampleRate);
  
  if (type === 'ringtone') generateRingtone(ctx, duration);
  else generateAmbientTrack(ctx, duration); // Keep it simple for large tiers too, just longer ambient
  
  const renderedBuffer = await ctx.startRendering();
  return { buffer: audioBufferToWav(renderedBuffer), type };
}

function generateRingtone(ctx: OfflineAudioContext, duration: number) {
  const notes = [261.63, 329.63, 392.00, 523.25]; // C major chord
  const tempo = 0.2; // fast
  for (let i = 0; i < duration; i += tempo) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = notes[Math.floor(Math.random() * notes.length)];
    gain.gain.setValueAtTime(0, i);
    gain.gain.linearRampToValueAtTime(0.3, i + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, i + tempo - 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(i);
    osc.stop(i + tempo);
  }
}

function generateAmbientTrack(ctx: OfflineAudioContext, duration: number) {
  const padOsc = ctx.createOscillator();
  const padGain = ctx.createGain();
  padOsc.type = 'sine';
  padOsc.frequency.value = 130.81; // C3
  padGain.gain.setValueAtTime(0, 0);
  padGain.gain.linearRampToValueAtTime(0.2, 5);
  padGain.gain.setValueAtTime(0.2, duration - 5);
  padGain.gain.linearRampToValueAtTime(0, duration);
  padOsc.connect(padGain);
  padGain.connect(ctx.destination);
  padOsc.start();
  padOsc.stop(duration);
  
  const notes = [261.63, 293.66, 329.63, 392.00, 440.00];
  for (let i = 0; i < duration; i += 0.5) {
    if (Math.random() > 0.4) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = notes[Math.floor(Math.random() * notes.length)] * 2;
      gain.gain.setValueAtTime(0, i);
      gain.gain.linearRampToValueAtTime(0.1, i + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, i + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(i);
      osc.stop(i + 0.5);
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
