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
 * Helper to create a dummy WAV file for testing or as a carrier
 */
export const createCarrierWav = (seconds: number = 5): ArrayBuffer => {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = seconds * byteRate;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF identifier
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, fileSize - 8, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Generate White Gaussian Noise using Box-Muller transform
  for (let i = 0; i < dataSize / 2; i += 2) {
    let u1 = 0, u2 = 0;
    while(u1 === 0) u1 = Math.random(); // Converting [0,1) to (0,1)
    while(u2 === 0) u2 = Math.random();
    
    // Standard normal distribution
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    
    // Scale to acceptable 16-bit range (std dev of 1500 for audible static)
    const stdDev = 1500;
    let sample0 = Math.floor(z0 * stdDev);
    let sample1 = Math.floor(z1 * stdDev);
    
    // Clamp to 16-bit boundaries
    sample0 = Math.max(-32768, Math.min(32767, sample0));
    sample1 = Math.max(-32768, Math.min(32767, sample1));
    
    view.setInt16(44 + i * 2, sample0, true);
    if (i + 1 < dataSize / 2) {
      view.setInt16(44 + (i + 1) * 2, sample1, true);
    }
  }

  return buffer;
};
