const fs = require('fs');

const append = `
export const encodeLSB4Bit = (audioBuffer: ArrayBuffer, data: string): ArrayBuffer => {
  const view = new DataView(audioBuffer);
  let paddedData = data;
  while (paddedData.length % 4 !== 0) paddedData += '0';
  paddedData += '0000000000000000'; // Null terminator

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

export const createDynamicCarrier4Bit = (binaryLength: number): ArrayBuffer => {
  // Add 16 for null terminator
  const numSamples = Math.ceil(((binaryLength + 16) / 4) * 1.15);
  return createDynamicCarrier(numSamples * 4); // generate carrier large enough
};
`;

fs.appendFileSync('src/utils/stego.ts', append);
console.log('Appended successfully');
