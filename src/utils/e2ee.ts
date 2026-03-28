import CryptoJS from 'crypto-js';

export async function generateRSAKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
  
  const pubBuffer = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privBuffer = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  
  return {
    publicKey: btoa(String.fromCharCode(...new Uint8Array(pubBuffer))),
    privateKey: btoa(String.fromCharCode(...new Uint8Array(privBuffer))),
  };
}

export async function encryptPINWithPublicKey(pin: string, publicKeyBase64: string): Promise<string> {
  const binaryDerString = atob(publicKeyBase64);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) binaryDer[i] = binaryDerString.charCodeAt(i);
  
  const pubKey = await window.crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );

  const encBuffer = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    pubKey,
    new TextEncoder().encode(pin)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(encBuffer)));
}

export async function decryptPINWithPrivateKey(encryptedPinBase64: string, privateKeyBase64: string): Promise<string> {
  const binaryDerString = atob(privateKeyBase64);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) binaryDer[i] = binaryDerString.charCodeAt(i);
  
  const privKey = await window.crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );

  const encBufferString = atob(encryptedPinBase64);
  const encBuffer = new Uint8Array(encBufferString.length);
  for (let i = 0; i < encBufferString.length; i++) encBuffer[i] = encBufferString.charCodeAt(i);

  const decBuffer = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privKey,
    encBuffer.buffer
  );
  
  return new TextDecoder().decode(decBuffer);
}

// Encrypt Private Key with User's Login Password so Server never sees it in Plaintext
export function encryptPrivateKeyWithPassword(privateKey: string, password: string): string {
    return CryptoJS.AES.encrypt(privateKey, password).toString();
}

// Decrypt Private Key with User's Login Password when they login
export function decryptPrivateKeyWithPassword(encryptedPrivateKey: string, password: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedPrivateKey, password);
    return bytes.toString(CryptoJS.enc.Utf8);
}
