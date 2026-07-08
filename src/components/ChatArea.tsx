import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { User, getCookie } from '../App';
import { Socket } from 'socket.io-client';
import { Send, Paperclip, Mic, Phone, MoreVertical, Shield, Lock, Trash2, Eye, Smile, Video, VideoOff, MicOff, Download, Clock, X, Check, CheckCheck, ArrowLeft, Volume2, UserPlus, UserMinus, ShieldAlert, Loader2, ExternalLink, Flag, UserX, Upload, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { SharedMediaViewer } from './SharedMediaViewer';
import { useModal } from '../contexts/ModalContext';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { encryptData, decryptData, stringToBinary, binaryToString, uint8ToBase64, base64ToUint8, getSha256Key, fastEncrypt, fastDecrypt } from '../utils/crypto';
import { encodeLSB, decodeLSB, createDynamicCarrier, encodeLSB4Bit, decodeLSB4Bit, createDynamicCarrier4Bit, generateMusicCarrier, encodeLSB1Bit, decodeLSB1Bit } from '../utils/stego';
import { generateWallpaperCanvas, encodeImageLSB, decodeImageLSB } from '../utils/imageStego';
import { strToU8, gzipSync, strFromU8, gunzipSync } from 'fflate';
import { saveMessageLocal, getMessagesLocal, deleteMessageLocal, getAllMessagesLocal, importMessagesLocal } from '../utils/db';
import { generateCoverSong } from '../utils/coverSongGenerator';
import { VideoStegoEncoder } from '../utils/VideoStegoEncoder';
import { VideoStegoDecoder } from '../utils/VideoStegoDecoder';
import CryptoJS from 'crypto-js';

const hashBufferHex = (buffer: ArrayBuffer): string => {
  const uint8 = new Uint8Array(buffer);
  const words = [];
  for (let i = 0; i < uint8.length; i += 4) {
    words.push(
      (uint8[i] << 24) |
      ((uint8[i + 1] || 0) << 16) |
      ((uint8[i + 2] || 0) << 8) |
      (uint8[i + 3] || 0)
    );
  }
  const wa = CryptoJS.lib.WordArray.create(words, uint8.length);
  return CryptoJS.SHA256(wa).toString();
};

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
  isBlocked?: boolean;
  onUnblock?: () => void;
  isActive: boolean;
  onResetSession?: () => void;
}

interface Message {
  id: string;
  fromId: string | number;
  toId?: string | number;
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

const ReportModal = ({ onClose, reportedId }: { onClose: () => void, reportedId: number }) => {
  const [reason, setReason] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showModal } = useModal();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files || []);
    if (images.length + files.length > 10) {
       showModal({ title: 'Upload Limit', message: 'Maximum 10 screenshots allowed.', iconType: 'warning' });
       return;
    }
    files.forEach((file: any) => {
      const reader = new FileReader();
      reader.onload = () => {
         setImages(prev => [...prev].slice(0, 9).concat(reader.result as string));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
       showModal({ title: 'Missing Reason', message: 'Please enter a reason for reporting.', iconType: 'warning' });
       return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': getCookie('csrf_token') || ''
        },
        body: JSON.stringify({ reportedId, reason, images }),
        credentials: 'include'
      });
      if (res.ok) {
         showModal({ title: 'Report Sent', message: 'Thank you. This user has been reported and details sent securely to the admin.', iconType: 'success' });
         onClose();
      } else {
         showModal({ title: 'Error', message: 'Error submitting report.', iconType: 'warning' });
      }
    } catch(err) {
      showModal({ title: 'Error', message: 'Error submitting report.', iconType: 'warning' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
     <div className="fixed inset-0 bg-[#0b141a]/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-[#2a3942] shadow-2xl">
           <h2 className="text-xl font-bold text-white mb-4">Report User</h2>
           <p className="text-xs text-[#8696a0] mb-4">Please provide detailed information on why you are reporting this user. Include any relevant screenshots.</p>
           <textarea className="w-full bg-[#111b21] text-white p-3 rounded-lg min-h-[100px] mb-4 outline-none focus:border-[#00a884] border border-transparent" placeholder="Reason for reporting..." value={reason} onChange={e => setReason(e.target.value)}></textarea>
           
           <div className="mb-4">
              <label className="block text-sm text-[#00a884] mb-2 cursor-pointer font-bold w-full text-center py-2 border border-[#00a884] rounded border-dashed hover:bg-[#00a884]/10 transition-colors">
                 + Attach Evidence ({images.length}/10)
                 <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              <div className="flex flex-wrap gap-2 mt-3">
                 {images.map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded overflow-hidden border border-[#2a3942]">
                       <img src={img} className="object-cover w-full h-full" />
                       <button onClick={() => setImages(images.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 bg-red-500/80 hover:bg-red-500 text-white rounded-bl-lg p-0.5"><X className="w-3 h-3" /></button>
                    </div>
                 ))}
              </div>
           </div>
           
           <div className="flex justify-end gap-3 mt-6">
              <button disabled={isSubmitting} onClick={onClose} className="px-4 py-2 text-[#8696a0] hover:text-white transition-colors">Cancel</button>
              <button disabled={isSubmitting} onClick={handleSubmit} className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition-colors shadow-lg">
                  {isSubmitting ? 'Reporting...' : 'Submit Report'}
              </button>
           </div>
        </div>
     </div>
  );
};




const DataManagementModal = ({ onClose, sessionInfo, targetUser }: { onClose: () => void, sessionInfo: any, targetUser: any }) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportOption, setExportOption] = useState<'full_media' | 'full_text' | 'range_media' | 'range_text'>('full_media');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewMsgs, setPreviewMsgs] = useState<any[]>([]);
  const [exportLog, setExportLog] = useState<string[]>([]);
  const { showModal } = useModal();

  const validatePassword = (pass: string) => {
    if (!pass) return '';
    if (pass.length < 8) return 'Must be at least 8 characters.';
    if (!/[A-Z]/.test(pass)) return 'Must contain a capital letter.';
    if (!/[a-z]/.test(pass)) return 'Must contain a lowercase letter.';
    if (!/[0-9]/.test(pass)) return 'Must contain a number.';
    if (!/[^A-Za-z0-9]/.test(pass)) return 'Must contain a special character.';
    return '';
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPass = e.target.value;
    setPassword(newPass);
    if (activeTab === 'export') {
      setPasswordError(validatePassword(newPass));
    } else {
      setPasswordError('');
    }
  };

  const generateSecurePassword = () => {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const num = '0123456789';
    const special = '!@#$%^&*()_+';
    const all = upper + lower + num + special;
    
    let newPass = '';
    newPass += upper.charAt(Math.floor(Math.random() * upper.length));
    newPass += lower.charAt(Math.floor(Math.random() * lower.length));
    newPass += num.charAt(Math.floor(Math.random() * num.length));
    newPass += special.charAt(Math.floor(Math.random() * special.length));
    
    for (let i = 4; i < 16; i++) {
      newPass += all.charAt(Math.floor(Math.random() * all.length));
    }
    
    // Shuffle
    newPass = newPass.split('').sort(() => 0.5 - Math.random()).join('');
    
    setPassword(newPass);
    setPasswordError('');
  };

  useEffect(() => {
    const fetchPreview = async () => {
      const msgs = await getAllMessagesLocal();
      let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
      
      if (exportOption === 'range_media' || exportOption === 'range_text') {
        if (startDate && endDate) {
          const startTs = new Date(startDate).setHours(0,0,0,0);
          const endTs = new Date(endDate).setHours(23,59,59,999);
          filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
        } else {
          filteredMsgs = [];
        }
      }

      if (exportOption === 'full_text' || exportOption === 'range_text') {
        filteredMsgs = filteredMsgs.map(m => {
          const { file, encryptedFile, ...rest } = m as any;
          return rest as any;
        });
      }
      

      const previewSlice = filteredMsgs.slice(-5).map(m => {
        const pMsg = { ...m } as any;
        if (pMsg.encryptedText) {
          pMsg.text = decryptData(pMsg.encryptedText, sessionInfo.pin) || '';
        }
        if (pMsg.encryptedFile) {
          pMsg.file = { type: 'media' };
        }
        return pMsg;
      });
      setPreviewMsgs(previewSlice); // show last 5 msgs as preview
    };
    fetchPreview();
  }, [exportOption, startDate, endDate, sessionInfo.sessionId, sessionInfo.pin]);

  const [exportEstimate, setExportEstimate] = useState<{ msgs: number, media: number, sizeBytes: number, format: string, reason: string } | null>(null);

  useEffect(() => {
    const calc = async () => {
       try {
         const msgs = await getAllMessagesLocal();
         let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
         if (exportOption === 'range_media' || exportOption === 'range_text') {
           const startTs = startDate ? new Date(startDate).setHours(0,0,0,0) : 0;
           const endTs = endDate ? new Date(endDate).setHours(23,59,59,999) : Infinity;
           filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
         }
         if (exportOption === 'full_text' || exportOption === 'range_text') {
           filteredMsgs = filteredMsgs.map(m => {
             const { file, encryptedFile, ...rest } = m as any;
             return rest as any;
           });
         }
         const mediaCount = filteredMsgs.filter(m => !!(m as any).file || !!(m as any).encryptedFile).length;
         const payloadStr = JSON.stringify({ backupId: "est", messages: filteredMsgs });
         // Account for Base64 (1.33x) and AES Base64 (1.33x) expansion: 1.33 * 1.33 = ~1.77
         const estSize = Math.floor(payloadStr.length * (mediaCount > 0 ? 0.95 : 0.3) * 1.77);
         
         let format = "Audio File (.wav)";
         let reason = "Your chat is small enough to be hidden inside a ringtone audio file.";
         // 4K image can hold exactly ~3.11 MB of data. 
         if (estSize > 3 * 1024 * 1024) {
           format = "Encrypted Data File (.dat)";
           reason = "Your chat contains large media files. It will be exported as an encrypted data file to prevent crashing.";
         } else if (estSize > 1024 * 1024) {
           format = "Image File (.png)";
           reason = "Your chat contains some media. It will be hidden inside a 4K wallpaper image.";
         }
         
         setExportEstimate({ msgs: filteredMsgs.length, media: mediaCount, sizeBytes: estSize, format, reason });
       } catch (err: any) {
         console.error("Estimation failed", err);
         setExportEstimate({ msgs: 0, media: 0, sizeBytes: 0, format: "Error", reason: err.message || "Failed to estimate size" });
       }
    };
    calc();
  }, [exportOption, startDate, endDate, sessionInfo.sessionId]);

  const handleExport = async () => {
    if ((exportOption === 'range_media' || exportOption === 'range_text') && (!startDate || !endDate)) {
      showModal({ title: 'Export Error', message: 'Please select start and end dates.', iconType: 'warning' });
      return;
    }
    if (!password) {
      showModal({ title: 'Export Error', message: 'Please enter an export password to encrypt the backup.', iconType: 'warning' });
      return;
    }
    
    setIsProcessing(true);
    setExportLog([]);
    const log = (msg: string) => setExportLog(prev => [...prev, msg]);

    try {
       log("[1/6] Loading messages from local database...");
       const msgs = await getAllMessagesLocal();
       let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
       
       if (exportOption === 'range_media' || exportOption === 'range_text') {
         const startTs = new Date(startDate).setHours(0,0,0,0);
         const endTs = new Date(endDate).setHours(23,59,59,999);
         filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       }
       if (exportOption === 'full_text' || exportOption === 'range_text') {
         filteredMsgs = filteredMsgs.map(m => {
           const { file, encryptedFile, ...rest } = m as any;
           return rest as any;
         });
       }
       if (filteredMsgs.length === 0) {
          showModal({ title: 'No Messages', message: 'No messages found to export.', iconType: 'warning' });
          setIsProcessing(false);
          return;
       }
       const mediaCount = filteredMsgs.filter(m => !!(m as any).file || !!(m as any).encryptedFile).length;
       log(`  ✅ Found ${filteredMsgs.length} messages (${mediaCount} with media)`);
       
       log("[2/6] Compressing data...");

       
       const backupPayload = {
         backupId: Date.now() + "_" + Math.random().toString(36).substring(2, 10),
         messages: filteredMsgs
       };
       const jsonString = JSON.stringify(backupPayload);
       const compressed = gzipSync(strToU8(jsonString), { level: 9 });
       log(`  ✅ Raw: ${(jsonString.length/1024).toFixed(1)} KB → Compressed: ${(compressed.byteLength/1024).toFixed(1)} KB`);
       
       log("[3/6] Encrypting with password...");
       const base64Data = uint8ToBase64(compressed);
       const encryptedData = encryptData(base64Data, password);
       const binaryEncryptedData = stringToBinary(encryptedData);
       log("  ✅ Encryption complete");
       
       const dateStr = new Date().toISOString().split('T')[0];
       const sizeBytes = encryptedData.length;
       
       let finalBlob: Blob;
       let filename = '';

       if (sizeBytes > 3 * 1024 * 1024) {
         // Tier 3: .dat Encrypted File
         log("[4/6] Payload too large for media. Packaging as encrypted file...");
         log("[5/6] Writing binary data...");
         finalBlob = new Blob([encryptedData], { type: 'application/octet-stream' });
         filename = `app_data_${dateStr}.dat`;
       } else if (sizeBytes > 1024 * 1024) {
         // Tier 2: .png Image Steganography
         log("[4/6] Fetching high-quality stock photo...");

         const canvas = await generateWallpaperCanvas();
         log("[5/6] Embedding data into image pixels...");
         finalBlob = await encodeImageLSB(canvas, binaryEncryptedData, password);
         filename = `photo_${dateStr}.png`;
       } else {
         // Tier 1: .wav Audio Steganography
         log("[4/6] Generating procedural audio carrier...");

         const carrier = await generateMusicCarrier(binaryEncryptedData.length);
         log("[5/6] Embedding data into audio track...");
         const finalBuffer = encodeLSB1Bit(carrier.buffer, binaryEncryptedData, password);
         finalBlob = new Blob([finalBuffer], { type: 'audio/wav' });
         const innocentNames = ['ringtone', 'notification_tone', 'alarm_sound', 'voice_memo'];
         const pickedName = innocentNames[Math.floor(Math.random() * innocentNames.length)];
         filename = `${pickedName}_${dateStr}.wav`;
       }
       
       log(`[6/6] Download ready! ✅ ${filename}`);
       
       const url = URL.createObjectURL(finalBlob);
       const a = document.createElement('a');
       a.href = url;
       a.download = filename;
       a.click();
       setTimeout(() => URL.revokeObjectURL(url), 1000);
       showModal({ title: 'Export Successful', message: 'Successfully exported chats.', iconType: 'success' });
    } catch(e) {
       console.error(e);
       showModal({ title: 'Export Failed', message: 'Failed to export chats.', iconType: 'warning' });
    }
    setIsProcessing(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!password) {
      showModal({ title: 'Import Error', message: 'Please enter the import password first.', iconType: 'warning' });
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      

      
      const isLegacyFormat = file.name.endsWith('.stego');
      const isDatFormat = file.name.endsWith('.dat');
      const isPngFormat = file.name.endsWith('.png');
      
      let extractedBinaryData = '';
      
      if (isDatFormat) {
         // Tier 3: Direct text read
         const decoder = new TextDecoder();
         extractedBinaryData = decoder.decode(arrayBuffer);
      } else if (isPngFormat) {
         // Tier 2: Image LSB Decode

         const img = new Image();
         const blob = new Blob([arrayBuffer]);
         const url = URL.createObjectURL(blob);
         await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
         });
         extractedBinaryData = decodeImageLSB(img, password);
         URL.revokeObjectURL(url);
      } else {
         // Tier 1: Audio LSB Decode

         if (isLegacyFormat) {
            extractedBinaryData = decodeLSB4Bit(arrayBuffer);
         } else {
            extractedBinaryData = decodeLSB1Bit(arrayBuffer, password);
         }
      }
      
      const encryptedData = binaryToString(extractedBinaryData);
      const base64Data = decryptData(encryptedData, password);
      
      if (!base64Data) {
         throw new Error("Invalid password or corrupted stego file.");
      }
      
      const uint8 = base64ToUint8(base64Data);
      
      const decompressed = gunzipSync(uint8);
      const jsonString = strFromU8(decompressed);
      const payload = JSON.parse(jsonString);
      
      let msgs;
      let backupId = null;
      
      if (Array.isArray(payload)) {
         // Legacy backward compatibility for old backups
         msgs = payload;
      } else if (payload && payload.messages) {
         msgs = payload.messages;
         backupId = payload.backupId;
      } else {
         throw new Error("Invalid backup format");
      }
      
      if (backupId) {
         const usedBackups = JSON.parse(localStorage.getItem('stego_used_backups') || '[]');
         if (usedBackups.includes(backupId)) {
            throw new Error("This backup file has already been imported and cannot be used again.");
         }
         usedBackups.push(backupId);
         localStorage.setItem('stego_used_backups', JSON.stringify(usedBackups));
      }
      
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      showModal({ title: 'Import Successful', message: `Successfully imported ${msgs.length} messages! Reloading...`, iconType: 'success' });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      console.error(err);
      showModal({ title: 'Import Failed', message: 'Failed to import chats: ' + err.message, iconType: 'warning' });
    }
    setIsProcessing(false);
    e.target.value = '';
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm">
       <div className="bg-[#202c33] rounded-xl w-full max-w-4xl h-[600px] border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-[#2a3942]">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Data Management</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="flex flex-1 overflow-hidden">
             {/* Left Box (Tabs) */}
             <div className="w-1/4 bg-[#111b21] border-r border-[#2a3942] flex flex-col p-4 space-y-2">
                <button 
                  onClick={() => setActiveTab('export')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'export' ? 'bg-[#2a3942] text-[#00a884]' : 'text-[#e9edef] hover:bg-[#202c33]'}`}
                >
                  Export
                </button>
                <button 
                  onClick={() => setActiveTab('import')}
                  className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'import' ? 'bg-[#2a3942] text-[#00a884]' : 'text-[#e9edef] hover:bg-[#202c33]'}`}
                >
                  Import
                </button>
             </div>
             
             {/* Middle/Right Area */}
             <div className="flex-1 p-6 flex flex-col overflow-y-auto bg-[#0b141a]">
                {activeTab === 'export' ? (
                   <div className="flex flex-col md:flex-row gap-6 h-full">
                      {/* Options Box */}
                      <div className="flex-1 flex flex-col space-y-6">
                         <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-4">
                           <h3 className="text-white font-medium mb-2 border-b border-[#2a3942] pb-2">Export Options</h3>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="full_media" checked={exportOption === 'full_media'} onChange={() => setExportOption('full_media')} className="accent-[#00a884] w-4 h-4" />
                             <span>Full Chat Export</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="full_text" checked={exportOption === 'full_text'} onChange={() => setExportOption('full_text')} className="accent-[#00a884] w-4 h-4" />
                             <span>Full Chat Export (Text Only)</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="range_media" checked={exportOption === 'range_media'} onChange={() => setExportOption('range_media')} className="accent-[#00a884] w-4 h-4" />
                             <span>Select the Dates with Media</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="range_text" checked={exportOption === 'range_text'} onChange={() => setExportOption('range_text')} className="accent-[#00a884] w-4 h-4" />
                             <span>Select the Dates with Text Only</span>
                           </label>
                         </div>
                         
                         {(exportOption === 'range_media' || exportOption === 'range_text') && (
                           <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-4 animate-fade-in">
                              <h3 className="text-white font-medium mb-2 border-b border-[#2a3942] pb-2">Date Range</h3>
                              <div className="flex gap-4">
                                <div className="flex-1">
                                   <label htmlFor="export-start-date" className="text-xs text-[#8696a0] mb-1 block uppercase font-bold">From Date</label>
                                   <input id="export-start-date" name="startDate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-[#3a4a54] focus:border-[#00a884]" />
                                </div>
                                <div className="flex-1">
                                   <label htmlFor="export-end-date" className="text-xs text-[#8696a0] mb-1 block uppercase font-bold">To Date</label>
                                   <input id="export-end-date" name="endDate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-[#3a4a54] focus:border-[#00a884]" />
                                </div>
                              </div>
                           </div>
                         )}
                         
                         {exportEstimate && !isProcessing && (
                           <div className="bg-[#202c33] p-4 rounded-xl border border-[#2a3942] space-y-2 text-sm text-[#e9edef] animate-fade-in">
                             <div className="font-bold border-b border-[#2a3942] pb-2 text-[#00a884]">📊 Export Preview</div>
                             <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                               <div className="text-[#8696a0]">Messages:</div><div>{exportEstimate.msgs}</div>
                               <div className="text-[#8696a0]">Media Files:</div><div>{exportEstimate.media}</div>
                                <div className="text-[#8696a0]">Est. Size:</div><div>{exportEstimate.sizeBytes > 1024 * 1024 ? (exportEstimate.sizeBytes / (1024 * 1024)).toFixed(2) + ' MB' : (exportEstimate.sizeBytes / 1024).toFixed(1) + ' KB'}</div>
                             </div>
                             <div className="bg-[#111b21] p-3 rounded mt-2 border border-[#2a3942]">
                               <div className="font-bold flex items-center gap-2 mb-1">
                                 {exportEstimate.format.includes('Audio') ? '🎵' : exportEstimate.format.includes('Image') ? '🖼️' : '🔒'} {exportEstimate.format}
                               </div>
                               <div className="text-xs text-[#8696a0]">{exportEstimate.reason}</div>
                             </div>
                           </div>
                         )}

                         {isProcessing && exportLog.length > 0 && (
                            <div className="flex-shrink-0 bg-[#111b21] p-4 rounded-xl border border-[#00a884] space-y-3 font-mono text-[10px] sm:text-xs text-[#00a884] max-h-64 overflow-y-auto animate-fade-in">
                              {(() => {
                                const latestStepMatch = [...exportLog].reverse().find(l => l.match(/\[(\d+)\/6\]/));
                                const currentStep = latestStepMatch ? parseInt(latestStepMatch.match(/\[(\d+)\/6\]/)![1]) : 0;
                                const progressPercent = exportLog[exportLog.length - 1].includes('Download ready! ✅') ? 100 : Math.round((currentStep / 6) * 100);
                                return (
                                  <div className="mb-2">
                                    <div className="flex justify-between items-center mb-1 text-xs font-bold text-[#00a884]">
                                      <span>Export Progress</span>
                                      <span>{progressPercent}%</span>
                                    </div>
                                    <div className="w-full bg-[#202c33] rounded-full h-2 overflow-hidden border border-[#2a3942]">
                                      <div 
                                        className="bg-[#00a884] h-2 rounded-full transition-all duration-500 ease-out" 
                                        style={{ width: `${progressPercent}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                );
                              })()}
                              <div className="space-y-1">
                                {exportLog.map((log, idx) => (
                                  <div key={idx} className="flex items-center gap-2">
                                    <span>{log}</span>
                                    {idx === exportLog.length - 1 && !log.includes('✅') && (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                         <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-2 mt-auto">
                            <div className="flex justify-between items-center">
                              <label className="text-xs text-[#8696a0] block uppercase font-bold">Export Password</label>
                              <button onClick={generateSecurePassword} className="text-xs text-[#00a884] hover:text-[#06cf9c] font-bold">Auto-Generate</button>
                            </div>
                            <input type="text" placeholder="Enter complex password" value={password} onChange={handlePasswordChange} className={`w-full bg-[#111b21] text-[#e9edef] p-3 text-sm rounded outline-none border ${passwordError && activeTab === 'export' ? 'border-red-500' : 'border-[#2a3942] focus:border-[#00a884]'}`} />
                            {passwordError && activeTab === 'export' && <p className="text-red-500 text-xs">{passwordError}</p>}
                            <div className="pt-2">
                              <button onClick={handleExport} disabled={isProcessing || !!passwordError || !password} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold rounded shadow-lg disabled:opacity-50 transition-colors">
                                 {isProcessing ? 'Processing...' : 'Export File'}
                              </button>
                            </div>
                         </div>
                      </div>
                      
                      {/* Preview Box */}
                      <div className="w-[300px] flex flex-col">
                         <div className="bg-[#202c33] rounded-xl border border-[#2a3942] flex-1 flex flex-col overflow-hidden">
                            <h3 className="text-white font-medium p-4 border-b border-[#2a3942] bg-[#111b21]">Preview of Chat</h3>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0b141a]">
                              {previewMsgs.length === 0 ? (
                                <p className="text-[#8696a0] text-sm text-center mt-10">No messages in selection</p>
                              ) : (
                                previewMsgs.map((m, i) => (
                                  <div key={i} className={`max-w-[90%] rounded-lg p-2 text-sm ${m.sender_id === sessionInfo.userId ? 'bg-[#005c4b] ml-auto text-[#e9edef]' : 'bg-[#202c33] text-[#e9edef]'}`}>
                                    {m.text && <p>{m.text}</p>}
                                    {m.file && <span className="text-xs opacity-70 flex items-center"><Download className="w-3 h-3 mr-1"/> Media ({m.file.type ? m.file.type.split('/')[0] : 'file'})</span>}
                                  </div>
                                ))
                              )}
                            </div>
                         </div>
                      </div>
                   </div>
                 ) : (
                   <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto w-full space-y-8 animate-fade-in">
                      <div className="text-center">
                         <Upload className="w-16 h-16 text-[#00a884] mx-auto mb-4 opacity-80" />
                         <h3 className="text-2xl text-white font-bold mb-2">Import Backup</h3>
                         <p className="text-[#8696a0] text-sm">Select a .wav, .png, or .dat file to merge into this chat.</p>
                      </div>
                      
                      <div className="w-full bg-[#202c33] p-6 rounded-xl border border-[#2a3942] space-y-6">
                          <div>
                             <label htmlFor="import-password" className="text-xs text-[#8696a0] mb-2 block uppercase font-bold">Import Password</label>
                             <input id="import-password" name="importPassword" type="password" placeholder="Enter file password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#111b21] text-[#e9edef] p-3 text-sm rounded outline-none border border-[#2a3942] focus:border-[#00a884]" />
                          </div>
                         
                         <label className={`w-full py-4 ${!password ? 'bg-[#111b21] opacity-50 cursor-not-allowed border-[#2a3942]' : 'bg-[#2a3942] hover:bg-[#3a4952] cursor-pointer border-[#00a884] shadow-lg'} text-[#e9edef] border border-dashed rounded-xl flex flex-col items-center justify-center transition-all`}>
                            {isProcessing ? 'Importing...' : (
                              <>
                                <div className="w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center mb-2">
                                  <span className="text-white font-bold text-xl">+</span>
                                </div>
                                <span className="font-bold">Import the chat</span>
                              </>
                            )}
                            <input type="file" accept=".wav,audio/wav,.png,image/png,.dat,.stego" className="hidden" onChange={handleImport} disabled={isProcessing || !password} />
                         </label>
                      </div>
                   </div>
                )}
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};

export function ChatArea({ user, targetUser, socket, sessionInfo, isOnline, pendingCall, clearPendingCall, dbSession, onBack, isBlocked, onUnblock, isActive, onResetSession }: ChatAreaProps) {
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
  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);
  const [isHovering, setIsHovering] = useState<number | null>(null);
  const [hashedMyId, setHashedMyId] = useState<string>('');

  useEffect(() => {
     import('../utils/crypto').then(m => m.hashString(user.id.toString()).then(setHashedMyId));
  }, [user.id]);

  const isMine = (msg: any) => msg.fromId === user.id || msg.fromId === user.id.toString() || msg.fromId === hashedMyId;

  const [callerId, setCallerId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [scanningStatus, setScanningStatus] = useState<{ active: boolean, type: 'link' | 'document' | null, name: string }>({ active: false, type: null, name: '' });
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownView, setDropdownView] = useState<'main' | 'export'>('main');
  const [activeMessageMenu, setActiveMessageMenu] = useState<string | null>(null);
  const [actionMenuMsgId, setActionMenuMsgId] = useState<string | null>(null);
  const [exportType, setExportType] = useState<'full' | 'range'>('full');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportLog, setExportLog] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);
  const [showSharedMedia, setShowSharedMedia] = useState(false);
  const [recoveryProgress, setRecoveryProgress] = useState<number | null>(null);
  const { showModal } = useModal();

  const [showReportModal, setShowReportModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  
  const [pipVideoEl, setPipVideoEl] = useState<HTMLVideoElement | null>(null);
  const [localVidPos, setLocalVidPos] = useState<{ x: number | 'auto'; y: number | 'auto' }>({ x: 'auto', y: 'auto' });
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callOverlayRef = useRef<HTMLDivElement>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // --- STEGANOGRAPHY CALL REFS ---
  const coverSongRef = useRef<Float32Array | null>(null);
  const stealthWorkletRef = useRef<AudioWorkletNode | null>(null);
  const stealthAudioCtxRef = useRef<AudioContext | null>(null);
  const workletModuleLoadedRef = useRef<boolean>(false); // track if addModule already done for this ctx
  const callStartTimeRef = useRef<number>(0);
  const videoEncoderRef = useRef<VideoStegoEncoder | null>(null);
  const videoDecoderRef = useRef<VideoStegoDecoder | null>(null);
  const collectedAudioBitsRef = useRef<number[]>([]);
  const expectedAudioBitsLengthRef = useRef<number>(0);
  const decodedVideoCanvasRef = useRef<HTMLCanvasElement>(null);
  const voiceQueueRef = useRef<number[]>([]);
  const isCallAcceptingRef = useRef<boolean>(false);
  const isCallStartingRef = useRef<boolean>(false);
  const derivedKeysRef = useRef<{ key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray; pin: string } | null>(null);
  const getDerivedKeys = (pin: string) => {
    if (derivedKeysRef.current && derivedKeysRef.current.pin === pin) {
      return derivedKeysRef.current;
    }
    const key = getSha256Key(pin);
    const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
    derivedKeysRef.current = { key, iv, pin };
    return derivedKeysRef.current;
  };
  const callIdRef = useRef<string | null>(null);
  const endedCallIdsRef = useRef<Set<string>>(new Set());
  const clockOffsetRef = useRef<number | null>(null);
  const mainCoverIndexRef = useRef<number>(0);
  const audioSeqRef = useRef<number>(0);
  const audioTsRef = useRef<number>(0);

  const [currentResolution, setCurrentResolution] = useState<'240p' | '480p'>('240p');
  const [targetFps, setTargetFpsState] = useState<5 | 10 | 15 | 30>(10);
  const currentResolutionRef = useRef<'240p' | '480p'>('240p');
  const targetFpsRef = useRef<5 | 10 | 15 | 30>(10);
  const consecutiveSlowFramesRef = useRef<number>(0);
  const lastSettingsChangeTimeRef = useRef<number>(0);
  const currentRttRef = useRef<number>(0);

  const isMobileDevice = () => {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  };

  const applyStegoSettings = (resolution: '240p' | '480p', fps: 5 | 10 | 15 | 30) => {
    currentResolutionRef.current = resolution;
    targetFpsRef.current = fps;
    setCurrentResolution(resolution);
    setTargetFpsState(fps);
    lastSettingsChangeTimeRef.current = performance.now();

    if (videoEncoderRef.current) {
      videoEncoderRef.current.setResolution(resolution);
      videoEncoderRef.current.setTargetFps(fps);
    }
    if (videoDecoderRef.current) {
      videoDecoderRef.current.setResolution(resolution);
    }
  };

  const checkAdaptiveStegoEngine = async (frameDurationMs: number, source: 'encode' | 'decode') => {
    if (isMobileDevice()) {
      return;
    }
    const rtt = currentRttRef.current;
    let batteryLevel = 1.0;
    let batteryCharging = true;
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        batteryLevel = battery.level;
        batteryCharging = battery.charging;
      } catch (e) {}
    }

    const isBatterySaver = !batteryCharging && batteryLevel < 0.3;
    const now = performance.now();
    const cooldownTime = 15000; // 15 seconds
    const timeSinceLastChange = now - lastSettingsChangeTimeRef.current;

    if (isBatterySaver) {
      if (currentResolutionRef.current !== '240p' || targetFpsRef.current !== 5) {
        console.warn(`[Stealth-Adaptive] Low battery (${Math.round(batteryLevel * 100)}%) and not charging. Forcing Battery Saver Mode (240p @ 5fps).`);
        applyStegoSettings('240p', 5);
      }
      return;
    }

    const profiles: { resolution: '240p' | '480p'; fps: 5 | 10 | 15 | 30 }[] = [
      { resolution: '240p', fps: 5 },
      { resolution: '240p', fps: 10 },
      { resolution: '240p', fps: 15 },
      { resolution: '240p', fps: 30 },
      { resolution: '480p', fps: 15 },
      { resolution: '480p', fps: 30 }
    ];

    const currentProfileIdx = profiles.findIndex(p => p.resolution === currentResolutionRef.current && p.fps === targetFpsRef.current);

    const isCpuOverloaded = frameDurationMs > 25;
    const isNetworkCongested = rtt > 180;

    if (isCpuOverloaded || isNetworkCongested) {
      consecutiveSlowFramesRef.current += 1;
      if (consecutiveSlowFramesRef.current >= 5) {
        consecutiveSlowFramesRef.current = 0;
        if (timeSinceLastChange > cooldownTime && currentProfileIdx > 0) {
          const nextProfile = profiles[currentProfileIdx - 1];
          console.warn(`[Stealth-Adaptive] Performance drop (Frame: ${frameDurationMs.toFixed(1)}ms, RTT: ${rtt.toFixed(1)}ms). Downgrading to ${nextProfile.resolution} @ ${nextProfile.fps}fps.`);
          applyStegoSettings(nextProfile.resolution, nextProfile.fps);
        }
      }
    } else {
      if (frameDurationMs < 12 && rtt < 100 && (batteryCharging || batteryLevel > 0.4)) {
        consecutiveSlowFramesRef.current = 0;
        if (timeSinceLastChange > cooldownTime && currentProfileIdx >= 0 && currentProfileIdx < profiles.length - 1) {
          const nextProfile = profiles[currentProfileIdx + 1];
          console.log(`[Stealth-Adaptive] Performance healthy (Frame: ${frameDurationMs.toFixed(1)}ms, RTT: ${rtt.toFixed(1)}ms). Upgrading to ${nextProfile.resolution} @ ${nextProfile.fps}fps.`);
          applyStegoSettings(nextProfile.resolution, nextProfile.fps);
        }
      }
    }
  };

  useEffect(() => {
    let intervalId: any;
    if (callState === 'connected') {
      console.log("[Stealth-RTP] Starting periodic RTT measurement pings...");
      intervalId = setInterval(() => {
        socket.emit('stealth_ping', { startTime: performance.now() });
      }, 5000);
    }
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [callState, socket]);

  const isDraggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isInitialLoad = useRef(true);

  useEffect(() => {
    isInitialLoad.current = true;
  }, [sessionInfo.sessionId]);

  const setupPeerConnectionListeners = (pc: RTCPeerConnection, isVideo: boolean) => {
    pc.onconnectionstatechange = () => {
      if (pc !== peerConnectionRef.current) {
        console.warn("[Stealth-Call] Connection state change event from obsolete PeerConnection ignored.");
        return;
      }
      const state = pc.connectionState;
      console.log("[Stealth-Call] WebRTC connection state changed to:", state);
      if (state === 'connected') {
        setWebrtcConnected(true);
        setMessages(prev => {
          const systemMsgText = isVideo ? '🔒 Secure video call established.' : '🔒 Secure audio call established.';
          if (prev.some(m => m.fromId === 'system' && m.text === systemMsgText)) return prev;
          return [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            fromId: "system",
            text: systemMsgText,
            timestamp: Date.now(),
            isSelfDestruct: false,
            isOneTime: false,
            timerSeconds: 0,
            isRevealed: true,
          }];
        });
      } else if (state === 'failed' || state === 'closed') {
        console.warn("[Stealth-Call] WebRTC connection failed or closed. Ending call. State:", state);
        if (callStateRef.current === 'connected' || state === 'closed') {
          endCall(true);
        }
      }
    };
  };

  useEffect(() => {
    if (!isActive) return;
    // Load local messages
    const loadLocalMessages = async () => {
      try {
        const localMsgs = await getMessagesLocal(sessionInfo.sessionId);
        const decryptedMsgs: Message[] = [];
        const toDeleteIds: string[] = [];
        const now = Date.now();
        const total = localMsgs.length;

        // Fetch a backup PIN from the local vault. This is the RSA-encrypted copy saved
        // by session_pins. We decrypt it here as a plain AES key string so we can use it
        // as a fallback if the current sessionInfo.pin fails on any stored message.
        let vaultFallbackPin: string | null = null;
        try {
          const { getPinLocal, getPrivateKeyLocal } = await import('../utils/db');
          const { decryptPINWithPrivateKey } = await import('../utils/e2ee');
          const encLocalPin = await getPinLocal(sessionInfo.sessionId);
          if (encLocalPin) {
            const privKey = user.privateKey
              || sessionStorage.getItem('stego_priv_key_' + user.id.toString())
              || await getPrivateKeyLocal(user.id.toString())
              || null;
            if (privKey) {
              const plain = await decryptPINWithPrivateKey(encLocalPin, privKey);
              if (plain && plain !== 'DECRYPTION_FAILED' && plain !== 'UNENCRYPTED') {
                vaultFallbackPin = plain;
              }
            }
          }
        } catch (e) {
          // Non-fatal: vault PIN fallback is best-effort
          console.debug('[Recovery] Could not load vault fallback PIN:', e);
        }
        
        if (total > 0) {
          setRecoveryProgress(0);
          const batchSize = 30;
          for (let i = 0; i < total; i++) {
            const msg = localMsgs[i];
            if (msg.expiresAt && msg.expiresAt < now) {
              toDeleteIds.push(msg.id);
              continue;
            }
            if (msg.isSelfDestruct) {
              toDeleteIds.push(msg.id);
              continue;
            }
            let text = '';
            if (msg.encryptedText) {
              text = decryptData(msg.encryptedText, sessionInfo.pin) || '';
              // Fallback: if current PIN produced nothing, try the local vault PIN.
              // This handles cases where re-encryption after a PIN change was incomplete.
              if (!text && vaultFallbackPin && vaultFallbackPin !== sessionInfo.pin) {
                text = decryptData(msg.encryptedText, vaultFallbackPin) || '';
              }
            }
            let file;
            if (msg.encryptedFile) {
              try {
                let decFile = decryptData(msg.encryptedFile, sessionInfo.pin);
                if (!decFile && vaultFallbackPin && vaultFallbackPin !== sessionInfo.pin) {
                  decFile = decryptData(msg.encryptedFile, vaultFallbackPin);
                }
                if (decFile) file = JSON.parse(decFile);
              } catch (e) {
                console.error("Failed to parse decrypted file payload", e);
              }
            }

            // Drop and clean up if it is a covert signaling message (e.g. legacy signaling residues in DB)
            if (text && (text.includes('"type":"stego_call_') || text.startsWith('{"type":"stego_'))) {
              toDeleteIds.push(msg.id);
              continue;
            }

            // Drop and clean up ANY Gzip-compressed base64 residue (H4sI prefix = always stego signaling)
            if (text && text.startsWith('H4sI')) {
              toDeleteIds.push(msg.id);
              continue;
            }

            // Drop if both text and file are empty/undefined (indicates failed decryption or empty signaling message)
            if (!text && !file) {
              continue;
            }

            decryptedMsgs.push({
              id: msg.id,
              fromId: msg.fromId,
              toId: msg.toId,
              text,
              timestamp: msg.timestamp,
              isSelfDestruct: msg.isSelfDestruct,
              expiresAt: msg.expiresAt,
              file
            });

            if (i > 0 && i % batchSize === 0) {
              setRecoveryProgress(Math.round((i / total) * 100));
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          setRecoveryProgress(100);
          await new Promise(resolve => setTimeout(resolve, 300));
          setRecoveryProgress(null);
        }
        
        setMessages(decryptedMsgs);

        // Perform batch deletes asynchronously in the background to avoid UI block
        if (toDeleteIds.length > 0) {
          import('../utils/db').then(m => {
            m.deleteMessagesLocal(toDeleteIds).catch(err => {
              console.error("Failed background DB cleanup", err);
            });
          });
        }
      } catch (err) {
        console.error("Failed to load local messages", err);
      }
    };
    loadLocalMessages();
  }, [sessionInfo.sessionId, sessionInfo.pin, isActive]);

  const addMessageLocal = async (msg: Message) => {
    try {
      if (msg.isSelfDestruct) return; // Never save disappearing messages
      const duration = localStorage.getItem('duration_' + sessionInfo.sessionId) || 'permanent';
      let expiresAt = msg.expiresAt;
      if (duration === '24h' && !expiresAt) {
         expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      }
      
      const encryptedText = msg.text ? encryptData(msg.text, sessionInfo.pin) : '';
      const encryptedFile = msg.file ? encryptData(JSON.stringify(msg.file), sessionInfo.pin) : undefined;
      
      await saveMessageLocal({
        id: msg.id,
        sessionId: sessionInfo.sessionId,
        fromId: msg.fromId.toString(),
        toId: (isMine(msg) ? targetUser.id : user.id).toString(),
        encryptedText: encryptedText,
        encryptedFile,
        timestamp: msg.timestamp,
        isSelfDestruct: !!msg.isSelfDestruct,
        expiresAt: expiresAt
      });
    } catch (e) {
      console.error("Failed to save local message", e);
    }
  };

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

  const handleBlockUser = async () => {
    if (!window.confirm("Are you sure you want to block this user? They will not be able to message or call you again.")) return;
    setIsBlocking(true);
    try {
      const res = await fetch('/api/block', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': getCookie('csrf_token') || ''
        },
        body: JSON.stringify({ targetId: targetUser.id }),
        credentials: 'include'
      });
      if (res.ok) {
         showModal({ title: 'User Blocked', message: 'User blocked successfully.', iconType: 'success' });
         onBack?.();
      }
    } catch(e) { console.error(e); }
    setIsBlocking(false);
  };

  const onEmojiClick = (emojiObject: any) => {
    setInputText(prev => prev + emojiObject.emoji);
  };

  useEffect(() => {
    if (!socket) return;
    if (!isActive && callState === 'idle') return;

    const handleReceive = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      if (data.fromId === user.id || data.fromId === user.id.toString() || data.fromId === hashedMyId) {
        if (data.isStegoSignaling) {
          console.log("[Stealth-Signaling] Ignoring self-sent signaling packet.");
          return;
        }
      }
      if (sessionInfo.pin === 'DECRYPTION_FAILED') {
        console.warn('[E2EE] Discarding incoming message/signal: PIN decryption failed state');
        return;
      }
      // Deduplicate: if this msgId was already processed (e.g. offline re-delivery), skip
      if (data.msgId) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.msgId)) return prev;
          return prev; // defer actual add to below
        });
      }
      try {
        // 1. Receive Audio Carrier (base64)
        const bytes = base64ToUint8(data.audioBase64);
        const audioData = bytes.buffer;
        
        // 2. Extract Hidden Binary — uses sequential LSB decoder to match encodeLSB in handleSendMessage
        const binary = decodeLSB(audioData);
        
        // 3. Convert Binary to Encrypted Text
        const encryptedText = binaryToString(binary);
        
        // 4. Decrypt using Session PIN
        if (data.isStegoSignaling) {
          console.warn("[Stego-Signaling] Decrypting signaling payload with PIN:", sessionInfo.pin, "Ciphertext length:", encryptedText.length);
        }
        const decrypted = decryptData(encryptedText, sessionInfo.pin);
        if (!decrypted && data.isStegoSignaling) {
          console.warn("[Stego-Signaling] Decryption failed for signaling payload! Ciphertext:", encryptedText);
        }
        
        if (decrypted) {
          // --- STEGANOGRAPHIC SIGNALING INTERCEPTION ---
          let decompressed = '';
          try {
            const compressedBytes = base64ToUint8(decrypted);
            const decompressedBytes = gunzipSync(compressedBytes);
            decompressed = strFromU8(decompressedBytes);
          } catch (e) {
            decompressed = decrypted;
          }

          try {
            if (decompressed.includes('"type":"stego_call_')) {
              const parsed = JSON.parse(decompressed);
              
              // Verify callId is not already ended
              if (parsed.callId && endedCallIdsRef.current.has(parsed.callId)) {
                console.warn("[Stealth-Call] Discarding stale stego signaling from already ended call:", parsed.callId);
                return;
              }
              // Verify timestamp is not too old (e.g. > 15s)
              if (parsed.timestamp && Date.now() - parsed.timestamp > 15000) {
                console.warn("[Stealth-Call] Discarding stale stego signaling payload (age > 15s):", Date.now() - parsed.timestamp);
                return;
              }

              if (parsed.type === 'stego_call_offer') {
                handleCallOffer({ ...parsed, fromId: data.fromId, sessionId: sessionInfo.sessionId });
                return; // Do not show in UI
              } else if (parsed.type === 'stego_call_answer') {
                handleCallAnswer({ ...parsed, fromId: data.fromId, sessionId: sessionInfo.sessionId });
                return; // Do not show in UI
              } else if (parsed.type === 'stego_call_ice_candidate') {
                handleIceCandidate({ ...parsed, fromId: data.fromId, sessionId: sessionInfo.sessionId });
                return; // Do not show in UI
              }
            }

            // If it contains stego call type but failed exact match or was truncated, drop it
            if (decompressed.includes('"type":"stego_call_') || decompressed.startsWith('{"type":"stego_')) {
               console.warn("[Stego] Intercepted and dropped partial or unhandled signaling payload");
               return;
            }
          } catch (e) {
             if (decompressed.includes('"type":"stego_call_') || decompressed.startsWith('{"type":"stego_')) {
               console.error("[Stego] Dropped corrupted signaling message", e);
               return; // Do not show corrupted signaling in UI
             }
             // Not JSON signaling, continue as normal text message
          }
          // ---------------------------------------------
          
          if (data.isStegoSignaling) {
            console.log("[Stego] Discarding stego signaling message that failed processing");
            return;
          }
          
          const msgId = data.msgId || Math.random().toString(36).substr(2, 9);
          // Skip if already in messages (dedup for offline re-delivery)
          setMessages(prev => {
            if (prev.some(m => m.id === msgId)) return prev;
            const newMessage: Message = {
              id: msgId,
              fromId: data.fromId,
              text: decrypted,
              timestamp: data.timestamp || Date.now(),
              isSelfDestruct: data.isSelfDestruct,
              isOneTime: false,
              timerSeconds: data.timer,
              isRevealed: true,
              expiresAt: data.isSelfDestruct ? Date.now() + (data.timer * 1000) : undefined
            };
            addMessageLocal(newMessage);
            return [...prev, newMessage];
          });
        }
      } catch (err: any) {
        // Silently discard — this message was encoded with a different PIN
        // (e.g. a very old session before PIN stability fix). Nothing to show.
        console.debug('[E2EE] Discarded undecodable incoming message.');
      }
    };

    const handleReceiveFile = (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      if (sessionInfo.pin === 'DECRYPTION_FAILED') return;
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
          addMessageLocal(newMessage);
        }
      } catch (err: any) {
        // Silently discard — file was encoded with a different PIN
        console.debug('[E2EE] Discarded undecodable incoming file.');
      }
    };

    const handleCallOffer = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      
      // Verify callId is not already ended
      if (data.callId && endedCallIdsRef.current.has(data.callId)) {
        console.warn("[Stealth-Call] Ignored stale stego_call_offer with already ended callId:", data.callId);
        return;
      }
      if (data.timestamp && Date.now() - data.timestamp > 15000) {
        console.warn("[Stealth-Call] Ignored stale stego_call_offer (age > 15s):", Date.now() - data.timestamp);
        return;
      }
      
      if (callStateRef.current !== 'idle') {
        console.warn("[Stealth-Call] Received call offer but call state is not idle:", callStateRef.current);
        if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed' || peerConnectionRef.current.connectionState === 'failed') {
          console.log("[Stealth-Call] Peer connection is closed/null. Force-clearing stale state to accept new offer.");
          endCall(false);
        } else {
          return;
        }
      }
      
      if (data.callId) {
        callIdRef.current = data.callId;
      }
      setCallState('receiving');
      setCallerId(data.fromId);
      setIsVideoCall(data.withVideo || false);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;
      setupPeerConnectionListeners(pc, data.withVideo || false);
      
      pc.onicecandidate = (event) => {
        if (peerConnectionRef.current !== pc) return;
        if (event.candidate) {
          socket.emit('call_ice_candidate', {
            sessionId: sessionInfo.sessionId,
            candidate: event.candidate,
            toId: data.fromId,
            callId: callIdRef.current
          });
        }
      };

      pc.ontrack = (event) => {
        if (peerConnectionRef.current !== pc) return;
        let rStream = event.streams[0];
        if (!rStream) {
          console.warn("[Stealth] No stream found in handleCallOffer ontrack. Using fallback MediaStream.");
          rStream = remoteStreamRef.current || new MediaStream();
          rStream.addTrack(event.track);
        }
        // Disable cover audio track from WebRTC so user doesn't hear it
        rStream.getAudioTracks().forEach(track => {
          track.enabled = false;
          console.log("[Stealth-RTP] Disabled remote WebRTC audio track to mute cover song.");
        });
        remoteStreamRef.current = rStream;
        const freshStream = new MediaStream(rStream.getTracks());
        setRemoteStream(freshStream);
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        while (pendingCandidates.current.length > 0) {
          const candidate = pendingCandidates.current.shift();
          if (candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
          }
        }
      } catch (err) {
        console.error("[Stealth-Call] Failed to set remote description on offer:", err);
        endCall(false);
      }
    };

    const handleCallAnswer = async (data: any) => {
      if (data.sessionId !== sessionInfo.sessionId) return;
      if (data.callId && data.callId !== callIdRef.current) {
        console.warn("[Stealth-Call] Mismatched callId in stego_call_answer. Expected:", callIdRef.current, "Got:", data.callId);
        return;
      }
      if (data.timestamp && Date.now() - data.timestamp > 15000) {
        console.warn("[Stealth-Call] Ignored stale stego_call_answer (age > 15s)");
        return;
      }
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
      if (data.callId && data.callId !== callIdRef.current) {
        console.warn("[Stealth-Call] Ignored ICE candidate for mismatched callId:", data.callId);
        return;
      }
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

    const handleStealthRtpReceive = async (packet: any) => {
      // Allow 'receiving' so the phone can pre-warm the audio pipeline before Accept is tapped.
      // Without this, all audio packets sent by the caller while the phone is ringing are silently
      // dropped, causing one-way audio after the call is accepted.
      if (callStateRef.current !== 'connected' && callStateRef.current !== 'receiving') {
        return;
      }
      console.log("[Stealth-RTP] Received socket packet type:", packet?.type);

      if (packet.timestamp) {
        if (clockOffsetRef.current === null) {
          clockOffsetRef.current = Date.now() - packet.timestamp;
          console.log("[Stealth-RTP] Established baseline clock offset:", clockOffsetRef.current);
        }
        const relativeAge = (Date.now() - packet.timestamp) - clockOffsetRef.current;
        if (Math.abs(relativeAge) > 5000) {
          clockOffsetRef.current = Date.now() - packet.timestamp;
          console.log("[Stealth-RTP] Clock shift detected. Reset baseline offset:", clockOffsetRef.current);
        } else if (relativeAge > 1500) {
          // Log a warning but NEVER drop the packet (steganographic bitstream requires all sequential packets)
          console.warn(`[Stealth-RTP] Late packet received (type: ${packet.type}, relative age: ${relativeAge}ms) - processing to keep LSB bitstream in sync.`);
        }
      }

      if (packet.type === 'audio_stego') {
        try {
          const audioCtx = stealthAudioCtxRef.current;
          if (!audioCtx) {
            console.warn("[Stealth-RTP] Cannot process packet: stealthAudioCtxRef is null!");
            return;
          }

          // Handle incoming audio stego wrapped in fake RTP
          let rtpBytes: Uint8Array;
          if (packet.rtpPacket) {
            rtpBytes = new Uint8Array(packet.rtpPacket);
          } else if (packet.audioBuffer) {
            // Coerce if sent over older audioBuffer format
            const buffer = packet.audioBuffer;
            if (buffer instanceof ArrayBuffer) {
              rtpBytes = new Uint8Array(buffer);
            } else if (buffer.buffer instanceof ArrayBuffer) {
              rtpBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            } else {
              rtpBytes = new Uint8Array(buffer);
            }
          } else {
            console.error("[Stealth-RTP] No audio payload found in socket packet!");
            return;
          }

          // Strip 12-byte RTP header
          let payloadBytes: Uint8Array;
          if (rtpBytes.length > 12 && rtpBytes[0] === 0x80 && rtpBytes[1] === 0x78) {
            payloadBytes = rtpBytes.subarray(12);
          } else {
            // Fallback for legacy WAV carrier
            const binary = decodeLSB(rtpBytes.buffer);
            const encryptedText = binaryToString(binary);
            const decrypted = decryptData(encryptedText, sessionInfo.pin);
            if (decrypted) {
              const compressedBytes = base64ToUint8(decrypted);
              const decompressedBytes = gunzipSync(compressedBytes);
              const voice8kHz = new Float32Array(decompressedBytes.length / 2);
              for (let i = 0; i < voice8kHz.length; i++) {
                const low = decompressedBytes[i * 2];
                const high = decompressedBytes[i * 2 + 1];
                let s16 = low | (high << 8);
                if (s16 & 0x8000) s16 |= ~0xFFFF;
                voice8kHz[i] = s16 / 32768.0;
              }
              const upsampled = upsampleAudio(voice8kHz, 8000, audioCtx.sampleRate);
              const voicePlayerNode = (window as any).stealthVoicePlayerNode;
              if (voicePlayerNode) {
                voicePlayerNode.port.postMessage({ type: 'PUSH_PLAYBACK', samples: upsampled });
              }
            }
            return;
          }

          // payloadBytes contains the UTF-8 bytes of the encrypted string directly (low-bandwidth mode)
          const encryptedText = strFromU8(payloadBytes);
          
          const keys = getDerivedKeys(sessionInfo.pin);
          const iv = CryptoJS.lib.WordArray.create([0, 0, 0, seq]);
          const decrypted = fastDecrypt(encryptedText, keys.key, iv);
          
          if (decrypted) {
            const compressedBytes = base64ToUint8(decrypted);
            const decompressedBytes = gunzipSync(compressedBytes);
            const voice8kHz = new Float32Array(decompressedBytes.length / 2);
            for (let i = 0; i < voice8kHz.length; i++) {
              const low = decompressedBytes[i * 2];
              const high = decompressedBytes[i * 2 + 1];
              let s16 = low | (high << 8);
              if (s16 & 0x8000) s16 |= ~0xFFFF;
              voice8kHz[i] = s16 / 32768.0;
            }
            const upsampled = upsampleAudio(voice8kHz, 8000, audioCtx.sampleRate);
            const voicePlayerNode = (window as any).stealthVoicePlayerNode;
            if (voicePlayerNode) {
              voicePlayerNode.port.postMessage({ type: 'PUSH_PLAYBACK', samples: upsampled });
            }
          }
        } catch (err) {
          console.error("[Stealth] Error decoding received socket voice packet:", err);
        }
      } else if (packet.type === 'video_stego') {
        // Video stego socket bypass completely removed.
        // All video stego data flows exclusively via WebRTC track.
        console.warn("[Stealth-RTP] Received video_stego packet over socket. Bypassing/ignoring.");
      }
    };

    if (pendingCall && pendingCall.sessionId === sessionInfo.sessionId) {
      handleCallOffer(pendingCall);
      if (clearPendingCall) clearPendingCall();
    }

    const handleStealthPong = (data: { startTime: number }) => {
      const rtt = performance.now() - data.startTime;
      currentRttRef.current = rtt;
      console.log(`[Stealth-RTT] Measured network RTT: ${rtt.toFixed(1)}ms`);
    };

    socket.on('stealth_pong', handleStealthPong);
    socket.on('receive_message', handleReceive);
    socket.on('receive_file', handleReceiveFile);
    socket.on('call_offer', handleCallOffer);
    socket.on('call_answer', handleCallAnswer);
    socket.on('call_ice_candidate', handleIceCandidate);
    socket.on('message_deleted', (data) => {
      if (data.msgId) {
        setMessages(prev => prev.filter(m => m.id !== data.msgId));
        deleteMessageLocal(data.msgId).catch(e => console.error(e));
      }
    });

    socket.on('call_end', handleCallEnd);
    socket.on('stealth_rtp_receive', handleStealthRtpReceive);

    return () => {
      socket.off('stealth_pong', handleStealthPong);
      socket.off('receive_message', handleReceive);
      socket.off('receive_file', handleReceiveFile);
      socket.off('call_offer', handleCallOffer);
      socket.off('call_answer', handleCallAnswer);
      socket.off('call_ice_candidate', handleIceCandidate);
      socket.off('message_deleted');
      socket.off('call_end', handleCallEnd);
      socket.off('stealth_rtp_receive', handleStealthRtpReceive);
    };
  }, [socket, sessionInfo.pin, sessionInfo.sessionId, pendingCall, clearPendingCall, isActive, callState]);

  useEffect(() => {
    if (messages.length > 0) {
      if (isInitialLoad.current) {
        const timer = setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
          }
        }, 100);
        isInitialLoad.current = false;
        return () => clearTimeout(timer);
      } else if (chatContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
  }, [messages]);

  // Force scroll to bottom when the chat becomes active (opened/unhidden)
  useEffect(() => {
    if (isActive && messages.length > 0) {
      const timer = setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isActive, messages.length]);

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

  // Unified effect to start E2EE stego audio and video decoding on call connection
  useEffect(() => {
    if (callState === 'connected' && remoteStream) {
      console.log("[Stealth] Unified-Decode: Call connected & remote stream active. Initializing decoding loops.");
      startStealthAudioDecode(remoteStream);
      if (isVideoCall && typeof remoteStream.getVideoTracks === 'function' && remoteStream.getVideoTracks().length > 0) {
        startStealthVideoDecode(remoteStream);
      }
    }
  }, [callState, remoteStream, isVideoCall]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const sendStegoSignaling = (payloadObj: any, toId: string) => {
    try {
      const jsonStr = JSON.stringify({
        ...payloadObj,
        timestamp: Date.now(),
        callId: callIdRef.current
      });
      const compressed = gzipSync(strToU8(jsonStr), { level: 6 });
      const compressedBase64 = uint8ToBase64(compressed);
      
      console.warn("[Stego-Signaling] Encrypting signaling payload with PIN:", sessionInfo.pin);
      const encrypted = encryptData(compressedBase64, sessionInfo.pin);
      const binary = stringToBinary(encrypted);
      const carrier = createDynamicCarrier(binary.length);
      const stegoAudio = encodeLSB(carrier, binary);
      
      const base64 = uint8ToBase64(stegoAudio);

      socket.emit('send_message', {
        sessionId: sessionInfo.sessionId,
        fromId: user.id,
        toId: toId,
        audioBase64: base64,
        isSelfDestruct: false,
        isOneTime: false,
        timer: 0,
        isStegoSignaling: true
      });
      console.log(`[Stego-Signaling] Sent covert compressed ${payloadObj.type} via audio LSB`);
    } catch (e) {
      console.error("[Stego-Signaling] Failed to send", e);
    }
  };

  const getOrCreateAudioContext = () => {
    if (!stealthAudioCtxRef.current || stealthAudioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      stealthAudioCtxRef.current = new AudioCtx();
      workletModuleLoadedRef.current = false; // new context needs module loaded again
    }
    return stealthAudioCtxRef.current;
  };

  const downsampleAudio = (buffer: Float32Array, fromSampleRate: number, toSampleRate: number): Float32Array => {
    if (fromSampleRate === toSampleRate) return buffer;
    const sampleRateRatio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  const upsampleAudio = (buffer: Float32Array, fromSampleRate: number, toSampleRate: number): Float32Array => {
    if (fromSampleRate === toSampleRate) return buffer;
    const sampleRateRatio = toSampleRate / fromSampleRate;
    const newLength = Math.round(buffer.length * sampleRateRatio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < result.length; i++) {
      const srcIdx = i / sampleRateRatio;
      const index = Math.floor(srcIdx);
      const frac = srcIdx - index;
      const s0 = buffer[index] || 0;
      const s1 = (index + 1 < buffer.length) ? buffer[index + 1] : s0;
      result[i] = s0 + (s1 - s0) * frac;
    }
    return result;
  };

  const startStealthAudioEncode = async (rawStream: MediaStream, toId: string): Promise<MediaStreamTrack | null> => {
    try {
      console.log("[Stealth] Initializing Audio Encode Pipeline...");
      const audioCtx = getOrCreateAudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Only call addModule once per AudioContext instance to avoid InvalidStateError
      if (!workletModuleLoadedRef.current) {
        await audioCtx.audioWorklet.addModule('/stealth-worklet.js');
        workletModuleLoadedRef.current = true;
      }

      const song = coverSongRef.current || await generateCoverSong(sessionInfo.pin, audioCtx.sampleRate);
      coverSongRef.current = song;

      const workletNode = new AudioWorkletNode(audioCtx, 'stealth-processor');
      // Use transferable to avoid copying 40MB Float32Array (much faster)
      const songBuffer = song.buffer.slice(0);
      workletNode.port.postMessage({ type: 'SET_COVER', buffer: songBuffer }, [songBuffer]);
      workletNode.port.postMessage({ type: 'SET_PIN', pin: sessionInfo.pin });
      workletNode.port.postMessage({ type: 'SET_MODE_ENCODE' });

      // Handle fake RTP chunks generated by the worklet
      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'RTP_CHUNK_READY') {
          const { rtp, jitter } = event.data;
          
          // Wait jitterMs before sending — makes packet timing look like real Wi-Fi
          setTimeout(() => {
            socket.emit('stealth_rtp_packet', {
              toId: toId,
              packet: {
                type: 'audio_stego',
                rtpPacket: Array.from(rtp), // Full fake-RTP-wrapped audio chunk
                timestamp: Date.now()
              }
            });
          }, jitter); // 0–15ms natural variation
        }
      };

      const dest = audioCtx.createMediaStreamDestination();
      workletNode.connect(dest);

      const micSource = audioCtx.createMediaStreamSource(rawStream);
      const micProcessor = audioCtx.createScriptProcessor(512, 1, 1);
      (window as any).stealthMicSource = micSource;
      micSource.connect(micProcessor);

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      micProcessor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      let micAccumulator: number[] = [];

      micProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        micAccumulator.push(...(Array.from(inputData) as number[]));

        const triggerLength = audioCtx.sampleRate === 48000 ? 2040 : 2048;
        if (micAccumulator.length >= triggerLength) {
          const chunk = micAccumulator.splice(0, triggerLength);
          const rawFloats = Float32Array.from(chunk);
          
          const downsampled = downsampleAudio(rawFloats, audioCtx.sampleRate, 8000);
          
          const bytes = new Uint8Array(downsampled.length * 2);
          const micGain = 3.5; // Boost gain factor for voice clarity
          for (let i = 0; i < downsampled.length; i++) {
            const boosted = Math.max(-1.0, Math.min(1.0, downsampled[i] * micGain));
            const s16 = Math.max(-32768, Math.min(32767, Math.floor(boosted * 32767)));
            bytes[i * 2] = s16 & 0xFF;         // Low byte
            bytes[i * 2 + 1] = (s16 >> 8) & 0xFF; // High byte
          }

          // Use compression level 1 for ultra-low latency & CPU savings
          const compressed = gzipSync(bytes, { level: 1 });
          const base64 = uint8ToBase64(compressed);

          // Use fastEncrypt with sequence number as IV to run under 1ms
          const seq = audioSeqRef.current;
          const keys = getDerivedKeys(sessionInfo.pin);
          const iv = CryptoJS.lib.WordArray.create([0, 0, 0, seq]);
          const encrypted = fastEncrypt(base64, keys.key, iv);

          const bits = stringToBinary(encrypted);

          // Prefix with a 32-bit length header (Big Endian)
          const len = bits.length;
          let headerBits = "";
          for (let i = 0; i < 32; i++) {
            headerBits += ((len >>> (31 - i)) & 1).toString();
          }
          const fullBits = headerBits + bits;
          const bitsArray = fullBits.split('').map(Number);

          // Push bits to the worklet to be embedded
          workletNode.port.postMessage({ type: 'PUSH_VOICE_BITS', bits: bitsArray });

          // --- MAIN THREAD AUDIO PACKAGING FOR SOCKET CHANNEL ---
          // Send the encrypted base64 payload directly to reduce bandwidth by 95% (preventing TCP bufferbloat & lag)
          const payloadBytes = strToU8(encrypted);

          // Wrap stego audio in a fake RTP packet (12-byte header + payload)
          const rtpPacket = new Uint8Array(12 + payloadBytes.length);
          rtpPacket[0] = 0x80; // Version 2
          rtpPacket[1] = 0x78; // Payload type 120

          // Sequence number
          rtpPacket[2] = (seq >> 8) & 0xFF;
          rtpPacket[3] = seq & 0xFF;
          audioSeqRef.current = (seq + 1) & 0xFFFF;

          // Timestamp
          const ts = audioTsRef.current;
          rtpPacket[4] = (ts >> 24) & 0xFF;
          rtpPacket[5] = (ts >> 16) & 0xFF;
          rtpPacket[6] = (ts >> 8) & 0xFF;
          rtpPacket[7] = ts & 0xFF;
          audioTsRef.current = ts + triggerLength;

          // SSRC
          rtpPacket[8] = 0x12; rtpPacket[9] = 0x34; rtpPacket[10] = 0x56; rtpPacket[11] = 0x78;

          // Copy stego payload
          rtpPacket.set(payloadBytes, 12);

          // Only send audio RTP once the WebRTC connection is fully established.
          // During 'calling' (ringing) phase, packets sent to the receiver are dropped
          // because the receiver is in 'receiving' state and hasn't accepted yet.
          // This prevents the audio stream clock from diverging before both sides are ready.
          if (callStateRef.current !== 'connected') return;

          // Apply natural human-like jitter variation (0-15ms)
          const jitter = Math.floor(Math.random() * 16);
          setTimeout(() => {
            socket.emit('stealth_rtp_packet', {
              toId: toId,
              packet: {
                type: 'audio_stego',
                rtpPacket: Array.from(rtpPacket),
                timestamp: Date.now()
              }
            });
          }, jitter);
        }
      };

      stealthWorkletRef.current = workletNode;
      (window as any).stealthMicProcessor = micProcessor; // prevent GC

      return dest.stream.getAudioTracks()[0];
    } catch (e) {
      console.error("[Stealth] Failed to start encode pipeline:", e);
      return null;
    }
  };

  const startStealthAudioDecode = async (remoteStream: MediaStream) => {
    if ((window as any).stealthDecodePipelineActive) {
      console.log("[Stealth] Audio Decode Pipeline already initialized. Skipping.");
      return;
    }
    try {
      console.log("[Stealth] Initializing Audio Decode Pipeline via AudioWorklet...");
      const audioCtx = getOrCreateAudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Ensure worklet module is loaded
      if (!workletModuleLoadedRef.current) {
        await audioCtx.audioWorklet.addModule('/stealth-worklet.js');
        workletModuleLoadedRef.current = true;
      }

      const voicePlayerNode = new AudioWorkletNode(audioCtx, 'stealth-processor');
      voicePlayerNode.port.postMessage({ type: 'SET_MODE_PLAYBACK' });
      voicePlayerNode.connect(audioCtx.destination);

      console.log("[Stealth-RTP] voicePlayer AudioWorkletNode initialized and connected to AudioContext destination.");
      (window as any).stealthVoicePlayerNode = voicePlayerNode; // prevent GC
      (window as any).stealthDecodePipelineActive = true;
    } catch (e) {
      console.error("[Stealth] Failed to start decode pipeline:", e);
    }
  };

  const startStealthVideoDecode = async (remoteStream: MediaStream) => {
    if (videoDecoderRef.current) {
      console.log("[Stealth] Video Decode Pipeline already initialized. Skipping.");
      return;
    }
    try {
      console.log("[Stealth] Initializing Video Decode Pipeline...");
      if (!decodedVideoCanvasRef.current) {
        console.warn("[Stealth] Decoded video canvas not ready yet.");
        return;
      }

      let attempts = 0;
      const initDecoder = async () => {
        if (remoteVideoRef.current && decodedVideoCanvasRef.current) {
          remoteVideoRef.current.muted = true;
          const decoder = new VideoStegoDecoder(
            remoteVideoRef.current,
            sessionInfo.pin,
            decodedVideoCanvasRef.current,
            currentResolutionRef.current,
            (pct) => {},
            (durationMs) => {
              checkAdaptiveStegoEngine(durationMs, 'decode');
            }
          );
          await decoder.init();
          videoDecoderRef.current = decoder;
          decoder.start();
          console.log("[Stealth] Video decoder pipeline successfully started.");
        } else if (attempts < 20) {
          attempts++;
          setTimeout(initDecoder, 100);
        }
      };
      initDecoder();
    } catch (e) {
      console.error("[Stealth] Failed to start video decode pipeline:", e);
    }
  };

  const startCall = async (withVideo: boolean = false) => {
    // Capture user gesture synchronously for mobile AudioContext activation
    const gestureAudioCtx = getOrCreateAudioContext();
    if (gestureAudioCtx && gestureAudioCtx.state === 'suspended') {
      gestureAudioCtx.resume().catch(err => console.warn("[Stealth-Gesture] AudioContext resume failed:", err));
    }

    // Initialize decode pipeline immediately in user gesture to ensure it's allowed to play audio
    await startStealthAudioDecode(null as any);

    const callId = Math.random().toString(36).substr(2, 9);
    callIdRef.current = callId;

    if (sessionInfo.pin === 'DECRYPTION_FAILED') {
      showModal({
        title: 'Encryption Error',
        message: 'Cannot place secure call. E2EE keys are mismatched. Please synchronize your device or reset the session first.',
        iconType: 'warning'
      });
      return;
    }
    if (callStateRef.current !== 'idle' || isCallStartingRef.current) {
      console.warn("[Stealth-Call] startCall ignored because state is not idle or already starting:", callStateRef.current);
      return;
    }
    isCallStartingRef.current = true;
    try {
      const isMobile = isMobileDevice();
      const initialResolution = '480p';
      const initialFps = 30;
      currentResolutionRef.current = initialResolution;
      targetFpsRef.current = initialFps;
      setCurrentResolution(initialResolution);
      setTargetFpsState(initialFps);

      pendingCandidates.current = [];
      setIsVideoCall(withVideo);
      setIsMuted(false);
      setIsVideoOff(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } : false
      });
      
      // --- V2 STEALTH ARCHITECTURE INJECTION ---
      let localAudioTrack = stream.getAudioTracks()[0];
      const stegoTrack = await startStealthAudioEncode(stream, targetUser.id.toString());
      if (stegoTrack) {
        localAudioTrack = stegoTrack;
      }

      let localVideoTrack = stream.getVideoTracks()[0];
      if (withVideo) {
        try {
          console.log("[Stealth] Initializing Video steganography encoder...");
          const encoder = new VideoStegoEncoder(
            stream,
            sessionInfo.pin,
            currentResolutionRef.current,
            (pct) => {},
            undefined, // Bypass PNG LSB encoding for socket
            (durationMs) => {
              checkAdaptiveStegoEngine(durationMs, 'encode');
            }
          );
          await encoder.init();
          videoEncoderRef.current = encoder;
          encoder.setTargetFps(targetFpsRef.current);
          encoder.start();
          localVideoTrack = encoder.getStegoStream().getVideoTracks()[0];
        } catch (e) {
          console.error("[Stealth] Video encoder failed to initialize", e);
        }
      }
      // -----------------------------------------

      setLocalStream(stream);
      localStreamRef.current = stream;
      setCallState('calling');

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionRef.current = pc;
      setupPeerConnectionListeners(pc, withVideo);

      // Add the steganographic audio track (cover song + encoded voice) in place of raw mic
      // and the (possibly encoded) video track
      const stegoStream = new MediaStream();
      stegoStream.addTrack(localAudioTrack);
      if (withVideo && localVideoTrack) {
        stegoStream.addTrack(localVideoTrack);
      }
      pc.addTrack(localAudioTrack, stegoStream);
      if (withVideo && localVideoTrack) {
        pc.addTrack(localVideoTrack, stegoStream);
      }

      pc.onicecandidate = (event) => {
        // Vanilla ICE gathers all candidates upfront; no separate transmission needed
      };

      pc.ontrack = (event) => {
        if (peerConnectionRef.current !== pc) return;
        let rStream = event.streams[0];
        if (!rStream) {
          console.warn("[Stealth] No stream found in startCall ontrack. Using fallback MediaStream.");
          rStream = remoteStreamRef.current || new MediaStream();
          rStream.addTrack(event.track);
        }
        // Disable cover audio track from WebRTC so user doesn't hear it
        rStream.getAudioTracks().forEach(track => {
          track.enabled = false;
          console.log("[Stealth-RTP] Disabled remote WebRTC audio track to mute cover song.");
        });
        remoteStreamRef.current = rStream;
        const freshStream = new MediaStream(rStream.getTracks());
        setRemoteStream(freshStream);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (Vanilla ICE)
      await new Promise<void>((resolve) => {
        let resolved = false;
        const complete = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        if (pc.iceGatheringState === 'complete') {
          complete();
        } else {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              complete();
            }
          };
          setTimeout(complete, 1500); // 1.5s safety timeout
        }
      });

      sendStegoSignaling({
        type: 'stego_call_offer',
        offer: pc.localDescription || offer,
        withVideo
      }, targetUser.id.toString());
    } catch (err: any) {
      console.error('Error starting call:', err);
      if (!navigator.mediaDevices) {
        alert('Microphone access requires a secure HTTPS connection. Please use the secure ngrok URL on your phone.');
      } else {
        alert(`Could not start video call: ${err.message || 'Unknown media error'}. Please check if the camera is already in use by another application.`);
      }
      endCall();
    } finally {
      isCallStartingRef.current = false;
    }
  };

  const acceptCall = async () => {
    // Capture user gesture synchronously for mobile AudioContext activation
    const gestureAudioCtx = getOrCreateAudioContext();
    if (gestureAudioCtx && gestureAudioCtx.state === 'suspended') {
      gestureAudioCtx.resume().catch(err => console.warn("[Stealth-Gesture] AudioContext resume failed:", err));
    }

    // Initialize decode pipeline immediately in user gesture to ensure it's allowed to play audio
    await startStealthAudioDecode(null as any);

    if (callStateRef.current !== 'receiving' || isCallAcceptingRef.current) {
      console.warn("[Stealth-Call] acceptCall ignored because state is not receiving or already accepting:", callStateRef.current);
      return;
    }
    isCallAcceptingRef.current = true;
    try {
      const isMobile = isMobileDevice();
      const initialResolution = '480p';
      const initialFps = 30;
      currentResolutionRef.current = initialResolution;
      targetFpsRef.current = initialFps;
      setCurrentResolution(initialResolution);
      setTargetFpsState(initialFps);

      setIsMuted(false);
      setIsVideoOff(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideoCall ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } : false
      });
      setLocalStream(stream);
      localStreamRef.current = stream;

      let localAudioTrack = stream.getAudioTracks()[0];
      const stegoTrack = await startStealthAudioEncode(stream, (callerId || targetUser.id).toString());
      if (stegoTrack) {
        localAudioTrack = stegoTrack;
      }

      let localVideoTrack = stream.getVideoTracks()[0];
      if (isVideoCall) {
        try {
          console.log("[Stealth] Initializing Video steganography encoder...");
          const encoder = new VideoStegoEncoder(
            stream,
            sessionInfo.pin,
            currentResolutionRef.current,
            (pct) => {},
            undefined, // Bypass PNG LSB encoding for socket
            (durationMs) => {
              checkAdaptiveStegoEngine(durationMs, 'encode');
            }
          );
          await encoder.init();
          videoEncoderRef.current = encoder;
          encoder.setTargetFps(targetFpsRef.current);
          encoder.start();
          localVideoTrack = encoder.getStegoStream().getVideoTracks()[0];
        } catch (e) {
          console.error("[Stealth] Video encoder failed to initialize", e);
        }
      }

      // Add the steganographic audio track (cover song + encoded voice) in place of raw mic
      const stegoStream = new MediaStream();
      stegoStream.addTrack(localAudioTrack);
      if (isVideoCall && localVideoTrack) {
        stegoStream.addTrack(localVideoTrack);
      }
      
      const pc = peerConnectionRef.current;
      if (!pc) {
        throw new Error("PeerConnection is null when accepting call.");
      }

      pc.addTrack(localAudioTrack, stegoStream);
      if (isVideoCall && localVideoTrack) {
        pc.addTrack(localVideoTrack, stegoStream);
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for ICE gathering to complete (Vanilla ICE)
      await new Promise<void>((resolve) => {
        let resolved = false;
        const complete = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        if (pc.iceGatheringState === 'complete') {
          complete();
        } else {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              complete();
            }
          };
          setTimeout(complete, 1500); // 1.5s safety timeout
        }
      });

      sendStegoSignaling({
        type: 'stego_call_answer',
        answer: pc.localDescription || answer
      }, callerId || targetUser.id);

      setCallState('connected');
      callStateRef.current = 'connected';
      
      const rStream = remoteStreamRef.current;
      // Attempt to play audio immediately to satisfy mobile browser user gesture requirements
      // The remote video element is always muted - voice is decoded via the stealth worklet
      if (remoteVideoRef.current && rStream) {
        remoteVideoRef.current.muted = true; // Always mute WebRTC cover song audio
        if (remoteVideoRef.current.srcObject !== rStream) {
          remoteVideoRef.current.srcObject = rStream;
        }
        remoteVideoRef.current.play().catch(e => {
          if (e.name !== 'AbortError') {
            console.error("Video play failed:", e);
          }
        });
      }
    } catch (err: any) {
      console.error('Error accepting call:', err);
      if (!navigator.mediaDevices) {
        alert('Media device access requires a secure HTTPS connection. Please use the secure ngrok URL on your phone.');
      } else {
        alert(`Could not access microphone/camera to accept call: ${err.message || 'Unknown media error'}. Please check permissions.`);
      }
      endCall();
    } finally {
      isCallAcceptingRef.current = false;
    }
  };

  const endCall = (emit = true) => {
    if (callIdRef.current) {
      endedCallIdsRef.current.add(callIdRef.current);
    }
    callIdRef.current = null;

    if (emit && callState === 'calling') {
      socket.emit('log_call', { toId: targetUser.id, status: 'missed' });
      socket.emit('send_message', { sessionId: sessionInfo.sessionId, fromId: user.id, toId: targetUser.id, type: 'missed_call' });
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        fromId: "system",
        text: '❌ Missed Call',
        timestamp: Date.now(),
        isSelfDestruct: false,
        isOneTime: false,
        timerSeconds: 0,
        isRevealed: true,
      }]);
    } else if (emit && callState === 'connected') {
      socket.emit('log_call', { toId: callerId || targetUser.id, status: 'completed' });
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        fromId: "system",
        text: '📞 Call Ended',
        timestamp: Date.now(),
        isSelfDestruct: false,
        isOneTime: false,
        timerSeconds: 0,
        isRevealed: true,
      }]);
    }

    setCallState('idle');
    setWebrtcConnected(false);
    pendingCandidates.current = [];

    currentResolutionRef.current = '240p';
    targetFpsRef.current = 10;
    setCurrentResolution('240p');
    setTargetFpsState(10);
    consecutiveSlowFramesRef.current = 0;
    lastSettingsChangeTimeRef.current = 0;
    currentRttRef.current = 0;
    
    // --- V2 STEALTH CLEANUP ---
    try {
      stealthWorkletRef.current?.port.postMessage({ type: 'STOP' });
      stealthWorkletRef.current = null;
      
      const decodeWorklet = (window as any).stealthDecodeWorklet;
      if (decodeWorklet) {
        decodeWorklet.port.postMessage({ type: 'STOP' });
        delete (window as any).stealthDecodeWorklet;
      }
      delete (window as any).stealthDecodePipelineActive;

      if (stealthAudioCtxRef.current) {
        stealthAudioCtxRef.current.close();
        stealthAudioCtxRef.current = null;
        workletModuleLoadedRef.current = false; // reset so next call loads the module into fresh ctx
      }

      coverSongRef.current = null;
      clockOffsetRef.current = null;
      delete (window as any).stealthRemoteSource;

      // Stop video stego if active
      videoEncoderRef.current?.stop();
      videoEncoderRef.current = null;
      videoDecoderRef.current?.stop();
      videoDecoderRef.current = null;

      // Clean up processors and players
      const micProcessor = (window as any).stealthMicProcessor;
      if (micProcessor) {
        micProcessor.onaudioprocess = null;
        micProcessor.disconnect();
        delete (window as any).stealthMicProcessor;
      }
      const micSource = (window as any).stealthMicSource;
      if (micSource) {
        micSource.disconnect();
        delete (window as any).stealthMicSource;
      }
      if ((window as any).stealthVoicePlayerNode) {
        (window as any).stealthVoicePlayerNode.port.postMessage({ type: 'STOP' });
        (window as any).stealthVoicePlayerNode.disconnect();
        delete (window as any).stealthVoicePlayerNode;
      }

      console.log("[Stealth] Steganography context and worklets cleaned up.");
    } catch (e) {
      console.error("[Stealth] Error during cleanup:", e);
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    remoteStreamRef.current = null;
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
    if (remoteVideoRef.current && remoteStream && callState === 'connected') {
      // The remote video element is always muted - voice is decoded via the stealth worklet
      remoteVideoRef.current.muted = true; // Always mute WebRTC cover song audio
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      remoteVideoRef.current.play().catch(e => {
        if (e.name !== 'AbortError') {
          console.error("Video play failed:", e);
        }
      });
    }
    if (localVideoRef.current && localStream && isVideoCall) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.play().catch(e => {
        if (e.name !== 'AbortError') {
          console.error("Local video play failed:", e);
        }
      });
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

  const toggleSpeaker = async () => {
    try {
      const audioCtx = stealthAudioCtxRef.current;
      if (!audioCtx) {
        console.warn("[Stealth-Speaker] AudioContext not active yet.");
        return;
      }
      if (typeof (audioCtx as any).setSinkId !== 'function') {
        alert("Your browser does not support choosing audio output devices (setSinkId).");
        return;
      }
      if (typeof navigator.mediaDevices?.enumerateDevices !== 'function') {
        alert("Media device enumeration is not supported in this browser.");
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      if (outputs.length === 0) {
        alert("No audio output devices detected.");
        return;
      }

      // Find loudspeaker vs earpiece/default
      const speakerDevice = outputs.find(d => 
        d.label.toLowerCase().includes('speaker') || 
        d.label.toLowerCase().includes('loudspeaker') ||
        d.label.toLowerCase().includes('speakerphone')
      );

      const earpieceDevice = outputs.find(d => 
        d.label.toLowerCase().includes('earpiece') || 
        d.label.toLowerCase().includes('receiver') || 
        d.label.toLowerCase().includes('handset')
      );

      const nextSpeakerState = !speakerOn;
      
      if (nextSpeakerState) {
        // Enable loudspeaker
        if (speakerDevice) {
          await (audioCtx as any).setSinkId(speakerDevice.deviceId);
          console.log("[Stealth-Speaker] Routed AudioContext to speaker:", speakerDevice.label);
        } else {
          // Fallback to the first output device
          await (audioCtx as any).setSinkId(outputs[0].deviceId);
        }
        
        if (remoteVideoRef.current && typeof (remoteVideoRef.current as any).setSinkId === 'function') {
          const targetId = speakerDevice?.deviceId || outputs[0].deviceId;
          await (remoteVideoRef.current as any).setSinkId(targetId).catch(() => {});
        }
      } else {
        // Disable loudspeaker (route back to earpiece/default)
        if (earpieceDevice) {
          await (audioCtx as any).setSinkId(earpieceDevice.deviceId);
          console.log("[Stealth-Speaker] Routed AudioContext to earpiece:", earpieceDevice.label);
        } else {
          await (audioCtx as any).setSinkId(''); // default sink ID
        }
        
        if (remoteVideoRef.current && typeof (remoteVideoRef.current as any).setSinkId === 'function') {
          const targetId = earpieceDevice?.deviceId || '';
          await (remoteVideoRef.current as any).setSinkId(targetId).catch(() => {});
        }
      }
      setSpeakerOn(nextSpeakerState);
    } catch (err: any) {
      console.error("[Stealth-Speaker] Error toggling speaker:", err);
      alert(`Could not change audio output route: ${err.message || 'Unknown error'}`);
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
   useEffect(() => {
    if (activeMessageMenu) {
      const closeMenu = () => setActiveMessageMenu(null);
      document.addEventListener('click', closeMenu);
      return () => document.removeEventListener('click', closeMenu);
    }
  }, [activeMessageMenu]);




  const togglePiP = async () => {
    if (callState !== 'connected') {
       alert("Call must be connected to use Picture-in-Picture.");
       return;
    }
    
    if (remoteVideoRef.current && isVideoCall) {
       try {
         if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
         } else {
            await remoteVideoRef.current.requestPictureInPicture();
         }
         return;
       } catch (err) {
         console.warn("Standard PiP failed", err);
       }
    }
    
    if (!isVideoCall) {
       try {
          let video = pipVideoEl;
          if (!video) {
             const canvas = document.createElement('canvas');
             canvas.width = 300; canvas.height = 300;
             const ctx = canvas.getContext('2d');
             if (ctx) {
                ctx.fillStyle = '#0a1014';
                ctx.fillRect(0, 0, 300, 300);
                ctx.fillStyle = '#00a884';
                ctx.beginPath();
                ctx.arc(150, 120, 50, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'white';
                ctx.font = 'bold 36px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(targetUser.username[0].toUpperCase(), 150, 132);
                ctx.font = '20px Arial';
                ctx.fillText('StegoChat Audio Call', 150, 220);
                ctx.font = '16px Arial';
                ctx.fillStyle = '#8696a0';
                ctx.fillText(targetUser.username, 150, 250);
             }
             const stream = canvas.captureStream(1);
             video = document.createElement('video');
             video.srcObject = stream;
             video.muted = true;
             await video.play();
             setPipVideoEl(video);
          }
          
          if (document.pictureInPictureElement) {
             await document.exitPictureInPicture();
          } else if (video) {
             await video.requestPictureInPicture();
          }
       } catch(e) {
          console.error("Audio PiP hack failed", e);
          alert("Your browser completely blocks Picture-in-Picture logic.");
       }
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
          }, (response: any) => {
            setIsProcessing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            
            if (response?.ok) {
              const newMsg: Message = {
                id: Math.random().toString(36).substr(2, 9),
                fromId: user.id,
                text: '',
                timestamp: Date.now(),
                isSelfDestruct: snapchatMode,
                isOneTime: oneTimeView,
                timerSeconds: timer,
                isRevealed: !(snapchatMode || oneTimeView),
                expiresAt: undefined,
                file: {
                  name: file.name,
                  type: file.type,
                  data: base64Data
                }
              };
              setMessages(prev => [...prev, newMsg]);
              addMessageLocal(newMsg);
            } else {
              alert('Failed to send file: ' + (response?.error || 'Unknown error'));
            }
          });
        } catch (err) {
          console.error(err);
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
              }, (response: any) => {
                setIsProcessing(false);
                if (response?.ok) {
                  const newMsg: Message = {
                    id: Math.random().toString(36).substr(2, 9),
                    fromId: user.id,
                    text: '',
                    timestamp: Date.now(),
                    isSelfDestruct: snapchatMode,
                    isOneTime: oneTimeView,
                    timerSeconds: timer,
                    isRevealed: !(snapchatMode || oneTimeView),
                    expiresAt: undefined,
                    file: {
                      name: 'Voice Message.webm',
                      type: 'audio/webm',
                      data: base64Data
                    }
                  };
                  setMessages(prev => [...prev, newMsg]);
                  addMessageLocal(newMsg);
                } else {
                  alert('Failed to send voice message: ' + (response?.error || 'Unknown error'));
                }
              });
            } catch (err) {
              console.error(err);
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
      
      // 3. Create Carrier Audio — sized exactly to the payload (no wasted bytes)
      const carrier = createDynamicCarrier(binary.length);
      
      // 4. Hide Data in Carrier
      const stegoAudio = encodeLSB(carrier, binary);
      
      // 5. Convert to Base64 for transmission
      const base64 = uint8ToBase64(stegoAudio);

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
      const newMsg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        fromId: user.id,
        text: inputText,
        timestamp: Date.now(),
        isSelfDestruct: snapchatMode,
        isOneTime: false, // Text messages never use One Time View
        timerSeconds: timer,
        isRevealed: true,
        expiresAt: snapchatMode ? Date.now() + (timer * 1000) : undefined
      };
      setMessages(prev => [...prev, newMsg]);
      addMessageLocal(newMsg);

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

  const handleDeleteMessage = async (msgId: string, forEveryone: boolean) => {
    // Delete locally
    setMessages(prev => prev.filter(m => m.id !== msgId));
    deleteMessageLocal(msgId).catch(e => console.error(e));
    
    // If for everyone, notify other party
    if (forEveryone) {
      socket.emit('delete_message', {
        sessionId: sessionInfo.sessionId,
        fromId: user.id,
        toId: targetUser.id,
        msgId: msgId
      });
    }
  };

  const destroyMessage = (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
    deleteMessageLocal(msgId).catch(e => console.error(e));
  };

  useEffect(() => {
    socket.on('message_deleted', ({ msgId }: { msgId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      deleteMessageLocal(msgId).catch(e => console.error(e));
    });

    return () => {
      socket.off('message_deleted');
    };
  }, []);

  const triggerDownload = async (msgId: string, filename: string, base64data: string) => {
    // 1. Pause countdown
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.expiresAt) {
        return { ...m, isPaused: true, timeRemaining: Math.max(0, m.expiresAt - Date.now()) };
      }
      return m;
    }));

    setScanningStatus({ active: true, type: 'document', name: filename });
    await new Promise(r => setTimeout(r, 1500));
    setScanningStatus({ active: false, type: null, name: '' });

    const extension = filename.split('.').pop()?.toLowerCase();
    const dangerousExtensions = ['exe', 'bat', 'cmd', 'sh', 'vbs', 'scr', 'pif', 'msi'];
    if (extension && dangerousExtensions.includes(extension)) {
       alert(`SECURITY ALERT: Threat Detection Blocked Download\n\nThe file "${filename}" is a potentially dangerous executable that could harm your computer.`);
       setTimeout(() => {
          setMessages(prev => prev.map(m => {
             if (m.id === msgId && m.isPaused && m.timeRemaining !== undefined) {
               return { ...m, isPaused: false, expiresAt: Date.now() + m.timeRemaining };
             }
             return m;
          }));
       }, 500);
       return; 
    }

    // 2. Process file download (using Blob handles large files without freezing UX)
    try {
      const parts = base64data.split(',');
      const u8arr = base64ToUint8(parts[parts.length - 1]);
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

  const handleLinkClick = async (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    setScanningStatus({ active: true, type: 'link', name: url });
    
    await new Promise(r => setTimeout(r, 1200));
    setScanningStatus({ active: false, type: null, name: '' });

    try {
      const domain = new URL(url).hostname;
      const dangerousDomains = ['malware.com', 'phishing.net', 'stealer.ru', 'hack.xyz', 'ngrok.io', 'loca.lt']; 
      const isIp = /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(domain);
      
      if (isIp || dangerousDomains.some(d => domain.includes(d))) {
          if (window.confirm(`⚠️ SECURITY WARNING ⚠️\n\nThe site ahead (${domain}) may contain malware or fraudulent content. Our Safe Browsing algorithm flagged it as dangerous.\n\nDo you want to proceed at your own risk?`)) {
             window.open(url, '_blank', 'noopener,noreferrer');
          }
      } else {
          window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch(err) {
       window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const renderMessageText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a key={i} href={part} onClick={(e) => handleLinkClick(e, part)} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all cursor-pointer">
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
          <div 
            ref={callOverlayRef}
            className={`absolute inset-0 z-50 flex flex-col items-center justify-center animate-fade-in
              ${
                callState === 'connected' && !isVideoCall
                  // Audio connected: compact floating card at top, chat visible + blurred behind
                  ? 'bg-black/40 backdrop-blur-sm'
                  // Calling/receiving/video: full blur overlay
                  : 'bg-black/60 backdrop-blur-md'
              }
            `}
          >
            {/* Remote video — fullscreen behind for video calls */}
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              muted
              className={`absolute inset-0 w-full h-full object-cover z-0 opacity-0 pointer-events-none ${isVideoCall && callState === 'connected' ? 'block' : 'hidden'}`} 
            />

            {/* Decoded Video Canvas — shows decrypted real face */}
            <canvas
              ref={decodedVideoCanvasRef}
              className={`absolute inset-0 w-full h-full object-cover z-0 ${isVideoCall && callState === 'connected' ? 'block' : 'hidden'}`}
            />

            {/* Audio Call Connected: compact floating card (chat visible behind) */}
            {callState === 'connected' && !isVideoCall ? (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 bg-[#202c33]/90 backdrop-blur-md border border-[#2a3942] rounded-2xl px-5 py-3 shadow-2xl">
                <div className="w-9 h-9 bg-[#00a884] rounded-full flex items-center justify-center shadow-lg">
                  <Phone className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white font-medium text-sm leading-tight">{targetUser.username}</p>
                  <p className="text-[#00a884] text-xs font-mono">{!webrtcConnected ? '🔒 Securing...' : formatDuration(callDuration)}</p>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <button onClick={toggleMute} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/80 text-white' : 'bg-[#2a3942] hover:bg-[#3b4a54] text-white'}`}>
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <button onClick={toggleSpeaker} className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${speakerOn ? 'bg-green-500 text-white' : 'bg-[#2a3942] hover:bg-[#3b4a54] text-white'}`}>
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button onClick={togglePiP} className="w-9 h-9 rounded-full flex items-center justify-center bg-[#2a3942] hover:bg-[#3b4a54] text-white transition-colors">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button onClick={() => endCall()} className="w-9 h-9 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-colors">
                    <Phone className="w-4 h-4 text-white rotate-[135deg]" />
                  </button>
                </div>
              </div>
            ) : (
              /* Calling / Receiving / Video connected: centred card */
              <div className={`relative w-full max-w-sm flex-1 flex flex-col items-center justify-center z-10 ${
                isVideoCall && callState === 'connected' ? 'bg-transparent' : 'bg-[#202c33] rounded-3xl border border-[#2a3942] p-8 shadow-2xl max-h-[420px] mx-8'
              }`}>
                {/* Avatar for non-video states */}
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
                      {callState === 'connected' && (!webrtcConnected ? '🔒 Securing connection...' : formatDuration(callDuration))}
                    </p>
                  </div>
                )}

                {/* Local PiP feed (Draggable) */}
                <div 
                  className={`absolute z-50 cursor-move rounded-2xl overflow-hidden shadow-2xl border-2 border-[#2a3942] bg-[#202c33] transition-opacity w-32 md:w-48 h-48 md:h-64 ${isVideoCall && !isVideoOff && callState === 'connected' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  style={{ 
                    left: localVidPos.x === 'auto' ? undefined : `${localVidPos.x}px`, 
                    top: localVidPos.y === 'auto' ? '20px' : `${localVidPos.y}px`,
                    right: localVidPos.x === 'auto' ? '20px' : undefined,
                    touchAction: 'none'
                  }}
                  onPointerDown={(e) => {
                    const target = e.currentTarget as HTMLElement;
                    const container = callOverlayRef.current;
                    if (!container) return;
                    const rect = container.getBoundingClientRect();
                    const targetRect = target.getBoundingClientRect();
                    
                    isDraggingRef.current = true;
                    target.setPointerCapture(e.pointerId);
                    offsetRef.current = { 
                      x: e.clientX - targetRect.left, 
                      y: e.clientY - targetRect.top 
                    };
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingRef.current) return;
                    const container = callOverlayRef.current;
                    if (!container) return;
                    const rect = container.getBoundingClientRect();
                    
                    let newX = e.clientX - rect.left - offsetRef.current.x;
                    let newY = e.clientY - rect.top - offsetRef.current.y;
                    
                    const isMD = window.innerWidth > 768;
                    const targetWidth = isMD ? 192 : 128; // matching w-32 (128px) or md:w-48 (192px)
                    const targetHeight = isMD ? 256 : 192; // matching h-48 (192px) or md:h-64 (256px)
                    
                    if (newX < 10) newX = 10;
                    if (newX > rect.width - targetWidth - 10) newX = rect.width - targetWidth - 10;
                    if (newY < 10) newY = 10;
                    if (newY > rect.height - targetHeight - 10) newY = rect.height - targetHeight - 10;
                    
                    setLocalVidPos({ x: newX, y: newY });
                  }}
                  onPointerUp={(e) => {
                    isDraggingRef.current = false;
                    const target = e.currentTarget as HTMLElement;
                    target.releasePointerCapture(e.pointerId);
                  }}
                >
                  <video 
                    ref={localVideoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover" 
                  />
                </div>

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
                      
                      <button onClick={toggleSpeaker} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${speakerOn ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'}`}>
                        <Volume2 className="w-6 h-6" />
                      </button>

                      {isVideoCall && (
                        <button onClick={toggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${isVideoOff ? 'bg-[#3b4a54] text-white/50' : 'bg-[#202c33] hover:bg-[#2a3942] text-white'}`}>
                          {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                        </button>
                      )}

                      <button onClick={togglePiP} className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors bg-[#202c33] hover:bg-[#2a3942] text-white">
                        <ExternalLink className="w-6 h-6" />
                      </button>

                      <button onClick={() => endCall()} className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
                        <Phone className="w-7 h-7 text-white rotate-[135deg]" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
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
                <Shield className="w-3 h-3 mr-1 text-[#00a884] flex-shrink-0" />
                <span className="text-[#00a884] hidden sm:inline">SECURE SESSION ACTIVE</span>
              </div>
              {recoveryProgress !== null && (
                <div className="text-[10px] text-[#00a884] font-medium mt-0.5 animate-pulse">
                  Recovering messages: {recoveryProgress}%
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-5 text-[#aebac1]">
          
          
          {callState === 'idle' ? (
            <>
              <Phone className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => startCall(false)} />
              <Video className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => startCall(true)} />
            </>
          ) : (
            <>
              <Phone className="w-5 h-5 opacity-40 cursor-not-allowed" title="Call in progress" />
              <Video className="w-5 h-5 opacity-40 cursor-not-allowed" title="Call in progress" />
            </>
          )}
          <div className="relative">
             <MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => { setShowDropdown(!showDropdown); setDropdownView('main'); }} />
             {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl shadow-2xl bg-[#2a3942] border border-[#3a4952] z-50 overflow-hidden">
                   <button onClick={() => { setShowReportModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-yellow-500 hover:bg-[#202c33] transition-colors font-medium flex items-center">
                      <Flag className="w-4 h-4 mr-2" /> Report User
                   </button>
                   <button onClick={() => { handleBlockUser(); setShowDropdown(false); }} disabled={isBlocking} className="block w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-[#202c33] transition-colors font-medium flex items-center border-b border-[#202c33]">
                      <UserX className="w-4 h-4 mr-2" /> Block User
                   </button>
                   <div className="px-4 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider bg-[#111b21]">Chat Duration</div>
                   <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, 'permanent'); showModal({ title: 'Settings Updated', message: 'Chat set to Permanent Storage', iconType: 'success' }); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <ExternalLink className="w-4 h-4 text-[#00a884]" />
                      💾 Keep Permanent
                   </button>
                   <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); showModal({ title: 'Settings Updated', message: 'Chat set to 24 Hours. Older messages will auto-delete on refresh.', iconType: 'success' }); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                      <Clock className="w-4 h-4 text-[#00a884]" />
                      🕒 Keep for 24 Hours
                   </button>
                   <div className="px-4 py-3 hover:bg-[#202c33] transition-colors flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <Clock className="w-4 h-4 text-orange-400" />
                       <span className="text-sm text-white font-medium">Instant</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <select 
                         id="chat-timer-select"
                         name="chatTimer"
                         className="bg-[#111b21] text-xs font-bold text-orange-400 border border-[#3b4a54] rounded-md px-1 py-1 outline-none cursor-pointer"
                         value={timer}
                         onChange={(e) => setTimer(Number(e.target.value))}
                       >
                         <option value={5}>5s</option>
                         <option value={10}>10s</option>
                         <option value={30}>30s</option>
                         <option value={60}>1m</option>
                       </select>
                       <input 
                         type="checkbox" 
                         checked={snapchatMode}
                         onChange={() => setSnapchatMode(!snapchatMode)}
                         className="w-4 h-4 accent-orange-400"
                       />
                     </div>
                   </div>
                   <div className="px-4 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider bg-[#111b21]">Data Management</div>
                   <button onClick={() => { setShowDataModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>
                </div>
             )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 relative bg-[var(--chat-bg)]"
        style={{
          background: 'var(--chat-bg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {dbSession?.status === 'pending' && dbSession?.initiator_id !== user.id && (
          <div className="absolute inset-0 bg-[#0b141a]/60 backdrop-blur-sm shadow-2xl flex items-center justify-center z-30">
            <div className="bg-[#202c33] rounded-3xl p-8 max-w-sm w-full mx-4 border border-[#2a3942] shadow-2xl flex flex-col items-center animate-fade-in text-center">
               <div className="w-20 h-20 bg-gradient-to-br from-[#00a884] to-[#046a53] rounded-full flex items-center justify-center mb-6 shadow-lg border border-[#111b21]">
                 <span className="text-white font-bold text-3xl">{targetUser.username[0].toUpperCase()}</span>
               </div>
               <h3 className="text-[#e9edef] text-2xl font-medium mb-3">
                  Message Request
               </h3>
               <p className="text-[#8696a0] text-base mb-8">
                  {targetUser.username} wants to send you a secure message. Accept to start chatting.
               </p>
               <div className="flex flex-col space-y-3 w-full">
                 <button onClick={() => socket.emit('accept_request', { sessionId: sessionInfo.sessionId })} className="w-full py-3.5 bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold rounded-xl transition-colors shadow-lg">
                   Accept
                 </button>
                 <button onClick={() => { socket.emit('decline_request', { sessionId: sessionInfo.sessionId, toId: targetUser.id }); if(onBack) onBack(); }} className="w-full py-3.5 bg-[#3b4a54] hover:bg-red-500 hover:text-white text-[#d1d7db] font-bold rounded-xl transition-colors">
                   Decline
                 </button>
               </div>
            </div>
          </div>
        )}
        
        {scanningStatus.active && (
           <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-[#202c33] border border-[#2a3942] rounded-full px-6 py-3 shadow-2xl flex items-center z-50 animate-fade-in text-[#e9edef]">
              <Loader2 className="w-5 h-5 text-[#00a884] animate-spin mr-3" />
              <ShieldAlert className="w-5 h-5 text-orange-400 mr-2" />
              <span>Scanning {scanningStatus.type === 'link' ? 'link' : 'document'} for threats...</span>
           </div>
        )}
        
        {messages.length === 0 ? (
          <div className="flex items-center justify-center pt-10">
            <div className="bg-[#182229] text-[#ffd279] px-4 py-2 rounded-lg text-xs shadow-sm text-center max-w-xs flex items-center">
              <Lock className="w-3 h-3 mr-2 flex-shrink-0" />
              Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
          <div 
            key={index} 
            className={`flex ${isMine(msg) ? 'justify-end' : 'justify-start'}`}
            onMouseEnter={() => setIsHovering(index)}
            onMouseLeave={() => setIsHovering(null)}
          >
              <div className={`max-w-[65%] rounded-lg px-3 py-2 shadow-sm relative group ${
                isMine(msg) ? 'bg-[#005c4b] text-[#e9edef]' : 'bg-[#202c33] text-[#e9edef]'
              }`}>
                {/* Action Menu Trigger */}
                {isHovering === index && (
                  <button 
                    onClick={() => setActionMenuMsgId(actionMenuMsgId === msg.id ? null : msg.id)}
                    className={`absolute top-2 text-[#8696a0] hover:text-[#d1d7db] p-1 bg-[#202c33] rounded-full shadow-md z-10 
                    ${isMine(msg) ? 'left-[-30px]' : 'right-[-30px]'}`}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                )}

                {/* Action Menu */}
                {actionMenuMsgId === msg.id && (
                  <div 
                    className={`absolute top-8 w-48 bg-[#2a3942] rounded-md shadow-xl z-50 overflow-hidden ${
                      isMine(msg) ? 'left-[-180px]' : 'right-[-180px]'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button 
                      onClick={() => { handleDeleteMessage(msg.id, false); setActionMenuMsgId(null); }}
                      className="w-full text-left px-4 py-3 text-sm text-[#e9edef] hover:bg-[#3a4a54] transition-colors"
                    >
                      Delete for me
                    </button>
                    {isMine(msg) && (
                      <button 
                        onClick={() => { handleDeleteMessage(msg.id, true); setActionMenuMsgId(null); }}
                        className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-[#3a4a54] transition-colors border-t border-[#3a4a54]"
                      >
                        Delete for everyone
                      </button>
                    )}
                  </div>
                )}

                {((msg.isSelfDestruct || msg.isOneTime) && !msg.isRevealed) ? (
                <div 
                  className="flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-black/20 rounded-lg group transition-colors min-w-[120px]"
                  onClick={() => handleReveal(msg.id)}
                >
                  <div className="relative">
                    {msg.isOneTime ? (
                      <span className="flex items-center justify-center w-12 h-12 rounded-full border-[3px] border-[#00a884] text-[#00a884] font-bold text-xl mb-3 group-hover:scale-110 transition-transform">1</span>
                    ) : (
                      <Clock className="w-12 h-12 text-[#00a884] mb-3 group-hover:scale-110 transition-transform" />
                    )}
                  </div>
                  <span className="text-[#00a884] font-semibold text-base text-center">
                    Tap to view
                  </span>
                </div>
              ) : (
                <>
                  {msg.isOneTime && msg.isRevealed && !isMine(msg) && (
                     <div className="absolute -top-3 -right-3 bg-red-500 rounded-full h-6 px-2 shadow-lg text-white z-50 flex items-center text-[10px] font-bold animate-pulse">
                       BURNING...
                     </div>
                  )}
                  {msg.file ? (
                    <div className="mb-2 relative">
                  {msg.file.type?.startsWith('image/') ? (
                    <div className="relative inline-block group/media">
                      <img src={msg.file.data} alt="attachment" className="max-w-full rounded-lg max-h-64 object-contain" />
                      {!msg.isOneTime && (
                        <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="absolute bottom-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition-colors opacity-0 group-hover/media:opacity-100 z-10">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : msg.file.type?.startsWith('video/') ? (
                    <div className="relative inline-block group/media">
                      <video src={msg.file.data} controls className="max-w-full rounded-lg max-h-64" />
                      {!msg.isOneTime && (
                        <button onClick={(e) => { e.preventDefault(); triggerDownload(msg.id, msg.file!.name, msg.file!.data); }} className="absolute -top-2 -right-2 p-2 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition-colors opacity-0 group-hover/media:opacity-100 shadow-xl z-10">
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ) : msg.file.type?.startsWith('audio/') ? (
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
        )))}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input Area or Request Panel */}
      {sessionInfo.pin === 'DECRYPTION_FAILED' ? (
        <div className="bg-[#202c33] p-4 flex flex-col md:flex-row items-center justify-between border-t border-red-500/30 gap-4 z-20 chat-input-area text-[#e9edef] w-full">
          <div className="flex items-start gap-3 min-w-0">
            <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm leading-normal">
              <span className="font-semibold text-red-400">Encryption Mismatch:</span> Your device failed to decrypt E2EE keys. Use the <strong className="text-white">Device Sync</strong> option in the sidebar menu (three dots) to sync keys from your phone, or reset this session to start fresh.
            </div>
          </div>
          <button 
            onClick={() => onResetSession?.()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex-shrink-0 flex items-center gap-1.5 shadow-md"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reset Session
          </button>
        </div>
      ) : dbSession?.status === 'pending' ? (
        <div className="bg-[#202c33] p-4 flex items-center justify-center border-t border-[#2a3942] z-20 text-[#8696a0] chat-input-area">
          {dbSession.initiator_id === user.id 
            ? "Waiting for user to accept your request..."
            : "You must accept the request to send messages."}
        </div>
      ) : isBlocked ? (
        <div className="bg-[#202c33] p-4 flex flex-col items-center justify-center border-t border-[#2a3942] z-20 chat-input-area">
          <p className="text-[#8696a0] mb-3 text-sm">You blocked this user. You can't send or receive messages.</p>
          <button onClick={onUnblock} className="px-6 py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white rounded-lg font-bold transition-colors">
             Unblock
          </button>
        </div>
      ) : (
        <div className="bg-[#202c33] p-3 flex flex-wrap md:flex-nowrap items-center gap-3 relative border-t border-[#2a3942] z-20 chat-input-area">
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
              id={`chat-message-input-${targetUser.id}`}
              name={`chat-message-input-${targetUser.id}`}
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
              <p className="text-[#8696a0] text-lg mb-6">{targetUser.email}</p>
            </div>
            
            <div className="mt-2 bg-[#111b21] py-2 shadow-sm">
               <button onClick={() => { setShowSharedMedia(true); setShowUserProfile(false); }} className="w-full text-left px-6 py-4 text-[#00a884] hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <ImageIcon className="w-5 h-5" />
                  <span className="font-medium">Shared Media</span>
               </button>
            </div>

            <div className="mt-2 bg-[#111b21] py-2 shadow-sm">
               <button onClick={() => { setShowReportModal(true); setShowUserProfile(false); }} className="w-full text-left px-6 py-4 text-orange-400 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Flag className="w-5 h-5" />
                  <span className="font-medium">Report User</span>
               </button>
               <button onClick={() => {
                 showModal({
                   title: 'Block User',
                   message: `Are you sure you want to block ${targetUser.username}?`,
                   type: 'confirm',
                   iconType: 'warning',
                   confirmText: 'Block',
                   onConfirm: handleBlockUser
                 });
               }} className="w-full text-left px-6 py-4 text-red-500 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <UserX className="w-5 h-5" />
                  <span className="font-medium">Block User</span>
               </button>
            </div>

            <div className="mt-2 bg-[#111b21] py-4 shadow-sm">
               <div className="px-6 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider">Chat Duration</div>
               <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, 'permanent'); showModal({ title: 'Settings Updated', message: 'Chat set to Permanent Storage', iconType: 'success' }); }} className="w-full text-left px-6 py-4 text-white hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <ExternalLink className="w-5 h-5 text-[#00a884]" />
                  <span className="font-medium text-sm">Keep Permanent</span>
               </button>
               <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); showModal({ title: 'Settings Updated', message: 'Chat set to 24 Hours. Older messages will auto-delete on refresh.', iconType: 'success' }); }} className="w-full text-left px-6 py-4 text-white hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Clock className="w-5 h-5 text-[#00a884]" />
                  <span className="font-medium text-sm">Keep for 24 Hours</span>
               </button>
               
               <div className="px-6 py-4 hover:bg-[#202c33] transition-colors flex items-center justify-between mt-2">
                 <div className="flex items-center gap-4">
                   <Clock className="w-5 h-5 text-orange-400" />
                   <span className="text-sm text-white font-medium">Instant</span>
                 </div>
                 <div className="flex items-center gap-3">
                   <select 
                     className="bg-[#202c33] text-xs font-bold text-orange-400 border border-[#3b4a54] rounded-md px-2 py-1.5 outline-none cursor-pointer"
                     value={timer}
                     onChange={(e) => setTimer(Number(e.target.value))}
                   >
                     <option value={5}>5s</option>
                     <option value={10}>10s</option>
                     <option value={30}>30s</option>
                     <option value={60}>1m</option>
                   </select>
                   <input 
                     type="checkbox" 
                     checked={snapchatMode}
                     onChange={() => setSnapchatMode(!snapchatMode)}
                     className="w-5 h-5 accent-orange-400 cursor-pointer"
                   />
                 </div>
               </div>
            </div>

            <div className="mt-2 bg-[#111b21] py-4 shadow-sm">
               <div className="px-6 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider">Data Management</div>
               <button onClick={() => { setShowDataModal(true); setShowUserProfile(false); }} className="w-full text-left px-6 py-4 text-blue-400 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Download className="w-5 h-5" />
                  <span className="font-medium text-sm">Export / Import Chat</span>
               </button>
            </div>
          </div>
        </div>
      )}
  {showReportModal && (
    <ReportModal onClose={() => setShowReportModal(false)} reportedId={Number(targetUser.id)} />
  )}
  {showDataModal && (
    <DataManagementModal onClose={() => setShowDataModal(false)} sessionInfo={sessionInfo} targetUser={targetUser} />
  )}
  {showSharedMedia && (
    <SharedMediaViewer sessionId={sessionInfo.sessionId} pin={sessionInfo.pin} onClose={() => setShowSharedMedia(false)} />
  )}

    </div>
  );
}
