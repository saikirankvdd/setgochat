import React, { useState } from 'react';
import { User } from '../App';
import { Lock, Mail, User as UserIcon, ShieldCheck } from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

export function Auth({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const endpoint = isLogin ? '/api/login' : '/api/signup';
    const body = isLogin ? { username, password } : { username, email, password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (data.success) {
        if (isLogin) {
          onLogin(data.user);
        } else {
          setIsLogin(true);
          alert('Signup successful! Please login.');
        }
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch (err) {
      setError('Failed to connect to server');
    }
  };

  return (
    <div className="min-h-screen bg-[#111b21] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#202c33] rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-8">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-[#00a884] rounded-full flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-12 h-12 text-white" />
            </div>
          </div>
          
          <h2 className="text-3xl font-bold text-center text-[#e9edef] mb-2">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-[#8696a0] text-center mb-8">
            {isLogin ? 'Login to your secure vault' : 'Join the secure communication network'}
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
              <input
                type="text"
                placeholder="Username"
                className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            {!isLogin && (
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
                <input
                  type="email"
                  placeholder="Email Address"
                  className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
              <input
                type="password"
                placeholder="Password"
                className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold py-3 rounded-lg transition-colors shadow-lg"
            >
              {isLogin ? 'Login' : 'Sign Up'}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-[#00a884] hover:underline text-sm font-medium"
            >
              {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
