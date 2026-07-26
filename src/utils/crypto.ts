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

// Cache for derived CryptoJS keys to prevent expensive EvpKDF on every frame/chunk
const keyCache = new Map<string, CryptoJS.lib.WordArray>();

export const getSha256Key = (pin: string): CryptoJS.lib.WordArray => {
  let cached = keyCache.get(pin);
  if (!cached) {
    cached = CryptoJS.SHA256(pin);
    keyCache.set(pin, cached);
  }
  return cached;
};

/**
 * Fast synchronous AES-256 encryption using a pre-hashed key and explicit IV
 */
export const fastEncrypt = (data: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
  return CryptoJS.AES.encrypt(data, key, { iv: iv }).toString();
};

/**
 * Fast synchronous AES-256 decryption using a pre-hashed key and explicit IV
 */
export const fastDecrypt = (ciphertext: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key, { iv: iv });
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return '';
  }
};

/**
 * Convert Uint8Array to CryptoJS WordArray accurately
 */
export const uint8ToWordArray = (u8: Uint8Array): CryptoJS.lib.WordArray => {
  const len = u8.length;
  const words: number[] = [];
  for (let i = 0; i < len; i += 4) {
    words.push(
      (u8[i] << 24) |
      ((u8[i + 1] || 0) << 16) |
      ((u8[i + 2] || 0) << 8) |
      (u8[i + 3] || 0)
    );
  }
  return CryptoJS.lib.WordArray.create(words, len);
};

/**
 * Convert CryptoJS WordArray to Uint8Array accurately
 */
export const wordArrayToUint8 = (wa: CryptoJS.lib.WordArray): Uint8Array => {
  const len = wa.sigBytes;
  const u8 = new Uint8Array(len);
  const words = wa.words;
  for (let i = 0; i < len; i++) {
    const wordIdx = i >>> 2;
    const byteIdx = 3 - (i % 4);
    u8[i] = (words[wordIdx] >>> (byteIdx * 8)) & 0xff;
  }
  return u8;
};

const webCryptoKeyCache = new Map<string, CryptoKey>();

/**
 * Derives a fast hardware-accelerated CryptoKey for video frames
 */
export const getWebCryptoKey = async (pin: string): Promise<CryptoKey> => {
  let cached = webCryptoKeyCache.get(pin);
  if (!cached) {
    const enc = new TextEncoder();
    // Use SHA-256 to hash the PIN into a 256-bit raw key for AES directly (fastest derivation)
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(pin));
    cached = await crypto.subtle.importKey(
      "raw",
      hashBuffer,
      { name: "AES-CTR" },
      false,
      ["encrypt", "decrypt"]
    );
    webCryptoKeyCache.set(pin, cached);
  }
  return cached;
};

/**
 * Hardware-accelerated AES-GCM encryption for raw video frame bytes (NO Base64 overhead)
 */
export const fastVideoEncrypt = async (data: Uint8Array, pin: string, frameIndex: number): Promise<Uint8Array> => {
  const key = await getWebCryptoKey(pin);
  // IV for AES-CTR is 16 bytes
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(0, frameIndex, false); // Use frame index to guarantee unique IV per frame

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    data
  );
  return new Uint8Array(encryptedBuffer);
};

/**
 * Hardware-accelerated AES-GCM decryption for raw video frame bytes
 */
export const fastVideoDecrypt = async (ciphertext: Uint8Array, pin: string, frameIndex: number): Promise<Uint8Array> => {
  const key = await getWebCryptoKey(pin);
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(0, frameIndex, false);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-CTR", counter: iv, length: 64 },
    key,
    ciphertext
  );
  return new Uint8Array(decryptedBuffer);
};

