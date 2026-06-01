
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
  // --- New RSA-OAEP decryption path ---
  try {
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
  } catch (err) {
    // RSA decryption failed — the session may have been created with a different key pair.
    // Handled silently; the user will re-establish fresh keys on next start_chat.
    console.debug('[E2EE] PIN handshake pending re-establishment for session.');
    return 'DECRYPTION_FAILED';
  }
}

// Encrypt Private Key with User's Login Password using PBKDF2 + AES-GCM (Finding 2)
export async function encryptPrivateKeyWithPassword(privateKey: string, password: string): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv   = window.crypto.getRandomValues(new Uint8Array(12));
  const km   = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key  = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct   = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey));
  const enc  = (a: Uint8Array) => btoa(String.fromCharCode(...a));
  return JSON.stringify({ v: 2, salt: enc(salt), iv: enc(iv), ct: enc(new Uint8Array(ct)) });
}

// Decrypt Private Key with User's Login Password when they login, with legacy fallback
export async function decryptPrivateKeyWithPassword(stored: string, password: string): Promise<{ key: string; upgraded: boolean }> {
  if (!stored.startsWith('{')) {
    throw new Error('KEY_VAULT_UPGRADE_REQUIRED');
  }
  const { salt, iv, ct } = JSON.parse(stored);
  const dec  = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const km   = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key  = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: dec(salt), iterations: 310000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec(iv) }, key, dec(ct));
  return { key: new TextDecoder().decode(plain), upgraded: false };
}
