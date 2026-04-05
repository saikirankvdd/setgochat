import React, { useState } from 'react';
import { User } from '../App';
import { Lock, Mail, User as UserIcon, ShieldCheck, Key, X } from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

const TermsModal = ({ onClose }: { onClose: () => void }) => (
  <div className="fixed inset-0 bg-[#0b141a]/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
    <div className="bg-[#202c33] rounded-2xl w-full max-w-2xl p-6 border border-[#2a3942] shadow-2xl flex flex-col max-h-[80vh]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">Terms of Service & Privacy Policy</h2>
        <button onClick={onClose} className="text-[#8696a0] hover:text-white transition-colors p-1 rounded hover:bg-[#2a3942]">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto pr-4 text-[#e9edef] space-y-4 flex-1 text-sm leading-relaxed custom-scrollbar py-2">
        <p><strong>Last Updated: {new Date().toLocaleDateString()}</strong></p>
        <h3 className="text-lg font-bold text-[#00a884] mt-4">1. Acceptance of Terms</h3>
        <p>By registering for or using StegoChat, you strictly agree to these Terms. We reserve the right to suspend or eternally ban any user who violates these guidelines without notice via our automated moderation system.</p>
        
        <h3 className="text-lg font-bold text-[#00a884] mt-4">2. Privacy and Data Security</h3>
        <p>StegoChat is constructed entirely upon End-to-End Encryption (E2EE) with impenetrable audio steganography algorithms. <strong>We do not read, intercept, or store your raw or decrypted messages.</strong> Your keys live entirely on your device. However, you are strictly prohibited from utilizing this infrastructure to exchange illicit, dangerous, or illegal materials.</p>

        <h3 className="text-lg font-bold text-[#00a884] mt-4">3. Limitation of Liability (Immunity Clause)</h3>
        <p><strong>StegoChat assumes absolutely zero responsibility or liability for user-generated content or behavior.</strong> Operating similarly to how Internet Service Providers (ISPs) or standard telecom networks function, our technology acts strictly as an unmonitored encrypted conduit. We are entirely immune from and hold no responsibility for any direct, indirect, incidental, or consequential damages resulting from any interactions, transactions, illegalities, or communications conducted between users on the platform.</p>
        
        <h3 className="text-lg font-bold text-[#00a884] mt-4">4. Cookie Policy & Consent</h3>
        <p>By using this service, you consent to our extremely strictly necessary cookies. We use essential cryptographic cookies and HTML5 local browser storage exclusively to secure your cryptographic key pairs natively on your device and maintain your active socket sessions against brute-force attacks. Absolutely no third-party tracking or targeted marketing cookies are utilized here.</p>

        <h3 className="text-lg font-bold text-[#00a884] mt-4">5. Community Reporting & Enforcement</h3>
        <p>If you encounter content violating community safety bounds, please utilize our in-app reporting feature dynamically hidden within the Chat Area. Our automated moderation systems issue strikes. Accumulating 3 warnings will result in an immediate permanent, irrevocable ban from StegoChat infrastructure.</p>
      </div>
      <div className="mt-6 pt-4 border-t border-[#2a3942] flex justify-end">
        <button onClick={onClose} className="px-6 py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white rounded-lg font-bold transition-colors">
          Acknowledge & Close
        </button>
      </div>
    </div>
  </div>
);

export function Auth({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [signupOtpSent, setSignupOtpSent] = useState(false);
  
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [error, setError] = useState('');

  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!hasAcceptedTerms) {
       setError('Please accept the Terms of Service & Privacy Policy to continue.');
       return;
    }
    
    const endpoint = isLogin ? '/api/login' : '/api/signup';
    const body: any = isLogin ? { username, password } : { username, email, password, otp };

    if (!isLogin) {
      try {
        const { generateRSAKeyPair, encryptPrivateKeyWithPassword } = await import('../utils/e2ee');
        const keys = await generateRSAKeyPair();
        body.publicKey = keys.publicKey;
        body.encryptedPrivateKey = encryptPrivateKeyWithPassword(keys.privateKey, password);
      } catch (err) {
        console.error('Key generation failed', err);
        setError('Failed to generate secure E2E encryption keys');
        return;
      }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (data.success) {
        if (isLogin) {
          try {
            const { decryptPrivateKeyWithPassword } = await import('../utils/e2ee');
            let privateKey = '';
            if (data.user.encryptedPrivateKey && data.user.encryptedPrivateKey !== 'ADMIN') {
               privateKey = decryptPrivateKeyWithPassword(data.user.encryptedPrivateKey, password);
            }
            onLogin({ ...data.user, privateKey });
          } catch(err) {
            setError('Vault decryption failed. Please check credentials.');
          }
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

  const handleRequestRegisterOtp = async () => {
    if (!email) {
      setError('Please enter your email to receive an OTP.');
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/request-register-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setSignupOtpSent(true);
        alert('OTP sent! Please check your email (and spam folder).');
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch (err) {
      setError('Failed to connect to server');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!otpSent) {
      if (!username) { setError('Please enter your Username or Email'); return; }
      try {
        const res = await fetch('/api/request-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailOrUsername: username }),
        });
        const data = await res.json();
        if (data.success) {
          setOtpSent(true);
          alert('If an account exists, an OTP has been requested. (Check server logs in dev mode for the OTP)');
        } else {
          setError(data.error || 'Something went wrong');
        }
      } catch (err) {
        setError('Failed to connect to server');
      }
    } else {
      if (!otp || !newPassword) { setError('Please enter OTP and New Password'); return; }
      try {
        const res = await fetch('/api/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailOrUsername: username, otp, newPassword }),
        });
        const data = await res.json();
        if (data.success) {
          alert('Password changed successfully! You can now login.');
          setIsForgotPassword(false);
          setIsLogin(true);
          setOtpSent(false);
          setPassword('');
          setOtp('');
          setNewPassword('');
        } else {
          setError(data.error || 'Invalid OTP');
        }
      } catch (err) {
        setError('Failed to connect to server');
      }
    }
  };

  if (isForgotPassword) {
    return (
      <div className="min-h-screen bg-[#111b21] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#202c33] rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8">
            <div className="flex justify-center mb-8">
              <div className="w-20 h-20 bg-[#00a884] rounded-full flex items-center justify-center shadow-lg">
                <Key className="w-12 h-12 text-white" />
              </div>
            </div>
            
            <h2 className="text-3xl font-bold text-center text-[#e9edef] mb-2">
              Reset Password
            </h2>
            <p className="text-[#8696a0] text-center mb-8">
              {otpSent ? 'Enter the OTP to set your new password' : 'Enter your Username or Email'}
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-6 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleForgotPassword} className="space-y-4">
              {!otpSent ? (
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
                  <input
                    type="text"
                    placeholder="Username or Email"
                    className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
                    <input
                      type="text"
                      placeholder="Enter 6-digit OTP"
                      className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
                    <input
                      type="password"
                      placeholder="New Password"
                      className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                className="w-full bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold py-3 rounded-lg transition-colors shadow-lg"
              >
                {otpSent ? 'Confirm Password Change' : 'Request OTP'}
              </button>
            </form>

            <div className="mt-8 text-center">
              <button
                onClick={() => {
                  setIsForgotPassword(false);
                  setOtpSent(false);
                  setError('');
                }}
                className="text-[#8696a0] hover:text-[#e9edef] transition-colors text-sm font-medium"
              >
                Back to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                placeholder={isLogin ? 'Username or Email' : 'Username'}
                className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            {!isLogin && (
              <>
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
                
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8696a0]" />
                    <input
                      type="text"
                      placeholder="Enter 6-digit OTP"
                      className="w-full bg-[#2a3942] text-[#e9edef] pl-11 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884] transition-all"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required={!isLogin}
                    />
                  </div>
                  <button type="button" onClick={handleRequestRegisterOtp} className="px-4 py-3 bg-[#202c33] border border-[#2a3942] rounded-lg hover:bg-[#2a3942] transition-colors text-sm text-[#00a884] font-bold whitespace-nowrap whitespace-nowrap">
                    {signupOtpSent ? 'Resend' : 'Get OTP'}
                  </button>
                </div>
              </>
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

            <div className="flex items-start py-2">
              <input
                type="checkbox"
                id="terms"
                checked={hasAcceptedTerms}
                onChange={(e) => setHasAcceptedTerms(e.target.checked)}
                className="mt-1 mr-3 w-4 h-4 rounded bg-[#2a3942] border-gray-600 focus:ring-[#00a884] text-[#00a884] accent-[#00a884] cursor-pointer"
              />
              <label htmlFor="terms" className="text-xs text-[#8696a0] leading-relaxed">
                By ticking this box, I confirm I have read and agree to the <button type="button" onClick={() => setShowTerms(true)} className="text-[#00a884] hover:underline focus:outline-none font-bold">Terms of Service</button>, <button type="button" onClick={() => setShowTerms(true)} className="text-[#00a884] hover:underline focus:outline-none font-bold">Privacy Policy</button>, and entirely consent to the Cookie Policy.
              </label>
            </div>

            <button
              type="submit"
              className="w-full bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold py-3 rounded-lg transition-colors shadow-lg"
            >
              {isLogin ? 'Login' : 'Sign Up'}
            </button>
          </form>

          <div className="mt-6 text-center space-y-3">
            {isLogin && (
              <div>
                <button
                  onClick={() => setIsForgotPassword(true)}
                  className="text-[#8696a0] hover:text-[#00a884] transition-colors text-sm font-medium"
                >
                  Forgot Password?
                </button>
              </div>
            )}
            <div>
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
      
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </div>
  );
}
