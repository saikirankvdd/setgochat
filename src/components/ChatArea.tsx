import React, { useState, useEffect, useRef } from 'react';
import { User } from '../App';
import { Socket } from 'socket.io-client';
import { Send, Paperclip, Mic, Phone, MoreVertical, Shield, Lock, Trash2, Eye, Smile, Video, VideoOff, MicOff, Download, Clock, X, Check, CheckCheck, ArrowLeft, Volume2, UserPlus, UserMinus } from 'lucide-react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { encryptData, decryptData, stringToBinary, binaryToString } from '../utils/crypto';
import { encodeLSB, decodeLSB, createCarrierWav } from '../utils/stego';

interface ChatAreaProps {
  key?: string | number;
  user: User;
  targetUser: User;
  socket: Socket;
  sessionInfo: { sessionId: string; pin: string };
  isOnline: boolean;
  pendingCall?: any;
  clearPendingCall?: () => void;
  dbSession?: any;
  onBack?: () => void;
}

interface Message {
  id: string;
  fromId: number;
  text: string;
  timestamp: number;
  isSelfDestruct?: boolean;
  expiresAt?: number;
  isRevealed?: boolean;
  isOneTime?: boolean;
  timerSeconds?: number;
  isPaused?: boolean;
  timeRemaining?: number;
  file?: {
    name: string;
    type: string;
    data: string; // base64
  };
}

export function ChatArea({ user, targetUser, socket, sessionInfo, isOnline, pendingCall, clearPendingCall, dbSession, onBack }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [snapchatMode, setSnapchatMode] = useState(false); // Disappearing timer
  const [oneTimeView, setOneTimeView] = useState(false);   // View once mode
  const [timer, setTimer] = useState(10); // seconds
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'receiving' | 'connected'>('idle');
  const [callerId, setCallerId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup media tracks on unmount to prevent stuck recording icons
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const onEmojiClick = (emojiObject: any) => {
    setInputText(prev => prev + emojiObject.emoji);
  };

  useEffect(() => {
    if (!socket) return;

    const handleReceive = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      try {
        // 1. Receive Audio Carrier (base64)
        const binaryString = atob(data.audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioData = bytes.buffer;
        
        // 2. Extract Hidden Binary
        const binary = decodeLSB(audioData);
        
        // 3. Convert Binary to Encrypted Text
        const encryptedText = binaryToString(binary);
        
        // 4. Decrypt using Session PIN
        const decrypted = decryptData(encryptedText, sessionInfo.pin);
        
        if (decrypted) {
          const newMessage: Message = {
            id: Math.random().toString(36).substr(2, 9),
            fromId: data.fromId,
            text: decrypted,
            timestamp: Date.now(),
            isSelfDestruct: data.isSelfDestruct,
            isOneTime: false, // Text is never one-time view
            timerSeconds: data.timer,
            isRevealed: true, // Snapchat style: always revealed instantly
            expiresAt: data.isSelfDestruct ? Date.now() + (data.timer * 1000) : undefined // Start countdown immediately
          };
          setMessages(prev => [...prev, newMessage]);
        }
      } catch (err) {
        console.error('Failed to process incoming message', err);
      }
    };

    const handleReceiveFile = (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      try {
        const decryptedFile = decryptData(data.encryptedFile, sessionInfo.pin);
        if (decryptedFile) {
          const filePayload = JSON.parse(decryptedFile);
          const newMessage: Message = {
            id: Math.random().toString(36).substr(2, 9),
            fromId: data.fromId,
            text: '',
            timestamp: Date.now(),
            isSelfDestruct: data.isSelfDestruct,
            isOneTime: data.isOneTime,
            timerSeconds: data.timer,
            isRevealed: !(data.isSelfDestruct || data.isOneTime),
            expiresAt: undefined,
            file: filePayload
          };
          setMessages(prev => [...prev, newMessage]);
        }
      } catch (err) {
        console.error('Failed to process incoming file', err);
      }
    };

    const handleCallOffer = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      setCallState('receiving');
      setCallerId(data.fromId);
      setIsVideoCall(data.withVideo || false);
      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('call_ice_candidate', {
            sessionId: sessionInfo.sessionId,
            candidate: event.candidate,
            toId: data.fromId
          });
        }
      };

      peerConnectionRef.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift();
        if (candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
        }
      }
    };

    const handleCallAnswer = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallState('connected');
        
        while (pendingCandidates.current.length > 0) {
          const candidate = pendingCandidates.current.shift();
          if (candidate) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
          }
        }
      }
    };

    const handleIceCandidate = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      if (peerConnectionRef.current) {
        if (peerConnectionRef.current.remoteDescription) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error("Error adding ICE candidate", e);
          }
        } else {
          pendingCandidates.current.push(data.candidate);
        }
      } else {
        pendingCandidates.current.push(data.candidate);
      }
    };

    const handleCallEnd = (data: any) => {
      if (data && data.sessionId !== sessionInfo.sessionId) return;
      endCall(false);
    };

    if (pendingCall && pendingCall.sessionId === sessionInfo.sessionId) {
      handleCallOffer(pendingCall);
      if (clearPendingCall) clearPendingCall();
    }

    socket.on('receive_message', handleReceive);
    socket.on('receive_file', handleReceiveFile);
    socket.on('call_offer', handleCallOffer);
    socket.on('call_answer', handleCallAnswer);
    socket.on('call_ice_candidate', handleIceCandidate);
    socket.on('call_end', handleCallEnd);

    return () => {
      socket.off('receive_message', handleReceive);
      socket.off('receive_file', handleReceiveFile);
      socket.off('call_offer', handleCallOffer);
      socket.off('call_answer', handleCallAnswer);
      socket.off('call_ice_candidate', handleIceCandidate);
      socket.off('call_end', handleCallEnd);
    };
  }, [socket, sessionInfo.pin, sessionInfo.sessionId, pendingCall, clearPendingCall]);

  useEffect(() => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle self-destructing messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => {
        const filtered = prev.filter(m => {
          if (!m.expiresAt) return true;
          if (m.isPaused) return true; // Keep message alive while downloading/paused
          return m.expiresAt > now;
        });
        // Only trigger React render if something actually expired and left the array
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 100); // 100ms for smoother countdown visuals
    return () => clearInterval(interval);
  }, []);

  // Handle call duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callState === 'connected') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callState]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startCall = async (withVideo: boolean = false) => {
    try {
      pendingCandidates.current = [];
      setIsVideoCall(withVideo);
      setIsMuted(false);
      setIsVideoOff(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallState('calling');

      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      stream.getTracks().forEach(track => {
        peerConnectionRef.current?.addTrack(track, stream);
      });

      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('call_ice_candidate', {
            sessionId: sessionInfo.sessionId,
            candidate: event.candidate,
            toId: targetUser.id
          });
        }
      };

      peerConnectionRef.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);

      socket.emit('call_offer', {
        sessionId: sessionInfo.sessionId,
        offer: offer,
        fromId: user.id,
        fromName: user.username,
        toId: targetUser.id,
        withVideo
      });
    } catch (err) {
      console.error('Error starting call:', err);
      if (!navigator.mediaDevices) {
        alert('Microphone access requires a secure HTTPS connection. Please use the secure ngrok URL on your phone.');
      } else {
        alert('Could not access microphone for call. Please check your browser permissions.');
      }
      endCall();
    }
  };

  const acceptCall = async () => {
    try {
      setIsMuted(false);
      setIsVideoOff(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall });
      setLocalStream(stream);
      localStreamRef.current = stream;

      stream.getTracks().forEach(track => {
        peerConnectionRef.current?.addTrack(track, stream);
      });

      const answer = await peerConnectionRef.current!.createAnswer();
      await peerConnectionRef.current!.setLocalDescription(answer);

      socket.emit('call_answer', {
        sessionId: sessionInfo.sessionId,
        answer: answer,
        toId: callerId || targetUser.id
      });

      setCallState('connected');
      
      // Attempt to play audio immediately to satisfy mobile browser user gesture requirements
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(e => console.error("Video play failed:", e));
      }
    } catch (err) {
      console.error('Error accepting call:', err);
      if (!navigator.mediaDevices) {
        alert('Media device access requires a secure HTTPS connection. Please use the secure ngrok URL on your phone.');
      } else {
        alert('Could not access microphone/camera to accept call. Please check permissions.');
      }
      endCall();
    }
  };

  const endCall = (emit = true) => {
    if (emit && callState === 'calling') {
      socket.emit('log_call', { toId: targetUser.id, status: 'missed' });
      socket.emit('send_message', { sessionId: sessionInfo.sessionId, fromId: user.id, toId: targetUser.id, type: 'missed_call' });
    } else if (emit && callState === 'connected') {
      socket.emit('log_call', { toId: callerId || targetUser.id, status: 'completed' });
    }

    setCallState('idle');
    pendingCandidates.current = [];
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
    if (emit) {
      socket.emit('call_end', {
        sessionId: sessionInfo.sessionId,
        toId: callerId || targetUser.id
      });
    }
    setCallerId(null);
  };

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
    if (localVideoRef.current && localStream && isVideoCall) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(e => console.error("Local video play failed:", e));
    }
  }, [remoteStream, localStream, callState, isVideoCall]);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = isMuted; // if previously muted, enable it
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream && isVideoCall) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoOff; 
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      alert("File is too large. Please select a file smaller than 100MB in accordance with WhatsApp standards.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      
      const filePayload = JSON.stringify({
        name: file.name,
        type: file.type,
        data: base64Data
      });
      
      setTimeout(() => {
        try {
          const encryptedFile = encryptData(filePayload, sessionInfo.pin);

          socket.emit('send_file', {
            sessionId: sessionInfo.sessionId,
            fromId: user.id,
            toId: targetUser.id,
            encryptedFile: encryptedFile,
            isSelfDestruct: snapchatMode,
            isOneTime: oneTimeView,
            timer: timer
          });

          setMessages(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            fromId: user.id,
            text: '',
            timestamp: Date.now(),
            isSelfDestruct: snapchatMode,
            isOneTime: oneTimeView,
            timerSeconds: timer,
            isRevealed: true,
            expiresAt: snapchatMode ? Date.now() + (timer * 1000) : undefined,
            file: {
              name: file.name,
              type: file.type,
              data: base64Data
            }
          }]);
        } catch (err) {
          console.error(err);
        } finally {
          setIsProcessing(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }, 50);
    };
    reader.readAsDataURL(file);
  };

  const handleVoiceRecord = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const base64Data = reader.result as string;
          
          const filePayload = JSON.stringify({
            name: 'Voice Message.webm',
            type: 'audio/webm',
            data: base64Data
          });
          
          setTimeout(() => {
            try {
              const encryptedFile = encryptData(filePayload, sessionInfo.pin);

              socket.emit('send_file', {
                sessionId: sessionInfo.sessionId,
                fromId: user.id,
                toId: targetUser.id,
                encryptedFile: encryptedFile,
                isSelfDestruct: snapchatMode,
                isOneTime: oneTimeView,
                timer: timer
              });

              setMessages(prev => [...prev, {
                id: Math.random().toString(36).substr(2, 9),
                fromId: user.id,
                text: '',
                timestamp: Date.now(),
                isSelfDestruct: snapchatMode,
                isOneTime: oneTimeView,
                timerSeconds: timer,
                isRevealed: true,
                expiresAt: snapchatMode ? Date.now() + (timer * 1000) : undefined,
                file: {
                  name: 'Voice Message.webm',
                  type: 'audio/webm',
                  data: base64Data
                }
              }]);
            } catch (err) {
              console.error(err);
            } finally {
              setIsProcessing(false);
            }
          }, 50);
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      if (!navigator.mediaDevices) {
        alert('Microphone access requires a secure HTTPS connection. Please use the secure ngrok URL on your phone.');
      } else {
        alert('Could not access microphone. Please check your browser permissions.');
      }
      setIsRecording(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    try {
      // 1. Encrypt Message
      const encrypted = encryptData(inputText, sessionInfo.pin);
      
      // 2. Convert to Binary
      const binary = stringToBinary(encrypted);
      
      // 3. Create Carrier Audio
      const carrier = createCarrierWav(2); // 2 seconds carrier
      
      // 4. Hide Data in Carrier
      const stegoAudio = encodeLSB(carrier, binary);
      
      // 5. Convert to Base64 for transmission
      const bytes = new Uint8Array(stegoAudio);
      let binaryStr = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binaryStr);

      // 6. Send via Socket
      socket.emit('send_message', {
        sessionId: sessionInfo.sessionId,
        fromId: user.id,
        toId: targetUser.id,
        audioBase64: base64,
        isSelfDestruct: snapchatMode,
        isOneTime: false, // Text messages never use One Time View
        timer: timer
      });

      // Add to local UI
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        fromId: user.id,
        text: inputText,
        timestamp: Date.now(),
        isSelfDestruct: snapchatMode,
        isOneTime: false, // Text messages never use One Time View
        timerSeconds: timer,
        isRevealed: true,
        expiresAt: snapchatMode ? Date.now() + (timer * 1000) : undefined
      }]);

      setInputText('');
    } catch (err) {
      alert('Error encoding message: ' + err);
    }
  };

  const handleReveal = (msgId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        return {
          ...m,
          isRevealed: true,
          expiresAt: m.isSelfDestruct ? Date.now() + ((m.timerSeconds || 10) * 1000) : (m.isOneTime ? Date.now() + 5000 : undefined)
        };
      }
      return m;
    }));
  };

  const destroyMessage = (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  const triggerDownload = (msgId: string, filename: string, base64data: string) => {
    // 1. Pause countdown
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.expiresAt) {
        return { ...m, isPaused: true, timeRemaining: Math.max(0, m.expiresAt - Date.now()) };
      }
      return m;
    }));

    // 2. Process file download (using Blob handles large files without freezing UX)
    try {
      const parts = base64data.split(',');
      const bstr = atob(parts[parts.length - 1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: parts[0].split(':')[1].split(';')[0] });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download Error:", err);
    }

    // 3. Resume countdown after typical download pop-up processes (2 seconds grace period)
    setTimeout(() => {
      setMessages(prev => prev.map(m => {
        if (m.id === msgId && m.isPaused && m.timeRemaining !== undefined) {
          return { ...m, isPaused: false, expiresAt: Date.now() + m.timeRemaining };
        }
        return m;
      }));
    }, 2000); 
  };

  const renderMessageText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all">
            {part}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-row h-full w-full">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Call UI Overlay */}
        {callState !== 'idle' && (
          <div className="absolute inset-0 z-50 bg-[#0b141a]/95 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in p-8">
            {/* Always mount video so ref attaches, hide visual if audio-only */}
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className={`absolute inset-0 w-full h-full object-cover z-0 ${isVideoCall && callState === 'connected' ? 'block' : 'hidden'}`} 
            />

            <div className={`relative w-full max-w-3xl flex-1 flex flex-col items-center justify-center z-10 ${isVideoCall && callState === 'connected' ? 'bg-transparent' : 'bg-[#202c33] rounded-3xl border border-[#2a3942] p-8 shadow-2xl max-h-[400px]'}`}>
              {/* Avatar for Audio Call or connecting */}
              {(!isVideoCall || callState !== 'connected') && (
                <div className="flex flex-col items-center">
                  <div className="w-24 h-24 bg-[#00a884] rounded-full flex items-center justify-center mb-6 animate-pulse shadow-lg shadow-[#00a884]/20">
                    {isVideoCall ? <Video className="w-10 h-10 text-white" /> : <Phone className="w-10 h-10 text-white" />}
                  </div>
                  <h2 className="text-2xl text-white font-medium mb-2">
                    {callState === 'receiving' ? (String(callerId) === String(targetUser.id) ? targetUser.username : 'Unknown') : targetUser.username}
                  </h2>
                  <p className="text-[#8696a0] mb-2 text-lg">
                    {callState === 'calling' && 'Calling...'}
                    {callState === 'receiving' && `Incoming ${isVideoCall ? 'Video ' : 'Audio '}Call`}
                    {callState === 'connected' && formatDuration(callDuration)}
                  </p>
                </div>
              )}
              
              {/* Local PiP feed */}
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`absolute bottom-32 right-8 w-32 md:w-48 h-48 md:h-64 object-cover rounded-2xl shadow-xl border-2 border-[#2a3942] bg-[#202c33] transition-opacity ${isVideoCall && !isVideoOff && callState === 'connected' ? 'opacity-100' : 'opacity-0 hidden'}`} 
              />

              {/* Actions Bar */}
              <div className="absolute bottom-8 flex items-center justify-center space-x-6 w-full">
                {callState === 'receiving' ? (
                  <>
                    <button onClick={acceptCall} className="w-16 h-16 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
                      {isVideoCall ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
                    </button>
                    <button onClick={() => endCall()} className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
                      <Phone className="w-7 h-7 text-white rotate-[135deg]" />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${isMuted ? 'bg-[#3b4a54] text-white/50' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'}`}>
                      {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>
                    
                    {isVideoCall && (
                      <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${isVideoOff ? 'bg-[#3b4a54] text-white/50' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'}`}>
                        {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                      </button>
                    )}

                    <button onClick={() => endCall()} className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
                      <Phone className="w-7 h-7 text-white rotate-[135deg]" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="h-[64px] bg-[#202c33] px-3 flex items-center justify-between border-l border-[#2a3942] z-40 shadow-sm w-full">
          <div className="flex items-center min-w-0">
            {onBack && (
              <button className="md:hidden p-2 mr-1 text-[#aebac1] hover:text-[#e9edef] rounded-full hover:bg-[rgba(255,255,255,0.1)] transition-colors" onClick={onBack}>
                <ArrowLeft className="w-6 h-6" />
              </button>
            )}
            <div className="flex items-center cursor-pointer hover:bg-[rgba(255,255,255,0.05)] p-1.5 rounded-lg transition-colors" onClick={() => setShowUserProfile(true)}>
              <div className="w-11 h-11 bg-gradient-to-br from-[#00a884] to-[#046a53] rounded-full flex items-center justify-center mr-3 flex-shrink-0 shadow-lg border border-[#111b21]">
                <span className="text-[#d1d7db] font-bold text-lg">{targetUser.username[0].toUpperCase()}</span>
              </div>
            <div>
              <h2 className="text-[#e9edef] font-medium leading-tight">{targetUser.username}</h2>
              <div className="flex items-center text-[11px] font-medium">
                <span className={`mr-2 ${isOnline ? 'text-[#00a884]' : 'text-[#8696a0]'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
                <Shield className="w-3 h-3 mr-1 text-[#00a884]" />
                <span className="text-[#00a884]">SECURE SESSION ACTIVE (PIN: {sessionInfo.pin})</span>
              </div>
            </div>
          </div>
        <div className="flex items-center space-x-5 text-[#aebac1]">
          {snapchatMode && (
            <select 
              className="bg-[#202c33] text-xs font-bold text-orange-400 border border-[#3b4a54] rounded-md px-2 py-1 outline-none cursor-pointer"
              value={timer}
              onChange={(e) => setTimer(Number(e.target.value))}
              title="Snapchat Timer"
            >
              <option value={5}>5 Sec</option>
              <option value={10}>10 Sec</option>
              <option value={30}>30 Sec</option>
              <option value={60}>1 Min</option>
            </select>
          )}
          <button 
            onClick={() => setSnapchatMode(!snapchatMode)}
            className={`transition-colors ${snapchatMode ? 'text-orange-400' : 'hover:text-[#d1d7db]'}`}
            title="Snapchat Mode"
          >
            <Clock className="w-5 h-5" />
          </button>
          <Phone className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => startCall(false)} />
          <Video className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => startCall(true)} />
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat opacity-90"
      >
        {messages.map(msg => (
          <div 
            key={msg.id} 
            className={`flex ${msg.fromId === user.id ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[65%] rounded-lg px-3 py-2 shadow-sm relative group ${
              msg.fromId === user.id ? 'bg-[#005c4b] text-[#e9edef]' : 'bg-[#202c33] text-[#e9edef]'
            }`}>
              {((msg.isSelfDestruct || msg.isOneTime) && !msg.isRevealed) ? (
                <div 
                  className="flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-black/20 rounded-lg group transition-colors min-w-[120px]"
                  onClick={() => handleReveal(msg.id)}
                >
                  <div className="relative">
                    {msg.isOneTime ? (
                      <span className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-[#00a884] text-[#00a884] font-bold text-sm mb-2 group-hover:scale-110 transition-transform">1</span>
                    ) : (
                      <Clock className="w-8 h-8 text-[#00a884] mb-2 group-hover:scale-110 transition-transform" />
                    )}
                  </div>
                  <span className="text-[#00a884] font-medium text-sm text-center">
                    Tap to view
                  </span>
                </div>
              ) : (
                <>
                  {msg.isOneTime && msg.isRevealed && msg.fromId !== user.id && (
                     <div className="absolute -top-3 -right-3 bg-red-500 rounded-full h-6 px-2 shadow-lg text-white z-50 flex items-center text-[10px] font-bold animate-pulse">
                       BURNING...
                     </div>
                  )}
                  {msg.file ? (
                    <div className="mb-2 relative">
                  {msg.file.type.startsWith('image/') ? (
                    <div className="relative inline-block group/media">
                      <img src={msg.file.data} alt="attachment" className="max-w-full rounded-lg max-h-64 object-contain" />
                      {!msg.isOneTime && (
                        <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="absolute bottom-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition-colors opacity-0 group-hover/media:opacity-100 z-10">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : msg.file.type.startsWith('video/') ? (
                    <div className="relative inline-block group/media">
                      <video src={msg.file.data} controls className="max-w-full rounded-lg max-h-64" />
                      {!msg.isOneTime && (
                        <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="absolute -top-2 -right-2 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition-colors opacity-0 group-hover/media:opacity-100 shadow-xl z-10">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : msg.file.type.startsWith('audio/') ? (
                    <div className="flex items-center space-x-2">
                       <audio src={msg.file.data} controls className="max-w-full flex-1" />
                       {!msg.isOneTime && (
                         <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="p-2 bg-[#2a3942] hover:bg-[#3a4952] rounded-full text-[#aebac1] transition-colors z-10">
                          <Download className="w-4 h-4" />
                         </button>
                       )}
                    </div>
                  ) : (
                    <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="flex items-center space-x-2 bg-[#2a3942] p-3 rounded-lg hover:bg-[#3a4952] transition-colors text-left w-full">
                      <Paperclip className="w-5 h-5 flex-shrink-0" />
                      <span className="truncate max-w-[200px] flex-1">{msg.file.name}</span>
                      <Download className="w-4 h-4 flex-shrink-0 text-[#aebac1]" />
                    </button>
                  )}
                </div>
              ) : null}
              {msg.text && <p className="text-sm leading-relaxed pr-8 whitespace-pre-wrap">{renderMessageText(msg.text)}</p>}
              <div className="flex items-center justify-end mt-1 space-x-1">
                <span className="text-[10px] text-[#8696a0] flex items-center">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {msg.fromId === user.id && (
                    <span className="ml-1">
                      {isOnline ? <CheckCheck className="w-4 h-4 text-[#53bdeb]" /> : <Check className="w-3 h-3 text-[#8696a0]" />}
                    </span>
                  )}
                </span>
                {msg.isSelfDestruct && msg.isRevealed && msg.expiresAt && (
                  <span className={`text-[10px] font-bold flex items-center ${msg.isPaused ? 'text-blue-400' : 'text-orange-400'}`}>
                    <Trash2 className="w-3 h-3 ml-1" />
                    {msg.isPaused && msg.timeRemaining 
                      ? `${Math.max(0, Math.ceil(msg.timeRemaining / 1000))}s (Paused)` 
                      : `${Math.max(0, Math.ceil((msg.expiresAt - Date.now()) / 1000))}s`}
                  </span>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      </div>
      
      {/* Input Area or Request Panel */}
      {dbSession?.status === 'pending' && dbSession?.initiator_id !== user.id ? (
        <div className="bg-[#202c33] p-4 flex flex-col items-center justify-center border-t border-[#2a3942] z-20">
           <h3 className="text-[#e9edef] font-medium mb-3 flex items-center">
              <UserPlus className="w-5 h-5 mr-2 text-[#00a884]" />
              {targetUser.username} wants to send you a secure message
           </h3>
           <p className="text-[#8696a0] text-sm mb-4">Accept the request to chat safely.</p>
           <div className="flex space-x-4 w-full max-w-sm">
             <button onClick={() => { socket.emit('decline_request', { sessionId: sessionInfo.sessionId, toId: targetUser.id }); if(onBack) onBack(); }} className="flex-1 py-2.5 bg-[#3b4a54] hover:bg-red-500 hover:text-white text-[#d1d7db] font-semibold rounded-lg transition-colors flex items-center justify-center">
               <UserMinus className="w-4 h-4 mr-2" /> Decline
             </button>
             <button onClick={() => socket.emit('accept_request', { sessionId: sessionInfo.sessionId })} className="flex-1 py-2.5 bg-[#00a884] hover:bg-[#06cf9c] text-white font-semibold rounded-lg transition-colors flex items-center justify-center">
               <Check className="w-4 h-4 mr-2" /> Accept
             </button>
           </div>
        </div>
      ) : (
        <div className="bg-[#202c33] p-3 flex flex-wrap md:flex-nowrap items-center gap-3 relative border-t border-[#2a3942] z-20">
          {showEmojiPicker && (
            <div className="absolute bottom-[70px] left-2 md:left-4 z-50 shadow-2xl">
              <EmojiPicker onEmojiClick={onEmojiClick} theme={Theme.DARK} width={window.innerWidth < 768 ? 320 : undefined}/>
            </div>
          )}
          <div className="flex items-center space-x-3 text-[#aebac1]">
            <Smile 
              className={`w-6 h-6 cursor-pointer hover:text-[#d1d7db] ${showEmojiPicker ? 'text-[#00a884]' : ''}`} 
              onClick={() => setShowEmojiPicker(!showEmojiPicker)} 
            />
            <button 
              onClick={() => setOneTimeView(!oneTimeView)}
              className={`flex items-center justify-center w-6 h-6 rounded-full border-[2px] transition-all shadow-sm ${oneTimeView ? 'bg-[#00a884] border-[#00a884] text-white' : 'bg-transparent border-[#aebac1] text-[#aebac1] hover:border-[#d1d7db] hover:text-[#d1d7db]'}`}
              title="View Once"
            >
              <span className="text-[10px] font-bold select-none text-center leading-none">1</span>
            </button>
            <Paperclip 
              className="w-6 h-6 cursor-pointer hover:text-[#d1d7db]" 
              onClick={() => fileInputRef.current?.click()}
            />
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileUpload} 
            />
          </div>
          <div className="flex-1 relative order-last md:order-none w-full md:w-auto mt-2 md:mt-0">
            <input
              type="text"
              placeholder="Type a secure message..."
              className="w-full bg-[#2a3942] text-[#e9edef] rounded-lg py-3 pl-4 pr-10 focus:outline-none text-[15px] shadow-inner"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            />
          </div>
          <button 
            onClick={inputText ? handleSendMessage : handleVoiceRecord}
            disabled={isProcessing}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white transition-colors shadow-lg ${
              isProcessing ? 'bg-gray-500 cursor-not-allowed' :
              isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-[#00a884] hover:bg-[#06cf9c]'
            }`}
          >
            {isProcessing ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : inputText ? (
              <Send className="w-5 h-5 ml-1" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
        </div>
      )}
      </div>

      {/* User Profile Sidebar */}
      {showUserProfile && (
        <div className="w-[350px] bg-[#111b21] border-l border-[#2a3942] flex flex-col animate-fade-in">
          <div className="h-[60px] bg-[#202c33] px-4 flex items-center text-[#d1d7db]">
            <button onClick={() => setShowUserProfile(false)} className="mr-6 hover:text-white">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h2 className="text-lg font-medium">Contact info</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center py-8 bg-[#111b21] shadow-sm">
              <div className="w-48 h-48 bg-[#4f5e67] rounded-full flex items-center justify-center mb-4">
                <span className="text-6xl text-[#d1d7db] font-bold">{targetUser.username[0].toUpperCase()}</span>
              </div>
              <h2 className="text-2xl text-[#e9edef] font-medium">{targetUser.username}</h2>
              <p className="text-[#8696a0] text-lg">{targetUser.email}</p>
            </div>
            <div className="mt-2 bg-[#111b21] p-4 shadow-sm">
              <h3 className="text-[#00a884] text-sm mb-4">Shared Media</h3>
              <div className="grid grid-cols-3 gap-2">
                {messages.filter(m => m.file && m.file.type.startsWith('image/')).map(m => (
                  <img key={m.id} src={m.file!.data} alt="shared" className="w-full h-24 object-cover rounded" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
