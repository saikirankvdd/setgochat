import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, MessageSquare, Download, MoreVertical, Flag, UserX, Phone, Zap, Box, Rocket, ChevronRight, ChevronLeft, X } from 'lucide-react';

interface OnboardingModalProps {
  onClose: () => void;
}

const slides = [
  {
    id: 1,
    icon: <Shield className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "Welcome to StegoChat",
    body: (
      <>
        <p className="mb-4">StegoChat is a secret-level encrypted messenger.</p>
        <p>Your messages are hidden inside audio files and photos — not just locked, but <strong>invisible</strong>. Not even the server knows what you said.</p>
      </>
    )
  },
  {
    id: 2,
    icon: <MessageSquare className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "Encrypted Messages",
    body: (
      <ul className="text-left list-disc list-inside space-y-2">
        <li>Every message is <strong>AES-256 encrypted</strong> with a PIN only you and your contact share.</li>
        <li>You'll see ✓ (sent) → ✓✓ (delivered) → <span className="text-[#00a884]">✓✓</span> (read).</li>
        <li>You can send <strong>text, images, audio, videos, and files</strong>.</li>
        <li>Hover over any message to see the <strong>⋮ menu</strong> with options: Copy, Delete, Save.</li>
      </ul>
    )
  },
  {
    id: 3,
    icon: <Download className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "How to Start a Chat",
    body: (
      <ul className="text-left list-disc list-inside space-y-2">
        <li>Go to the <strong>Chats</strong> tab and search for any user.</li>
        <li>Click a user to send a <strong>Message Request</strong> — they'll see it in their Requests tab.</li>
        <li>Once they <strong>Accept</strong>, your secure encrypted session starts.</li>
        <li>You can <strong>Decline</strong> a request without the sender knowing.</li>
      </ul>
    )
  },
  {
    id: 4,
    icon: <MoreVertical className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "What's in the 3-Dot Menu?",
    body: (
      <>
        <p className="mb-4">Tap the <strong>⋮ (three dots)</strong> in the top-right of any chat to access:</p>
        <ul className="text-left space-y-2 text-sm">
          <li>🚩 <strong>Report User</strong> — Flag a user for bad behaviour</li>
          <li>🚫 <strong>Block User</strong> — Instantly block them</li>
          <li>💾 <strong>Keep Permanent</strong> — Store messages forever</li>
          <li>🕒 <strong>Keep for 24 Hours</strong> — Auto-delete after 24h</li>
          <li>⚡ <strong>Instant Mode</strong> — Self-destruct messages (Snapchat-style)</li>
          <li>📦 <strong>Export / Import</strong> — Backup your chat</li>
        </ul>
      </>
    )
  },
  {
    id: 5,
    icon: <Flag className="w-16 h-16 text-yellow-500 mb-6" />,
    title: "Reporting a User",
    body: (
      <ul className="text-left list-decimal list-inside space-y-2 text-sm">
        <li>Tap <strong>⋮ → Report User</strong> in any chat.</li>
        <li>Write a reason and optionally attach a screenshot.</li>
        <li>Sent <strong>anonymously</strong> to the admin.</li>
        <li>Admin can issue a <strong>Warning</strong> or <strong>Reject</strong> it.</li>
        <li><strong>3 warnings</strong> = automatic ban.</li>
        <li>You'll get a notification about the outcome.</li>
      </ul>
    )
  },
  {
    id: 6,
    icon: <UserX className="w-16 h-16 text-red-500 mb-6" />,
    title: "Blocking a User",
    body: (
      <ul className="text-left list-disc list-inside space-y-2">
        <li>Tap <strong>⋮ → Block User</strong> to instantly block someone.</li>
        <li>A blocked user <strong>cannot send you messages</strong> or see when you're online.</li>
        <li>You can view and <strong>unblock</strong> anyone from the <strong>⋮ → Blocked Users</strong> list in the Sidebar.</li>
      </ul>
    )
  },
  {
    id: 7,
    icon: <Phone className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "Secure Voice & Video Calls",
    body: (
      <ul className="text-left list-disc list-inside space-y-2">
        <li>Tap the <strong>📞 phone</strong> icon for an audio call.</li>
        <li>Tap the <strong>🎥 camera</strong> icon for a video call.</li>
        <li>All calls are <strong>peer-to-peer encrypted</strong> using WebRTC — not routed through our servers.</li>
        <li>Call history is in the <strong>Calls</strong> tab.</li>
      </ul>
    )
  },
  {
    id: 8,
    icon: <Zap className="w-16 h-16 text-orange-400 mb-6" />,
    title: "Disappearing Mode",
    body: (
      <ul className="text-left list-disc list-inside space-y-2">
        <li>Inside any chat, tap <strong>⋮ → Instant</strong> and enable the checkbox.</li>
        <li>Pick a timer: <strong>5s, 10s, 30s, or 1 minute</strong>.</li>
        <li>Once enabled, every message you send <strong>disappears automatically</strong> after that time — for both sides.</li>
        <li>Perfect for ultra-sensitive conversations.</li>
      </ul>
    )
  },
  {
    id: 9,
    icon: <Box className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "Hiding Your Chat Backup",
    body: (
      <>
        <p className="mb-4">When you tap <strong>⋮ → Export / Import Chat</strong>, StegoChat hides your backup based on size:</p>
        <div className="bg-[#111b21] p-3 rounded text-sm text-left space-y-2 border border-[#2a3942]">
          <p>🎵 <strong>Small (text only):</strong> Hidden in a .wav ringtone</p>
          <p>🖼️ <strong>Medium:</strong> Hidden inside a 4K .png stock photo</p>
          <p>🔒 <strong>Large:</strong> Packaged as an encrypted .dat file</p>
        </div>
        <p className="mt-4 text-sm text-[#8696a0]">To restore: tap ⋮ → Export / Import Chat → Import</p>
      </>
    )
  },
  {
    id: 10,
    icon: <Rocket className="w-16 h-16 text-[#00a884] mb-6" />,
    title: "You're All Set!",
    body: (
      <>
        <p className="mb-6">Your conversations are completely private. Not even the server can read them.</p>
        <div className="bg-[#111b21] p-4 rounded-lg border border-[#2a3942] flex items-start text-sm text-left">
          <span className="text-xl mr-3">💡</span>
          <p className="text-[#8696a0]">
            <strong>Tip:</strong> Tap the <strong>⋮ menu</strong> in the sidebar header anytime and choose <strong>User Guide</strong> to re-read this guide.
          </p>
        </div>
      </>
    )
  }
];

export function OnboardingModal({ onClose }: OnboardingModalProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onClose();
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/90 backdrop-blur-sm z-[99999] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#202c33] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[600px] border border-[#2a3942] animate-fade-in relative">
        
        {/* Top bar with Skip */}
        <div className="flex justify-between items-center p-4 border-b border-[#2a3942]">
          <span className="text-[#8696a0] font-bold text-sm tracking-widest uppercase">StegoChat Guide</span>
          <button onClick={onClose} className="text-[#8696a0] hover:text-white flex items-center text-sm font-medium transition-colors">
            Skip <X className="w-4 h-4 ml-1" />
          </button>
        </div>

        {/* Carousel Content */}
        <div className="flex-1 relative overflow-hidden flex">
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-8 text-center transition-transform duration-500 ease-in-out"
              style={{
                transform: `translateX(${(index - currentSlide) * 100}%)`,
                opacity: index === currentSlide ? 1 : 0,
                visibility: Math.abs(index - currentSlide) <= 1 ? 'visible' : 'hidden'
              }}
            >
              {slide.icon}
              <h2 className="text-2xl font-bold text-white mb-6">{slide.title}</h2>
              <div className="text-[#e9edef] text-base leading-relaxed max-w-sm w-full">
                {slide.body}
              </div>
            </div>
          ))}
        </div>

        {/* Footer controls */}
        <div className="p-6 border-t border-[#2a3942] bg-[#111b21] flex flex-col space-y-6">
          {/* Dot Indicators */}
          <div className="flex justify-center space-x-2">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`w-2 h-2 rounded-full transition-colors ${index === currentSlide ? 'bg-[#00a884]' : 'bg-[#3a4952]'}`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
          
          {/* Buttons */}
          <div className="flex justify-between items-center gap-4">
            <button
              onClick={prevSlide}
              disabled={currentSlide === 0}
              className={`p-3 rounded-full bg-[#202c33] border border-[#2a3942] transition-colors ${currentSlide === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#2a3942] text-white'}`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            
            <button
              onClick={nextSlide}
              className="flex-1 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold py-3 rounded-xl transition-colors flex items-center justify-center shadow-lg"
            >
              {currentSlide === slides.length - 1 ? (
                "Let's Get Started!"
              ) : (
                <>Continue <ChevronRight className="w-5 h-5 ml-1" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
