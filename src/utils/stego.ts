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

  // Fill with silence or low noise
  for (let i = 0; i < dataSize / 2; i++) {
    view.setInt16(44 + i * 2, Math.floor(Math.random() * 100) - 50, true);
  }

  return buffer;
};
