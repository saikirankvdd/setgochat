# StegoChat - Complete Project Documentation

**Version:** 1.0.0  
**Last Updated:** April 10, 2026  
**Status:** Production Ready ✅

---

## 📌 Table of Contents

1. [Project Overview](#project-overview)
2. [Technical Architecture](#technical-architecture)
3. [Security Implementation](#security-implementation)
4. [System Components](#system-components)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
7. [Socket.IO Events](#socketio-events)
8. [Installation & Setup](#installation--setup)
9. [Configuration](#configuration)
10. [Deployment](#deployment)
11. [Admin Operations](#admin-operations)
12. [Troubleshooting](#troubleshooting)

---

## Project Overview

**StegoChat** is a production-grade, end-to-end encrypted secure communication platform that combines multiple advanced cryptographic disciplines into a unified chat application:

### Key Features
- 🔒 **Audio Steganography** - Messages hidden inside audio files using LSB technique
- 🔐 **End-to-End Encryption** - RSA-2048 asymmetric + AES-256 symmetric encryption
- 📞 **Real-Time Communication** - WebSockets via Socket.IO
- 🎥 **Audio/Video Calls** - Full WebRTC implementation with draggable PiP
- 👮 **Community Moderation** - 3-strike warning system with automatic banning
- 🚫 **User Blocking** - Bidirectional blocking with session termination
- 📋 **Admin Dashboard** - Real-time system statistics and moderation tools
- 💬 **Self-Destructing Messages** - Snapchat-style expiring messages
- 🔄 **Offline Message Queue** - Automatic message delivery on reconnect
- ✅ **Anti-Screenshot Protection** - Privacy measures for sensitive chats

### Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20.x |
| **Frontend** | React | 19.x |
| **Bundler** | Vite | 6.x |
| **Backend** | Express | 4.21.2 |
| **Real-Time** | Socket.IO | 4.8.3 |
| **Database** | MongoDB | Atlas (Cloud) |
| **ORM** | Mongoose | 9.3.3 |
| **Language** | TypeScript | 5.8.2 |

---

## Technical Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (User A)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ React 19 Frontend (src/components/*)               │   │
│  │ ├─ Auth.tsx (Login/Signup/Password Reset)         │   │
│  │ ├─ Dashboard.tsx (Main UI)                        │   │
│  │ ├─ ChatArea.tsx (Messaging + Calls)               │   │
│  │ ├─ Sidebar.tsx (User List)                        │   │
│  │ └─ AdminDashboard.tsx (Admin Controls)            │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Cryptography Layer (src/utils/*)                   │   │
│  │ ├─ stego.ts (LSB Audio Steganography)             │   │
│  │ ├─ e2ee.ts (RSA-2048 Key Exchange)                │   │
│  │ └─ crypto.ts (AES-256 Encryption)                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                      ↓ (Socket.IO + HTTPS)                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│              Node.js + Express Backend (server.ts)          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ API Routes                                          │   │
│  │ ├─ /api/signup (User Registration)                │   │
│  │ ├─ /api/login (User Authentication)               │   │
│  │ ├─ /api/users (User List)                         │   │
│  │ ├─ /api/reports (User Reports)                    │   │
│  │ └─ /api/admin/* (Admin Operations)                │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Socket.IO Event Handlers                           │   │
│  │ ├─ start_chat (Session Initiation)                │   │
│  │ ├─ send_message (LSB + E2EE Relay)                │   │
│  │ ├─ call_offer/answer (WebRTC Signaling)           │   │
│  │ └─ log_call (Call History Recording)              │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Security Middleware                                │   │
│  │ ├─ verifyAuth (JWT Validation)                    │   │
│  │ ├─ verifyAdmin (Admin Authorization)              │   │
│  │ ├─ Rate Limiting (100 req/15min per IP)           │   │
│  │ └─ Input Validation (XSS & ReDoS Protection)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                      ↓                                       │
└─────────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│           MongoDB Atlas (Cloud Database)                    │
│  Collections:                                              │
│  ├─ users (Accounts + E2EE Keys)                           │
│  ├─ sessions (Chat Sessions + PINs)                        │
│  ├─ callhistories (Call Records)                           │
│  ├─ offlinemessages (Message Queue)                        │
│  ├─ feedbacks (User Feedback)                              │
│  ├─ reports (Abuse Reports)                                │
│  └─ bannedemails (Permanent Blacklist)                     │
└─────────────────────────────────────────────────────────────┘
```

### 4-Layer Security Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Transport Security (HTTPS + Rate Limiting)       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Server Authentication (JWT + bcrypt)             │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Session Encryption (RSA-2048 Key Exchange)       │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Message Steganography (LSB + AES-256)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Implementation

### Layer 1: Audio LSB Steganography

**File:** `src/utils/stego.ts`

Messages are embedded directly into audio files using the Least Significant Bit (LSB) technique:

```typescript
// Encoding Process
plaintext "Hello" 
  → Binary: 01001000 01100101 01101100 01101100 01101111
  → Embedded into WAV audio sample LSBs
  → Only network sees audio data, never plaintext

// Decoding Process  
Received audio file
  → Extract LSBs from each sample
  → Reconstruct binary string
  → Convert binary → original text
```

**Key Points:**
- Uses 5-second white Gaussian Noise carrier (Box-Muller transform)
- 16-bit PCM WAV format with 44-byte header
- Null terminator (0000000000000000) marks message end
- Network observer sees only seemingly-random audio

### Layer 2: RSA-2048 Key Exchange (E2EE Handshake)

**File:** `src/utils/e2ee.ts`

Before two users chat, they establish a shared session PIN without server knowledge:

```
User A Sign-Up:
├─ Browser generates RSA-2048 key pair (client-side)
├─ Public key uploaded to server
└─ Private key encrypted with password, never sent plaintext

Chat Initiation:
├─ Server generates random 6-digit PIN
├─ PIN encrypted with User A's public key → pin1
├─ PIN encrypted with User B's public key → pin2
├─ Each user decrypts their copy using private key
└─ Both users share same PIN, server never knows plaintext
```

**Implementation Details:**
- `generateRSAKeyPair()` - Browser WebCrypto API
- `encryptPINWithPublicKey()` - RSA-OAEP encryption
- `decryptPINWithPrivateKey()` - RSA-OAEP decryption
- Private keys encrypted with user password via AES (CryptoJS)

### Layer 3: AES-256 Message Encryption

**File:** `src/utils/crypto.ts`

Once session PIN is established, all message content encrypted symmetrically:

```
Message Flow:
Plaintext "Hello" 
  → Encrypt with AES-256(key=sessionPIN) 
  → Binary conversion 
  → LSB encode into audio
  → Base64 encode
  → Transmit over Socket.IO
  
Receive Flow:
Receive Base64 audio
  → Decode Base64 → WAV buffer
  → Extract LSBs → binary string
  → AES-256 decrypt(key=sessionPIN) 
  → "Hello" displayed
```

### Layer 4: Server-Side Security

**File:** `server.ts`

| Security Feature | Implementation |
|-----------------|-----------------|
| **JWT Auth** | All routes require `Authorization: Bearer <token>` |
| **Password Hashing** | bcrypt with 10 salt rounds |
| **Rate Limiting** | 300 req/15min (API), 10 req/15min (Auth) |
| **Input Validation** | express-validator + regex escaping |
| **HTTP Headers** | Helmet.js (CSP, X-Frame-Options, HSTS) |
| **HTTPS** | Enforced in production; self-signed cert in dev |
| **Email Verification** | OTP required for signup & password reset |
| **Ban Enforcement** | BannedEmail collection checked on every signup |

---

## System Components

### Frontend Components

#### 1. Auth.tsx - Authentication System
- User signup with OTP verification
- RSA-2048 key pair generation
- Login with private key decryption
- Password reset with OTP flow
- Terms & Privacy Policy acceptance
- **Lines:** ~390

#### 2. Dashboard.tsx - Main Interface
- User list with online status
- Session initialization
- Message preview in sidebar
- Admin dashboard access
- System alerts and notifications
- **Lines:** ~352

#### 3. ChatArea.tsx - Messaging & Calls
**Messaging Features:**
- LSB steganography encoding/decoding
- AES-256 encryption/decryption
- Self-destruct timers (Snapchat mode)
- One-time view messages
- File sharing with encryption
- Emoji picker

**Call Features:**
- Audio calls with WebRTC
- Video calls with full duplex
- Call duration tracking
- Draggable PiP overlay for local video
- Mute/video toggle
- Call history logging

**Moderation Features:**
- User reporting with evidence screenshots (up to 10)
- User blocking
- **Lines:** ~1,303

#### 4. Sidebar.tsx - User Management
- User search functionality
- Last message preview
- Unread badge counter
- Call history display
- Online status indicators
- Feedback submission
- **Lines:** ~451

#### 5. AdminDashboard.tsx - Admin Panel
- Real-time system statistics
- User list with masked data
- User deletion
- Feedback review and resolution
- Pending abuse reports
- Warning count tracking (0/3)
- Send Warning / Reject Report actions
- **Lines:** ~285

### Backend Routes

#### Authentication Routes
```
POST /api/request-register-otp
  - Request OTP for signup
  
POST /api/signup
  - Create new user with OTP verification
  
POST /api/login
  - Login with JWT token generation
  
POST /api/request-otp
  - Request password reset OTP
  
POST /api/change-password
  - Reset password with OTP verification
```

#### User Routes
```
GET /api/users
  - Get all users with public keys
  
GET /api/me
  - Get current user with blocked list
  
POST /api/block
  - Block a user
  
GET /api/calls
  - Get call history
```

#### Feedback & Reporting
```
POST /api/feedback
  - Submit feedback with screenshots
  
POST /api/reports
  - Report a user with evidence
```

#### Admin Routes
```
GET /api/admin/stats
  - System statistics
  
GET /api/admin/feedback
  - View all user feedback
  
POST /api/admin/feedback/:id/resolve
  - Mark feedback as resolved
  
GET /api/admin/reports
  - View pending abuse reports
  
POST /api/admin/reports/:id/review
  - Action on report (warn/reject)
  
DELETE /api/admin/users/:id
  - Delete user account permanently
```

### Utility Functions

#### stego.ts - Audio Steganography
```typescript
encodeLSB(audioBuffer, data)      // Encode message into audio
decodeLSB(audioBuffer)             // Extract message from audio
createCarrierWav(seconds)          // Generate WAV with white noise
```

#### e2ee.ts - E2EE Key Management
```typescript
generateRSAKeyPair()               // Browser RSA-2048 key generation
encryptPINWithPublicKey(pin, key)  // RSA-OAEP encryption
decryptPINWithPrivateKey(enc, key) // RSA-OAEP decryption
encryptPrivateKeyWithPassword()    // AES private key encryption
decryptPrivateKeyWithPassword()    // AES private key decryption
```

#### crypto.ts - Message Encryption
```typescript
encryptData(data, pin)             // AES-256 encryption
decryptData(ciphertext, pin)       // AES-256 decryption
stringToBinary(str)                // String to binary conversion
binaryToString(bin)                // Binary to string conversion
```

---

## Database Schema

### Collections Overview

#### 1. users
```javascript
{
  _id: ObjectId,
  username: String (unique),
  email: String (unique),
  password: String (bcrypt hash),
  public_key: String (RSA-2048 DER Base64),
  encrypted_private_key: String (AES encrypted),
  warningsCount: Number (default: 0),
  blockedUsers: [String] (user IDs)
}
```

#### 2. sessions
```javascript
{
  id: String (unique, format: "user1_id-user2_id"),
  user1_id: String,
  user2_id: String,
  pin: String (hidden from client),
  pin1: String (RSA encrypted for user1),
  pin2: String (RSA encrypted for user2),
  status: String (pending | active),
  initiator_id: String,
  created_at: Date
}
```

#### 3. offlinemessages
```javascript
{
  _id: ObjectId,
  to_id: String (indexed),
  payload: String (JSON stringified),
  created_at: Date
}
```

#### 4. callhistories
```javascript
{
  _id: ObjectId,
  from_id: String (indexed),
  to_id: String (indexed),
  status: String (completed | missed | rejected),
  created_at: Date
}
```

#### 5. feedbacks
```javascript
{
  _id: ObjectId,
  user_id: String (indexed),
  text: String,
  images: [String] (Base64 encoded),
  created_at: Date
}
```

#### 6. reports
```javascript
{
  _id: ObjectId,
  reporter_id: String,
  reported_id: String,
  reason: String,
  images: [String] (Base64 evidence),
  status: String (pending | warned | rejected),
  created_at: Date
}
```

#### 7. bannedemails
```javascript
{
  _id: ObjectId,
  email: String (unique),
  reason: String,
  created_at: Date
}
```

---

## API Reference

### Authentication

#### Register OTP Request
```http
POST /api/request-register-otp
Content-Type: application/json

{
  "email": "user@gmail.com"
}

Response 200:
{
  "success": true,
  "message": "OTP sent to email successfully"
}

Response 400:
{
  "error": "Email already registered."
}
```

#### User Signup
```http
POST /api/signup
Content-Type: application/json

{
  "username": "johndoe",
  "email": "john@gmail.com",
  "password": "securePassword123",
  "otp": "123456",
  "publicKey": "MIIBIjANBg...",
  "encryptedPrivateKey": "U2FsdGVkX1..."
}

Response 200:
{
  "success": true,
  "userId": "507f1f77bcf86cd799439011"
}

Response 400:
{
  "error": "Invalid or incorrect OTP."
}
```

#### User Login
```http
POST /api/login
Content-Type: application/json

{
  "username": "johndoe",
  "password": "securePassword123"
}

Response 200:
{
  "success": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "johndoe",
    "email": "john@gmail.com",
    "isAdmin": false,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "publicKey": "MIIBIjANBg...",
    "encryptedPrivateKey": "U2FsdGVkX1..."
  }
}

Response 401:
{
  "error": "Invalid credentials"
}
```

### User Operations

#### Get User List
```http
GET /api/users
Authorization: Bearer <jwt_token>

Response 200:
[
  {
    "id": "507f1f77bcf86cd799439011",
    "username": "alice",
    "publicKey": "MIIBIjANBg..."
  },
  {
    "id": "507f1f77bcf86cd799439012",
    "username": "bob",
    "publicKey": "MIIBIjANBg..."
  }
]
```

#### Get My Profile
```http
GET /api/me
Authorization: Bearer <jwt_token>

Response 200:
{
  "id": "507f1f77bcf86cd799439011",
  "username": "johndoe",
  "blockedUsers": ["507f1f77bcf86cd799439012"]
}
```

#### Block User
```http
POST /api/block
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "targetId": "507f1f77bcf86cd799439012"
}

Response 200:
{
  "success": true
}
```

### Admin Operations

#### Get System Statistics
```http
GET /api/admin/stats
Authorization: Bearer <admin_jwt_token>

Response 200:
{
  "totalUsers": 42,
  "activeSessions": 12,
  "connections": 15,
  "uptime": 86400,
  "usersList": [
    {
      "id": "507f1f77bcf86cd799439011",
      "maskedName": "user_123456",
      "maskedEmail": "a1b2c3d4e5f6@hidden.root"
    }
  ],
  "sessionsList": [...]
}
```

#### Review User Report
```http
POST /api/admin/reports/:id/review
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json

{
  "action": "warn"  // or "reject"
}

Response 200:
{
  "success": true
}

Auto-actions on "warn":
- Warning 1-2: System alert sent to user
- Warning 3: Account deleted, email blacklisted, socket disconnected
```

---

## Socket.IO Events

### Chat Events

#### start_chat
```javascript
// Client → Server
socket.emit('start_chat', {
  toId: "507f1f77bcf86cd799439012",
  pin1: "RSA_encrypted_pin_for_user1",
  pin2: "RSA_encrypted_pin_for_user2"
});

// Server → Recipient
socket.on('chat_started', {
  sessionId: "507f1f77bcf86cd799439011-507f1f77bcf86cd799439012",
  pin1: "...",
  pin2: "...",
  user1_id: "507f1f77bcf86cd799439011",
  user2_id: "507f1f77bcf86cd799439012",
  status: "pending",
  initiator_id: "507f1f77bcf86cd799439011"
});
```

#### send_message
```javascript
socket.emit('send_message', {
  sessionId: "507f1f77bcf86cd799439011-507f1f77bcf86cd799439012",
  fromId: "507f1f77bcf86cd799439011",
  toId: "507f1f77bcf86cd799439012",
  audioBase64: "data:audio/wav;base64,UklGRiY...",
  isSelfDestruct: true,
  timer: 10  // seconds
});

socket.on('receive_message', {
  sessionId: "...",
  fromId: "507f1f77bcf86cd799439011",
  audioBase64: "...",
  isSelfDestruct: true,
  timer: 10
});
```

### Call Events

#### call_offer
```javascript
socket.emit('call_offer', {
  sessionId: "...",
  offer: RTCSessionDescription,
  fromId: "507f1f77bcf86cd799439011",
  fromName: "alice",
  toId: "507f1f77bcf86cd799439012",
  withVideo: true  // or false for audio-only
});
```

#### call_answer
```javascript
socket.emit('call_answer', {
  sessionId: "...",
  answer: RTCSessionDescription,
  toId: "507f1f77bcf86cd799439011"
});
```

#### call_ice_candidate
```javascript
socket.emit('call_ice_candidate', {
  sessionId: "...",
  candidate: RTCIceCandidateInit,
  toId: "507f1f77bcf86cd799439012"
});
```

### System Events

#### online_users
```javascript
socket.on('online_users', [
  "507f1f77bcf86cd799439011",
  "507f1f77bcf86cd799439012",
  "507f1f77bcf86cd799439013"
]);
```

#### system_alert
```javascript
socket.on('system_alert', {
  title: "Terms of Service Warning",
  message: "We received a report about you violating our community guidelines. This is warning 1/3..."
});
```

#### banned
```javascript
socket.on('banned');
// Auto redirects to login, clears localStorage
```

---

## Installation & Setup

### Prerequisites
- **Node.js** 20.x or higher
- **npm** 10.x or higher
- **MongoDB** Atlas account (or local MongoDB)
- **EmailJS** account (for production OTP delivery)

### Development Setup

#### 1. Clone Repository
```bash
git clone https://github.com/saikirankvdd/stegochat.git
cd secure-audio-steganography-platform
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Environment Configuration
Create `.env` file in project root:
```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/stegochat
# or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/stegochat

# JWT
JWT_SECRET=your_super_secret_jwt_key_here_change_me

# Email (EmailJS - for production)
EMAILJS_SERVICE_ID=service_xxxxx
EMAILJS_TEMPLATE_ID=template_xxxxx
EMAILJS_PUBLIC_KEY=public_key_xxxxx
EMAILJS_PRIVATE_KEY=private_key_xxxxx

# Node Environment
NODE_ENV=development

# Optional: Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5000
```

#### 4. Start Development Server
```bash
npm run dev
```

The application will start on `https://localhost:5000` (self-signed certificate).

#### 5. Access Application
- Open browser to `https://localhost:5000`
- Accept self-signed certificate warning
- Sign up or login with test credentials

### Database Setup

#### Local MongoDB
```bash
# Start MongoDB
mongod

# In application, MongoDB auto-creates collections on first use
```

#### MongoDB Atlas
1. Create MongoDB Atlas account at https://www.mongodb.com/cloud/atlas
2. Create cluster
3. Get connection string
4. Add to `.env` as `MONGODB_URI`

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `NODE_ENV` | Yes | `development` or `production` |
| `EMAILJS_SERVICE_ID` | No | EmailJS service ID |
| `EMAILJS_TEMPLATE_ID` | No | EmailJS template ID |
| `EMAILJS_PUBLIC_KEY` | No | EmailJS public key |
| `EMAILJS_PRIVATE_KEY` | No | EmailJS private key (production only) |
| `FRONTEND_URL` | No | Frontend URL for CORS (production) |
| `PORT` | No | Server port (default: 5000) |

### Rate Limiting Configuration

**File:** `server.ts` (lines 164-178)

Current settings:
```typescript
// API routes
max: 300 requests / 15 minutes per IP

// Auth routes
max: 10 requests / 15 minutes per IP
```

To adjust, modify `rateLimit` configuration in `server.ts`.

### Security Headers

Configured via Helmet.js:
- Content-Security-Policy
- X-Content-Type-Options
- X-Frame-Options
- HSTS

---

## Deployment

### Render.com (Recommended)

#### 1. Push to GitHub
```bash
git remote add origin https://github.com/yourusername/stegochat.git
git push -u origin main
```

#### 2. Create Render Service
1. Go to https://render.com
2. Create new Web Service
3. Connect GitHub repository
4. Select `secure-audio-steganography-platform`

#### 3. Configure Build & Start
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

#### 4. Set Environment Variables
In Render dashboard, add all variables from `.env`:
- `MONGODB_URI`
- `JWT_SECRET`
- `EMAILJS_SERVICE_ID`
- `EMAILJS_TEMPLATE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY`
- `NODE_ENV=production`
- `FRONTEND_URL=https://your-render-url.onrender.com`

#### 5. Deploy
- Push to `main` branch → Auto-deploys on Render
- Monitor deployment in Render dashboard

### Production Best Practices

1. **Use HTTPS** - Render provides free SSL/TLS certificates
2. **Set Strong JWT_SECRET** - Use cryptographically secure random string
3. **MongoDB Atlas** - Use production-grade MongoDB with backups
4. **Email Configuration** - Use EmailJS for reliable OTP delivery
5. **Monitoring** - Enable Render error tracking
6. **Backups** - Enable MongoDB Atlas backups
7. **Rate Limiting** - Prevent DDoS attacks

---

## Admin Operations

### Admin Account
- **Username:** `Admin_SaiKiran`
- **Email:** `saikirankvdd13@gmail.com`
- **Password:** `kvs007`
- **Auto-seeded** on first server boot

### Admin Dashboard Access
1. Login as admin
2. Click 3-dot menu (⋮)
3. Select "Admin Dashboard"

### Common Admin Tasks

#### Review User Reports
1. Navigate to "Pending User Reports" section
2. Read report reason and evidence screenshots
3. Click "Send Warning (1/3)" or "Reject Report"
4. User receives system alert or reporter notified

#### Send User Warnings
- **Warning 1-2:** User receives alert but account active
- **Warning 3:** System auto-executes account deletion + email ban

#### Delete User
1. Go to "Users List" section
2. Find user
3. Click delete button
4. User immediately disconnected and account removed

#### View User Feedback
1. Navigate to "Feedback from Users"
2. Review feedback with screenshots
3. Click "Issue Resolved"
4. User receives system notification

---

## Troubleshooting

### Common Issues

#### 1. MongoDB Connection Error
```
Error: MongoDB connection error
Solution:
- Verify MONGODB_URI in .env
- Ensure MongoDB is running (local) or Atlas cluster is active
- Check network access for MongoDB Atlas
```

#### 2. EmailJS OTP Not Sending
```
Error: OTP not received in email
Solution:
- In dev mode: Check console for OTP (printed to stdout)
- In production: Verify EMAILJS keys in .env
- Check spam folder
- Render outbound SMTP may need EmailJS HTTP API (port 443)
```

#### 3. Microphone/Camera Permission Denied
```
Error: Could not access microphone for call
Solution:
- Ensure using HTTPS (required for WebRTC on mobile)
- Check browser permissions
- Allow microphone/camera access when prompted
- On mobile: Use secure ngrok tunnel URL
```

#### 4. Socket.IO Connection Failed
```
Error: WebSocket connection failed
Solution:
- Check server is running (npm run dev)
- Verify CORS settings in server.ts
- For production: Ensure FRONTEND_URL matches actual URL
- Check firewall isn't blocking WebSocket
```

#### 5. Message Encryption Failed
```
Error: Failed to decrypt session / Vault decryption failed
Solution:
- Verify private key properly decrypted during login
- Ensure session PIN correctly exchanged
- Check browser crypto API enabled
- Verify password correct (for private key decryption)
```

### Debug Mode

#### Enable Detailed Logging
```typescript
// server.ts - Add console.logs for debugging
socket.on('connect', (socket) => {
  console.log('User connected:', socket.id);  // Server logs
});

// Browser console - Check for crypto errors
console.log('Key generation:', keyPair);
console.log('Encryption:', encryptedData);
```

#### Check Socket Events
Browser DevTools → Network → WebSocket → Messages

#### Verify Database
```bash
# MongoDB shell
mongo

# List databases
show databases

# Use stegochat database
use stegochat

# Check collections
show collections

# View sample user
db.users.findOne()
```

---

## Performance Optimization Tips

1. **Indexed Queries** - Add MongoDB indexes for frequently queried fields
2. **Lazy Loading** - Implement code splitting for React components
3. **Image Compression** - Compress feedback/report screenshots before upload
4. **Connection Pooling** - MongoDB connection pooling optimized by Mongoose
5. **Caching** - Implement Redis for session caching (optional)
6. **CDN** - Deploy static assets to CDN for production
7. **Database Cleanup** - Remove old offline messages periodically

---

## Contributing

See CONTRIBUTING.md for guidelines on submitting pull requests.

---

## License

© 2026 StegoChat. All rights reserved.

---

## Support

For issues, errors, or questions:
1. Check Troubleshooting section above
2. Review GitHub issues
3. Contact development team

---

**Document Version:** 1.0.0  
**Last Updated:** April 10, 2026
