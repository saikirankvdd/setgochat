# Security Vulnerabilities - Implementation Fixes Guide
## StegoChat Platform - Complete Remediation Steps

---

## CRITICAL FIX #1: Remove Hardcoded Admin Credentials

### Current Vulnerable Code (server.ts lines 97-104)
```typescript
const adminEmail = 'saikirankvdd13@gmail.com';
const adminPassword = 'kvs007';  // ❌ EXPOSED IN SOURCE CODE
const hashedAdminPassword = bcrypt.hashSync(adminPassword, 10);

mongoose.connection.once('open', async () => {
    try {
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (!existingAdmin) {
            await User.deleteOne({ username: 'Admin_SaiKiran' });
            await User.create({ username: 'Admin_SaiKiran', email: adminEmail, password: hashedAdminPassword, public_key: 'ADMIN', encrypted_private_key: 'ADMIN' });
            console.log('[System] Admin account seeded successfully.');
        }
    } catch(e) {
        console.error('Error seeding admin account:', e);
    }
});
```

### Fixed Code
```typescript
// ✅ SECURE VERSION - Use environment variables only
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

// Validate on startup
if (!adminEmail || !adminPassword) {
  console.error('❌ FATAL ERROR: ADMIN_EMAIL and ADMIN_PASSWORD environment variables not set!');
  console.error('   Please set these in your .env file or Render dashboard.');
  console.error('   Without these, the admin account will not be created.');
  process.exit(1);
}

if (adminPassword.length < 12) {
  console.error('❌ FATAL ERROR: ADMIN_PASSWORD must be at least 12 characters long!');
  process.exit(1);
}

let hashedAdminPassword: string;

mongoose.connection.once('open', async () => {
    try {
        // Check if admin already exists
        const existingAdmin = await User.findOne({ username: 'Admin_SaiKiran' });
        
        if (!existingAdmin) {
            // Hash password on first creation
            hashedAdminPassword = bcrypt.hashSync(adminPassword, 12);
            
            // Clean up any unauthorized admins
            await User.deleteMany({ 
              username: 'Admin_SaiKiran', 
              email: { $ne: adminEmail } 
            });
            
            // Create admin
            await User.create({
              username: 'Admin_SaiKiran',
              email: adminEmail,
              password: hashedAdminPassword,
              public_key: 'ADMIN',
              encrypted_private_key: 'ADMIN'
            });
            
            console.log('✅ [System] Admin account created successfully.');
            console.log('⚠️  IMPORTANT: Change your admin password after first login!');
        } else {
            // Admin exists - only update if password changed in env vars
            hashedAdminPassword = bcrypt.hashSync(adminPassword, 12);
            await User.updateOne(
              { username: 'Admin_SaiKiran' },
              { 
                password: hashedAdminPassword,
                email: adminEmail 
              }
            );
            console.log('✅ [System] Admin account verified and updated.');
        }
    } catch(e) {
        console.error('❌ Error during admin account setup:', e.message);
        process.exit(1);
    }
});
```

### Environment Setup Instructions

#### Local Development (.env file)
```bash
# Create/Update .env file in project root
ADMIN_EMAIL="your_actual_email@gmail.com"
ADMIN_PASSWORD="YourStrongRandomPassword123!@#$%"
JWT_SECRET="your_super_secret_jwt_key_min_32_chars_random_string_123456789"
MONGODB_URI="mongodb://127.0.0.1:27017/stegochat"
PORT=5000
```

#### Production (Render.com Dashboard)

1. Go to **Render Dashboard** → Select your app
2. Click **Environment** in left sidebar
3. Add these environment variables:

```
Name: ADMIN_EMAIL
Value: your_actual_email@gmail.com

Name: ADMIN_PASSWORD
Value: GenerateStrongPassword123!@#$

Name: JWT_SECRET
Value: your_random_secret_key_minimum_32_chars_long_abcdefghijklmnop

Name: MONGODB_URI
Value: mongodb+srv://username:password@cluster.mongodb.net/stegochat

Name: NODE_ENV
Value: production
```

4. Click **Save Changes**
5. App will auto-redeploy

### Verification Steps
```bash
# 1. Clear old admin from database (one-time)
# In MongoDB compass/CLI:
db.users.deleteMany({ username: "Admin_SaiKiran" })

# 2. Start server - should create new admin
npm run dev

# 3. Check logs for:
# ✅ [System] Admin account created successfully.

# 4. Try login:
# Username: Admin_SaiKiran
# Password: (whatever you set in env vars)
```

---

## CRITICAL FIX #2: Validate JWT Secret on Startup

### Current Vulnerable Code (server.ts - missing validation)
```typescript
// Current code just uses JWT_SECRET without checking
app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET); // ❌ What if undefined?
});
```

### Fixed Code - Add to server.ts TOP (after imports, before app = express())
```typescript
// ==========================================
// SECURITY: Validate Environment Variables
// ==========================================

const requiredEnvVars = {
  JWT_SECRET: { minLength: 32, description: 'JWT signing key' },
  MONGODB_URI: { minLength: 10, description: 'MongoDB connection string' },
  ADMIN_EMAIL: { minLength: 5, description: 'Admin email address' },
  ADMIN_PASSWORD: { minLength: 12, description: 'Admin account password' }
};

const missingVars: string[] = [];
const weakVars: string[] = [];

for (const [varName, config] of Object.entries(requiredEnvVars)) {
  const value = process.env[varName];
  
  if (!value) {
    missingVars.push(`  - ${varName}: ${config.description}`);
  } else if (value.length < config.minLength) {
    weakVars.push(`  - ${varName}: Too short (${value.length} chars, minimum ${config.minLength})`);
  }
}

if (missingVars.length > 0) {
  console.error('❌ FATAL: Missing required environment variables:');
  missingVars.forEach(v => console.error(v));
  console.error('\n📝 Please set these in your .env file or Render environment.');
  process.exit(1);
}

if (weakVars.length > 0) {
  console.error('❌ FATAL: Environment variables too weak:');
  weakVars.forEach(v => console.error(v));
  console.error('\n🔐 Strengthen your secrets and try again.');
  process.exit(1);
}

console.log('✅ All environment variables validated successfully');

// ==========================================
// Express App Initialization
// ==========================================
const app = express();
```

### JWT Verification Helper Function
```typescript
// Add this helper function after app = express()
const JWT_SECRET = process.env.JWT_SECRET!;

interface JWTPayload {
  id: string;
  username: string;
  iat: number;
  exp: number;
}

function verifyJWT(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch(e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    } else if (e instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token signature');
    }
    throw e;
  }
}

// Middleware to use in protected routes
const authMiddleware = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    
    const token = authHeader.substring(7); // Remove "Bearer "
    const decoded = verifyJWT(token);
    
    req.user = decoded;
    next();
  } catch(e) {
    res.status(401).json({ error: e.message });
  }
};

// Export for use in routes
export { authMiddleware, verifyJWT };
```

### Update Protected Routes
```typescript
// BEFORE: ❌ Using string directly
app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  // ...rest of handler
});

// AFTER: ✅ Using middleware
app.get('/api/users', authMiddleware, async (req, res) => {
  // req.user is already verified
  const currentUser = req.user; // { id, username, iat, exp }
  
  const users = await User.find({ username: { $ne: 'Admin_SaiKiran' } });
  res.json(users);
});

// Apply to all protected routes:
app.get('/api/admin/stats', authMiddleware, async (req, res) => { ... });
app.get('/api/admin/feedback', authMiddleware, async (req, res) => { ... });
app.post('/api/admin/reports/:id/review', authMiddleware, async (req, res) => { ... });
app.get('/api/calls', authMiddleware, async (req, res) => { ... });
app.get('/api/me', authMiddleware, async (req, res) => { ... });
```

---

## HIGH FIX #1: Sanitize Email Inputs

### Current Vulnerable Code
```typescript
app.post('/api/request-register-otp', (req, res) => {
  const { email } = req.body; // ❌ No validation
  
  // Email sent directly
  await sendEmailJS(email, otp);
});
```

### Fixed Code
```typescript
// Add email validation middleware
app.post('/api/request-register-otp',
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .trim()
      .toLowerCase()
      .custom(async (email) => {
        // Check if already registered
        const existing = await User.findOne({ email });
        if (existing) {
          throw new Error('Email already registered');
        }
      })
      .custom(async (email) => {
        // Check if banned
        const banned = await BannedEmail.findOne({ email });
        if (banned) {
          throw new Error('This email cannot be registered (account previously banned)');
        }
      })
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { email } = req.body; // Now validated
    
    try {
      const otp = Math.random().toString().slice(2, 8).padStart(6, '0');
      registerOtps.set(email, otp);
      
      // Set 10-minute expiry
      setTimeout(() => registerOtps.delete(email), 10 * 60 * 1000);
      
      await sendEmailJS(email, otp, false);
      
      res.json({ 
        success: true, 
        message: 'OTP sent to email. Valid for 10 minutes.' 
      });
    } catch(e) {
      console.error('OTP send error:', e);
      res.status(500).json({ 
        error: 'Failed to send OTP. Please try again.' 
      });
    }
  }
);
```

Apply the same validation to `/api/request-otp` (password reset) and `/api/signup`.

---

## HIGH FIX #2: Enforce Offline Message Limits

### Add to server.ts (near Collections definition)
```typescript
// ==============================
// Message Storage Limits
// ==============================
const MAX_OFFLINE_MESSAGES = 50;
const MAX_OFFLINE_FILES = 20;
const MAX_AUDIO_SIZE_MB = 10;
```

### Fix send_message event handler
```typescript
socket.on('send_message', async (data: any) => {
  try {
    // 1. Validate audio size if present
    if (data.audioBase64) {
      const audioSizeBytes = Buffer.byteLength(data.audioBase64);
      const audioSizeMB = audioSizeBytes / (1024 * 1024);
      
      if (audioSizeMB > MAX_AUDIO_SIZE_MB) {
        socket.emit('error', {
          location: 'send_message',
          message: `Audio file too large (${audioSizeMB.toFixed(2)}MB, max ${MAX_AUDIO_SIZE_MB}MB)`
        });
        return;
      }
    }
    
    // 2. Find recipient and check if online
    const recipient_socket = io.sockets.sockets.get(data.toId);
    
    if (recipient_socket) {
      // Recipient online - send directly
      recipient_socket.emit('receive_message', data);
    } else {
      // Recipient offline - store message
      
      // Check count before storing
      const messageCount = await OfflineMessage.countDocuments({ to_id: data.toId });
      
      if (messageCount >= MAX_OFFLINE_MESSAGES) {
        // Delete oldest message to make room
        const oldestMsg = await OfflineMessage.findOne({ to_id: data.toId })
          .sort({ created_at: 1 });
        
        if (oldestMsg) {
          await OfflineMessage.deleteOne({ _id: oldestMsg._id });
          console.log(`[Cleanup] Removed oldest offline message for user ${data.toId}`);
        }
      }
      
      // Now store the message
      await OfflineMessage.create({
        to_id: data.toId,
        payload: JSON.stringify(data),
        created_at: new Date()
      });
      
      socket.emit('message_stored', {
        message: 'Message stored. Will be delivered when recipient comes online.',
        storedAt: new Date()
      });
    }
  } catch(e) {
    console.error('Error in send_message:', e);
    socket.emit('error', { 
      location: 'send_message',
      message: 'Failed to send message' 
    });
  }
});
```

---

## HIGH FIX #3: Remove Plain PIN Storage

### Current Schema (Vulnerable)
```typescript
const SessionSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  user1_id: { type: String, index: true },
  user2_id: { type: String, index: true },
  pin: { type: String },        // ❌ PLAIN TEXT - REMOVE THIS
  pin1: { type: String },       // RSA encrypted (good)
  pin2: { type: String },       // RSA encrypted (good)
  status: { type: String, default: 'pending' },
  initiator_id: { type: String },
  created_at: { type: Date, default: Date.now }
});
```

### Fixed Schema
```typescript
const SessionSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  user1_id: { type: String, index: true },
  user2_id: { type: String, index: true },
  pin1: { type: String },       // RSA encrypted for user1 ✅
  pin2: { type: String },       // RSA encrypted for user2 ✅
  // ❌ REMOVED: pin (plain text) - no longer needed
  status: { type: String, default: 'pending' },
  initiator_id: { type: String },
  created_at: { type: Date, default: Date.now }
});
const Session = mongoose.model('Session', SessionSchema);
```

### Update Chat Session Creation
```typescript
socket.on('start_chat', async (data: any) => {
  try {
    const { user2_id } = data;
    
    // Generate 6-digit PIN
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    
    // ✅ FIXED: Do NOT store plain PIN
    // Only create RSA-encrypted versions for each user
    
    const session = new Session({
      id: sessionId,
      user1_id: user.id,
      user2_id: user2_id,
      // ❌ REMOVED: pin: pin, // Don't store in plain
      pin1: encryptedPin1,  // RSA encrypted
      pin2: encryptedPin2,  // RSA encrypted
      status: 'pending',
      initiator_id: user.id,
      created_at: new Date()
    });
    
    await session.save();
    
    // Emit to user2
    const recipient_socket = io.sockets.sockets.get(user2_id);
    recipient_socket?.emit('chat_started', {
      sessionId: sessionId,
      fromUser: { id: user.id, username: user.username },
      encryptedPin: pin2 // ✅ Send encrypted PIN for user2
    });
    
  } catch(e) {
    socket.emit('error', { message: 'Failed to start chat' });
  }
});
```

---

## Test Your Fixes

### After implementing all fixes, run:

```bash
# 1. Clear admin user from database (first time only)
# Use MongoDB Compass or CLI:
# db.users.deleteMany({ username: "Admin_SaiKiran" })

# 2. Update .env with strong values
echo "ADMIN_EMAIL=your_email@gmail.com" >> .env
echo "ADMIN_PASSWORD=YourStrongPassword123!@#$" >> .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# 3. Restart server
npm run dev

# 4. Check logs - should see:
# ✅ All environment variables validated successfully
# ✅ [System] Admin account created successfully.

# 5. Run stress test against running server
node comprehensive_stress_test.js

# 6. Check results
cat stress_test_results.json | jq '.summary'
```

### Expected Result After Fixes
```json
{
  "summary": {
    "total": 10,
    "passed": 10,
    "failed": 0,
    "errors": 0,
    "vulnerabilitiesFound": 0,
    "criticalVulns": 0,
    "highVulns": 0
  }
}
```

---

## Summary of Changes

| Issue | Fix Location | Changes |
|-------|--------------|---------|
| Hardcoded Admin | server.ts line 97+ | Move to env vars + validation |
| Missing JWT Validation | server.ts top | Add startup checks + middleware |
| Email Not Sanitized | /api/request-register-otp | Add express-validator |
| No Message Limits | send_message handler | Add count check + cleanup |
| Plain PIN Storage | Session schema | Remove 'pin' field |
| No Audio Limits | send_message handler | Add size validation |

**Total Lines Added:** ~300 lines  
**Total Lines Removed:** ~50 lines  
**Net Change:** +250 lines  
**Time to Implement:** 1-2 hours  
**Testing Time:** ~30 minutes

---

## Before Deploying to Production

- [ ] Implement ALL critical fixes
- [ ] Test locally with `npm run dev`
- [ ] Run `node comprehensive_stress_test.js`
- [ ] Update .env in Render environment
- [ ] Deploy to Render
- [ ] Verify admin login works
- [ ] Test all protected endpoints with valid JWT
- [ ] Monitor logs for errors

