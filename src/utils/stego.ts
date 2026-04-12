/**
 * Audio LSB Steganography Utility
 * Works with WAV files (PCM 16-bit)
 */

export const encodeLSB = (audioBuffer: ArrayBuffer, data: string): ArrayBuffer => {
  const view = new DataView(audioBuffer);
  const dataBinary = data + '0000000000000000'; // Null terminator (16 bits)
  
  // WAV Header is usually 44 bytes
  const headerSize = 44;
  const availableSamples = (view.byteLength - headerSize) / 2; // 16-bit = 2 bytes per sample

  if (dataBinary.length > availableSamples) {
    throw new Error('Data too large for this audio file');
  }

  const newBuffer = audioBuffer.slice(0);
  const newView = new DataView(newBuffer);

  for (let i = 0; i < dataBinary.length; i++) {
    const offset = headerSize + i * 2;
    let sample = newView.getInt16(offset, true);
    
    // Set the LSB
    if (dataBinary[i] === '1') {
      sample |= 1;
    } else {
      sample &= ~1;
    }
    
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

    // Check for 16-bit null terminator
    if (bit === '0') {
      nullCounter++;
    } else {
      nullCounter = 0;
    }

    if (nullCounter === 16) {
      return binaryData.slice(0, -16);
    }
  }

  return binaryData;
};

/**
 * Create a WAV carrier whose size is calculated dynamically from the actual
 * binary payload length — so a short message like "Hi" produces a tiny file
 * and a long message produces a proportionally larger one.
 *
 * Each carrier is filled with a unique random mix of 4–9 sine waves at
 * random frequencies (200–4000 Hz), random amplitudes, and random phase
 * offsets — so every audio file sounds different every time.
 *
 * @param binaryLength - number of bits in the binary string to be hidden
 */
export const createDynamicCarrier = (binaryLength: number): ArrayBuffer => {
  const sampleRate    = 44100;
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign    = numChannels * (bitsPerSample / 8);

  // Each bit occupies exactly 1 PCM sample.
  // Add 16 for the null terminator and 15% headroom so encodeLSB never overflows.
  const numSamples = Math.ceil((binaryLength + 16) * 1.15);
  const dataSize   = numSamples * 2; // 2 bytes per 16-bit sample
  const fileSize   = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view   = new DataView(buffer);

  // ── RIFF / WAV header ──────────────────────────────────────
  view.setUint32(0,  0x52494646, false); // "RIFF"
  view.setUint32(4,  fileSize - 8, true);
  view.setUint32(8,  0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // ── Randomised multi-tone content ─────────────────────────
  // Pick 4–9 sine components — completely random every call,
  // so two identical messages still produce different-sounding carriers.
  interface SineComponent { freq: number; amp: number; phase: number; }
  const numComponents = 4 + Math.floor(Math.random() * 6); // [4, 9]
  const components: SineComponent[] = [];

  for (let c = 0; c < numComponents; c++) {
    components.push({
      freq:  200 + Math.random() * 3800,  // 200 Hz – 4000 Hz
      amp:   0.3 + Math.random() * 0.7,   // random weight
      phase: Math.random() * 2 * Math.PI, // random starting phase
    });
  }

  // Normalise so the signal stays within ±1 before we scale to 16-bit
  const totalAmp = components.reduce((sum, c) => sum + c.amp, 0);

  // Very small noise floor keeps the carrier from being purely periodic,
  // which would make steganalysis easier.
  const noiseSigma = 0.02;

  for (let i = 0; i < numSamples; i++) {
    // Sum normalised sine waves
    let sample = 0;
    for (const comp of components) {
      sample += (comp.amp / totalAmp) *
                Math.sin(2 * Math.PI * comp.freq * i / sampleRate + comp.phase);
    }

    // Box-Muller Gaussian noise floor
    const u1 = Math.random() || 1e-10;
    sample += Math.sqrt(-2 * Math.log(u1)) *
              Math.cos(2 * Math.PI * Math.random()) * noiseSigma;

    // Scale to 16-bit with headroom (×12000 ≈ 37% of 32767) so LSB
    // modifications during encoding never push samples out of range
    const clamped = Math.max(-32768, Math.min(32767, Math.round(sample * 12000)));
    view.setInt16(44 + i * 2, clamped, true);
  }

  return buffer;
};
