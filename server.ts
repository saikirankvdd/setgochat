import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('database.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user1_id INTEGER,
    user2_id INTEGER,
    pin TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8 // 100 MB
});

app.use(express.json());

// Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Auth Routes
app.post('/api/signup', (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
    const info = stmt.run(username, email, hashedPassword);
    res.json({ success: true, userId: info.lastInsertRowid });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user: any = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    const isAdmin = user.email === process.env.ADMIN_EMAIL;
    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, isAdmin } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, username FROM users').all();
  res.json(users);
});

// Socket.io Logic
const userSockets = new Map<number, string>();
const otps = new Map<number, string>();

app.post('/api/request-otp', (req, res) => {
  const { userId } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps.set(userId, otp);
  console.log(`\n========================================`);
  console.log(`[ADMIN ALERT] Password Reset Requested`);
  console.log(`User ID: ${userId}`);
  console.log(`OTP: ${otp}`);
  console.log(`========================================\n`);
  res.json({ success: true });
});

app.post('/api/change-password', (req, res) => {
  const { userId, otp, newPassword } = req.body;
  const storedOtp = otps.get(userId);
  
  if (storedOtp && storedOtp === otp) {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);
    otps.delete(userId);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid OTP' });
  }
});

function broadcastOnlineUsers() {
  const onlineUserIds = Array.from(userSockets.keys());
  io.emit('online_users', onlineUserIds);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (userId: number) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered with socket ${socket.id}`);
    broadcastOnlineUsers();
  });

  socket.on('disconnect', () => {
    let disconnectedUserId: number | null = null;
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

  socket.on('start_chat', ({ fromId, toId }) => {
    const sessionId = [fromId, toId].sort().join('-');
    let session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    
    if (!session) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      db.prepare('INSERT INTO sessions (id, user1_id, user2_id, pin) VALUES (?, ?, ?, ?)')
        .run(sessionId, fromId, toId, pin);
      session = { id: sessionId, pin };
    }

    socket.join(sessionId);
    const toSocketId = userSockets.get(toId);
    if (toSocketId) {
      io.to(toSocketId).emit('chat_started', { sessionId, pin: session.pin, fromId });
    }
    socket.emit('chat_ready', { sessionId, pin: session.pin });
  });

  socket.on('send_message', (data) => {
    // data: { sessionId, fromId, toId, audioBlob (base64) }
    socket.to(data.sessionId).emit('receive_message', data);
  });

  socket.on('send_file', (data) => {
    socket.to(data.sessionId).emit('receive_file', data);
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

  socket.on('disconnect', () => {
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
  });
});

// Admin Routes
app.get('/api/admin/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const activeSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;
  res.json({
    totalUsers: totalUsers.count,
    activeSessions: activeSessions.count,
    connections: userSockets.size,
    uptime: process.uptime()
  });
});

// Vite Integration
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
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

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
