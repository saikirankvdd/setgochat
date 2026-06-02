import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, getCookie } from '../App';
import { Search, MoreVertical, MessageSquare, User as UserIcon, Activity, ArrowLeft, Key, Phone, PhoneMissed, PhoneIncoming, PhoneOutgoing, UserPlus, LogOut, X, ShieldAlert, Download, Upload, BookOpen, Bell, Shield, Trash2 } from 'lucide-react';
import { getAllMessagesLocal, importMessagesLocal } from '../utils/db';
import { useTheme } from '../contexts/ThemeContext';
import { useModal } from '../contexts/ModalContext';

interface SidebarProps {
  currentUser: User;
  users: User[];
  sessions: any[];
  calls: any[];
  onSelectUser: (user: User) => void;
  activeUserId?: number;
  onShowAdmin: () => void;
  onlineUsers: number[];
  lastMessages?: Record<number, string>;
  unreadCounts?: Record<number, number>;
  blockedUsersList?: User[];
  onShowOnboarding?: () => void;
  notifications: any[];
  onClearNotifications: () => void;
  onSyncRequest?: () => void;
}


const BackupModal = ({ onClose, currentUser }: { onClose: () => void, currentUser: User }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { showModal } = useModal();

  const handleExport = async () => {
    if (!startDate || !endDate) return showModal({ title: 'Export Error', message: 'Please select start and end dates.', type: 'alert', iconType: 'warning' });
    setIsExporting(true);
    try {
       const msgs = await getAllMessagesLocal();
       const startTs = new Date(startDate).setHours(0,0,0,0);
       const endTs = new Date(endDate).setHours(23,59,59,999);
       const filteredMsgs = msgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       
       if (filteredMsgs.length === 0) {
          showModal({ title: 'No Messages', message: 'No messages found in that date range.', type: 'alert' });
          setIsExporting(false);
          return;
       }
       
       const blob = new Blob([JSON.stringify(filteredMsgs)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `stegochat_backup_${startDate}_to_${endDate}.stego`;
       a.click();
       URL.revokeObjectURL(url);
       showModal({ title: 'Export Successful', message: `Successfully exported ${filteredMsgs.length} messages.`, iconType: 'success' });
    } catch(e) {
       console.error(e);
       showModal({ title: 'Export Failed', message: 'Failed to export chats.', iconType: 'warning' });
    }
    setIsExporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const msgs = JSON.parse(text);
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      showModal({ title: 'Import Successful', message: `Successfully imported ${msgs.length} messages! Reloading...`, iconType: 'success' });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      console.error(e);
      showModal({ title: 'Import Failed', message: "Failed to import chats: " + e.message, iconType: 'warning' });
    }
    setIsImporting(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-[#2a3942] shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Chat Backup</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="mb-6 space-y-4">
             <div className="bg-[#111b21] p-4 rounded-lg border border-[#2a3942]">
                <h3 className="text-[#e9edef] font-medium mb-2">Export Chats</h3>
                <p className="text-[#8696a0] text-sm mb-4">Download a secure .stego file containing your chat history within a specific date range.</p>
                <div className="flex gap-2 mb-4">
                   <div className="flex-1">
                      <label className="text-xs text-[#8696a0] mb-1 block">From</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                   <div className="flex-1">
                      <label className="text-xs text-[#8696a0] mb-1 block">To</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                </div>
                <button onClick={handleExport} disabled={isExporting} className="w-full py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold rounded shadow-lg disabled:opacity-50 transition-colors">
                   {isExporting ? 'Exporting...' : 'Export to .stego'}
                </button>
             </div>
             
             <div className="bg-[#111b21] p-4 rounded-lg border border-[#2a3942]">
                <h3 className="text-[#e9edef] font-medium mb-2">Import Chats</h3>
                <p className="text-[#8696a0] text-sm mb-4">Restore your messages from a previous .stego backup file.</p>
                <label className="w-full py-2 bg-[#2a3942] hover:bg-[#3a4952] text-white font-bold rounded shadow-lg flex items-center justify-center cursor-pointer transition-colors">
                   {isImporting ? 'Importing...' : <><Upload className="w-4 h-4 mr-2" /> Import from .stego</>}
                   <input type="file" accept=".stego,.json" className="hidden" onChange={handleImport} disabled={isImporting} />
                </label>
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};

export function Sidebar({ currentUser, users, sessions, calls, onSelectUser, activeUserId, onShowAdmin, onlineUsers, lastMessages, unreadCounts, blockedUsersList = [], onShowOnboarding, notifications, onClearNotifications, onSyncRequest }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'requests' | 'calls'>('chats');
  const [showProfile, setShowProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showBlockedUsersModal, setShowBlockedUsersModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const { theme } = useTheme();
  const { showModal } = useModal();

  const handleToggleNotifications = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications) {
      setHasUnreadAlerts(false);
    }
  };

  useEffect(() => {
    if (notifications.length > 0) {
      setHasUnreadAlerts(true);
    }
  }, [notifications.length]);
  

  const getTargetUser = (call: any) => {
    const id = call.from_id === currentUser.id ? call.to_id : call.from_id;
    return users.find(u => u.id === id) || { id, username: 'Unknown User' };
  };

  const handleRequestOtp = async () => {
    try {
      const res = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: currentUser.username }),
        credentials: 'include'
      });
      if (res.ok) {
        setOtpSent(true);
        showModal({ title: 'OTP Sent', message: 'OTP sent via email.', iconType: 'success' });
      }
    } catch (err) { console.error(err); }
  };

  const handleChangePassword = async () => {
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: currentUser.username, otp, newPassword }),
        credentials: 'include'
      });
      if (res.ok) {
        setShowChangePassword(false);
        showModal({ title: 'Success', message: 'Password changed successfully!', iconType: 'success' });
        setOtpSent(false); setOtp(''); setNewPassword('');
      } else { showModal({ title: 'Error', message: 'Invalid OTP or error changing password', iconType: 'warning' }); }
    } catch (err) { console.error(err); }
  };

const FeedbackModal = ({ onClose }: { onClose: () => void }) => {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (!text.trim() && images.length === 0) {
       showModal({ title: 'Empty Feedback', message: 'Please enter feedback or attach screenshots.', iconType: 'warning' });
       return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': getCookie('csrf_token') || ''
        },
        body: JSON.stringify({ text, images }),
        credentials: 'include'
      });
      if (res.ok) {
         showModal({ title: 'Feedback Sent', message: 'Thank you! Your feedback has been sent directly to the admin.', iconType: 'success' });
         onClose();
      } else {
         const data = await res.json();
         showModal({ title: 'Error', message: "Error: " + data.error, iconType: 'warning' });
      }
    } catch(err) {
      showModal({ title: 'Error', message: 'Error sending feedback.', iconType: 'warning' });
    } finally {
      setIsSubmitting(false);
    }
  };

   return createPortal(
       <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
         <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-[#2a3942] shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Send Feedback</h2>
            <textarea className="w-full bg-[#111b21] text-white p-3 rounded-lg min-h-[100px] mb-4 outline-none focus:border-[#00a884] border border-transparent" placeholder="Describe the issue or feedback..." value={text} onChange={e => setText(e.target.value)}></textarea>
            
            <div className="mb-4">
               <label className="block text-sm text-[#00a884] mb-2 cursor-pointer font-bold w-full text-center py-2 border border-[#00a884] rounded border-dashed hover:bg-[#00a884]/10 transition-colors">
                  + Attach Screenshots ({images.length}/10)
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
               <button disabled={isSubmitting} onClick={handleSubmit} className="px-5 py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white rounded-lg font-bold transition-colors shadow-lg">
                   {isSubmitting ? 'Sending...' : 'Submit Feedback'}
               </button>
            </div>
         </div>
      </div>,
      document.body
   );
};

const BlockedUsersModal = ({ onClose, users, onSelect }: { onClose: () => void, users: User[], onSelect: (u: User) => void }) => {
  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-[#2a3942] shadow-2xl flex flex-col max-h-[80vh]">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white flex items-center"><ShieldAlert className="w-5 h-5 mr-2 text-red-500" /> Blocked Users</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          
          <div className="flex-1 overflow-y-auto mb-4 border border-[#2a3942] rounded-lg bg-[#111b21] divide-y divide-[#2a3942]">
            {users.length === 0 ? (
               <p className="text-[#8696a0] p-6 text-center">No blocked users.</p>
            ) : (
               users.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 hover:bg-[#202c33] cursor-pointer" onClick={() => { onSelect(u); onClose(); }}>
                     <div className="flex items-center">
                        <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-full flex items-center justify-center mr-3">
                           <span className="text-white font-bold">{u.username[0].toUpperCase()}</span>
                        </div>
                        <span className="text-[#e9edef] font-medium">{u.username}</span>
                     </div>
                     <span className="text-xs text-[#8696a0]">Tap to view</span>
                  </div>
               ))
            )}
          </div>
       </div>
    </div>,
    document.body
  );
};

  if (showProfile) {
    return (
      <div className="flex flex-col h-full bg-[#111b21] animate-fade-in w-full">
        <div className="h-[108px] bg-[#202c33] px-4 flex items-end pb-4">
          <div className="flex items-center text-[#d1d7db] cursor-pointer" onClick={() => setShowProfile(false)}>
            <ArrowLeft className="w-6 h-6 mr-6" />
            <h1 className="text-xl font-medium">Profile</h1>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto w-full">
          <div className="flex justify-center py-8">
            <div className="w-48 h-48 bg-[#4f5e67] rounded-full flex items-center justify-center">
              <UserIcon className="w-24 h-24 text-[#d1d7db]" />
            </div>
          </div>
          <div className="px-8 py-4 bg-[#111b21]">
            <p className="text-[#00a884] text-sm mb-2">Your Name</p>
            <p className="text-[#e9edef] text-lg mb-6">{currentUser.username}</p>
            <p className="text-[#00a884] text-sm mb-2">Email</p>
            <p className="text-[#e9edef] text-lg mb-6">{currentUser.email}</p>
            
            <div className="mt-8">
              {!showChangePassword ? (
                <button onClick={() => setShowChangePassword(true)} className="flex items-center text-[#00a884] hover:text-[#06cf9c] transition-colors">
                  <Key className="w-5 h-5 mr-3" />
                  <span>Change Password</span>
                </button>
              ) : (
                <div className="bg-[#202c33] p-4 rounded-lg">
                  <h3 className="text-[#e9edef] mb-4">Change Password</h3>
                  {!otpSent ? (
                    <button onClick={handleRequestOtp} className="w-full bg-[#00a884] text-white py-2 rounded">
                      Request OTP
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input type="text" placeholder="Enter OTP" className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2" value={otp} onChange={e => setOtp(e.target.value)} />
                      <input type="password" placeholder="New Password" className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                      <button onClick={handleChangePassword} className="w-full bg-[#00a884] text-white py-2 rounded">Confirm Change</button>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/logout', { 
                      method: 'POST', 
                      headers: { 'x-csrf-token': getCookie('csrf_token') || '' },
                      credentials: 'include' 
                    });
                  } catch(e) {}
                  localStorage.removeItem('stego_profile');
                  window.location.reload();
                }}
                className="flex items-center text-red-500 hover:text-red-400 mt-8 w-full transition-colors font-medium"
              >
                <LogOut className="w-5 h-5 mr-3" />
                <span>Log Out</span>
              </button>

              {/* Danger Zone */}
              <div className="mt-6 border border-red-900/40 rounded-lg p-4 bg-red-950/20">
                <p className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-3">Danger Zone</p>
                <p className="text-[#8696a0] text-xs mb-4">Permanently delete your account and all your data. Your email can be used to create a new account after deletion.</p>
                <button
                  onClick={() => { setShowDeleteModal(true); setDeletePassword(''); setDeleteError(''); }}
                  className="flex items-center gap-2 text-sm text-red-500 hover:text-red-400 border border-red-800 hover:border-red-600 px-4 py-2 rounded-lg transition-all w-full justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete My Account
                </button>
              </div>

              {/* Delete Account Confirmation Modal */}
              {showDeleteModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
                  <div className="bg-[#202c33] rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-red-900/40">
                    <h3 className="text-[#e9edef] font-bold text-lg mb-2">Delete Account</h3>
                    <p className="text-[#8696a0] text-sm mb-4">
                      This will permanently delete your account, all your chats, and all your data. <span className="text-red-400 font-semibold">This cannot be undone.</span>
                    </p>
                    <p className="text-[#e9edef] text-sm mb-2">Enter your password to confirm:</p>
                    <input
                      id="delete-confirm-password"
                      name="delete-confirm-password"
                      type="password"
                      placeholder="Your current password"
                      value={deletePassword}
                      onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
                      className="w-full bg-[#111b21] text-[#e9edef] border border-[#2a3942] focus:border-red-500 rounded-lg px-3 py-2 text-sm outline-none mb-2"
                      autoFocus
                    />
                    {deleteError && <p className="text-red-400 text-xs mb-3">{deleteError}</p>}
                    <div className="flex gap-3 mt-4">
                      <button
                        onClick={() => setShowDeleteModal(false)}
                        className="flex-1 py-2 rounded-lg border border-[#2a3942] text-[#8696a0] hover:text-[#e9edef] transition-colors text-sm"
                      >Cancel</button>
                      <button
                        disabled={isDeleting || !deletePassword.trim()}
                        onClick={async () => {
                          setIsDeleting(true);
                          setDeleteError('');
                          try {
                            // Verify password first via login endpoint
                            const verifyRes = await fetch('/api/login', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCookie('csrf_token') || '' },
                              credentials: 'include',
                              body: JSON.stringify({ email: currentUser.email, password: deletePassword })
                            });
                            const verifyData = await verifyRes.json();
                            if (!verifyData.success) {
                              setDeleteError('Incorrect password. Please try again.');
                              setIsDeleting(false);
                              return;
                            }
                            // Now delete
                            const res = await fetch('/api/me', {
                              method: 'DELETE',
                              headers: { 'x-csrf-token': getCookie('csrf_token') || '' },
                              credentials: 'include'
                            });
                            const data = await res.json();
                            if (data.success) {
                              localStorage.clear();
                              window.location.reload();
                            } else {
                              setDeleteError(data.error || 'Deletion failed. Please try again.');
                            }
                          } catch(e) {
                            setDeleteError('Network error. Please try again.');
                          }
                          setIsDeleting(false);
                        }}
                        className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                      >
                        {isDeleting ? 'Deleting...' : 'Delete Forever'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine lists
  let displayUsers: User[] = [];
  const incomingRequests = sessions.filter(s => s.status === 'pending' && s.initiator_id !== currentUser.id);
  const activeChatSessions = sessions.filter(s => s.status === 'accepted' || (s.status === 'pending' && s.initiator_id === currentUser.id));

  if (search.trim().length > 0) {
     displayUsers = users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()));
  } else if (activeTab === 'chats') {
     const chatUserIds = new Set(activeChatSessions.map(s => s.user1_id === currentUser.id ? s.user2_id : s.user1_id));
     displayUsers = users.filter(u => chatUserIds.has(u.id));
  } else if (activeTab === 'requests') {
     const reqUserIds = new Set(incomingRequests.map(s => s.user1_id === currentUser.id ? s.user2_id : s.user1_id));
     displayUsers = users.filter(u => reqUserIds.has(u.id));
  }

  return (
    <div className="flex flex-col h-full bg-[#111b21] w-full max-w-full">
      {/* Header */}
      <div className="h-[60px] bg-[#202c33] px-4 flex items-center justify-between shadow-md z-10 w-full">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setShowProfile(true)}>
          <div className="w-10 h-10 bg-[#4f5e67] rounded-full flex items-center justify-center">
            <span className="text-[#d1d7db] font-bold text-lg">{currentUser.username[0].toUpperCase()}</span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-[#aebac1]">
          {currentUser.isAdmin && (
            <Activity className="w-5 h-5 cursor-pointer text-[#00a884] hover:text-[#06cf9c]" onClick={onShowAdmin} title="Admin Dashboard" />
          )}

          {/* Notifications Bell Icon */}
          <div className="relative">
             <Bell className="w-5 h-5 cursor-pointer hover:text-[#d1d7db] transition-colors" onClick={handleToggleNotifications} />
             {hasUnreadAlerts && notifications.length > 0 && (
                <span className="absolute top-[-2px] right-[-2px] w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse border border-[#202c33]"></span>
             )}
             {showNotifications && (
                <div className="absolute right-[-40px] mt-2 w-80 rounded-2xl shadow-2xl bg-[#2a3942] border border-[#3a4952] z-[999] overflow-hidden flex flex-col max-h-[400px]">
                   <div className="p-4 border-b border-[#3a4952] flex justify-between items-center bg-[#202c33]">
                      <h3 className="text-white font-bold text-sm flex items-center">
                         <Bell className="w-4 h-4 mr-2 text-[#00a884]" /> Notifications
                      </h3>
                      {notifications.length > 0 && (
                         <button onClick={onClearNotifications} className="text-xs text-red-400 hover:text-red-300 font-bold flex items-center gap-1">
                            <Trash2 className="w-3.5 h-3.5" /> Clear All
                         </button>
                      )}
                   </div>
                   <div className="flex-1 overflow-y-auto divide-y divide-[#3a4952] max-h-64 custom-scrollbar bg-[#111b21]">
                      {notifications.length === 0 ? (
                         <div className="p-6 text-center text-[#8696a0] text-xs">
                            No alerts or updates.
                         </div>
                      ) : (
                         notifications.map((n) => (
                            <div key={n.id} className="p-4 hover:bg-[#202c33] transition-colors flex gap-3 text-xs leading-relaxed">
                               <div className="flex-shrink-0">
                                  {n.type === 'alert' ? (
                                     <div className="w-8 h-8 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center text-red-500">
                                        <ShieldAlert className="w-4 h-4" />
                                     </div>
                                  ) : (
                                     <div className="w-8 h-8 bg-[#00a884]/10 border border-[#00a884]/30 rounded-full flex items-center justify-center text-[#00a884]">
                                        <Shield className="w-4 h-4" />
                                     </div>
                                  )}
                               </div>
                               <div className="flex-1 min-w-0">
                                  <h4 className="font-bold text-white mb-1">{n.title}</h4>
                                  <p className="text-[#8696a0] text-left">{n.message}</p>
                                  <span className="text-[10px] text-[#8696a0] mt-1 block">
                                     {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                               </div>
                            </div>
                         ))
                      )}
                   </div>
                </div>
             )}
          </div>

          <div className="relative">
             <MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => setShowDropdown(!showDropdown)} />
             {showDropdown && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl shadow-2xl bg-[#2a3942] border border-[#3a4952] z-50 overflow-hidden">
                   <button onClick={() => { onShowOnboarding?.(); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#00a884] hover:bg-[#202c33] transition-colors font-medium flex items-center border-b border-[#3a4952]">
                      <BookOpen className="w-4 h-4 mr-2" /> User Guide
                   </button>
                   <button onClick={() => { onSyncRequest?.(); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#e9edef] hover:bg-[#202c33] transition-colors font-medium flex items-center">
                      <Download className="w-4 h-4 mr-2" /> Sync from Device
                   </button>
                   <button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#e9edef] hover:bg-[#202c33] transition-colors font-medium">
                      Submit Feedback
                   </button>
                   <button onClick={() => { setShowBlockedUsersModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#e9edef] hover:bg-[#202c33] transition-colors font-medium">
                      Blocked Users
                   </button>
                </div>
             )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#202c33] border-b border-[#2a3942] w-full">
         <button onClick={() => setActiveTab('chats')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'chats' ? 'text-[#00a884] border-[#00a884]' : 'text-[#8696a0] border-transparent hover:text-white'}`}>
           Chats
         </button>
         <button onClick={() => setActiveTab('requests')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors relative ${activeTab === 'requests' ? 'text-[#00a884] border-[#00a884]' : 'text-[#8696a0] border-transparent hover:text-white'}`}>
           Requests
           {incomingRequests.length > 0 && <span className="absolute top-2 right-4 w-2 h-2 bg-red-500 rounded-full"></span>}
         </button>
         <button onClick={() => setActiveTab('calls')} className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'calls' ? 'text-[#00a884] border-[#00a884]' : 'text-[#8696a0] border-transparent hover:text-white'}`}>
           Calls
         </button>
      </div>

      {showFeedbackModal && (
          <FeedbackModal onClose={() => setShowFeedbackModal(false)} />
      )}
      
      {showBlockedUsersModal && (
          <BlockedUsersModal onClose={() => setShowBlockedUsersModal(false)} users={blockedUsersList} onSelect={onSelectUser} />
      )}

      {/* Search */}
      <div className="p-3 bg-[#111b21] w-full">
        <div className="relative bg-[#202c33] rounded-xl flex items-center px-4 py-2 mt-1">
          <Search className="w-4 h-4 text-[#8696a0] mr-3" />
          <input
            id="search-users"
            name="search-users"
            type="text"
            placeholder="Search all users..."
            className="bg-transparent text-[#d1d7db] text-sm w-full focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto w-full">
        {activeTab === 'calls' && search.length === 0 ? (
           calls.length === 0 ? (
             <p className="text-[#8696a0] p-6 text-center text-sm">No recent calls.</p>
           ) : (
             calls.map(call => {
               const targetUser = getTargetUser(call);
               const isMissed = call.status === 'missed';
               const isOutgoing = call.from_id === currentUser.id;
               
               return (
                 <div key={call.id} className="flex items-center px-4 py-3 hover:bg-[#202c33] transition-colors border-b border-[#2a3942]/50">
                    <div className="w-12 h-12 bg-[#4f5e67] rounded-full flex items-center justify-center mr-4">
                      <span className="text-[#d1d7db] font-bold text-lg">{targetUser.username[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                       <h3 className={`font-medium truncate ${isMissed && !isOutgoing ? 'text-red-500' : 'text-[#e9edef]'}`}>{targetUser.username}</h3>
                       <div className="flex items-center text-xs text-[#8696a0] mt-1 space-x-1">
                          {isMissed && !isOutgoing ? <PhoneMissed className="w-3 h-3 text-red-500" /> : (isOutgoing ? <PhoneOutgoing className="w-3 h-3 text-green-500" /> : <PhoneIncoming className="w-3 h-3 text-blue-400" />)}
                          <span>{new Date(call.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                       </div>
                    </div>
                    <button onClick={() => onSelectUser(targetUser as User)} className="p-3 bg-[#0a1014] hover:bg-[#2a3942] rounded-full transition-colors ml-2">
                      <Phone className="w-4 h-4 text-[#00a884]" />
                    </button>
                 </div>
               );
             })
           )
        ) : (
          displayUsers.length === 0 ? (
            <div className="p-6 text-center text-[#8696a0] text-sm">
              {search ? 'No users found.' : (activeTab === 'chats' ? 'Find someone via Search to start chatting!' : 'No pending requests.')}
            </div>
          ) : (
            displayUsers.map(user => {
              const isSearch = search.length > 0;
              const hasReq = incomingRequests.some(s => s.user1_id === user.id || s.user2_id === user.id);
              
              return (
                <div
                  key={user.id}
                  onClick={() => onSelectUser(user)}
                  className={`flex items-center px-4 py-3 cursor-pointer hover:bg-[#202c33] transition-colors border-b border-[#2a3942]/50 ${activeUserId === user.id ? 'bg-[#2a3942]' : ''}`}
                >
                  <div className="w-14 h-14 bg-gradient-to-br from-[#00a884] to-[#046a53] rounded-full flex items-center justify-center mr-4 shadow-lg border-2 border-[#111b21] flex-shrink-0">
                    <span className="text-white font-bold text-xl">{user.username[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="text-[#e9edef] font-medium text-lg truncate">{user.username}</h3>
                      <span className={`text-xs ml-2 flex-shrink-0 ${onlineUsers.includes(Number(user.id)) ? 'text-[#00a884]' : 'text-[#8696a0]'}`}>
                        {onlineUsers.includes(Number(user.id)) ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    {isSearch ? (
                      <div className="flex items-center text-sm text-[#00a884]">
                         <UserPlus className="w-4 h-4 mr-2" /> Message
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-sm mt-0.5">
                        <p className={`truncate pr-2 flex-1 ${unreadCounts?.[user.id] ? 'text-white font-medium' : 'text-[#8696a0]'}`}>
                          {hasReq ? 'Wants to message you' : (lastMessages?.[user.id] || "No messages yet")}
                        </p>
                        {unreadCounts?.[user.id] ? (
                          <div className="w-5 h-5 bg-[#00a884] rounded-full flex items-center justify-center flex-shrink-0 animate-pulse">
                            <span className="text-xs text-white font-bold">{unreadCounts[user.id]}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}
