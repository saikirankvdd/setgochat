import { useState, useEffect, useRef } from 'react';
import { User } from '../App';
import { Socket } from 'socket.io-client';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { decodeLSB } from '../utils/stego';
import { decryptData, binaryToString } from '../utils/crypto';
import { AdminDashboard } from './AdminDashboard';
import { Shield, MessageSquare, Lock, Activity, X, Phone, Video } from 'lucide-react';

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
  const [users, setUsers] = useState<User[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<number, string>>({});
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [pendingCall, setPendingCall] = useState<any>(null);
  
  const pinsRef = useRef<Record<string, string>>({});
  const activeUserIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeUserIdRef.current = activeChat?.id || null;
    if (activeChat) {
      setUnreadCounts(prev => ({ ...prev, [activeChat.id]: 0 }));
    }
  }, [activeChat]);

  useEffect(() => {
    fetch('/api/users', {
      headers: {
        'Authorization': `Bearer ${user.token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUsers(data.filter((u: User) => u.id !== user.id));
        }
      });
  }, [user.id]);

  useEffect(() => {
    if (!socket) return;

    socket.on('chat_started', (data) => {
      setSessionInfo({ sessionId: data.sessionId, pin: data.pin });
      pinsRef.current[data.sessionId] = data.pin;
    });

    socket.on('chat_ready', (data) => {
      setSessionInfo({ sessionId: data.sessionId, pin: data.pin });
      pinsRef.current[data.sessionId] = data.pin;
    });

    socket.on('online_users', (userIds: number[]) => {
      setOnlineUsers(userIds);
    });

    socket.on('session_pins', (sessions: any[]) => {
      const newPins: Record<string, string> = { ...pinsRef.current };
      sessions.forEach(s => newPins[s.id] = s.pin);
      pinsRef.current = newPins;
    });

    const processPreview = (data: any, isFile: boolean) => {
       if (data.fromId === user.id) return;
       const pin = pinsRef.current[data.sessionId];
       if (!pin) return; 

       let previewText = '';
       if (isFile) {
         previewText = '📷 Photo or File';
       } else {
         try {
           const binaryString = atob(data.audioBase64);
           const bytes = new Uint8Array(binaryString.length);
           for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
           const binary = decodeLSB(bytes.buffer);
           const encryptedText = binaryToString(binary);
           previewText = decryptData(encryptedText, pin);
         } catch(e) {}
       }

       if (previewText) {
          setLastMessages(prev => ({ ...prev, [data.fromId]: previewText }));
          if (activeUserIdRef.current !== data.fromId) {
             setUnreadCounts(prev => ({ ...prev, [data.fromId]: (prev[data.fromId] || 0) + 1 }));
          }
       }
    };

    const handleMsg = (data: any) => processPreview(data, false);
    const handleFile = (data: any) => processPreview(data, true);

    const handleCallOfferGlobal = (data: any) => {
       if (activeUserIdRef.current === data.fromId) return; // ChatArea will handle it
       setIncomingCall(data);
    };

    const handleCallEndGlobal = (data: any) => {
       setIncomingCall(prev => {
          if (prev && prev.sessionId === data.sessionId) return null;
          return prev;
       });
    };

    socket.on('receive_message', handleMsg);
    socket.on('receive_file', handleFile);
    socket.on('call_offer', handleCallOfferGlobal);
    socket.on('call_end', handleCallEndGlobal);

    return () => {
      socket.off('chat_started');
      socket.off('chat_ready');
      socket.off('online_users');
      socket.off('session_pins');
      socket.off('receive_message', handleMsg);
      socket.off('receive_file', handleFile);
      socket.off('call_offer', handleCallOfferGlobal);
      socket.off('call_end', handleCallEndGlobal);
    };
  }, [socket, user.id]);

  const handleShowAdmin = () => {
    setShowAdmin(true);
  };

  const handleStartChat = (targetUser: User) => {
    setActiveChat(targetUser);
    socket.emit('start_chat', { fromId: user.id, toId: targetUser.id });
  };

  return (
    <div className="flex h-screen bg-[#111b21] overflow-hidden">
      {/* Sidebar */}
      <div className="w-[400px] border-r border-[#2a3942] flex flex-col z-10">
        <Sidebar 
          currentUser={user} 
          users={users}
          onSelectUser={(u) => {
            setUnreadCounts(prev => ({ ...prev, [u.id]: 0 }));
            handleStartChat(u);
          }} 
          activeUserId={activeChat?.id}
          onShowAdmin={handleShowAdmin}
          onlineUsers={onlineUsers}
          lastMessages={lastMessages}
          unreadCounts={unreadCounts}
        />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-[#0b141a] relative">
        {users.filter(u => pinsRef.current[[user.id, u.id].sort().join('-')]).map(targetUser => {
          const sId = [user.id, targetUser.id].sort().join('-');
          const pin = pinsRef.current[sId];
          if (!pin) return null;
          
          return (
             <div key={targetUser.id} className={activeChat?.id === targetUser.id ? "w-full h-full flex flex-col absolute inset-0 z-10 bg-[#0b141a]" : "hidden"}>
               <ChatArea 
                 user={user} 
                 targetUser={targetUser} 
                 socket={socket} 
                 sessionInfo={{ sessionId: sId, pin }} 
                 isOnline={onlineUsers.includes(targetUser.id)}
                 pendingCall={pendingCall}
                 clearPendingCall={() => setPendingCall(null)}
               />
             </div>
          );
        })}
        {!activeChat && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 absolute inset-0 z-0 bg-[#0b141a]">
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
        
        {/* Global Incoming Call Popup */}
        {incomingCall && (
          <div className="absolute top-8 right-8 z-50 bg-[#202c33] border border-[#2a3942] rounded-2xl shadow-2xl p-6 flex flex-col w-80 animate-fade-in shadow-black/50">
            <div className="flex items-center space-x-4 mb-6">
              <div className="w-14 h-14 bg-[#00a884] rounded-full flex items-center justify-center animate-pulse shadow-lg shadow-[#00a884]/20 flex-shrink-0">
                {incomingCall.withVideo ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-medium text-lg truncate">{incomingCall.fromName || `User ${incomingCall.fromId}`}</h3>
                <p className="text-[#00a884] text-sm">Incoming {incomingCall.withVideo ? 'Video' : 'Audio'} Call...</p>
              </div>
            </div>
            <div className="flex space-x-3 w-full">
               <button 
                  onClick={() => {
                     const caller = users.find(u => u.id === incomingCall.fromId);
                     if (caller) {
                        handleStartChat(caller);
                        setPendingCall(incomingCall);
                        setIncomingCall(null);
                     }
                  }} 
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg font-medium transition-colors"
               >
                 Accept
               </button>
               <button 
                  onClick={() => {
                     socket.emit('call_end', {
                        sessionId: incomingCall.sessionId,
                        toId: incomingCall.fromId
                     });
                     setIncomingCall(null);
                  }} 
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium transition-colors"
               >
                 Decline
               </button>
            </div>
          </div>
        )}

        {/* Bottom indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#00a884]"></div>
      </div>

      {/* Admin Dashboard */}
      {showAdmin && (
        <AdminDashboard user={user} onBack={() => setShowAdmin(false)} />
      )}
    </div>
  );
}