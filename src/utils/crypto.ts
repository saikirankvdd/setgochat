import CryptoJS from 'crypto-js';

/**
 * AES-256 Encryption using a Session PIN
 */
export const encryptData = (data: string, pin: string): string => {
  return CryptoJS.AES.encrypt(data, pin).toString();
};

/**
 * AES-256 Decryption using a Session PIN
 */
export const decryptData = (ciphertext: string, pin: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, pin);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted;
  } catch (e) {
    console.warn('Decryption failed (possibly incorrect PIN or legacy residue)');
    return '';
  }
};

/**
 * Convert string to binary string (highly optimized)
 */
export const stringToBinary = (str: string): string => {
  const len = str.length;
  const bits = new Array(len * 8);
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    const offset = i * 8;
    bits[offset]     = (code >>> 7) & 1;
    bits[offset + 1] = (code >>> 6) & 1;
    bits[offset + 2] = (code >>> 5) & 1;
    bits[offset + 3] = (code >>> 4) & 1;
    bits[offset + 4] = (code >>> 3) & 1;
    bits[offset + 5] = (code >>> 2) & 1;
    bits[offset + 6] = (code >>> 1) & 1;
    bits[offset + 7] = code & 1;
  }
  return bits.join('');
};

/**
 * Convert binary string to string (highly optimized)
 */
export const binaryToString = (bin: string): string => {
  const len = bin.length;
  const charCount = Math.floor(len / 8);
  const chars = new Array(charCount);
  for (let i = 0; i < charCount; i++) {
    const offset = i * 8;
    let code = 0;
    for (let j = 0; j < 8; j++) {
      if (bin.charCodeAt(offset + j) === 49) { // ASCII for '1' is 49
        code |= (1 << (7 - j));
      }
    }
    chars[i] = String.fromCharCode(code);
  }
  return chars.join('');
};

/**
 * SHA-256 Hashing for Metadata Anonymization
 */
export const hashString = async (data: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Fast chunked conversion of Uint8Array/ArrayBuffer to Base64 to prevent thread blocking
 */
export const uint8ToBase64 = (arr: Uint8Array | ArrayBuffer): string => {
  const buf = arr instanceof ArrayBuffer ? new Uint8Array(arr) : arr;
  let binStr = '';
  const chunkSize = 8192;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binStr += String.fromCharCode.apply(null, buf.subarray(i, i + chunkSize) as any);
  }
  return btoa(binStr);
};

/**
 * Fast conversion of Base64 string to Uint8Array
 */
export const base64ToUint8 = (base64: string): Uint8Array => {
  const binStr = atob(base64);
  const len = binStr.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = binStr.charCodeAt(i);
  }
  return arr;
};
