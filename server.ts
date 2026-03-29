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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import 'dotenv/config';

// ----------------------
// MongoDB Initialization
// ----------------------
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stegochat';
mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB successfully!'))
  .catch((err) => console.error('MongoDB connection error. Please ensuring MONGODB_URI is set in Render:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: { type: String },
  public_key: { type: String },
  encrypted_private_key: { type: String }
});
const User = mongoose.model('User', UserSchema);

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
  created_at: { type: Date, default: Date.now }
});
const OfflineMessage = mongoose.model('OfflineMessage', OfflineMessageSchema);

const CallHistorySchema = new mongoose.Schema({
  from_id: { type: String, index: true },
  to_id: { type: String, index: true },
  status: { type: String },
  created_at: { type: Date, default: Date.now }
});
const CallHistory = mongoose.model('CallHistory', CallHistorySchema);

// Auto-seed Admin User requested by User
const adminEmail = 'saikirankvdd13@gmail.com';
const adminPassword = 'kvs007';
const hashedAdminPassword = bcrypt.hashSync(adminPassword, 10);

mongoose.connection.once('open', async () => {
    try {
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (!existingAdmin) {
            await User.deleteOne({ username: 'Admin_SaiKiran' }); // Purge any squatters
            await User.create({ username: 'Admin_SaiKiran', email: adminEmail, password: hashedAdminPassword, public_key: 'ADMIN', encrypted_private_key: 'ADMIN' });
            console.log('[System] Admin account seeded successfully.');
        } else {
            await User.deleteMany({ username: 'Admin_SaiKiran', email: { $ne: adminEmail } }); // Purge squatters
            await User.updateOne({ email: adminEmail }, { username: 'Admin_SaiKiran', password: hashedAdminPassword });
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

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

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

const isProduction = process.env.NODE_ENV === 'production';
const httpServer = isProduction 
  ? createHttpServer(app) 
  : createHttpsServer(httpsOptions, app);

const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [process.env.FRONTEND_URL || 'https://stegochat-e74t.onrender.com'] 
  : '*';

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
  maxHttpBufferSize: 1e8 // 100 MB
});

app.use(express.json());

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

  const existing = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
  if (existing) {
     return res.status(400).json({ error: 'Email already registered.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  registerOtps.set(email, otp);

  if (!process.env.EMAILJS_PRIVATE_KEY) {
      console.log(`[Local fallback] Registration OTP for ${email}: ${otp}`);
      return res.json({ success: true, message: 'OTP logged to console because EmailJS is not fully configured in Render yet.' });
  }

  try {
    await sendEmailJS(email, otp, false);
    console.log(`[Email System] Registration OTP sent via EmailJS securely to ${email}`);
    res.json({ success: true, message: 'OTP sent to email successfully' });
  } catch (error: any) {
    console.error('Email error:', error.message);
    res.status(500).json({ error: 'Failed to send OTP email. View Render logs for EmailJS details.' });
  }
});

app.post('/api/signup', authLimiter, [
  body('email').isEmail().trim().toLowerCase(),
  body('username').trim().isLength({ min: 3, max: 30 }).escape() // Prevent XSS!
], async (req: any, res: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid input data detected.' });

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
          { username: new RegExp(`^${safeUsername}$`, 'i') }, 
          { email: new RegExp(`^${safeUsername}$`, 'i') }
      ] 
  });
  
  if (user && user.password && bcrypt.compareSync(password, user.password)) {
    const isAdmin = (user.email || '').toLowerCase() === 'saikirankvdd13@gmail.com';
    
    // Generate Secure JWT Token for Protected Routes!
    const token = jwt.sign({ id: user._id.toString(), username: user.username, isAdmin }, process.env.JWT_SECRET || 'fallback_secret_for_jwt', { expiresIn: '7d' });
    
    res.json({ success: true, user: { id: user._id.toString(), username: user.username, email: user.email, isAdmin, token, publicKey: user.public_key, encryptedPrivateKey: user.encrypted_private_key } });
  } else {
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
          { username: new RegExp(`^${emailOrUsername}$`, 'i') }, 
          { email: new RegExp(`^${emailOrUsername}$`, 'i') }
      ] 
  });
  
  if (!user) {
    // Return success anyway to prevent user enumeration
    return res.json({ success: true, message: 'If an account exists, an OTP has been sent.' });
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
    console.error('Email error:', error.message);
    res.status(500).json({ error: 'Failed to send EmailJS OTP.' });
  }
});

app.post('/api/change-password', authLimiter, async (req: any, res: any) => {
  const { emailOrUsername, otp, newPassword } = req.body;
  if (!emailOrUsername || !otp || !newPassword) return res.status(400).json({ error: 'Missing fields' });

  const user = await User.findOne({
      $or: [
          { username: new RegExp(`^${emailOrUsername}$`, 'i') }, 
          { email: new RegExp(`^${emailOrUsername}$`, 'i') }
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

io.use((socket: any, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: Token missing'));
  }
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_jwt');
    socket.userId = decoded.id; // Trusted ID (now a string from MongoDB _id)
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid Token'));
  }
});

io.on('connection', (socket: any) => {
  console.log('User connected:', socket.id, 'Authenticated as:', socket.userId);

  socket.on('register', async () => {
    const userId = socket.userId; // Use trusted ID instead of client payload
    userSockets.set(userId, socket.id);
    socket.join(`user_${userId}`);
    console.log(`User ${userId} registered with socket ${socket.id}`);
    broadcastOnlineUsers();

    // Send all offline messages
    try {
      const offlineMsgs = await OfflineMessage.find({ to_id: userId });
      if (offlineMsgs.length > 0) {
        offlineMsgs.forEach(m => {
          const payload = JSON.parse(m.payload as string);
          if (payload.type === 'text') {
             io.to(socket.id).emit('receive_message', payload.data);
          } else {
             io.to(socket.id).emit('receive_file', payload.data);
          }
        });
        await OfflineMessage.deleteMany({ to_id: userId });
      }

      // Send all pins for this user
      const sessions = await Session.find({ $or: [{ user1_id: userId }, { user2_id: userId }] });
      io.to(socket.id).emit('session_pins', sessions);
    } catch(e) { console.error('Error syncing offline data:', e); }
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

  socket.on('start_chat', async ({ toId, pin1, pin2 }) => {
    const fromId = socket.userId; // Trusted ID
    const sessionId = [fromId, toId].sort().join('-');
    let session = await Session.findOne({ id: sessionId });
    
    if (!session) {
      session = await Session.create({
          id: sessionId,
          user1_id: fromId,
          user2_id: toId,
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

  socket.on('accept_request', async ({ sessionId }) => {
     await Session.updateOne({ id: sessionId }, { status: 'accepted' });
     io.to(sessionId).emit('request_accepted', { sessionId });
  });

  socket.on('send_message', async (data) => {
    const safeData = { ...data, fromId: socket.userId };
    const toSocketId = userSockets.get(safeData.toId);
    if (toSocketId) {
      io.to(toSocketId).emit('receive_message', safeData);
    } else {
      await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'text', data: safeData }) });
    }
  });

  socket.on('send_file', async (data) => {
    const safeData = { ...data, fromId: socket.userId };
    const toSocketId = userSockets.get(safeData.toId);
    if (toSocketId) {
      io.to(toSocketId).emit('receive_file', safeData);
    } else {
      await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'file', data: safeData }) });
    }
  });

  socket.on('call_offer', (data) => {
    socket.to(data.sessionId).emit('call_offer', data);
  });

  socket.on('call_answer', (data) => {
    socket.to(data.sessionId).emit('call_answer', data);
  });

  socket.on('call_ice_candidate', (data) => {
    socket.to(data.sessionId).emit('call_ice_candidate', data);
  });

  socket.on('call_end', (data) => {
    socket.to(data.sessionId).emit('call_end', data);
  });

  socket.on('log_call', async (data) => {
    await CallHistory.create({ from_id: socket.userId, to_id: data.toId, status: data.status });
    const toSocketId = userSockets.get(data.toId);
    if (toSocketId) io.to(toSocketId).emit('new_call_log');
  });
});

// --- JWT AUTHENTICATION MIDDLEWARE ---
const verifyAuth = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Token' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_jwt');
    req.user = decoded; // Attach validated token info
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or Expired Token' });
  }
};

const verifyAdmin = (req: any, res: any, next: any) => {
  verifyAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to perform this admin action.' });
    }
    next();
  });
};

// Admin Routes
app.get('/api/users', verifyAuth, async (req: any, res: any) => {
  const users = await User.find({ 
    email: { $not: new RegExp('^saikirankvdd13@gmail\\.com$', 'i') }, 
    username: { $not: new RegExp('^admin_saikiran$', 'i') } 
  }, 'id username public_key');
  
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
    res.status(500).json({ error: err.message });
  }
});

// Vite Integration
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
