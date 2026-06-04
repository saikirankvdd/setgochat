/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { io, Socket } from 'socket.io-client';
import { getPrivateKeyLocal } from './utils/db';
import { useModal } from './contexts/ModalContext';
import { VaultReauthModal } from './components/VaultReauthModal';

export type User = {
  id: string | number;
  username: string;
  email: string;
  publicKey?: string;
  encryptedPrivateKey?: string;
  privateKey?: string;
  isAdmin?: boolean;
};

// Cryptographic helper to read same-origin cookies (Finding 1)
export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

const APP_VERSION = '2.3.0';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [reauthData, setReauthData] = useState<{
    userId: string;
    encryptedPrivateKey: string;
    publicKey: string;
    userObj: User;
  } | null>(null);
  const { showModal } = useModal();

  // Bootstrap user session from HttpOnly cookie on mount (Finding 1)
  useEffect(() => {
    async function bootstrapSession() {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            let privateKey = await getPrivateKeyLocal(data.user.id.toString());
            if (!privateKey) {
              privateKey = sessionStorage.getItem('stego_priv_key_' + data.user.id.toString()) || undefined;
            }

            let isValidKey = false;
            if (privateKey && data.user.publicKey) {
              const { verifyKeyPair } = await import('./utils/e2ee');
              isValidKey = await verifyKeyPair(data.user.publicKey, privateKey);
            }

            if (privateKey && !isValidKey) {
              console.warn('[E2EE] Mismatched or stale private key detected. Clearing local copy.');
              const { savePrivateKeyLocal } = await import('./utils/db');
              await savePrivateKeyLocal(data.user.id.toString(), '');
              try {
                sessionStorage.removeItem('stego_priv_key_' + data.user.id.toString());
              } catch (e) {}
              privateKey = undefined;
            }

            if (!privateKey) {
              console.warn('[E2EE] No valid private key found for session. Showing Vault reauth prompt.');
              setReauthData({
                userId: data.user.id.toString(),
                encryptedPrivateKey: data.user.encryptedPrivateKey,
                publicKey: data.user.publicKey,
                userObj: data.user
              });
              setIsBootstrapping(false);
              return;
            }

            setUser({ ...data.user, privateKey });
          }
        }
      } catch (err) {
        console.error('[Security] Failed to bootstrap session:', err);
      } finally {
        setIsBootstrapping(false);
      }
    }
    bootstrapSession();
  }, []);

  // Sync profile metadata locally (removed for strict security audit compliance)
  useEffect(() => {
    // No sensitive key or user data stored in localStorage anymore
    localStorage.removeItem('stego_profile');
  }, []);

  // Connect to Socket.IO using secure single-use handshakes (Finding 1)
  useEffect(() => {
    if (user) {
      const newSocket = io({
        auth: async (cb) => {
          try {
            let nonce = getCookie('socket_nonce');
            if (nonce) {
              document.cookie = "socket_nonce=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            }
            if (!nonce) {
              // Request a fresh single-use nonce if cookie expired or reconnecting
              const res = await fetch('/api/socket-nonce', { 
                method: 'POST', 
                credentials: 'include',
                headers: { 'x-csrf-token': getCookie('csrf_token') || '' }
              });
              const data = await res.json();
              nonce = data.nonce;
            }
            cb({ nonce });
          } catch (err) {
            console.error('[Security] Nonce retrieval failed:', err);
            cb({ nonce: '' });
          }
        }
      });

      newSocket.emit('register', { version: APP_VERSION });

      newSocket.on('system_info', ({ version }) => {
        if (version !== APP_VERSION) {
          showModal({
            title: 'Security Update Required',
            message: 'A secure version update is available. Reloading in 3 seconds to apply encryption compatibility fixes...',
            iconType: 'info'
          });
          setTimeout(() => {
            // Hard cache-busting reload — forces browser to fetch fresh JS bundle
            // window.location.reload() serves cached JS; adding ?v=timestamp bypasses cache
            const url = new URL(window.location.href);
            url.searchParams.set('v', Date.now().toString());
            window.location.replace(url.toString());
          }, 3000);
        }
      });
      
      newSocket.on('banned', async () => {
         setUser(null);
         try { await fetch('/api/logout', { method: 'POST' }); } catch(e) {}
         showModal({ 
            title: 'Account Terminated', 
            message: 'Your account has been permanently terminated by the Administrator.', 
            iconType: 'warning',
            onConfirm: () => window.location.reload()
         });
      });

      newSocket.on('force_logout', async (data) => {
         setUser(null);
         showModal({
            title: 'Security Alert',
            message: data.message || 'Your account was signed in on another device. You have been logged out for security.',
            iconType: 'warning'
         });
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user]);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#111b21] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-[#8696a0]">Securing workspace environment...</p>
      </div>
    );
  }

  if (reauthData) {
    return (
      <VaultReauthModal
        userId={reauthData.userId}
        encryptedPrivateKey={reauthData.encryptedPrivateKey}
        publicKey={reauthData.publicKey}
        onSuccess={(decryptedPrivateKey) => {
          setUser({ ...reauthData.userObj, privateKey: decryptedPrivateKey });
          setReauthData(null);
        }}
        onLogout={async () => {
          setReauthData(null);
          setUser(null);
          try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
        }}
      />
    );
  }

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  if (!socket) {
    return (
      <div className="min-h-screen bg-[#111b21] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-[#8696a0]">Initializing secure connection...</p>
      </div>
    );
  }

  return (
    <Dashboard
      user={user}
      socket={socket}
      onReauthRequired={() => {
        setReauthData({
          userId: user.id.toString(),
          encryptedPrivateKey: user.encryptedPrivateKey || '',
          publicKey: user.publicKey || '',
          userObj: user
        });
      }}
    />
  );
}
