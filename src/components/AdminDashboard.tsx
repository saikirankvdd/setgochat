import React, { useEffect, useState } from 'react';
import { User } from '../App';
import { Users, MessageSquare, ShieldAlert, Activity, ArrowLeft, Trash2 } from 'lucide-react';

interface AdminDashboardProps {
  user: User;
  onBack: () => void;
}

interface AdminStats {
  totalUsers: number;
  activeSessions: number;
  connections: number;
  uptime: number;
  usersList: { id: number; maskedName: string; maskedEmail: string }[];
  sessionsList: { id: string; user1_id: number; user2_id: number; created_at: string }[];
}

interface FeedbackItem {
  id: string;
  text: string;
  images: string[];
  created_at: string;
  username: string;
}

export function AdminDashboard({ user, onBack }: AdminDashboardProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch admin stats', err);
        setLoading(false);
      });

    fetch('/api/admin/feedback', {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
      .then(res => res.json())
      .then(data => {
         if (Array.isArray(data)) setFeedbacks(data);
      })
      .catch(console.error);
  }, []);

  const handleDeleteUser = async (targetId: number) => {
    if (targetId === user.id) {
       alert("You cannot delete your own admin account.");
       return;
    }
    if (!window.confirm("Are you sure you want to completely delete this user? This will instantly erase them and their session history.")) return;
    
    try {
       const res = await fetch(`/api/admin/users/${targetId}`, { 
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${user.token}` }
       });
       if (res.ok) {
          setStats(prev => {
             if (!prev) return prev;
             return {
                ...prev,
                usersList: prev.usersList.filter(u => u.id !== targetId),
                totalUsers: prev.totalUsers - 1
             };
          });
       } else {
          alert('Failed to delete user.');
       }
    } catch(e) { console.error(e); }
  };

  if (!user.isAdmin) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111b21] text-red-500 font-bold">
        UNAUTHORIZED ACCESS
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111b21] p-8 text-[#e9edef] w-full overflow-y-auto w-full absolute inset-0 z-50">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold flex items-center">
            <ShieldAlert className="w-8 h-8 mr-3 text-[#00a884]" />
            Admin Security Dashboard
          </h1>
          <button onClick={onBack} className="flex items-center px-4 py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white rounded-lg transition shadow-lg font-medium">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Chat
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-[#202c33] p-6 rounded-xl border border-[#2a3942] flex items-center shadow-lg">
                <div className="w-12 h-12 bg-[#00a884]/20 text-[#00a884] rounded-full flex items-center justify-center mr-4">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[#8696a0] text-sm">Total Users</p>
                  <p className="text-2xl font-bold">{stats.totalUsers}</p>
                </div>
              </div>

              <div className="bg-[#202c33] p-6 rounded-xl border border-[#2a3942] flex items-center shadow-lg">
                <div className="w-12 h-12 bg-purple-500/20 text-purple-500 rounded-full flex items-center justify-center mr-4">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[#8696a0] text-sm">Socket Connections</p>
                  <p className="text-2xl font-bold">{stats.connections}</p>
                </div>
              </div>

              <div className="bg-[#202c33] p-6 rounded-xl border border-[#2a3942] flex items-center shadow-lg">
                <div className="w-12 h-12 bg-orange-500/20 text-orange-500 rounded-full flex items-center justify-center mr-4">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[#8696a0] text-sm">Uptime</p>
                  <p className="text-2xl font-bold">{(stats.uptime / 3600).toFixed(1)} hrs</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-8">
              {/* Users List */}
              <div className="bg-[#202c33] rounded-xl border border-[#2a3942] overflow-hidden shadow-lg">
                <div className="bg-[#2a3942] px-6 py-4 flex items-center justify-between border-b border-[#3a4952]">
                  <h3 className="font-semibold text-[#e9edef] flex items-center">
                    <Users className="w-5 h-5 mr-2 text-[#aebac1]" />
                    Registered Users (Anonymized)
                  </h3>
                  <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full font-bold">Privacy Enabled</span>
                </div>
                <div className="max-h-96 overflow-y-auto p-4 space-y-3">
                  {stats.usersList?.map(u => (
                    <div key={u.id} className="bg-[#111b21] p-3 rounded-lg flex justify-between items-center border border-[#2a3942] hover:bg-[#202c33] transition-colors">
                      <div className="flex items-center">
                        <div className="w-8 h-8 rounded-full bg-[#4f5e67] flex items-center justify-center mr-3 flex-shrink-0 text-sm">
                          <Users className="w-4 h-4 text-[#d1d7db]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm text-[#00a884] truncate">{u.maskedName}</p>
                          <p className="text-xs text-[#8696a0] font-mono truncate">
                            {u.maskedEmail} <span className="text-[#3a4952] italic ml-1 select-all">({u.id})</span>
                          </p>
                        </div>
                      </div>
                      
                      {u.id !== user.id && (
                        <button 
                           onClick={() => handleDeleteUser(u.id)}
                           className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors focus:outline-none"
                           title="Permanently Delete User"
                        >
                           <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {(!stats.usersList || stats.usersList.length === 0) && <p className="text-center text-[#8696a0] py-4">No users found.</p>}
                </div>
              </div>

              {/* Feedback Section */}
              <div className="bg-[#202c33] rounded-xl border border-[#2a3942] overflow-hidden shadow-lg">
                <div className="bg-[#2a3942] px-6 py-4 flex items-center justify-between border-b border-[#3a4952]">
                  <h3 className="font-semibold text-[#e9edef] flex items-center">
                    <MessageSquare className="w-5 h-5 mr-2 text-[#aebac1]" />
                    Feedback from Users
                  </h3>
                </div>
                <div className="max-h-[600px] overflow-y-auto p-4 space-y-4">
                  {feedbacks.length === 0 ? (
                      <p className="text-[#8696a0] text-center italic py-6">No feedback submitted yet.</p>
                  ) : (
                    feedbacks.map(f => (
                      <div key={f.id} className="bg-[#111b21] p-5 rounded-lg border border-[#2a3942]">
                         <div className="flex justify-between items-center mb-3">
                            <span className="font-bold text-[#00a884]">{f.username}</span>
                            <span className="text-xs text-[#8696a0]">{new Date(f.created_at).toLocaleString()}</span>
                         </div>
                         {f.text && <p className="text-[#e9edef] whitespace-pre-wrap mb-4">{f.text}</p>}
                         {f.images && f.images.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                               {f.images.map((img, i) => (
                                  <a key={i} href={img} target="_blank" rel="noreferrer" className="w-24 h-24 rounded border border-[#2a3942] overflow-hidden block hover:opacity-80 transition-opacity">
                                     <img src={img} className="w-full h-full object-cover" />
                                  </a>
                               ))}
                            </div>
                         )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="mt-8 bg-[#111b21] p-4 rounded-xl border border-[#2a3942] w-full">
              <p className="text-xs text-[#8696a0] italic text-center">
                * Admin panel provides system-level metrics only. Encrypted message contents are never accessible to the server or administrators. Usernames and emails are irreversibly hashed before reaching the frontend.
              </p>
            </div>
          </>
        ) : (
          <div className="text-center py-20 text-red-400">
            Failed to load data. Please make sure the server is running.
          </div>
        )}
      </div>
    </div>
  );
}
