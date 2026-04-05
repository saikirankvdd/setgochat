import { useState, useEffect, useRef } from 'react';
import { User } from '../App';
import { Socket } from 'socket.io-client';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { decodeLSB } from '../utils/stego';
import { decryptData, binaryToString } from '../utils/crypto';
import { AdminDashboard } from './AdminDashboard';
import { Shield, Lock, Phone, Video } from 'lucide-react';

interface DashboardProps {
  user: User;
  socket: Socket;
}

export function Dashboard({ user, socket }: DashboardProps) {
  const [activeChat, setActiveChat] = useState<User | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; pin: string } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<number[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<number, string>>({});
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [pendingCall, setPendingCall] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  
  const pinsRef = useRef<Record<string, string>>({});
  const activeUserIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeUserIdRef.current = activeChat?.id || null;
    if (activeChat) {
      setUnreadCounts(prev => ({ ...prev, [activeChat.id]: 0 }));
    }
  }, [activeChat]);

  useEffect(() => {
    fetch('/api/users', { headers: { 'Authorization': `Bearer ${user.token}` } })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setUsers(data.filter((u: User) => u.id !== user.id)); });

    fetch('/api/calls', { headers: { 'Authorization': `Bearer ${user.token}` } })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setCalls(data); });
  }, [user.id, user.token]);

  useEffect(() => {
    if (!socket) return;

    socket.on('chat_started', async (data) => {
      try {
        const { decryptPINWithPrivateKey } = await import('../utils/e2ee');
        const encPin = user.id === data.user1_id ? data.pin1 : data.pin2;
        const decryptedPin = await decryptPINWithPrivateKey(encPin, user.privateKey!);
        setSessionInfo({ sessionId: data.sessionId, pin: decryptedPin });
        pinsRef.current[data.sessionId] = decryptedPin;

        setSessions(prev => {
           const exists = prev.find(s => s.id === data.sessionId);
           const newData = { ...data, id: data.sessionId };
           if (exists) return prev.map(s => s.id === data.sessionId ? newData : s);
           return [...prev, newData];
        });
      } catch (e) { console.error('Failed to decrypt session', e); }
    });

    socket.on('chat_ready', async (data) => {
      try {
        const { decryptPINWithPrivateKey } = await import('../utils/e2ee');
        const encPin = user.id === data.user1_id ? data.pin1 : data.pin2;
        const decryptedPin = await decryptPINWithPrivateKey(encPin, user.privateKey!);
        setSessionInfo({ sessionId: data.sessionId, pin: decryptedPin });
        pinsRef.current[data.sessionId] = decryptedPin;

        setSessions(prev => {
           const exists = prev.find(s => s.id === data.sessionId);
           const newData = { ...data, id: data.sessionId };
           if (exists) return prev.map(s => s.id === data.sessionId ? newData : s);
           return [...prev, newData];
        });
      } catch (e) { console.error('Failed to decrypt session', e); }
    });

    socket.on('request_accepted', ({ sessionId }) => {
       setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'accepted' } : s));
    });

    socket.on('request_declined', ({ sessionId }) => {
       setSessions(prev => prev.filter(s => s.id !== sessionId));
    });

    socket.on('online_users', (userIds: number[]) => { 
      setOnlineUsers(userIds); 
      fetch('/api/users', { headers: { 'Authorization': `Bearer ${user.token}` } })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setUsers(data.filter((u: User) => u.id !== user.id)); });
    });

    socket.on('session_pins', async (sessionsData: any[]) => {
      setSessions(sessionsData);
      const newPins: Record<string, string> = { ...pinsRef.current };
      try {
        const { decryptPINWithPrivateKey } = await import('../utils/e2ee');
        await Promise.all(sessionsData.map(async (s) => {
          const encPin = user.id === s.user1_id ? s.pin1 : s.pin2;
          try {
            newPins[s.id] = await decryptPINWithPrivateKey(encPin, user.privateKey!);
          } catch(e) {}
        }));
        pinsRef.current = newPins;
      } catch(e) {}
    });

    socket.on('new_call_log', () => {
      fetch('/api/calls', { headers: { 'Authorization': `Bearer ${user.token}` } })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setCalls(data); });
    });

    const processPreview = (data: any, isFile: boolean, msgType: string) => {
       if (data.fromId === user.id) return;
       const pin = pinsRef.current[data.sessionId];
       if (!pin) return; 
       
       if (msgType === 'missed_call') {
           setLastMessages(prev => ({ ...prev, [data.fromId]: 'Missed Call' }));
           if (activeUserIdRef.current !== data.fromId) setUnreadCounts(prev => ({ ...prev, [data.fromId]: (prev[data.fromId] || 0) + 1 }));
           return;
       }

       let previewText = '';
       if (isFile) previewText = '📷 Photo or File';
       else {
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

    const handleMsg = (data: any) => processPreview(data, false, data.type);
    const handleFile = (data: any) => processPreview(data, true, data.type);

    const handleCallOfferGlobal = (data: any) => {
       if (activeUserIdRef.current === data.fromId) return; // ChatArea will handle it
       setIncomingCall(data);
    };
    const handleCallEndGlobal = (data: any) => {
       setIncomingCall(prev => { if (prev && prev.sessionId === data.sessionId) return null; return prev; });
    };

    socket.on('receive_message', handleMsg);
    socket.on('receive_file', handleFile);
    socket.on('call_offer', handleCallOfferGlobal);
    socket.on('call_end', handleCallEndGlobal);

    return () => {
      socket.off('chat_started');
      socket.off('chat_ready');
      socket.off('request_accepted');
      socket.off('request_declined');
      socket.off('new_call_log');
      socket.off('online_users');
      socket.off('session_pins');
      socket.off('receive_message', handleMsg);
      socket.off('receive_file', handleFile);
      socket.off('call_offer', handleCallOfferGlobal);
      socket.off('call_end', handleCallEndGlobal);
    };
  }, [socket, user.id, user.privateKey, user.token]);

  const handleStartChat = async (targetUser: User) => {
    setActiveChat(targetUser);
    try {
      if (!user.publicKey || !targetUser.publicKey) return;
      const { encryptPINWithPublicKey } = await import('../utils/e2ee');
      const myGeneratedPin = Math.floor(100000 + Math.random() * 900000).toString();
      let pin1, pin2;

      if (user.id < targetUser.id) {
         pin1 = await encryptPINWithPublicKey(myGeneratedPin, user.publicKey);
         pin2 = await encryptPINWithPublicKey(myGeneratedPin, targetUser.publicKey);
      } else {
         pin2 = await encryptPINWithPublicKey(myGeneratedPin, user.publicKey);
         pin1 = await encryptPINWithPublicKey(myGeneratedPin, targetUser.publicKey);
      }
      socket.emit('start_chat', { toId: targetUser.id, pin1, pin2 });
    } catch (err) { console.error('E2EE Handshake failed', err); }
  };

  return (
    <div className="flex h-screen bg-[#111b21] overflow-hidden w-full max-w-full relative">
      <div className={`w-full md:w-[420px] border-r border-[#2a3942] flex flex-col z-10 transition-all shadow-xl ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        <Sidebar 
          currentUser={user} 
          users={users}
          sessions={sessions}
          calls={calls}
          onSelectUser={(u) => { setUnreadCounts(prev => ({ ...prev, [u.id]: 0 })); handleStartChat(u); }} 
          activeUserId={activeChat?.id}
          onShowAdmin={() => setShowAdmin(true)}
          onlineUsers={onlineUsers}
          lastMessages={lastMessages}
          unreadCounts={unreadCounts}
        />
      </div>

      <div className={`flex-1 flex flex-col bg-[#0b141a] relative w-full h-full ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {users.filter(u => pinsRef.current[[user.id, u.id].sort().join('-')]).map(targetUser => {
           const sId = [user.id, targetUser.id].sort().join('-');
           const pin = pinsRef.current[sId];
           if (!pin) return null;
           const targetSession = sessions.find(s => s.id === sId) || { status: 'accepted', initiator_id: user.id };
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
                  dbSession={targetSession}
                  onBack={() => setActiveChat(null)}
                />
              </div>
           );
        })}

        {!activeChat && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 absolute inset-0 z-0 bg-transparent">
            <div className="w-32 h-32 bg-[#202c33] rounded-full flex items-center justify-center mb-8 shadow-2xl">
              <Shield className="w-16 h-16 text-[#00a884] opacity-80" />
            </div>
            <h1 className="text-4xl font-light text-[#e9edef] mb-4">Secure Steganography Chat</h1>
            <p className="text-[#8696a0] max-w-md leading-relaxed text-lg">
              Search to start a secure, E2EE conversation.
            </p>
            <div className="mt-12 inline-flex items-center px-6 py-2 bg-[#202c33] rounded-full text-[#8696a0] text-sm shadow-xl font-medium border border-[#2a3942]">
              <Lock className="w-4 h-4 mr-3 text-[#00a884]" />
              True Military-Grade RSA-2048 Vault Encryption
            </div>
          </div>
        )}

        {incomingCall && (
          <div className="absolute top-8 right-8 md:top-6 md:right-6 z-[9999] bg-[#202c33] border border-[#2a3942] rounded-3xl shadow-2xl p-6 flex flex-col w-[90%] md:w-80 max-w-sm animate-fade-in shadow-black/80">
            <div className="flex items-center space-x-4 mb-6">
               <div className="w-16 h-16 bg-gradient-to-br from-[#00a884] to-[#015f4a] rounded-full flex items-center justify-center animate-pulse flex-shrink-0 shadow-lg border-2 border-[#111b21]">
                 {incomingCall.withVideo ? <Video className="w-8 h-8 text-white" /> : <Phone className="w-8 h-8 text-white" />}
               </div>
               <div className="min-w-0">
                 <h3 className="text-white font-medium text-xl truncate tracking-tight">{incomingCall.fromName || `User ${incomingCall.fromId}`}</h3>
                 <p className="text-[#e9edef] mt-1 text-sm font-light tracking-wide flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-bounce"></span>
                    Incoming {incomingCall.withVideo ? 'Video' : 'Audio'} Call
                 </p>
               </div>
            </div>
            <div className="flex space-x-4 w-full mt-2">
               <button onClick={() => {
                  socket.emit('call_end', { sessionId: incomingCall.sessionId, toId: incomingCall.fromId });
                  setIncomingCall(null);
               }} className="flex-1 bg-[#3b4a54] hover:bg-red-500 hover:text-white text-[#d1d7db] py-3 rounded-xl font-semibold transition-all shadow-md">
                 Decline
               </button>
               <button onClick={() => {
                  const caller = users.find(u => u.id === incomingCall.fromId);
                  if (caller) { handleStartChat(caller); setPendingCall(incomingCall); setIncomingCall(null); }
               }} className="flex-1 bg-[#00a884] hover:bg-[#06cf9c] text-white py-3 rounded-xl font-semibold transition-all shadow-md shadow-[#00a884]/30">
                 Accept
               </button>
            </div>
          </div>
        )}
      </div>

      {showAdmin && <AdminDashboard user={user} onBack={() => setShowAdmin(false)} />}
    </div>
  );
}