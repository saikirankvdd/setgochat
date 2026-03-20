import { useState, useEffect } from 'react';
import { User } from '../App';
import { Search, MoreVertical, MessageSquare, User as UserIcon, LogOut, Activity, ArrowLeft, Key } from 'lucide-react';

interface SidebarProps {
  currentUser: User;
  users: User[];
  onSelectUser: (user: User) => void;
  activeUserId?: number;
  onShowAdmin: () => void;
  onlineUsers: number[];
  lastMessages?: Record<number, string>;
  unreadCounts?: Record<number, number>;
}

export function Sidebar({ currentUser, users, onSelectUser, activeUserId, onShowAdmin, onlineUsers, lastMessages, unreadCounts }: SidebarProps) {
  const [search, setSearch] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const handleRequestOtp = async () => {
    try {
      const res = await fetch('/api/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: currentUser.username })
      });
      if (res.ok) {
        setOtpSent(true);
        alert('OTP sent to admin. Please ask admin for the OTP.');
      }
    } catch (err) {
      console.error(err);
    }
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
        setOtpSent(false);
        setOtp('');
        setNewPassword('');
      } else {
        alert('Invalid OTP or error changing password');
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (showProfile) {
    return (
      <div className="flex flex-col h-full bg-[#111b21] animate-fade-in">
        <div className="h-[108px] bg-[#202c33] px-4 flex items-end pb-4">
          <div className="flex items-center text-[#d1d7db] cursor-pointer" onClick={() => setShowProfile(false)}>
            <ArrowLeft className="w-6 h-6 mr-6" />
            <h1 className="text-xl font-medium">Profile</h1>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
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
                <button 
                  onClick={() => setShowChangePassword(true)}
                  className="flex items-center text-[#00a884] hover:text-[#06cf9c] transition-colors"
                >
                  <Key className="w-5 h-5 mr-3" />
                  <span>Change Password</span>
                </button>
              ) : (
                <div className="bg-[#202c33] p-4 rounded-lg">
                  <h3 className="text-[#e9edef] mb-4">Change Password</h3>
                  {!otpSent ? (
                    <button 
                      onClick={handleRequestOtp}
                      className="w-full bg-[#00a884] text-white py-2 rounded hover:bg-[#06cf9c] transition-colors"
                    >
                      Request OTP from Admin
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input 
                        type="text" 
                        placeholder="Enter OTP" 
                        className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 focus:outline-none"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                      />
                      <input 
                        type="password" 
                        placeholder="New Password" 
                        className="w-full bg-[#2a3942] text-[#e9edef] rounded px-3 py-2 focus:outline-none"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                      />
                      <button 
                        onClick={handleChangePassword}
                        className="w-full bg-[#00a884] text-white py-2 rounded hover:bg-[#06cf9c] transition-colors"
                      >
                        Confirm Change
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#111b21]">
      {/* Header */}
      <div className="h-[60px] bg-[#202c33] px-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setShowProfile(true)}>
          <div className="w-10 h-10 bg-[#4f5e67] rounded-full flex items-center justify-center">
            <UserIcon className="w-6 h-6 text-[#d1d7db]" />
          </div>
          <span className="text-[#e9edef] font-medium">{currentUser.username}</span>
        </div>
        <div className="flex items-center space-x-4 text-[#aebac1]">
          {currentUser.isAdmin && (
            <Activity 
              className="w-5 h-5 cursor-pointer text-[#00a884] hover:text-[#06cf9c]" 
              onClick={onShowAdmin} 
              title="Admin Dashboard" 
            />
          )}
          <Search className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" />
          <MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" />
        </div>
      </div>

      {/* Search */}
      <div className="p-2 bg-[#111b21]">
        <div className="relative bg-[#202c33] rounded-lg flex items-center px-3 py-1.5">
          <Search className="w-4 h-4 text-[#8696a0] mr-3" />
          <input
            type="text"
            placeholder="Search or start new chat"
            className="bg-transparent text-[#d1d7db] text-sm w-full focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto">
        {filteredUsers.map(user => (
          <div
            key={user.id}
            onClick={() => onSelectUser(user)}
            className={`flex items-center px-3 py-3 cursor-pointer hover:bg-[#202c33] transition-colors border-b border-[#2a3942]/50 ${
              activeUserId === user.id ? 'bg-[#2a3942]' : ''
            }`}
          >
            <div className="w-12 h-12 bg-[#4f5e67] rounded-full flex items-center justify-center mr-4 flex-shrink-0">
              <UserIcon className="w-7 h-7 text-[#d1d7db]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <h3 className="text-[#e9edef] font-medium truncate">{user.username}</h3>
                <span className={`text-xs ml-2 flex-shrink-0 ${unreadCounts?.[user.id] ? 'text-[#00a884] font-medium' : (onlineUsers.includes(user.id) ? 'text-[#00a884]' : 'text-[#8696a0]')}`}>
                  {unreadCounts?.[user.id] ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (onlineUsers.includes(user.id) ? 'Online' : 'Offline')}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <p className="text-[#8696a0] truncate pr-2 flex-1">
                  {lastMessages?.[user.id] || "Click to start secure session"}
                </p>
                {unreadCounts?.[user.id] ? (
                  <div className="w-5 h-5 bg-[#00a884] rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xs text-white font-medium">{unreadCounts[user.id]}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
