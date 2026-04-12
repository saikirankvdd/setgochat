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
/**
 * Create a WAV carrier whose size is calculated dynamically from the actual
 * binary payload length — so a short message produces a tiny file and a long
 * message produces a proportionally larger one.
 *
 * Audio content is White Gaussian Noise (Box-Muller transform), identical in
 * character to natural recording noise — statistically flat spectrum, maximum
 * entropy, ideal for hiding LSB data without detectable patterns.
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

  // ── White Gaussian Noise via Box-Muller transform ──────────
  // Generates pairs of independent normally-distributed samples.
  // stdDev = 1500 → audible static that stays well within 16-bit range.
  const stdDev = 1500;
  for (let i = 0; i < numSamples; i += 2) {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random(); // ensure (0, 1]
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

