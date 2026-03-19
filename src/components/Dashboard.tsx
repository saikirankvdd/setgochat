import { useState, useEffect } from 'react';
import { User } from '../App';
import { Socket } from 'socket.io-client';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { Shield, MessageSquare, Lock, Activity, X } from 'lucide-react';

interface DashboardProps {
  user: User;
  socket: Socket;
}

export function Dashboard({ user, socket }: DashboardProps) {
  const [activeChat, setActiveChat] = useState<User | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; pin: string } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [onlineUsers, setOnlineUsers] = useState<number[]>([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('chat_started', (data) => {
      setSessionInfo({ sessionId: data.sessionId, pin: data.pin });
    });

    socket.on('chat_ready', (data) => {
      setSessionInfo({ sessionId: data.sessionId, pin: data.pin });
    });

    socket.on('online_users', (userIds: number[]) => {
      setOnlineUsers(userIds);
    });

    return () => {
      socket.off('chat_started');
      socket.off('chat_ready');
      socket.off('online_users');
    };
  }, [socket]);

  const fetchStats = async () => {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    setStats(data);
    setShowAdmin(true);
  };

  const handleStartChat = (targetUser: User) => {
    setActiveChat(targetUser);
    socket.emit('start_chat', { fromId: user.id, toId: targetUser.id });
  };

  return (
    <div className="flex h-screen bg-[#111b21] overflow-hidden">
      {/* Sidebar */}
      <div className="w-[400px] border-r border-[#2a3942] flex flex-col">
        <Sidebar 
          currentUser={user} 
          onSelectUser={handleStartChat} 
          activeUserId={activeChat?.id}
          onShowAdmin={fetchStats}
          onlineUsers={onlineUsers}
        />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-[#0b141a] relative">
        {activeChat && sessionInfo ? (
          <ChatArea 
            key={activeChat.id}
            user={user} 
            targetUser={activeChat} 
            socket={socket} 
            sessionInfo={sessionInfo} 
            isOnline={onlineUsers.includes(activeChat.id)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-24 h-24 bg-[#202c33] rounded-full flex items-center justify-center mb-6">
              <Shield className="w-12 h-12 text-[#8696a0]" />
            </div>
            <h1 className="text-3xl font-light text-[#e9edef] mb-4">Secure Steganography Chat</h1>
            <p className="text-[#8696a0] max-w-md leading-relaxed">
              Select a contact to start a secure session. All messages are AES-encrypted and hidden inside audio carriers using LSB steganography.
            </p>
            <div className="mt-12 flex items-center text-[#8696a0] text-sm">
              <Lock className="w-4 h-4 mr-2" />
              End-to-end encrypted with temporary session PINs
            </div>
          </div>
        )}
        
        {/* Bottom indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#00a884]"></div>
      </div>

      {/* Admin Modal */}
      {showAdmin && stats && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#202c33] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-[#2a3942] flex justify-between items-center">
              <div className="flex items-center text-[#00a884]">
                <Activity className="w-5 h-5 mr-2" />
                <h2 className="text-xl font-bold">System Security Stats</h2>
              </div>
              <button onClick={() => setShowAdmin(false)} className="text-[#8696a0] hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#2a3942] p-4 rounded-xl">
                  <p className="text-[#8696a0] text-xs uppercase font-bold mb-1">Total Users</p>
                  <p className="text-2xl font-bold text-[#e9edef]">{stats.totalUsers}</p>
                </div>
                <div className="bg-[#2a3942] p-4 rounded-xl">
                  <p className="text-[#8696a0] text-xs uppercase font-bold mb-1">Active Sessions</p>
                  <p className="text-2xl font-bold text-[#e9edef]">{stats.activeSessions}</p>
                </div>
                <div className="bg-[#2a3942] p-4 rounded-xl">
                  <p className="text-[#8696a0] text-xs uppercase font-bold mb-1">Live Connections</p>
                  <p className="text-2xl font-bold text-[#00a884]">{stats.connections}</p>
                </div>
                <div className="bg-[#2a3942] p-4 rounded-xl">
                  <p className="text-[#8696a0] text-xs uppercase font-bold mb-1">System Uptime</p>
                  <p className="text-lg font-bold text-[#e9edef]">{Math.floor(stats.uptime / 60)} mins</p>
                </div>
              </div>
              <div className="bg-[#111b21] p-4 rounded-xl border border-[#2a3942]">
                <p className="text-xs text-[#8696a0] italic">
                  * Admin panel provides system-level metrics only. Encrypted message contents are never accessible to the server or administrators.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}