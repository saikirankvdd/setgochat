/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { io, Socket } from 'socket.io-client';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Bootstrap user session from HttpOnly cookie on mount (Finding 1)
  useEffect(() => {
    async function bootstrapSession() {
      try {
        const res = await fetch('/api/session', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setUser(data.user);
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

      newSocket.emit('register');
      
      newSocket.on('banned', () => {
         setUser(null);
         alert('Your account has been permanently terminated by the Administrator.');
      });

      newSocket.on('force_logout', (data) => {
         setUser(null);
         alert(data.message || 'Your account was signed in on another device. You have been logged out for security.');
         window.location.reload();
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

  return <Dashboard user={user} socket={socket} />;
}
