/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { io, Socket } from 'socket.io-client';

export type User = {
  id: number;
  username: string;
  email: string;
  token?: string;
  publicKey?: string;
  encryptedPrivateKey?: string;
  privateKey?: string;
  isAdmin?: boolean;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (user) {
      const newSocket = io({
        auth: { token: user.token }
      });
      newSocket.emit('register');
      
      newSocket.on('banned', () => {
         setUser(null);
         alert('Your account has been permanently terminated by the Administrator.');
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [user]);

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

