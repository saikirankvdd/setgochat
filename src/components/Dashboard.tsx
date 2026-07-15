import { useState, useEffect, useRef } from 'react';
import { User, getCookie } from '../App';
import { Socket } from 'socket.io-client';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { decodeLSB, decodeLSB1Bit } from '../utils/stego';
import { gunzipSync, strFromU8 } from 'fflate';
import { decryptData, binaryToString, encryptData, base64ToUint8 } from '../utils/crypto';
import { useModal } from '../contexts/ModalContext';
import { saveMessageLocal } from '../utils/db';
import { AdminDashboard } from './AdminDashboard';
import { OnboardingModal } from './OnboardingModal';
import { Shield, Lock, Phone, Video, X } from 'lucide-react';

interface DashboardProps {
  user: User;
  socket: Socket;
  onReauthRequired?: () => void;
}

const APP_VERSION = '2.3.0';

export function Dashboard({ user, socket, onReauthRequired }: DashboardProps) {
  const [activeChat, setActiveChat] = useState<User | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; pin: string } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<number, number>>({});
  const [lastMessages, setLastMessages] = useState<Record<number, string>>({});
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [pendingCall, setPendingCall] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<number[]>([]);
  const [systemAlert, setSystemAlert] = useState<{title: string, message: string} | null>(null);
  const [pinsReady, setPinsReady] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { showModal } = useModal();
  const [notifications, setNotifications] = useState<any[]>([
    {
      id: 'sec-update',
      type: 'update',
      title: '🔒 Core Security Reinforcements',
      message: 'We have updated all vault algorithms to PBKDF2 (310,000 iterations) + AES-GCM, enabled secure cookie authentication, added strict connect-src Content Security Policies, enforced horizontal authorization checks across sessions, and deployed double-submit CSRF tokens.',
      timestamp: Date.now()
    }
  ]);
  
  const requestedOfflineMsgs = useRef(false);
  const pinsRef = useRef<Record<string, string>>({});
  const activeUserIdRef = useRef<number | null>(null);
  const usersRef = useRef<User[]>([]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    if (!localStorage.getItem('stegochat_guide_done')) {
      setShowOnboarding(true);
    }
    
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const unlockAudio = () => {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContext();
        const buffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);
        audioCtx.resume();
      } catch (e) {}
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  useEffect(() => {
    activeUserIdRef.current = activeChat?.id || null;
    if (activeChat) {
      setUnreadCounts(prev => ({ ...prev, [activeChat.id]: 0 }));
    }
  }, [activeChat]);

  useEffect(() => {
    fetch('/api/users', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setUsers(data.filter((u: User) => u.id !== user.id)); });

    fetch('/api/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (data.blockedUsers) setBlockedUsers(data.blockedUsers); });

    fetch('/api/calls', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setCalls(data); });
  }, [user.id]);

  useEffect(() => {
    if (pinsReady && usersLoaded && !requestedOfflineMsgs.current) {
      requestedOfflineMsgs.current = true;
      setTimeout(() => {
        socket.emit('request_offline_messages');
      }, 500); // Wait for ChatArea components to fully mount and register listeners
    }
  }, [pinsReady, usersLoaded]);

  const playNotificationSound = () => {
    try {
      // Browsers require a user gesture before playing audio
      if (!navigator.userActivation?.hasBeenActive) return;
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
         audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
      
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.2);
    } catch(e) {}
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('connect', () => {
      // Re-register the user on the server after a reconnection
      socket.emit('register', { version: APP_VERSION });
      
      // Request any offline messages that arrived while disconnected
      setTimeout(() => {
        socket.emit('request_offline_messages');
      }, 1000);
    });

    // If socket is already connected on mount, trigger registration immediately to synchronize session PINs
    if (socket.connected) {
      socket.emit('register', { version: APP_VERSION });
    }

    const reEncryptMessagesForPinChange = async (sessionId: string, oldPin: string, newPin: string) => {
       if (!oldPin || oldPin === 'DECRYPTION_FAILED' || oldPin === 'UNENCRYPTED') return;
       if (!newPin || newPin === 'DECRYPTION_FAILED' || newPin === 'UNENCRYPTED' || oldPin === newPin) return;

       console.log(`[E2EE] Session PIN changed from ${oldPin} to ${newPin}. Re-encrypting local database messages...`);
       try {
         const { getMessagesLocal, saveMessageLocal } = await import('../utils/db');
         const localMsgs = await getMessagesLocal(sessionId);
         for (const msg of localMsgs) {
            try {
              let decryptedText = '';
              if (msg.encryptedText) decryptedText = decryptData(msg.encryptedText, oldPin) || '';
              let decryptedFile = '';
              if (msg.encryptedFile) decryptedFile = decryptData(msg.encryptedFile, oldPin) || '';
              
              const newEncryptedText = decryptedText ? encryptData(decryptedText, newPin) : '';
              const newEncryptedFile = decryptedFile ? encryptData(decryptedFile, newPin) : undefined;
              
              await saveMessageLocal({
                ...msg,
                encryptedText: newEncryptedText,
                encryptedFile: newEncryptedFile
              }, true);
            } catch (err) {
              console.error("Failed to re-encrypt message during PIN transition", err);
            }
         }
       } catch (err) {
         console.error("Failed to re-encrypt messages database", err);
       }
    };

    socket.on('chat_started', async (data) => {
      try {
        const { decryptPINWithPrivateKey } = await import('../utils/e2ee');
        const { getPrivateKeyLocal } = await import('../utils/db');
        // Resolve private key with fallback chain
        let resolvedKey: string | undefined = user.privateKey
          || sessionStorage.getItem('stego_priv_key_' + user.id.toString())
          || await getPrivateKeyLocal(user.id.toString())
          || undefined;
        const encPin = String(user.id) === String(data.user1_id) ? data.pin1 : data.pin2;
        let decryptedPin = 'UNENCRYPTED';
        if (encPin && resolvedKey) {
           decryptedPin = await decryptPINWithPrivateKey(encPin, resolvedKey);
        }

        const oldPin = pinsRef.current[data.sessionId];
        if (oldPin && oldPin !== decryptedPin) {
           await reEncryptMessagesForPinChange(data.sessionId, oldPin, decryptedPin);
        }

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
        const { getPrivateKeyLocal } = await import('../utils/db');
        // Resolve private key with fallback chain
        let resolvedKey: string | undefined = user.privateKey
          || sessionStorage.getItem('stego_priv_key_' + user.id.toString())
          || await getPrivateKeyLocal(user.id.toString())
          || undefined;
        const encPin = String(user.id) === String(data.user1_id) ? data.pin1 : data.pin2;
        let decryptedPin = 'UNENCRYPTED';
        if (encPin && resolvedKey) {
           decryptedPin = await decryptPINWithPrivateKey(encPin, resolvedKey);
        }

        const oldPin = pinsRef.current[data.sessionId];
        if (oldPin && oldPin !== decryptedPin) {
           await reEncryptMessagesForPinChange(data.sessionId, oldPin, decryptedPin);
        }

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

    socket.on('online_users', (userIds: string[]) => { 
      setOnlineUsers(userIds.map(String)); 
      fetch('/api/users', { credentials: 'include' })
        .then(res => res.json())
        .then(data => { 
          if (Array.isArray(data)) {
            setUsers(data.filter((u: User) => u.id !== user.id));
            setUsersLoaded(true);
          }
        });
    });

    socket.on('session_pins', async (sessionsData: any[]) => {
      setSessions(sessionsData);
      const newPins: Record<string, string> = { ...pinsRef.current };
      try {
        const { decryptPINWithPrivateKey, encryptPINWithPublicKey } = await import('../utils/e2ee');
        const { getPinLocal, savePinLocal, getPrivateKeyLocal } = await import('../utils/db');

        // Resolve private key from multiple fallback sources to handle cases where
        // user.privateKey is undefined after a forced version-mismatch reload
        let resolvedPrivateKey: string | undefined = user.privateKey;
        if (!resolvedPrivateKey) {
          resolvedPrivateKey = sessionStorage.getItem('stego_priv_key_' + user.id.toString()) || undefined;
        }
        if (!resolvedPrivateKey) {
          resolvedPrivateKey = await getPrivateKeyLocal(user.id.toString()) || undefined;
        }
        
        // Verify that the private key matches the user's public key
        let isCurrentKeyValid = false;
        if (resolvedPrivateKey && user.publicKey) {
          const { verifyKeyPair } = await import('../utils/e2ee');
          isCurrentKeyValid = await verifyKeyPair(user.publicKey, resolvedPrivateKey);
        }

        if (!resolvedPrivateKey || !isCurrentKeyValid) {
          console.warn('[E2EE] Private key is missing or mismatched with public key. Triggering reauth.');
          if (onReauthRequired) {
            onReauthRequired();
          }
          setPinsReady(true);
          return;
        }
        
        let allFailed = sessionsData.length > 0;
        await Promise.all(sessionsData.map(async (s) => {
          try {
            // Decrypt the Server PIN first
            const encPin = String(user.id) === String(s.user1_id) ? s.pin1 : s.pin2;
            let serverPin = 'UNENCRYPTED';
            if (encPin) {
              serverPin = await decryptPINWithPrivateKey(encPin, resolvedPrivateKey!);
            }

            // Check the local Secure Vault
            const localEncryptedPin = await getPinLocal(s.id);
            if (localEncryptedPin) {
                const localPin = await decryptPINWithPrivateKey(localEncryptedPin, resolvedPrivateKey!);
                
                // If local pin and server pin are different and both valid, reconcile/re-encrypt
                if (localPin && serverPin && localPin !== 'DECRYPTION_FAILED' && serverPin !== 'DECRYPTION_FAILED' && localPin !== 'UNENCRYPTED' && serverPin !== 'UNENCRYPTED' && localPin !== serverPin) {
                    await reEncryptMessagesForPinChange(s.id, localPin, serverPin);
                    // Update local vault backup
                    if (user.publicKey) {
                        const reEncryptedLocalPin = await encryptPINWithPublicKey(serverPin, user.publicKey);
                        await savePinLocal(s.id, reEncryptedLocalPin);
                    }
                }
                const resolvedPin = (serverPin !== 'DECRYPTION_FAILED') ? serverPin : localPin;
                newPins[s.id] = resolvedPin;
                if (resolvedPin !== 'DECRYPTION_FAILED') {
                  allFailed = false;
                }
                return;
            }

            // Fallback to Server PIN if no local PIN backup exists
            newPins[s.id] = serverPin;
            if (serverPin !== 'DECRYPTION_FAILED') {
                allFailed = false;
                if (user.publicKey) {
                    const reEncryptedLocalPin = await encryptPINWithPublicKey(serverPin, user.publicKey);
                    await savePinLocal(s.id, reEncryptedLocalPin);
                }
            }
          } catch (e) {
            newPins[s.id] = 'DECRYPTION_FAILED';
          }
        }));
        pinsRef.current = newPins;
        setPinsReady(true);
      } catch(e) {}
    });

    socket.on('new_call_log', () => {
      fetch('/api/calls', { credentials: 'include' })
        .then(res => res.json())
        .then(data => { if (Array.isArray(data)) setCalls(data); });
    });

    const processPreview = (data: any, isFile: boolean, msgType: string) => {
       if (data.fromId === user.id) return;
       const pin = pinsRef.current[data.sessionId];
       if (!pin) return; 
       
       if (msgType === 'missed_call') {
           setLastMessages(prev => ({ ...prev, [data.fromId]: 'Missed Call' }));
           if (activeUserIdRef.current !== data.fromId || document.hidden) {
              setUnreadCounts(prev => ({ ...prev, [data.fromId]: (prev[data.fromId] || 0) + 1 }));
              playNotificationSound();
              if ('Notification' in window && Notification.permission === 'granted') {
                 const sender = usersRef.current.find(u => u.id === data.fromId);
                 const senderName = sender ? sender.username : `User ${data.fromId}`;
                 new Notification('StegoChat', { body: `From StegoChat: ${senderName} left a missed call` });
              }
           }
           return;
       }

       let previewText = '';
       let extractedEncryptedText = '';
       if (isFile) previewText = '📷 Photo or File';
       else {
         try {
           const binaryString = atob(data.audioBase64);
           const bytes = new Uint8Array(binaryString.length);
           for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
           const binary = decodeLSB(bytes.buffer);
           extractedEncryptedText = binaryToString(binary);
           previewText = decryptData(extractedEncryptedText, pin);
           
           // Handle Covert Stego signaling in Dashboard
           if (data.isStegoSignaling || (previewText && (previewText.startsWith('H4sI') || previewText.includes('"type":"stego_call_')))) {
             try {
               let decryptedSignaling = previewText || '';
               if (previewText.startsWith('H4sI')) {
                 const compressedBytes = base64ToUint8(previewText);
                 const decompressedBytes = gunzipSync(compressedBytes);
                 decryptedSignaling = strFromU8(decompressedBytes);
               }
               
               if (decryptedSignaling.includes('"type":"stego_call_')) {
                 const parsed = JSON.parse(decryptedSignaling);
                 if (parsed.type === 'stego_call_offer') {
                   if (activeUserIdRef.current !== data.fromId) {
                     const sender = usersRef.current.find(u => u.id === data.fromId);
                     const senderName = sender ? sender.username : `User ${data.fromId}`;
                     setIncomingCall({
                       sessionId: data.sessionId,
                       fromId: data.fromId,
                       fromName: senderName,
                       offer: parsed.offer,
                       withVideo: parsed.withVideo,
                       callId: parsed.callId
                     });
                     playNotificationSound();
                   }
                 } else if (parsed.type === 'stego_call_end') {
                   setIncomingCall(prev => {
                     if (prev && prev.sessionId === data.sessionId) return null;
                     return prev;
                   });
                 }
               }
             } catch (err) {
               console.error("[Dashboard-Stego-Signaling] Failed to process signaling:", err);
             }
             return; // Ignore signaling message from standard chat previews
           }
         } catch(e) {}
       }

       // Unconditionally save message to local DB if ChatArea is not open to handle it
       if (activeUserIdRef.current !== data.fromId || document.hidden) {
          if (!data.isSelfDestruct) { // Don't save disappearing messages
            const expiresAt = undefined;
            saveMessageLocal({
              id: data.msgId || Math.random().toString(36).substr(2, 9),
              sessionId: data.sessionId,
              fromId: data.fromId.toString(),
              toId: user.id.toString(),
              encryptedText: isFile ? '' : extractedEncryptedText,
              encryptedFile: isFile ? data.encryptedFile : undefined,
              timestamp: data.timestamp || Date.now(),
              isSelfDestruct: !!data.isSelfDestruct,
              expiresAt: expiresAt
            }).catch(e => console.error("Failed to save offline message in Dashboard", e));
          }

          setUnreadCounts(prev => ({ ...prev, [data.fromId]: (prev[data.fromId] || 0) + 1 }));
          playNotificationSound();

          if (previewText) {
             setLastMessages(prev => ({ ...prev, [data.fromId]: previewText }));
          } else {
             setLastMessages(prev => ({ ...prev, [data.fromId]: '🔒 Encrypted Message' }));
          }

          if ('Notification' in window && Notification.permission === 'granted') {
             const sender = usersRef.current.find(u => u.id === data.fromId);
             const senderName = sender ? sender.username : `User ${data.fromId}`;
             const notificationBody = previewText ? `From StegoChat: ${senderName} sent a message` : `From StegoChat: ${senderName} sent an encrypted message`;
             new Notification('StegoChat', { body: notificationBody });
          }
       } else {
          // Message received while active - just update last preview text
          if (previewText) {
             setLastMessages(prev => ({ ...prev, [data.fromId]: previewText }));
          } else {
             setLastMessages(prev => ({ ...prev, [data.fromId]: '🔒 Encrypted Message' }));
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
    socket.on('system_alert', (data) => setSystemAlert(data));
    socket.on('security_alert', (data) => {
       setNotifications(prev => [
         {
            id: Math.random().toString(),
            type: 'alert',
            title: data.title || 'Security Alert',
            message: data.message,
            timestamp: Date.now()
         },
         ...prev
       ]);
       playNotificationSound();
    });
    socket.on('banned', () => {
        showModal({ title: 'Account Suspended', message: 'Your account has been permanently suspended.', iconType: 'warning' });
        window.location.reload();
    });

    socket.on('device_sync_request', async (data: { fromSocketId: string, publicKey: string }) => {
        showModal({
            title: 'New Device Login Detected',
            message: 'A new device is requesting your secure session and chat history. Do you want to transfer it?',
            type: 'confirm',
            iconType: 'warning',
            confirmText: 'Approve Sync',
            cancelText: 'Deny',
            onConfirm: async () => {
                try {
                    const { getAllMessagesLocal, getPrivateKeyLocal } = await import('../utils/db');
                    const { encryptPINWithPublicKey } = await import('../utils/e2ee');
                    const { encryptData } = await import('../utils/crypto');
                    
                    const privateKey = await getPrivateKeyLocal(user.id.toString());
                    const messages = await getAllMessagesLocal();
                    const pins = pinsRef.current;

                    const payloadString = JSON.stringify({ privateKey, messages, pins });
                    
                    // Generate a massive 256-bit AES Transport Password
                    const syncPassword = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
                    
                    // Encrypt the massive JSON string with AES
                    const encryptedPayload = encryptData(payloadString, syncPassword);
                    
                    // Encrypt the short AES Transport Password with the new device's RSA Public Key
                    const encryptedPassword = await encryptPINWithPublicKey(syncPassword, data.publicKey);

                    socket.emit('device_sync_payload', {
                        toSocketId: data.fromSocketId,
                        encryptedPassword,
                        payload: encryptedPayload
                    });
                    
                    setSystemAlert('Secure session successfully transferred to new device.');
                    setTimeout(() => setSystemAlert(null), 3000);
                } catch (e) {
                    console.error('Failed to sync device:', e);
                }
            }
        });
    });

    socket.on('device_sync_payload', async (data: { encryptedPassword: string, payload: string }) => {
        try {
            const { decryptPINWithPrivateKey, encryptPINWithPublicKey } = await import('../utils/e2ee');
            const { decryptData } = await import('../utils/crypto');
            const tempPrivateKey = sessionStorage.getItem('temp_sync_private_key');
            if (!tempPrivateKey) return;

            // Decrypt the AES Transport Password using our RSA Private Key
            const syncPassword = await decryptPINWithPrivateKey(data.encryptedPassword, tempPrivateKey);
            if (syncPassword === 'DECRYPTION_FAILED') throw new Error('Decryption Failed');

            // Decrypt the massive JSON payload using the AES Transport Password
            const decryptedString = decryptData(data.payload, syncPassword);
            if (!decryptedString) throw new Error('Malformed UTF-8 data');

            const { privateKey, messages, pins } = JSON.parse(decryptedString);

            const { savePrivateKeyLocal, importMessagesLocal, savePinLocal } = await import('../utils/db');
            if (privateKey) {
                await savePrivateKeyLocal(user.id.toString(), privateKey);
                try {
                  sessionStorage.setItem('stego_priv_key_' + user.id.toString(), privateKey);
                } catch (e) {}
            }
            
            // Encrypt all recovered PINs using our RSA Public Key and save them to the Secure Vault
            if (pins && user.publicKey) {
                for (const sessionId of Object.keys(pins)) {
                    const encryptedLocalPin = await encryptPINWithPublicKey(pins[sessionId], user.publicKey);
                    await savePinLocal(sessionId, encryptedLocalPin);
                }
            }
            
            if (messages) await importMessagesLocal(messages);
            
            // Clean up temporary keys
            sessionStorage.removeItem('temp_sync_private_key');
            sessionStorage.removeItem('temp_sync_public_key');

            showModal({
                title: 'Sync Complete',
                message: 'Your chat history and keys have been successfully restored! Reloading...',
                iconType: 'success'
            });
            setTimeout(() => window.location.reload(), 2000);
        } catch (e) {
            console.error('Failed to process sync payload:', e);
            showModal({
                title: 'Sync Failed',
                message: 'Failed to restore chat history. The payload may be corrupted.',
                iconType: 'warning'
            });
        }
    });

    return () => {
      socket.off('chat_started');
      socket.off('chat_ready');
      socket.off('request_accepted');
      socket.off('request_declined');
      socket.off('connect');
      socket.off('new_call_log');
      socket.off('online_users');
      socket.off('session_pins');
      socket.off('receive_message', handleMsg);
      socket.off('receive_file', handleFile);
      socket.off('call_offer', handleCallOfferGlobal);
      socket.off('call_end', handleCallEndGlobal);
      socket.off('system_alert');
      socket.off('security_alert');
      socket.off('banned');
      socket.off('device_sync_request');
      socket.off('device_sync_payload');
    };
  }, [socket, user.id, user.privateKey]);

  // Re-register and request offline messages when private key is updated/restored
  useEffect(() => {
    if (socket && user.privateKey) {
      console.log('[E2EE] Private key synchronized/updated. Re-registering socket to decrypt pins.');
      socket.emit('register', { version: APP_VERSION });
      socket.emit('request_offline_messages');
    }
  }, [user.privateKey, socket]);

  const handleStartChat = async (targetUser: User) => {
    setActiveChat(targetUser);
    try {
      if (!user.publicKey || !targetUser.publicKey) return;

      // CRITICAL GUARD: Do NOT generate a new PIN if session_pins hasn't been received yet.
      // If the user clicks a chat before the server responds with existing PINs, pinsRef is
      // empty and isValidPin would be false — causing a fresh PIN to overwrite the old one,
      // permanently making all locally stored messages (encrypted with the old PIN) unreadable.
      if (!pinsReady) {
        console.log('[E2EE] Pins not ready yet — skipping start_chat to prevent overwriting existing session PIN.');
        return;
      }

      const sId = [String(user.id), String(targetUser.id)].sort().join('-');
      const existingPin = pinsRef.current[sId];
      
      // If the PIN is DECRYPTION_FAILED, show the mismatch banner (don't auto-reset).
      // The user must explicitly click "Reset Session" to generate a new PIN.
      if (existingPin === 'DECRYPTION_FAILED') {
        console.warn('[E2EE] Not auto-generating PIN for decryption-failed session:', sId);
        return;
      }

      // KEY FIX: If a valid PIN already exists for this session, do NOT emit start_chat.
      // The ChatArea is already rendered with isActive=false (pinsRef was populated by
      // session_pins on login). setActiveChat() above flips isActive to true, which
      // triggers loadLocalMessages() with the correct stable PIN already in pinsRef.
      // Emitting start_chat here would race against the decryption loop and could
      // replace the stored PIN with a newly-encrypted version before recovery finishes.
      const isValidPin = existingPin && existingPin !== 'UNENCRYPTED' && existingPin.length >= 6;
      if (isValidPin) {
        console.log('[E2EE] Existing valid PIN found for session', sId, '— skipping start_chat. Recovery will use stored PIN.');
        return;
      }

      // Brand-new session (no PIN in pinsRef yet) or UNENCRYPTED legacy session:
      // generate a fresh PIN and perform the full handshake.
      const { encryptPINWithPublicKey } = await import('../utils/e2ee');
      const pinToUse = Math.floor(100000 + Math.random() * 900000).toString();

      const ids = [String(user.id), String(targetUser.id)].sort();
      const iAmUser1 = ids[0] === String(user.id);
      let pin1, pin2;

      if (iAmUser1) {
         pin1 = await encryptPINWithPublicKey(pinToUse, user.publicKey);         // user1 slot
         pin2 = await encryptPINWithPublicKey(pinToUse, targetUser.publicKey);   // user2 slot
      } else {
         pin1 = await encryptPINWithPublicKey(pinToUse, targetUser.publicKey);   // user1 slot
         pin2 = await encryptPINWithPublicKey(pinToUse, user.publicKey);         // user2 slot
      }
      socket.emit('start_chat', { toId: targetUser.id, pin1, pin2 });
    } catch (err) { console.error('E2EE Handshake failed', err); }
  };

  const handleResetChatSession = async (targetUser: User) => {
    try {
      if (!user.publicKey || !targetUser.publicKey) return;
      const { encryptPINWithPublicKey } = await import('../utils/e2ee');

      const sId = [String(user.id), String(targetUser.id)].sort().join('-');
      const pinToUse = Math.floor(100000 + Math.random() * 900000).toString();

      const ids = [String(user.id), String(targetUser.id)].sort();
      const iAmUser1 = ids[0] === String(user.id);
      let pin1, pin2;

      if (iAmUser1) {
         pin1 = await encryptPINWithPublicKey(pinToUse, user.publicKey);
         pin2 = await encryptPINWithPublicKey(pinToUse, targetUser.publicKey);
      } else {
         pin1 = await encryptPINWithPublicKey(pinToUse, targetUser.publicKey);
         pin2 = await encryptPINWithPublicKey(pinToUse, user.publicKey);
      }
      
      console.log('[E2EE] Manually resetting chat session keys for', sId);
      socket.emit('start_chat', { toId: targetUser.id, pin1, pin2 });
      
      showModal({
        title: 'Session Reset',
        message: 'A fresh secure session has been initialized. You can now start chatting!',
        iconType: 'success'
      });
    } catch (err) {
      console.error('Manual E2EE Handshake failed', err);
    }
  };

  const visibleUsers = users.filter(u => !blockedUsers.includes(u.id as any));

  return (
    <div className="flex h-[100dvh] bg-[#111b21] overflow-hidden w-full max-w-full relative">
      <div className={`w-full md:w-[420px] border-r border-[#2a3942] z-10 transition-all shadow-xl ${activeChat ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
        <Sidebar 
          currentUser={user} 
          users={visibleUsers}
          sessions={sessions}
          calls={calls}
          pinsReady={pinsReady}
          onSelectUser={(u) => { setUnreadCounts(prev => ({ ...prev, [u.id]: 0 })); handleStartChat(u); }} 
          activeUserId={activeChat?.id}
          onShowAdmin={() => setShowAdmin(true)}
          onlineUsers={onlineUsers}
          lastMessages={lastMessages}
          unreadCounts={unreadCounts}
          blockedUsersList={users.filter(u => blockedUsers.includes(u.id as any))}
          onShowOnboarding={() => setShowOnboarding(true)}
          notifications={notifications}
          onClearNotifications={() => setNotifications([])}
          onSyncRequest={async () => {
             const { generateRSAKeyPair } = await import('../utils/e2ee');
             const tempKeys = await generateRSAKeyPair();
             sessionStorage.setItem('temp_sync_private_key', tempKeys.privateKey);
             sessionStorage.setItem('temp_sync_public_key', tempKeys.publicKey);
             socket.emit('device_sync_request', { publicKey: tempKeys.publicKey });
             showModal({
                title: 'Sync Requested',
                message: 'A sync request has been sent to your other active devices. Please approve it on the other device to transfer your secure session and chat history.',
                iconType: 'info'
             });
          }}
        />
      </div>

      <div className={`flex-1 bg-[#0b141a] relative w-full h-full ${!activeChat ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
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
                  dbSession={targetSession}
                  isActive={activeChat?.id === targetUser.id}
                  onBack={() => setActiveChat(null)}
                  isBlocked={blockedUsers.includes(targetUser.id as any)}
                  onUnblock={async () => {
                     try {
                       const res = await fetch('/api/unblock', {
                         method: 'POST',
                         headers: { 
                           'Content-Type': 'application/json',
                           'x-csrf-token': getCookie('csrf_token') || ''
                         },
                         body: JSON.stringify({ targetId: targetUser.id }),
                         credentials: 'include'
                       });
                       if (res.ok) {
                         setBlockedUsers(prev => prev.filter(id => id !== targetUser.id));
                         handleStartChat(targetUser); 
                         showModal({ title: 'Success', message: 'User unblocked successfully.', iconType: 'success' });
                       }
                     } catch(e) { console.error(e); }
                  }}
                  onResetSession={() => handleResetChatSession(targetUser)}
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
      
      {systemAlert && (
         <div className="fixed inset-0 bg-[#0b141a]/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-red-500/50 shadow-2xl flex flex-col items-center text-center">
               <Shield className="w-16 h-16 text-orange-500 mb-4" />
               <h2 className="text-2xl font-bold text-white mb-2">{systemAlert.title}</h2>
               <p className="text-[#e9edef] whitespace-pre-wrap mb-8 text-lg">{systemAlert.message}</p>
               <button onClick={() => setSystemAlert(null)} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-white rounded-lg font-bold transition-colors">
                  Acknowledge
               </button>
            </div>
         </div>
      )}

      {showOnboarding && (
        <OnboardingModal onClose={() => {
          localStorage.setItem('stegochat_guide_done', '1');
          setShowOnboarding(false);
        }} />
      )}
    </div>
  );
}