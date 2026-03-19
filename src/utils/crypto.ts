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
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.error('Decryption failed', e);
    return '';
  }
};

/**
 * Convert string to binary string
 */
export const stringToBinary = (str: string): string => {
  return str.split('').map(char => {
    return char.charCodeAt(0).toString(2).padStart(8, '0');
  }).join('');
};

/**
 * Convert binary string to string
 */
export const binaryToString = (bin: string): string => {
  let str = '';
  for (let i = 0; i < bin.length; i += 8) {
    const byte = bin.substring(i, i + 8);
    if (byte.length === 8) {
      str += String.fromCharCode(parseInt(byte, 2));
    }
  }
  return str;
};
