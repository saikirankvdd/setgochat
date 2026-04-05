import React, { useState } from 'react';
import { User } from '../App';
import { Search, MoreVertical, MessageSquare, User as UserIcon, Activity, ArrowLeft, Key, Phone, PhoneMissed, PhoneIncoming, PhoneOutgoing, UserPlus, LogOut, X } from 'lucide-react';

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
}

export function Sidebar({ currentUser, users, sessions, calls, onSelectUser, activeUserId, onShowAdmin, onlineUsers, lastMessages, unreadCounts }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'requests' | 'calls'>('chats');
  const [showProfile, setShowProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  const getTargetUser = (call: any) => {
    const id = call.from_id === currentUser.id ? call.to_id : call.from_id;
    return users.find(u => u.id === id) || { id, username: 'Unknown User' };
  };

  const handleRequestOtp = async () => {
    try {
      const res = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: currentUser.username })
      });
      if (res.ok) {
        setOtpSent(true);
        alert('OTP sent via email.');
      }
    } catch (err) { console.error(err); }
  };

  const handleChangePassword = async () => {
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: currentUser.username, otp, newPassword })
      });
      if (res.ok) {
        alert('Password changed successfully!');
        setShowChangePassword(false);
        setOtpSent(false); setOtp(''); setNewPassword('');
      } else { alert('Invalid OTP or error changing password'); }
    } catch (err) { console.error(err); }
  };

const FeedbackModal = ({ onClose, token }: { onClose: () => void, token: string }) => {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];
    if (images.length + files.length > 10) {
       alert("Maximum 10 screenshots allowed.");
       return;
    }
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
         setImages(prev => [...prev].slice(0, 9).concat(reader.result as string));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async () => {
    if (!text.trim() && images.length === 0) {
       alert("Please enter feedback or attach screenshots.");
       return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text, images })
      });
      if (res.ok) {
         alert("Thank you! Your feedback has been sent directly to the admin.");
         onClose();
      } else {
         const data = await res.json();
         alert("Error: " + data.error);
      }
    } catch(err) {
      alert("Error sending feedback.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
     <div className="fixed inset-0 bg-[#0b141a]/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
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
     </div>
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
              <button onClick={() => { localStorage.removeItem('stego_user'); window.location.reload(); }} className="flex items-center text-red-500 hover:text-red-400 mt-8 w-full transition-colors font-medium">
                <LogOut className="w-5 h-5 mr-3" />
                <span>Log Out</span>
              </button>
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
          <div className="relative">
             <MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => setShowDropdown(!showDropdown)} />
             {showDropdown && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl shadow-2xl bg-[#2a3942] border border-[#3a4952] z-50 overflow-hidden">
                   <button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#e9edef] hover:bg-[#202c33] transition-colors font-medium">
                      Submit Feedback
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
          <FeedbackModal onClose={() => setShowFeedbackModal(false)} token={currentUser.token!} />
      )}

      {/* Search */}
      <div className="p-3 bg-[#111b21] w-full">
        <div className="relative bg-[#202c33] rounded-xl flex items-center px-4 py-2 mt-1">
          <Search className="w-4 h-4 text-[#8696a0] mr-3" />
          <input
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
                      <span className={`text-xs ml-2 flex-shrink-0 ${onlineUsers.includes(user.id) ? 'text-[#00a884]' : 'text-[#8696a0]'}`}>
                        {onlineUsers.includes(user.id) ? 'Online' : 'Offline'}
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
