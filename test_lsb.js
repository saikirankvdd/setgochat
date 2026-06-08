const CryptoJS = require('crypto-js');

// Copy binary helper functions
const stringToBinary = (str) => {
  return str.split('').map(char => {
    return char.charCodeAt(0).toString(2).padStart(8, '0');
  }).join('');
};

const binaryToString = (bin) => {
  let str = '';
  for (let i = 0; i < bin.length; i += 8) {
    const byte = bin.substring(i, i + 8);
    if (byte.length === 8) {
      str += String.fromCharCode(parseInt(byte, 2));
    }
  }
  return str;
};

// Copy stego functions
const encodeLSB = (audioBuffer, data) => {
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

const decodeLSB = (audioBuffer) => {
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

const createDynamicCarrier = (binaryLength) => {
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

// Test with a sample ciphertext
const originalCiphertext = "U2FsdGVkX19Uosoz0DEp7gIVmzSrQwT8THqFs8+RZBgKCBDNDy1+SyhwLy29Mnq7G84iCbDEds/nb7cKO4TvGKmaL9xitSH1ekuJEXZANV5Qgq+UbH6U0j4Ha3y7CBhop9ARvlYd2W/KyUPYx2hdraK0oOrP1oCmjyGm040dKywl7FTYUrj08fEHZx9eRX1V7jgOcMC+BlNDAhWJZrq+9deZM6B4m1HFDcuZx2MCjBqHH8xmNVg8i+JjsQhL8HsIIljCXuFa70ZPR9vTNbI5q+6+6SrR+qw+vdVMFOPlTEg=";

console.log("Original length:", originalCiphertext.length);

const bits = stringToBinary(originalCiphertext);
console.log("Bits length:", bits.length);

const carrier = createDynamicCarrier(bits.length);
console.log("Carrier size:", carrier.byteLength);

const stego = encodeLSB(carrier, bits);
console.log("Stego size:", stego.byteLength);

const decodedBits = decodeLSB(stego);
console.log("Decoded bits length:", decodedBits.length);

const decodedText = binaryToString(decodedBits);
console.log("Decoded text length:", decodedText.length);

console.log("Match:", originalCiphertext === decodedText);
if (originalCiphertext !== decodedText) {
  console.log("Decoded text:", decodedText);
}
