import express from 'express';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first'); // Force IPv4 routing for Nodemailer since Render/Railway struggles with IPv6 outbound
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import selfsigned from 'selfsigned';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import cookieParser from 'cookie-parser';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import 'dotenv/config';

// Safe in-memory nonce store for Socket.IO single-use connection bridging
const nonceMap = new Map<string, string>();

// ----------------------
// MongoDB Initialization
// ----------------------
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stegochat';
mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB successfully!'))
  .catch((err) => console.error('MongoDB connection error. Please ensuring MONGODB_URI is set in Render:', err));

const BannedEmailSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  reason: { type: String },
  created_at: { type: Date, default: Date.now }
});
const BannedEmail = mongoose.model('BannedEmail', BannedEmailSchema);

const ReportSchema = new mongoose.Schema({
  reporter_id: { type: String },
  reported_id: { type: String },
  reason: { type: String },
  images: [{ type: String }],
  status: { type: String, default: 'pending' }, // pending, warned, rejected
  created_at: { type: Date, default: Date.now }
});
const Report = mongoose.model('Report', ReportSchema);

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: { type: String },
  public_key: { type: String },
  encrypted_private_key: { type: String },
  warningsCount: { type: Number, default: 0 },
  blockedUsers: [{ type: String }],
  sessionVersion: { type: Number, default: 0 },
  keyVaultVersion: { type: Number, default: 1 }
});
const User = mongoose.model('User', UserSchema);

function escapeHtmlEntities(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

const SessionSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  user1_id: { type: String, index: true },
  user2_id: { type: String, index: true },
  pin: { type: String },
  pin1: { type: String },
  pin2: { type: String },
  status: { type: String, default: 'pending' },
  initiator_id: { type: String },
  created_at: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', SessionSchema);

const OfflineMessageSchema = new mongoose.Schema({
  to_id: { type: String, index: true },
  payload: { type: String },
  created_at: { type: Date, default: Date.now },
  expiresAt: { type: Date }
});
const OfflineMessage = mongoose.model('OfflineMessage', OfflineMessageSchema);

const CallHistorySchema = new mongoose.Schema({
  from_id: { type: String, index: true },
  to_id: { type: String, index: true },
  status: { type: String },
  created_at: { type: Date, default: Date.now }
});
const CallHistory = mongoose.model('CallHistory', CallHistorySchema);

const FeedbackSchema = new mongoose.Schema({
  user_id: { type: String, index: true },
  text: { type: String },
  images: [{ type: String }],
  created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', FeedbackSchema);

// Auto-seed Admin User requested by User
const adminEmail = 'saikirankvdd13@gmail.com';
const adminPassword = 'kvs007';
const hashedAdminPassword = bcrypt.hashSync(adminPassword, 10);

mongoose.connection.once('open', async () => {
    try {
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (!existingAdmin) {
            await User.deleteOne({ username: 'Admin_SaiKiran' }); // Purge any squatters
            await User.create({ username: 'Admin_SaiKiran', email: adminEmail, password: hashedAdminPassword, public_key: 'ADMIN', encrypted_private_key: 'ADMIN', keyVaultVersion: 2 });
            console.log('[System] Admin account seeded successfully.');
        } else {
            await User.deleteMany({ username: 'Admin_SaiKiran', email: { $ne: adminEmail } }); // Purge squatters
            await User.updateOne({ email: adminEmail }, { username: 'Admin_SaiKiran', password: hashedAdminPassword, keyVaultVersion: 2 });
            console.log('[System] Old admin account strictly overwritten to enforce Admin_SaiKiran identity and kvs007.');
        }
    } catch(e) {
        console.error('Error seeding admin account:', e);
    }
});

async function sendEmailJS(toEmail: string, otpCode: string, isReset: boolean = false) {
  if (!process.env.EMAILJS_PRIVATE_KEY) {
     console.log(`[Local fallback] EmailJS skipped. OTP for ${toEmail}: ${otpCode}`);
     return true; 
  }
  
  const payload = {
    service_id: process.env.EMAILJS_SERVICE_ID || 'service_d59ibbf',
    template_id: process.env.EMAILJS_TEMPLATE_ID,
    user_id: process.env.EMAILJS_PUBLIC_KEY,
    accessToken: process.env.EMAILJS_PRIVATE_KEY,
    template_params: {
        to_email: toEmail,
        otp: otpCode,
        subject: isReset ? "Password Reset OTP" : "Registration OTP"
    }
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!response.ok) {
     const errorText = await response.text();
     throw new Error(`EmailJS HTTP Error: ${errorText}`);
  }
}

const registerOtps = new Map<string, string>();

const app = express();
app.set('trust proxy', 1); // Enable proxy trust for Render load balancer compatibility with express-rate-limit

app.use(cookieParser());

const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:         ["'self'"],
      scriptSrc:          ["'self'"],              // No unsafe-inline, no CDN scripts
      styleSrc:           isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"], // Tightened style CSP in production
      imgSrc:             ["'self'", "data:", "blob:", "https://picsum.photos", "https://fastly.picsum.photos"],
      mediaSrc:           ["'self'", "data:", "blob:"],
      connectSrc:         ["'self'", "wss://stegochat-e74t.onrender.com", "wss://localhost:5000", "wss://127.0.0.1:5000", "https://picsum.photos"], // Tight connect-src
      fontSrc:            ["'self'", "data:"],
      objectSrc:          ["'none'"],
      baseUri:            ["'none'"],
      frameAncestors:     ["'none'"],
      formAction:         ["'self'"],
      workerSrc:          ["'self'", "blob:"],     // Needed for fflate WASM workers
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for WebRTC call integration
}));

// Permissions-Policy header
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(self), clipboard-write=(self)'
  );
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const csrfProtect = (req: any, res: any, next: any) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const exemptPaths = [
    '/api/login',
    '/api/signup',
    '/api/request-otp',
    '/api/request-register-otp',
    '/api/change-password'
  ];
  if (exemptPaths.includes(req.originalUrl.split('?')[0]) || exemptPaths.includes(req.path)) return next();

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'] || req.headers['X-CSRF-Token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Forbidden: CSRF token mismatch' });
  }
  next();
};

app.use('/api/', apiLimiter);
app.use('/api/', csrfProtect);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts from this IP, please try again after 15 minutes.' }
});

let httpsOptions: any = {};
if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  httpsOptions.key = fs.readFileSync('key.pem', 'utf8');
  httpsOptions.cert = fs.readFileSync('cert.pem', 'utf8');
} else {
  // We can't use await here at top level easily in TS without type=module fully cooperating, 
  // but it is type=module. However, selfsigned is sync-ish or we can run synchronously.
  // Actually, wait, the original code used 'await' here successfully because server.ts is type=module.
  const pems = (selfsigned as any).generate([{ name: 'commonName', value: 'localhost' }], { days: 365, keySize: 2048 });
  httpsOptions.key = pems.private;
  httpsOptions.cert = pems.cert;
  try {
    fs.writeFileSync('cert.pem', pems.cert);
    fs.writeFileSync('key.pem', pems.private);
  } catch(e) {}
}

const httpServer = isProduction 
  ? createHttpServer(app) 
  : createHttpsServer(httpsOptions, app);

const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [process.env.FRONTEND_URL || 'https://stegochat-e74t.onrender.com'] 
  : '*';

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
  maxHttpBufferSize: 5e6 // 5 MB (Audit mitigation for DoS)
});

// Helper to escape regex values to prevent ReDoS
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

app.use(express.json({ limit: '2mb' })); // Reduced from 100MB to prevent DoS

const upload = multer({ dest: 'uploads/' });

// Auth Routes
app.post('/api/request-register-otp', authLimiter, [
  body('email').isEmail().trim().toLowerCase().withMessage('Invalid email provided.')
], async (req: any, res: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  if (email.toLowerCase() === 'saikirankvdd13@gmail.com') {
     return res.status(400).json({ error: 'Cannot register using admin email.' });
  }

  const existing = await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
  if (existing) {
     return res.status(400).json({ error: 'Email already registered.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  registerOtps.set(email, otp);

  if (!process.env.EMAILJS_PRIVATE_KEY) {
      console.log(`[Local fallback] Registration OTP for ${email}: ${otp}`);
      return res.json({ success: true, message: 'OTP sent. Please check your email.' });
  }

  try {
    await sendEmailJS(email, otp, false);
    console.log(`[Email System] Registration OTP sent via EmailJS securely to ${email}`);
    res.json({ success: true, message: 'OTP sent to email successfully' });
  } catch (error: any) {
    console.error('[Audit] request-register-otp email failure:', { email, error: error.message });
    res.status(502).json({ error: 'Unable to send verification email. Please try again later.' });
  }
});

app.post('/api/signup', authLimiter, [
  body('email').isEmail().trim().toLowerCase(),
  body('username').trim().isLength({ min: 3, max: 30 }).escape() // Prevent XSS!
], async (req: any, res: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid input data detected.' });

  const exactUsername = await User.findOne({ username: new RegExp(`^${escapeRegex(req.body.username)}$`, 'i') });
  if (exactUsername) return res.status(400).json({ error: 'Username already taken.' });

  const isBanned = await BannedEmail.findOne({ email: new RegExp(`^${escapeRegex(req.body.email)}$`, 'i') });
  if (isBanned) return res.status(403).json({ error: 'System Policy Block: This email has been permanently banned from StegoChat.' });

  const { username, email, password, otp, publicKey, encryptedPrivateKey } = req.body;
  if (!publicKey || !encryptedPrivateKey) {
     if (email !== 'saikirankvdd13@gmail.com') return res.status(400).json({ error: 'E2EE Keys are required.' });
  }
  
  if (email === 'saikirankvdd13@gmail.com' && username !== 'Admin_SaiKiran') {
     return res.status(400).json({ error: 'This email is permanently reserved for the administrator.' });
  }
  if (username === 'Admin_SaiKiran' && email !== 'saikirankvdd13@gmail.com') {
     return res.status(400).json({ error: 'This username is permanently reserved for the administrator.' });
  }

  const storedOtp = registerOtps.get(email);
  if (storedOtp) registerOtps.delete(email); // Invalidate on first attempt!

  if (!otp || !storedOtp || storedOtp !== otp) {
      return res.status(400).json({ error: 'Invalid or incorrect OTP. Please request a new one.' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUser = await User.create({
        username, email, password: hashedPassword,
        public_key: publicKey || 'ADMIN', 
        encrypted_private_key: encryptedPrivateKey || 'ADMIN'
    });
    res.json({ success: true, userId: newUser._id.toString() });
  } catch (error: any) {
    if (error.code === 11000) {
        return res.status(400).json({ error: 'Username or Email already exists.' });
    }
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', authLimiter, async (req: any, res: any) => {
  const { username, password } = req.body;
  const safeUsername = (username || '').trim();
  
  const user = await User.findOne({ 
      $or: [
          { username: new RegExp(`^${escapeRegex(safeUsername)}$`, 'i') }, 
          { email: new RegExp(`^${escapeRegex(safeUsername)}$`, 'i') }
      ] 
  });
  
  if (user && user.password && bcrypt.compareSync(password, user.password)) {
    const isAdmin = (user.email || '').toLowerCase() === 'saikirankvdd13@gmail.com';
    
    // Increment sessionVersion for single-device login enforcement
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { sessionVersion: 1 } },
      { new: true }
    );

    // Alert existing active socket session (if online) that a new login is attempted/completed
    const activeSocketId = userSockets.get(user._id.toString());
    if (activeSocketId) {
      io.to(activeSocketId).emit('security_alert', {
        type: 'login_attempt',
        title: 'Security Alert',
        message: 'A new login attempt was detected on another device.'
      });
    }

    // Generate Secure JWT Token including sessionVersion!
    const token = jwt.sign({ 
      id: user._id.toString(), 
      username: user.username, 
      isAdmin, 
      sessionVersion: updatedUser.sessionVersion 
    }, process.env.JWT_SECRET || 'fallback_secret_for_jwt', { expiresIn: '7d' });
    
    // Set httpOnly cookie access_token with explicit path=/
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Generate a secure CSRF token (double-submit pattern)
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false, // Must be readable by client JS to include in header
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Generate single-use nonce for socket authentication containing both userId & sessionVersion
    const nonce = crypto.randomUUID();
    nonceMap.set(nonce, JSON.stringify({ userId: user._id.toString(), sessionVersion: updatedUser.sessionVersion }));
    // Auto-delete nonce after 10s
    setTimeout(() => nonceMap.delete(nonce), 10000);

    // Set short-lived socket_nonce cookie with path=/
    res.cookie('socket_nonce', nonce, {
      httpOnly: false,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 10000 // 10 seconds
    });

    res.json({ 
      success: true, 
      user: { 
        id: user._id.toString(), 
        username: user.username, 
        email: user.email, 
        isAdmin, 
        publicKey: user.public_key, 
        encryptedPrivateKey: user.encrypted_private_key,
        keyVaultVersion: user.keyVaultVersion || 1
      } 
    });
  } else {
    // If user exists but login failed, notify them as a precaution!
    if (user) {
      const activeSocketId = userSockets.get(user._id.toString());
      if (activeSocketId) {
        io.to(activeSocketId).emit('security_alert', {
          type: 'failed_login',
          title: 'Security Alert',
          message: 'Someone entered an incorrect password trying to login to your account.'
        });
      }
    }
    res.status(401).json({ error: 'Invalid credentials' });
  }
});


// Socket.io Logic
const userSockets = new Map<string, string>();
const otps = new Map<string, string>();

app.post('/api/request-otp', authLimiter, async (req: any, res: any) => {
  const { emailOrUsername } = req.body;
  if (!emailOrUsername) return res.status(400).json({ error: 'Username or email required' });
  
  const user = await User.findOne({
      $or: [
          { username: new RegExp(`^${escapeRegex(emailOrUsername)}$`, 'i') }, 
          { email: new RegExp(`^${escapeRegex(emailOrUsername)}$`, 'i') }
      ] 
  });
  
  if (!user) {
    // Return success anyway to prevent user enumeration
    return res.json({ success: true, message: 'If an account exists, an OTP has been sent.' });
  }

  // Alert active socket if someone requests a reset OTP
  const activeSocketId = userSockets.get(user._id.toString());
  if (activeSocketId) {
    io.to(activeSocketId).emit('security_alert', {
      type: 'otp_attempt',
      title: 'Security Alert',
      message: 'Someone requested a password reset OTP for your account.'
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps.set(user._id.toString(), otp);
  
  if (!process.env.EMAILJS_PRIVATE_KEY) {
      console.log(`\n========================================`);
      console.log(`[ADMIN ALERT] Password Reset Requested for ${user.username} (ID: ${user._id}). OTP: ${otp}`);
      console.log(`========================================\n`);
      return res.json({ success: true });
  }

  try {
    await sendEmailJS(user.email as string, otp, true);
    console.log(`[Email System] Password Reset OTP sent securely via EmailJS to ${user.email}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Audit] request-otp email failure:', { emailOrUsername, error: error.message });
    res.status(502).json({ error: 'Unable to send verification email. Please try again later.' });
  }
});

app.post('/api/change-password', authLimiter, async (req: any, res: any) => {
  const { emailOrUsername, otp, newPassword } = req.body;
  if (!emailOrUsername || !otp || !newPassword) return res.status(400).json({ error: 'Missing fields' });

  const user = await User.findOne({
      $or: [
          { username: new RegExp(`^${escapeRegex(emailOrUsername)}$`, 'i') }, 
          { email: new RegExp(`^${escapeRegex(emailOrUsername)}$`, 'i') }
      ] 
  });
  
  if (!user) return res.status(400).json({ error: 'Invalid OTP' }); // Hide exact reason

  const userId = user._id.toString();
  const storedOtp = otps.get(userId);
  if (storedOtp) otps.delete(userId); // Invalidate immediately upon use!
  
  if (storedOtp && storedOtp === otp) {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid or incorrect OTP. Please request a new one.' });
  }
});

function broadcastOnlineUsers() {
  const onlineUserIds = Array.from(userSockets.keys());
  io.emit('online_users', onlineUserIds);
}

// Session participant verification helper for IDOR mitigation (Finding 4)
async function assertParticipant(userId: string, sessionId: string): Promise<void> {
  const session = await Session.findOne({ id: sessionId });
  if (!session || (session.user1_id !== userId && session.user2_id !== userId)) {
    throw new Error('IDOR: Not a participant of this session');
  }
}

// Socket.io Handshake Nonce-based Authentication Middleware (Finding 1)
io.use((socket: any, next) => {
  const nonce = socket.handshake.auth?.nonce;
  if (!nonce) {
    return next(new Error('Authentication error: Nonce missing'));
  }
  
  const mappedData = nonceMap.get(nonce);
  if (!mappedData) {
    return next(new Error('Authentication error: Invalid or Expired Nonce'));
  }
  
  // Nonce is single-use, delete immediately (bridging cookie security to WebSocket)
  nonceMap.delete(nonce);
  
  try {
    const { userId, sessionVersion } = JSON.parse(mappedData);
    socket.userId = userId;
    socket.sessionVersion = sessionVersion;
    next();
  } catch (e) {
    return next(new Error('Authentication error: Invalid Nonce Data Format'));
  }
});

// Event Size Limits config (Finding 2)
const EVENT_SIZE_LIMITS: Record<string, number> = {
  send_message:      50000,   // 50 KB
  send_file:         900000,  // 900 KB (generous audio file stego size)
  call_offer:        25000,
  call_answer:       25000,
  call_ice_candidate: 10000,
  delete_message:    5000,
  start_chat:        5000,
  accept_request:    5000,
  decline_request:   5000,
  log_call:          5000,
  register:          1000,
  request_offline_messages: 1000
};

// Event Rate Limiting Store
const eventRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkEventRateLimit(userId: string, event: string, maxPerMinute: number = 60): boolean {
  const key = `${userId}:${event}`;
  const now = Date.now();
  const record = eventRateLimitMap.get(key);
  if (!record || now > record.resetAt) {
    eventRateLimitMap.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (record.count >= maxPerMinute) return false;
  record.count++;
  return true;
}

// Socket.IO event size checking middleware
io.use((socket: any, next) => {
  socket.use(([event, ...args]: any[], nextEvent: any) => {
    const limit = EVENT_SIZE_LIMITS[event] ?? 10000;
    const size = Buffer.byteLength(JSON.stringify(args), 'utf8');
    if (size > limit) {
      console.warn(`[Security] Event "${event}" payload size limit exceeded (${size} > ${limit} bytes)`);
      return nextEvent(new Error('Payload too large'));
    }
    nextEvent();
  });
  next();
});

io.on('connection', (socket: any) => {
  console.log('User connected:', socket.id, 'Authenticated as:', socket.userId);

  socket.on('register', async () => {
    const userId = socket.userId; // Use trusted ID instead of client payload
    
    // Single-device login version check
    const dbUser = await User.findById(userId);
    if (!dbUser || dbUser.sessionVersion !== socket.sessionVersion) {
       socket.emit('force_logout', { message: 'Your account was signed in on another device. You have been logged out for your security.' });
       socket.disconnect(true);
       return;
    }

    // Force disconnect any other active socket session for this user:
    const existingSocketId = userSockets.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
       const oldSocket = io.sockets.sockets.get(existingSocketId);
       if (oldSocket) {
          oldSocket.emit('force_logout', { message: 'Your account was signed in on another device. You have been logged out for your security.' });
          oldSocket.disconnect(true);
       }
    }

    userSockets.set(userId, socket.id);
    socket.join(`user_${userId}`);
    console.log(`User ${userId} registered with socket ${socket.id}`);
    broadcastOnlineUsers();

    // Send all pins for this user
    try {
      const sessions = await Session.find({ $or: [{ user1_id: userId }, { user2_id: userId }] });
      io.to(socket.id).emit('session_pins', sessions);
    } catch(e) { console.error('Error syncing pins:', e); }
  });

  socket.on('request_offline_messages', async () => {
    const userId = socket.userId;
    try {
      // Disappearing message enforcement: delete offline messages that have expired (Finding 7)
      await OfflineMessage.deleteMany({ to_id: userId, expiresAt: { $lte: new Date() } });

      const offlineMsgs = await OfflineMessage.find({ to_id: userId });
      if (offlineMsgs.length > 0) {
        offlineMsgs.forEach(m => {
          const payload = JSON.parse(m.payload as string);
          if (payload.type === 'text') {
             io.to(socket.id).emit('receive_message', payload.data);
          } else if (payload.type === 'delete_msg') {
             io.to(socket.id).emit('message_deleted', { msgId: payload.msgId });
          } else {
             io.to(socket.id).emit('receive_file', payload.data);
          }
        });
        await OfflineMessage.deleteMany({ to_id: userId });
      }
    } catch(e) { console.error('Error syncing offline data:', e); }
  });

  // Delete Message with IDOR mitigation
  socket.on('delete_message', async (data, ack) => {
    try {
      const { toId, msgId } = data;
      const sessionId = [socket.userId, toId].sort().join('-');
      await assertParticipant(socket.userId, sessionId);
      
      const toSocketId = userSockets.get(toId);
      if (toSocketId) {
        io.to(toSocketId).emit('message_deleted', { msgId });
      } else {
        const payload = JSON.stringify({ type: 'delete_msg', msgId: msgId });
        const offlineMsg = new OfflineMessage({
          to_id: toId,
          payload: payload
        });
        await offlineMsg.save();
      }
      ack?.({ ok: true });
    } catch (err: any) {
      console.error("[Security] delete_message rejected:", err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('disconnect', () => {
    let disconnectedUserId: string | null = null;
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        break;
      }
    }
    if (disconnectedUserId !== null) {
      userSockets.delete(disconnectedUserId);
      console.log(`User ${disconnectedUserId} disconnected`);
      broadcastOnlineUsers();
    }
  });

  const isUserBlocked = async (fromId: string, toId: string) => {
    const toUser: any = await User.findById(toId);
    return toUser && toUser.blockedUsers && toUser.blockedUsers.includes(fromId);
  };

  socket.on('start_chat', async ({ toId, pin1, pin2 }) => {
    if (await isUserBlocked(socket.userId, toId)) return;
    const fromId = socket.userId; // Trusted ID
    const sessionId = [fromId, toId].sort().join('-');
    const [sorted1, sorted2] = [fromId, toId].sort();
    let session = await Session.findOne({ id: sessionId });
    
    if (!session) {
      session = await Session.create({
          id: sessionId,
          user1_id: sorted1,
          user2_id: sorted2,
          pin: 'HIDDEN',
          pin1,
          pin2,
          status: 'pending',
          initiator_id: fromId
      });
    }

    socket.join(sessionId);
    const toSocketId = userSockets.get(toId);
    if (toSocketId) {
      io.to(toSocketId).emit('chat_started', { sessionId, pin1: session.pin1, pin2: session.pin2, user1_id: session.user1_id, user2_id: session.user2_id, status: session.status, initiator_id: session.initiator_id, fromId });
    }
    socket.emit('chat_ready', { sessionId, pin1: session.pin1, pin2: session.pin2, user1_id: session.user1_id, user2_id: session.user2_id, status: session.status, initiator_id: session.initiator_id });
  });

  socket.on('accept_request', async ({ sessionId }, ack) => {
    try {
      const session = await Session.findOne({ id: sessionId });
      if (!session) throw new Error('Session not found');
      if (session.user1_id !== socket.userId && session.user2_id !== socket.userId) {
        throw new Error('Not a participant');
      }
      if (session.initiator_id === socket.userId) {
        throw new Error('Initiator cannot accept their own request');
      }

      await Session.updateOne({ id: sessionId }, { status: 'accepted' });
      io.to(sessionId).emit('request_accepted', { sessionId });
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] accept_request rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('decline_request', async ({ sessionId }, ack) => {
    try {
      const session = await Session.findOne({ id: sessionId });
      if (!session) throw new Error('Session not found');
      if (session.user1_id !== socket.userId && session.user2_id !== socket.userId) {
        throw new Error('Not a participant');
      }

      await Session.deleteOne({ id: sessionId });
      io.to(sessionId).emit('request_declined', { sessionId });
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] decline_request rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('send_message', async (data, ack) => {
    try {
      const sessionId = [socket.userId, data.toId].sort().join('-');
      await assertParticipant(socket.userId, sessionId);
      
      if (await isUserBlocked(socket.userId, data.toId)) {
        ack?.({ ok: false, error: 'Blocked' });
        return;
      }
      
      // Server-side disappearing message expiration calculation (Finding 7)
      const expiresAt = data.timer ? new Date(Date.now() + data.timer * 1000) : null;
      const safeData = { ...data, fromId: socket.userId };
      const toSocketId = userSockets.get(safeData.toId);
      
      if (toSocketId) {
        io.to(toSocketId).emit('receive_message', safeData);
        
        // For active sessions, setup the timed server deletion to keep state clean on both sides
        if (data.timer && data.msgId) {
          setTimeout(() => {
            io.to(toSocketId).emit('message_deleted', { msgId: data.msgId });
            io.to(socket.id).emit('message_deleted', { msgId: data.msgId });
          }, data.timer * 1000);
        }
      } else {
        const msgCount = await OfflineMessage.countDocuments({ to_id: safeData.toId });
        if (msgCount < 50) {
          await OfflineMessage.create({
            to_id: safeData.toId,
            payload: JSON.stringify({ type: 'text', data: safeData }),
            expiresAt
          });
        }
      }
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] send_message rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('send_file', async (data, ack) => {
    try {
      const sessionId = [socket.userId, data.toId].sort().join('-');
      await assertParticipant(socket.userId, sessionId);
      
      if (await isUserBlocked(socket.userId, data.toId)) {
        ack?.({ ok: false, error: 'Blocked' });
        return;
      }
      
      const expiresAt = data.timer ? new Date(Date.now() + data.timer * 1000) : null;
      const safeData = { ...data, fromId: socket.userId };
      const toSocketId = userSockets.get(safeData.toId);
      
      if (toSocketId) {
        io.to(toSocketId).emit('receive_file', safeData);
        
        if (data.timer && data.msgId) {
          setTimeout(() => {
            io.to(toSocketId).emit('message_deleted', { msgId: data.msgId });
            io.to(socket.id).emit('message_deleted', { msgId: data.msgId });
          }, data.timer * 1000);
        }
      } else {
        const fileCount = await OfflineMessage.countDocuments({ to_id: safeData.toId });
        if (fileCount < 20) {
          await OfflineMessage.create({
            to_id: safeData.toId,
            payload: JSON.stringify({ type: 'file', data: safeData }),
            expiresAt
          });
        }
      }
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] send_file rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('call_offer', async (data, ack) => {
    try {
      await assertParticipant(socket.userId, data.sessionId);
      if (await isUserBlocked(socket.userId, data.toId)) return;
      socket.to(data.sessionId).emit('call_offer', data);
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] call_offer rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('call_answer', async (data, ack) => {
    try {
      await assertParticipant(socket.userId, data.sessionId);
      socket.to(data.sessionId).emit('call_answer', data);
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] call_answer rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('call_ice_candidate', async (data, ack) => {
    try {
      await assertParticipant(socket.userId, data.sessionId);
      socket.to(data.sessionId).emit('call_ice_candidate', data);
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] call_ice_candidate rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('call_end', async (data, ack) => {
    try {
      await assertParticipant(socket.userId, data.sessionId);
      socket.to(data.sessionId).emit('call_end', data);
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] call_end rejected:', err.message);
      ack?.({ ok: false });
    }
  });

  socket.on('log_call', async (data, ack) => {
    try {
      const sessionId = [socket.userId, data.toId].sort().join('-');
      await assertParticipant(socket.userId, sessionId);
      
      await CallHistory.create({ from_id: socket.userId, to_id: data.toId, status: data.status });
      const toSocketId = userSockets.get(data.toId);
      if (toSocketId) io.to(toSocketId).emit('new_call_log');
      io.to(socket.id).emit('new_call_log');
      ack?.({ ok: true });
    } catch (err: any) {
      console.error('[Security] log_call rejected:', err.message);
      ack?.({ ok: false });
    }
  });
});

// --- JWT AUTHENTICATION MIDDLEWARE ---
const verifyAuth = async (req: any, res: any, next: any) => {
  // Read from cookie first
  let token = req.cookies?.access_token;
  
  // Fallback to Bearer token for dev environments (not production)
  if (!token && process.env.NODE_ENV !== 'production') {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing Token' });
  }
  
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_jwt');
    
    // Strict DB sessionVersion verification to block concurrent/old sessions (Single-Device Enforcement)
    const dbUser = await User.findById(decoded.id);
    if (!dbUser || dbUser.sessionVersion !== decoded.sessionVersion) {
      return res.status(401).json({ error: 'Unauthorized: Session Expired or Single-Device Enforcement Logout' });
    }
    
    req.user = { ...decoded, sessionVersion: dbUser.sessionVersion }; // Attach validated token info
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or Expired Token' });
  }
};

// --- REST Session & Token Bridging API (Finding 1) ---
app.get('/api/session', verifyAuth, async (req: any, res: any) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'Session invalid or user not found' });
    }
    const isAdmin = (user.email || '').toLowerCase() === 'saikirankvdd13@gmail.com';
    res.json({
      success: true,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        isAdmin,
        publicKey: user.public_key,
        encryptedPrivateKey: user.encrypted_private_key,
        keyVaultVersion: user.keyVaultVersion || 1
      }
    });
  } catch (err: any) {
    console.error('[Audit] session retrieval error:', { error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.post('/api/logout', (req: any, res: any) => {
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/'
  });
  res.clearCookie('socket_nonce', {
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    path: '/'
  });
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    path: '/'
  });
  res.json({ success: true });
});

app.patch('/api/me/key', verifyAuth, async (req: any, res: any) => {
  try {
    const { encryptedPrivateKey } = req.body;
    if (!encryptedPrivateKey) {
      return res.status(400).json({ error: 'Missing encryptedPrivateKey' });
    }
    await User.findByIdAndUpdate(req.user.id, { 
      encrypted_private_key: encryptedPrivateKey,
      keyVaultVersion: 2 
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] key upgrade update error:', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.post('/api/socket-nonce', verifyAuth, (req: any, res: any) => {
  const nonce = crypto.randomUUID();
  nonceMap.set(nonce, JSON.stringify({ userId: req.user.id, sessionVersion: req.user.sessionVersion }));
  // Auto-delete nonce after 10s
  setTimeout(() => nonceMap.delete(nonce), 10000);
  

  res.json({ success: true, nonce });
});

const verifyAdmin = (req: any, res: any, next: any) => {
  verifyAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to perform this admin action.' });
    }
    next();
  });
};

// Feedback System Routes
app.post('/api/feedback', verifyAuth, async (req: any, res: any) => {
  try {
    const { text, images } = req.body;
    if (!text && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'Feedback cannot be empty' });
    }
    
    // HTML Entity Encoding for XSS protection
    const sanitizedText = escapeHtmlEntities(text);
    
    await Feedback.create({
      user_id: req.user.id,
      text: sanitizedText,
      images: images || []
    });
    
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] feedback creation failure:', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// Admin Routes
app.get('/api/admin/feedback', verifyAdmin, async (req: any, res: any) => {
  try {
    const feedbacks = await Feedback.find().sort({ created_at: -1 });
    const formatted = feedbacks.map(f => ({
      id: f._id.toString(),
      text: f.text,
      images: f.images,
      created_at: f.created_at,
      username: userSockets.get(f.user_id) || 'Offline',
      user_id: f.user_id
    }));
    
    res.json(formatted);
  } catch (err: any) {
    console.error('[Audit] admin feedback retrieval failure:', { error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// Resolve Feedback
app.post('/api/admin/feedback/:id/resolve', verifyAdmin, async (req: any, res: any) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
    
    const socketId = userSockets.get(feedback.user_id);
    const alertBody = { title: 'Feedback Update', message: 'Thank you for your feedback. We have successfully resolved your issue.\n\n- Team StegoChat' };
    if (socketId) {
       io.to(socketId).emit('system_alert', alertBody);
    } else {
       await OfflineMessage.create({ to_id: feedback.user_id, payload: JSON.stringify({ type: 'system_alert', data: alertBody }) });
    }
    
    await Feedback.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] resolve feedback failure:', { feedbackId: req.params.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// Reports from Users
app.post('/api/reports', verifyAuth, async (req: any, res: any) => {
  try {
    const { reportedId, reason, images } = req.body;
    
    // HTML Entity Encoding for XSS protection
    const sanitizedReason = escapeHtmlEntities(reason);
    
    await Report.create({
      reporter_id: req.user.id,
      reported_id: reportedId,
      reason: sanitizedReason,
      images: images || []
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] report creation failure:', { reporterId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.post('/api/block', verifyAuth, async (req: any, res: any) => {
  try {
     const { targetId } = req.body;
     await User.findByIdAndUpdate(req.user.id, { $addToSet: { blockedUsers: targetId } });
     res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] block failure:', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.post('/api/unblock', verifyAuth, async (req: any, res: any) => {
  try {
     const { targetId } = req.body;
     await User.findByIdAndUpdate(req.user.id, { $pull: { blockedUsers: targetId } });
     res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] unblock failure:', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});


// Admin Report Fetch
app.get('/api/admin/reports', verifyAdmin, async (req: any, res: any) => {
  try {
    const reports = await Report.find({ status: 'pending' }).sort({ created_at: -1 });
    const userIds = [...new Set(reports.map(r => r.reporter_id).concat(reports.map(r => r.reported_id)))];
    const users = await User.find({ _id: { $in: userIds } }, '_id username email warningsCount');
    const userMap = new Map();
    users.forEach(u => userMap.set(u._id.toString(), u));
    
    const formatted = reports.map(r => {
      const reporter = userMap.get(r.reporter_id);
      const reported = userMap.get(r.reported_id);
      return {
        id: r._id.toString(),
        reporter_id: r.reporter_id,
        reported_id: r.reported_id,
        reporter_name: userSockets.get(r.reporter_id) || 'Offline',
        reported_name: userSockets.get(r.reported_id) || 'Offline',
        reported_warnings: reported ? (reported as any).warningsCount : 0,
        reason: r.reason,
        images: r.images,
        created_at: r.created_at
      };
    });
    res.json(formatted);
  } catch (err: any) {
    console.error('[Audit] admin reports retrieval failure:', { error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

// Admin Review Report
app.post('/api/admin/reports/:id/review', verifyAdmin, async (req: any, res: any) => {
  try {
    const { action } = req.body; // 'warn' or 'reject'
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    
    if (action === 'warn') {
       const reportedUser: any = await User.findById(report.reported_id);
       if (reportedUser) {
          const newCount = (reportedUser.warningsCount || 0) + 1;
          
          if (newCount >= 3) { 
             await BannedEmail.create({ email: reportedUser.email, reason: 'Accumulated 3 policy warnings.' });
             await Session.deleteMany({ $or: [{ user1_id: report.reported_id }, { user2_id: report.reported_id }] });
             await User.findByIdAndDelete(report.reported_id);
             
             const socketId = userSockets.get(report.reported_id);
             if (socketId) {
                io.to(socketId).emit('banned');
                io.sockets.sockets.get(socketId)?.disconnect(true);
             }
          } else {
             await User.findByIdAndUpdate(report.reported_id, { warningsCount: newCount });
             const socketId = userSockets.get(report.reported_id);
             const alertBody = { title: 'Terms of Service Warning', message: `We received a report about you violating our community guidelines. This is warning ${newCount}/3.\n\nFurther violations will result in permanent account suspension and an irreversible email ban.\n\n- Team StegoChat Admin` };
             if (socketId) io.to(socketId).emit('system_alert', alertBody);
             else await OfflineMessage.create({ to_id: report.reported_id, payload: JSON.stringify({ type: 'system_alert', data: alertBody }) });
          }
       }
       report.status = 'warned';
    } else if (action === 'reject') {
       const socketId = userSockets.get(report.reporter_id);
       const alertBody = { title: 'Report Update', message: 'We have carefully reviewed your request. However, the user actions fall under our standard acceptable user policy, or insufficient evidence was provided. No action will be taken at this time.\n\n- Team StegoChat Admin' };
       if (socketId) io.to(socketId).emit('system_alert', alertBody);
       else await OfflineMessage.create({ to_id: report.reporter_id, payload: JSON.stringify({ type: 'system_alert', data: alertBody }) });
       report.status = 'rejected';
    }
    await report.save();
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] admin review report failure:', { reportId: req.params.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.get('/api/users', verifyAuth, async (req: any, res: any) => {
  const users = await User.find({ 
    email: { $not: new RegExp('^saikirankvdd13@gmail\\.com$', 'i') }, 
    username: { $not: new RegExp('^admin_saikiran$', 'i') } 
  }, 'username public_key');
  
  // map _id and public_key -> publicKey to match old sqlite response
  const formatUsers = users.map(u => ({ id: u._id.toString(), username: u.username, publicKey: u.public_key }));
  res.json(formatUsers);
});

app.get('/api/calls', verifyAuth, async (req: any, res: any) => {
  const calls = await CallHistory.find({ $or: [{ from_id: req.user.id }, { to_id: req.user.id }] }).sort({ created_at: -1 });
  // Map _id -> id
  res.json(calls.map(c => ({ id: c._id.toString(), from_id: c.from_id, to_id: c.to_id, status: c.status, created_at: c.created_at })));
});

app.get('/api/admin/stats', verifyAdmin, async (req: any, res: any) => {
  const totalUsers = await User.countDocuments();
  const activeSessions = await Session.countDocuments();
  
  const allUsers = await User.find({}, '_id username email');
  const anonymizedUsers = allUsers.map(u => {
    const uIdStr = u._id.toString();
    const socketId = userSockets.get(uIdStr);
    const maskedName = socketId ? `${socketId}` : `Offline`;
    const maskedEmail = crypto.createHash('sha256').update(u.email as string).digest('hex').substring(0, 8) + '@hidden.root';
    return { id: uIdStr, maskedName, maskedEmail };
  });

  const allSessionsResult = await Session.find({}, 'id user1_id user2_id created_at');
  
  res.json({
    totalUsers,
    activeSessions,
    connections: userSockets.size,
    uptime: process.uptime(),
    usersList: anonymizedUsers,
    sessionsList: allSessionsResult.map(s => ({ id: s.id, user1_id: s.user1_id, user2_id: s.user2_id, created_at: s.created_at }))
  });
});

app.delete('/api/admin/users/:id', verifyAdmin, async (req: any, res: any) => {
  const targetIdStr = req.params.id;
  try {
    await Session.deleteMany({ $or: [{ user1_id: targetIdStr }, { user2_id: targetIdStr }] });
    await OfflineMessage.deleteMany({ to_id: targetIdStr });
    await User.findByIdAndDelete(targetIdStr);
    
    // Disconnect their live socket connection immediately
    const socketId = userSockets.get(targetIdStr);
    if (socketId) {
      io.to(socketId).emit('banned');
      io.sockets.sockets.get(socketId)?.disconnect(true);
      userSockets.delete(targetIdStr);
      broadcastOnlineUsers();
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Audit] admin user deletion failure:', { targetId: req.params.id, error: err.message });
    res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

app.get('/api/me', verifyAuth, async (req: any, res: any) => {
   try {
      const u = await User.findById(req.user.id);
      if (!u) return res.status(404).json({ error: 'Not found' });
      res.json({ id: u._id, username: u.username, blockedUsers: (u as any).blockedUsers || [] });
   } catch (err: any) {
     console.error('[Audit] me retrieval failure:', { userId: req.user?.id, error: err.message });
     res.status(500).json({ error: 'An internal error occurred. Please try again.' });
   }
});

// Vite Integration & Server Start
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        https: {
          key: httpsOptions.key,
          cert: httpsOptions.cert
        } as any 
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();
