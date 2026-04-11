# StegoChat - API Reference & Developer Guide

**Version:** 1.0.0  
**Status:** Production Ready  
**Base URL:** `https://localhost:5000` (dev) or `https://app.onrender.com` (production)

---

## Table of Contents

1. [Authentication](#authentication)
2. [User API](#user-api)
3. [Chat API](#chat-api)  
4. [Admin API](#admin-api)
5. [Socket.IO Events](#socketio-events)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [Examples](#examples)

---

## Authentication

All protected routes require a JWT token in the `Authorization` header:

```http
Authorization: Bearer <jwt_token>
```

### Get JWT Token

**Endpoint:** `POST /api/login`

```javascript
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'alice',        // or email
    password: 'password123'
  })
});

const data = await response.json();
const token = data.user.token;

// Use token for protected requests
const apiResponse = await fetch('/api/users', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

---

## User API

### 1. Request Signup OTP

**Endpoint:** `POST /api/request-register-otp`  
**Rate Limit:** 10/15min per IP  
**Auth Required:** No

```javascript
const response = await fetch('/api/request-register-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@gmail.com'
  })
});

const data = await response.json();
// Development: OTP printed to server console
// Production: OTP sent via email
```

**Response 200 (Success):**
```json
{
  "success": true,
  "message": "OTP sent to email successfully"
}
```

**Response 400 (Error):**
```json
{
  "error": "Email already registered."
}
```

---

### 2. Signup (Create Account)

**Endpoint:** `POST /api/signup`  
**Rate Limit:** 10/15min per IP  
**Auth Required:** No  
**Prerequisites:** Must have requested OTP first

```javascript
// Step 1: Generate RSA-2048 key pair
const { publicKey, privateKey } = await generateRSAKeyPair();

// Step 2: Encrypt private key with password
const encryptedPrivateKey = encryptPrivateKeyWithPassword(privateKey, password);

// Step 3: Send signup request
const response = await fetch('/api/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'alice',
    email: 'user@gmail.com',
    password: 'SecurePassword123!',
    otp: '123456',                      // Received via email
    publicKey: publicKey,                // RSA public key (Base64)
    encryptedPrivateKey: encryptedPrivateKey  // AES encrypted (Base64)
  })
});

const data = await response.json();
// Success: Account created, redirect to login
```

**Response 200 (Success):**
```json
{
  "success": true,
  "userId": "507f1f77bcf86cd799439011"
}
```

**Response 400 (Error):**
```json
{
  "error": "Invalid or incorrect OTP."
}
```

---

### 3. Login

**Endpoint:** `POST /api/login`  
**Rate Limit:** 10/15min per IP  
**Auth Required:** No

```javascript
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'alice',  // or email
    password: 'SecurePassword123!'
  })
});

const data = await response.json();
const user = data.user;

// Decrypt private key for this session
const privateKey = await decryptPrivateKeyWithPassword(
  user.encryptedPrivateKey,
  password
);

// Store user data (except private key in localStorage for security)
localStorage.setItem('stego_user', JSON.stringify({
  ...user,
  privateKey: privateKey  // Keep in memory only during session
}));
```

**Response 200 (Success):**
```json
{
  "success": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "alice",
    "email": "alice@gmail.com",
    "isAdmin": false,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg...",
    "encryptedPrivateKey": "U2FsdGVkX19nKy9r3D8K8pZQwR..."
  }
}
```

**Response 401 (Error):**
```json
{
  "error": "Invalid credentials"
}
```

---

### 4. Request Password Reset OTP

**Endpoint:** `POST /api/request-otp`  
**Rate Limit:** 10/15min per IP  
**Auth Required:** No

```javascript
const response = await fetch('/api/request-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    emailOrUsername: 'alice'  // username or email
  })
});

const data = await response.json();
// Returns success even if user not found (prevents user enumeration)
// OTP sent to user if account exists
```

**Response 200:**
```json
{
  "success": true
}
```

---

### 5. Change Password

**Endpoint:** `POST /api/change-password`  
**Rate Limit:** 10/15min per IP  
**Auth Required:** No  
**Prerequisites:** Must have requested OTP first

```javascript
const response = await fetch('/api/change-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    emailOrUsername: 'alice',
    otp: '123456',           // Received via email
    newPassword: 'NewPassword456!'
  })
});

const data = await response.json();
```

**Response 200 (Success):**
```json
{
  "success": true
}
```

**Response 400 (Error):**
```json
{
  "error": "Invalid or incorrect OTP."
}
```

---

## User API

### 6. Get User List

**Endpoint:** `GET /api/users`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/users', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const users = await response.json();
// Use for displaying user list, getting public keys for E2EE
```

**Response 200:**
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "username": "alice",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg..."
  },
  {
    "id": "507f1f77bcf86cd799439012",
    "username": "bob",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg..."
  }
]
```

---

### 7. Get My Profile

**Endpoint:** `GET /api/me`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/me', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const profile = await response.json();
// Contains blocked users list
```

**Response 200:**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "username": "alice",
  "blockedUsers": ["507f1f77bcf86cd799439012"]
}
```

---

### 8. Block User

**Endpoint:** `POST /api/block`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/block', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    targetId: '507f1f77bcf86cd799439012'
  })
});

const data = await response.json();
// Blocked user cannot message or call you
// Any active sessions terminated
```

**Response 200:**
```json
{
  "success": true
}
```

---

### 9. Get Call History

**Endpoint:** `GET /api/calls`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/calls', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const calls = await response.json();
```

**Response 200:**
```json
[
  {
    "id": "507f1f77bcf86cd799439001",
    "from_id": "507f1f77bcf86cd799439011",
    "to_id": "507f1f77bcf86cd799439012",
    "status": "completed",
    "created_at": "2026-04-10T15:30:00Z"
  },
  {
    "id": "507f1f77bcf86cd799439002",
    "from_id": "507f1f77bcf86cd799439012",
    "to_id": "507f1f77bcf86cd799439011",
    "status": "missed",
    "created_at": "2026-04-10T14:15:00Z"
  }
]
```

---

## Chat API

### 10. Submit User Report

**Endpoint:** `POST /api/reports`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/reports', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    reportedId: '507f1f77bcf86cd799439012',
    reason: 'User sent inappropriate content',
    images: [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...'
    ]  // Up to 10 screenshots
  })
});

const data = await response.json();
```

**Response 200:**
```json
{
  "success": true
}
```

---

### 11. Submit Feedback

**Endpoint:** `POST /api/feedback`  
**Rate Limit:** 300/15min per IP  
**Auth Required:** Yes

```javascript
const response = await fetch('/api/feedback', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    text: 'UI is confusing on mobile, could improve...',
    images: [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...'
    ]
  })
});

const data = await response.json();
```

**Response 200:**
```json
{
  "success": true
}
```

---

## Admin API

**All admin endpoints require `isAdmin: true` flag in JWT token**

### 12. Get System Statistics

**Endpoint:** `GET /api/admin/stats`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/stats', {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});

const stats = await response.json();
// Contains: totalUsers, activeSessions, connections, uptime, usersList, sessionsList
```

**Response 200:**
```json
{
  "totalUsers": 42,
  "activeSessions": 12,
  "connections": 15,
  "uptime": 86400,
  "usersList": [
    {
      "id": "507f1f77bcf86cd799439011",
      "maskedName": "socket_id_hash",
      "maskedEmail": "a1b2c3d4e5f6@hidden.root"
    }
  ],
  "sessionsList": [
    {
      "id": "507f1f77bcf86cd799439011-507f1f77bcf86cd799439012",
      "user1_id": "507f1f77bcf86cd799439011",
      "user2_id": "507f1f77bcf86cd799439012",
      "created_at": "2026-04-10T15:30:00Z"
    }
  ]
}
```

---

### 13. Get User Feedback

**Endpoint:** `GET /api/admin/feedback`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/feedback', {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});

const feedbacks = await response.json();
```

**Response 200:**
```json
[
  {
    "id": "507f1f77bcf86cd799439001",
    "text": "Great app! Love the privacy features.",
    "images": ["data:image/png;base64,..."],
    "created_at": "2026-04-10T15:30:00Z",
    "username": "alice (hash)"
  }
]
```

---

### 14. Resolve Feedback

**Endpoint:** `POST /api/admin/feedback/:id/resolve`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/feedback/507f1f77bcf86cd799439001/resolve', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${adminToken}` }
});

const data = await response.json();
// User receives system notification: "Thank you for your feedback..."
```

**Response 200:**
```json
{
  "success": true
}
```

---

### 15. Get Pending Reports

**Endpoint:** `GET /api/admin/reports`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/reports', {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});

const reports = await response.json();
```

**Response 200:**
```json
[
  {
    "id": "507f1f77bcf86cd799439001",
    "reporter_id": "507f1f77bcf86cd799439011",
    "reported_id": "507f1f77bcf86cd799439012",
    "reporter_name": "alice",
    "reported_name": "bob",
    "reported_warnings": 1,
    "reason": "Sent inappropriate content",
    "images": ["data:image/png;base64,..."],
    "created_at": "2026-04-10T15:30:00Z"
  }
]
```

---

### 16. Action on Report

**Endpoint:** `POST /api/admin/reports/:id/review`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/reports/507f1f77bcf86cd799439001/review', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  },
  body: JSON.stringify({
    action: 'warn'  // or 'reject'
  })
});

const data = await response.json();

// If "warn": User warning count += 1
// If count reaches 3: Account deleted, email blacklisted, socket disconnected
// If "reject": Report rejected, reporter notified
```

**Response 200:**
```json
{
  "success": true
}
```

---

### 17. Delete User

**Endpoint:** `DELETE /api/admin/users/:id`  
**Auth Required:** Yes (Admin only)

```javascript
const response = await fetch('/api/admin/users/507f1f77bcf86cd799439012/delete', {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${adminToken}` }
});

const data = await response.json();
// User account deleted, sessions terminated, socket disconnected
```

**Response 200:**
```json
{
  "success": true
}
```

---

## Socket.IO Events

### Connection

```javascript
import { io } from 'socket.io-client';

// Create socket connection with JWT
const socket = io(window.location.origin, {
  auth: { token: user.token }
});

// Register user
socket.on('connect', () => {
  socket.emit('register');
});
```

### Disconnect

```javascript
socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

### Start Chat

```javascript
// Client → Server
socket.emit('start_chat', {
  toId: '507f1f77bcf86cd799439012',
  pin1: 'RSA_OAEP_encrypted_pin_for_user1',
  pin2: 'RSA_OAEP_encrypted_pin_for_user2'
});

// Server → Initiator
socket.on('chat_ready', (data) => {
  const { sessionId, pin1, pin2, user1_id, user2_id } = data;
  const decryptedPin = decryptPINWithPrivateKey(pin1, privateKey);
  // Store decrypted PIN for message encryption
});

// Server → Recipient
socket.on('chat_started', (data) => {
  const { sessionId, pin1, pin2, user1_id, user2_id } = data;
  const decryptedPin = decryptPINWithPrivateKey(pin2, privateKey);
  // Store decrypted PIN for message encryption
});
```

### Send Message

```javascript
// Encrypt message
const encryptedText = encryptData(messageText, sessionPin);

// Convert to binary
const binaryString = stringToBinary(encryptedText);

// Embed into audio
const audioBuffer = createCarrierWav(5);  // 5-second WAV
const stegoAudio = encodeLSB(audioBuffer, binaryString);

// Convert to Base64
const audioBase64 = 'data:audio/wav;base64,' + 
  btoa(String.fromCharCode(...new Uint8Array(stegoAudio)));

// Send
socket.emit('send_message', {
  sessionId: sessionId,
  fromId: user.id,
  toId: targetUser.id,
  audioBase64: audioBase64,
  isSelfDestruct: false,
  timer: 0
});

// Receive
socket.on('receive_message', (data) => {
  // Extract LSB from audio
  const binary = decodeLSB(audioData);
  
  // Convert binary to encrypted text
  const encryptedText = binaryToString(binary);
  
  // Decrypt with session PIN
  const plaintext = decryptData(encryptedText, sessionPin);
  
  // Display message
  displayMessage(plaintext, data.fromId);
});
```

### Send File

```javascript
// Read file as Base64
const fileData = {
  name: 'document.pdf',
  type: 'application/pdf',
  data: 'data:application/pdf;base64,...'
};

// Encrypt file data
const encryptedFile = encryptData(JSON.stringify(fileData), sessionPin);

// Send
socket.emit('send_file', {
  sessionId: sessionId,
  fromId: user.id,
  toId: targetUser.id,
  encryptedFile: encryptedFile
});

// Receive
socket.on('receive_file', (data) => {
  const decryptedData = decryptData(data.encryptedFile, sessionPin);
  const file = JSON.parse(decryptedData);
  // Download file
});
```

### Audio/Video Calls

```javascript
// Call offer
socket.emit('call_offer', {
  sessionId: sessionId,
  offer: RTCSessionDescription,
  fromId: user.id,
  fromName: user.username,
  toId: targetUser.id,
  withVideo: true
});

// Call answer
socket.emit('call_answer', {
  sessionId: sessionId,
  answer: RTCSessionDescription,
  toId: callerId
});

// ICE candidate
socket.emit('call_ice_candidate', {
  sessionId: sessionId,
  candidate: RTCIceCandidateInit,
  toId: targetUser.id
});

// Call end
socket.emit('call_end', {
  sessionId: sessionId,
  toId: targetUser.id
});

// Log call (record to history)
socket.emit('log_call', {
  toId: targetUser.id,
  status: 'completed'  // or 'missed' or 'rejected'
});
```

### System Events

```javascript
// Online users list
socket.on('online_users', (userIds) => {
  // Update UI with online status
});

// System alert
socket.on('system_alert', (data) => {
  const { title, message } = data;
  alert(`${title}\n\n${message}`);
});

// User banned
socket.on('banned', () => {
  localStorage.removeItem('stego_user');
  window.location.href = '/';  // Redirect to login
});
```

---

## Error Handling

### HTTP Error Responses

```javascript
try {
  const response = await fetch('/api/users', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    // Handle errors
    switch (response.status) {
      case 400:
        console.error('Bad request:', data.error);
        break;
      case 401:
        console.error('Unauthorized:', data.error);
        // Redirect to login
        break;
      case 403:
        console.error('Forbidden:', data.error);
        // Show permission error
        break;
      case 404:
        console.error('Not found:', data.error);
        break;
      case 429:
        console.error('Too many requests. Please try again later.');
        break;
      case 500:
        console.error('Server error:', data.error);
        break;
    }
    return;
  }
  
  // Handle success
  console.log('Success:', data);
} catch (error) {
  console.error('Network error:', error);
}
```

### Socket.IO Error Handling

```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error);
  // Handle connection errors
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  // Reconnect logic
});
```

---

## Rate Limiting

### Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| General API | 300 | 15 minutes |
| Authentication | 10 | 15 minutes |

### Rate Limit Response

```json
HTTP 429 Too Many Requests

{
  "error": "Too many authentication attempts from this IP, please try again after 15 minutes."
}
```

### Handle Rate Limiting

```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After') || 900;  // seconds
  console.log(`Rate limited. Retry after ${retryAfter} seconds.`);
  // Show user message: "Too many attempts. Please wait 15 minutes."
}
```

---

## Examples

### Complete Login Flow

```javascript
async function login(username, password) {
  try {
    // Login
    const loginRes = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    if (!loginRes.ok) throw new Error('Login failed');
    
    const { user } = await loginRes.json();
    
    // Decrypt private key
    const { decryptPrivateKeyWithPassword } = await import('./utils/e2ee');
    const privateKey = await decryptPrivateKeyWithPassword(
      user.encryptedPrivateKey,
      password
    );
    
    // Store in memory
    user.privateKey = privateKey;
    
    // Connect Socket.IO
    const socket = io({
      auth: { token: user.token }
    });
    
    socket.emit('register');
    
    return { user, socket };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
}
```

### Send Encrypted Message

```javascript
async function sendMessage(socket, sessionId, messageText, targetUserId) {
  try {
    // Imports
    const { encryptData, stringToBinary } = await import('./utils/crypto');
    const { createCarrierWav, encodeLSB } = await import('./utils/stego');
    
    // Encrypt
    const encrypted = encryptData(messageText, sessionPin);
    const binary = stringToBinary(encrypted);
    
    // Create audio carrier
    const audioBuffer = createCarrierWav(5);
    const stegoAudio = encodeLSB(audioBuffer, binary);
    
    // Encode
    const audioBase64 = 'data:audio/wav;base64,' +
      btoa(String.fromCharCode(...new Uint8Array(stegoAudio)));
    
    // Send
    socket.emit('send_message', {
      sessionId,
      fromId: currentUser.id,
      toId: targetUserId,
      audioBase64,
      isSelfDestruct: false,
      timer: 0
    });
  } catch (error) {
    console.error('Send message error:', error);
  }
}
```

---

**Version:** 1.0.0  
**Last Updated:** April 10, 2026  
**Questions?** See PROJECT_DOCUMENTATION.md or contact support
