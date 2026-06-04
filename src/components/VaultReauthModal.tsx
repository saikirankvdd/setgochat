import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, ShieldAlert, LogOut, Key } from 'lucide-react';
import { decryptPrivateKeyWithPassword, verifyKeyPair } from '../utils/e2ee';
import { savePrivateKeyLocal } from '../utils/db';

interface VaultReauthModalProps {
  userId: string;
  encryptedPrivateKey: string;
  publicKey: string;
  onSuccess: (privateKey: string) => void;
  onLogout: () => void;
}

export function VaultReauthModal({
  userId,
  encryptedPrivateKey,
  publicKey,
  onSuccess,
  onLogout,
}: VaultReauthModalProps) {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Decrypt the private key with the entered password
      const result = await decryptPrivateKeyWithPassword(encryptedPrivateKey, password);
      const privateKey = result.key;

      // 2. Verify that this decrypted key actually matches the public key
      const isValid = await verifyKeyPair(publicKey, privateKey);
      if (!isValid) {
        throw new Error('Key pair verification failed');
      }

      // 3. Save the valid private key to local stores
      await savePrivateKeyLocal(userId, privateKey);
      try {
        sessionStorage.setItem('stego_priv_key_' + userId, privateKey);
      } catch (storageErr) {
        console.warn('[Vault] Failed to save key to sessionStorage:', storageErr);
      }

      // 4. Trigger success callback
      onSuccess(privateKey);
    } catch (err) {
      console.error('[Vault] Decryption or verification failed:', err);
      setError('Incorrect password. Please try again.');
      setIsLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/95 backdrop-blur-md z-[99999] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#202c33] rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-[#2a3942] animate-fade-in p-6 relative">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[#111b21] flex items-center justify-center border border-[#00a884]/30 mb-4 animate-pulse">
            <Lock className="w-8 h-8 text-[#00a884]" />
          </div>
          <h2 className="text-xl font-bold text-[#e9edef] mb-2">Unlock Your Secure Vault</h2>
          <p className="text-sm text-[#8696a0] max-w-xs leading-relaxed">
            Your encryption keys need to be re-synchronized. Please enter your account password to decrypt and restore your secure chat database.
          </p>
        </div>

        {error && (
          <div className="bg-[#ea0038]/10 border border-[#ea0038]/30 rounded-lg p-3 flex items-start gap-2.5 mb-4 text-[#ea0038] text-sm leading-snug">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#8696a0] mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                disabled={isLoading}
                autoFocus
                className="w-full bg-[#111b21] border border-[#2a3942] rounded-xl px-4 py-3 text-[#e9edef] placeholder-[#667781] outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full bg-[#00a884] hover:bg-[#06cf9c] disabled:bg-[#00a884]/40 disabled:text-[#111b21]/50 text-[#111b21] font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:cursor-not-allowed mt-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-[#111b21] border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                <Key className="w-4 h-4" />
                Unlock Secure Vault
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#2a3942] flex justify-center">
          <button
            onClick={onLogout}
            disabled={isLoading}
            className="text-sm font-semibold text-[#8696a0] hover:text-[#e9edef] transition-colors flex items-center gap-2 hover:underline cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Log out instead
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
