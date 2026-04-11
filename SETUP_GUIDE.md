# StegoChat - Setup & Installation Guide

**Version:** 1.0.0  
**Last Updated:** April 10, 2026

---

## Quick Start (5 minutes)

### Prerequisites
```bash
✓ Node.js 20.x or higher
✓ npm 10.x or higher
✓ MongoDB (local or Atlas)
✓ Git
```

### Installation Steps

```bash
# 1. Clone repository
git clone https://github.com/saikirankvdd/stegochat.git
cd secure-audio-steganography-platform

# 2. Install dependencies
npm install

# 3. Create .env file
cp .env.example .env

# 4. Edit .env with your configuration
nano .env  # or use your editor

# 5. Start development server
npm run dev

# 6. Open browser
open https://localhost:5000
```

Access the application at `https://localhost:5000`

---

## Detailed Installation Guide

### Part 1: Prerequisites Installation

#### Option A: Windows

**Node.js & npm:**
1. Download from https://nodejs.org/ (LTS version)
2. Run installer, follow prompts
3. Verify installation:
   ```bash
   node --version  # v20.x.x
   npm --version   # 10.x.x
   ```

**Git:**
1. Download from https://git-scm.com/download/win
2. Run installer with default settings
3. Verify:
   ```bash
   git --version
   ```

#### Option B: macOS

**Using Homebrew (Recommended):**
```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js & npm
brew install node@20

# Install Git
brew install git

# Verify
node --version
npm --version
git --version
```

**Manual Installation:**
1. Download Node.js from https://nodejs.org/
2. Download Git from https://git-scm.com/download/mac
3. Run installers

#### Option C: Linux (Ubuntu/Debian)

```bash
# Update package list
sudo apt update

# Install Node.js & npm
sudo apt install nodejs npm

# Install Git
sudo apt install git

# Install MongoDB (optional, for local development)
sudo apt install mongodb

# Verify
node --version
npm --version
git --version
```

### Part 2: Repository Setup

#### Clone Repository

```bash
# Clone via HTTPS (recommended for beginners)
git clone https://github.com/saikirankvdd/stegochat.git
cd secure-audio-steganography-platform

# Or clone via SSH (if SSH keys configured)
git clone git@github.com:saikirankvdd/stegochat.git
cd secure-audio-steganography-platform
```

#### Install Dependencies

```bash
# Install all npm packages
npm install

# Verify installation
npm list --depth=0
```

**Expected output:**
```
secure-audio-steganography-platform@0.0.0
├── @google/genai@1.29.0
├── @tailwindcss/vite@4.1.14
├── bcryptjs@3.0.3
├── crypto-js@4.2.0
├── express@4.21.2
├─── mongoose@9.3.3
├── react@19.0.0
├── socket.io@4.8.3
└── (40+ more packages)
```

### Part 3: Environment Configuration

#### Create .env File

```bash
# Copy example environment file
cp .env.example .env
```

If `.env.example` doesn't exist, create `.env` manually:

```bash
# Create blank .env
touch .env

# Edit with your editor
nano .env
```

#### Configure Environment Variables

**Development Configuration (.env):**

```env
# ============================================
# MONGODB CONNECTION
# ============================================

# Option 1: Local MongoDB
MONGODB_URI=mongodb://localhost:27017/stegochat

# Option 2: MongoDB Atlas (Cloud)
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/stegochat

# ============================================
# SECURITY
# ============================================

# JWT Secret (Change this to a random string!)
JWT_SECRET=your_super_secret_jwt_key_here_change_me_to_random_string_12345

# Node Environment
NODE_ENV=development

# ============================================
# EMAIL (Optional for development)
# ============================================

# EmailJS (Production OTP delivery)
# Leave blank for development (OTP will print to console)
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_ID=
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=

# ============================================
# SERVER
# ============================================

# Port (default: 5000)
PORT=5000

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5000
```

**Production Configuration (for Render):**

```env
# MongoDB Atlas URL
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/stegochat

# JWT Secret (Generate a strong random string)
JWT_SECRET=<generate-with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

# Node Environment
NODE_ENV=production

# EmailJS Settings (Required for production)
EMAILJS_SERVICE_ID=service_xxxxx
EMAILJS_TEMPLATE_ID=template_xxxxx
EMAILJS_PUBLIC_KEY=public_key_xxxxx
EMAILJS_PRIVATE_KEY=private_key_xxxxx

# Frontend URL
FRONTEND_URL=https://your-render-app.onrender.com

# Port (Render manages this)
PORT=5000
```

#### Generate Strong JWT Secret

```bash
# Method 1: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z...

# Method 2: OpenSSL
openssl rand -hex 32

# Method 3: Use online generator
# https://randomkeygen.com/ (not recommended for production)
```

### Part 4: Database Setup

#### Option A: MongoDB Atlas (Recommended for Production)

**Step 1: Create MongoDB Atlas Account**
1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for free account
3. Enter project details

**Step 2: Create Cluster**
1. Click "Create Deployment"
2. Select "M0 (Free tier)" for development
3. Select server region (closest to you)
4. Click "Create Cluster"
5. Wait 5-10 minutes for cluster to initialize

**Step 3: Database Access**
1. Go to "Database Access" in left menu
2. Click "Add Database User"
3. Create username: `stegochat_user`
4. Create password: (use strong password)
5. Click "Add User"

**Step 4: Get Connection String**
1. Go to "Clusters" in left menu
2. Click "Connect" on your cluster
3. Select "Drivers"
4. Copy connection string
5. Replace `<password>` with your password and `stegochat` with database name

**Step 5: Update .env**
```env
MONGODB_URI=mongodb+srv://stegochat_user:yourpassword@cluster.mongodb.net/stegochat
```

#### Option B: Local MongoDB (Development Only)

**Windows:**
```bash
# Download from https://www.mongodb.com/try/download/community
# Run installer with default settings
# MongoDB should auto-start

# Verify
mongosh  # opens MongoDB shell
```

**macOS:**
```bash
# Install via Homebrew
brew tap mongodb/brew
brew install mongodb-community

# Start MongoDB service
brew services start mongodb-community

# Verify
mongosh
```

**Linux (Ubuntu/Debian):**
```bash
# Install
sudo apt install mongodb

# Start service
sudo systemctl start mongodb

# Verify
mongosh
```

**Configure .env for Local MongoDB:**
```env
MONGODB_URI=mongodb://localhost:27017/stegochat
```

### Part 5: EmailJS Setup (Production Only)

For production, you need EmailJS for OTP email delivery.

**Step 1: Create EmailJS Account**
1. Go to https://www.emailjs.com/
2. Sign up for free account (limited to 200 emails/month)
3. For production, upgrade to paid plan

**Step 2: Create Email Service**
1. Go to "Email Services" → "Create New Service"
2. Select Gmail as service
3. Follow instructions to authorize
4. Note the Service ID: `service_xxxxx`

**Step 3: Create Email Template**
1. Go to "Email Templates" → "Create New Template"
2. Use this template:
   ```
   Subject: Your OTP Code {{subject}}
   
   Hello,
   
   Your OTP code is: {{otp}}
   
   This code is valid for 10 minutes.
   
   - Team StegoChat
   ```
3. Note the Template ID: `template_xxxxx`

**Step 4: Get API Keys**
1. Go to "Account" / "API Keys" tab
2. Copy Public Key: `public_key_xxxxx`
3. Copy Private Key: `private_key_xxxxx` (keep secret!)

**Step 5: Update .env**
```env
EMAILJS_SERVICE_ID=service_xxxxx
EMAILJS_TEMPLATE_ID=template_xxxxx
EMAILJS_PUBLIC_KEY=public_key_xxxxx
EMAILJS_PRIVATE_KEY=private_key_xxxxx
```

### Part 6: Start Development Server

```bash
# Install again (in case anything missing)
npm install

# Start server with hot reload
npm run dev

# Expected output:
# [2026-04-10 10:30:45] Server running on https://localhost:5000
# [2026-04-10 10:30:45] Connected to MongoDB successfully!
# [2026-04-10 10:30:45] [System] Admin account seeded successfully.
```

#### Common Startup Issues

**Issue 1: Port 5000 already in use**
```bash
# Solution A: Kill process on port 5000
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :5000
kill -9 <PID>

# Solution B: Use different port
PORT=5001 npm run dev
```

**Issue 2: MongoDB connection error**
```bash
# Check MongoDB is running
# Windows: Services → MongoDB Community Server should be running
# macOS: brew services list | grep mongodb
# Linux: sudo systemctl status mongodb

# Check connection string in .env
# Local: mongodb://localhost:27017/stegochat
# Atlas: mongodb+srv://user:pass@cluster.mongodb.net/db
```

**Issue 3: npm install fails**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules
rm -rf node_modules
rm package-lock.json

# Reinstall
npm install
```

### Part 7: Verify Installation

**Open Browser:**
1. Navigate to `https://localhost:5000`
2. Accept self-signed certificate warning
3. You should see StegoChat login screen

**Test Signup:**
1. Click "Don't have an account? Sign Up"
2. Enter test credentials:
   - Username: `testuser`
   - Email: `test@gmail.com`
   - Password: `TestPassword123`
3. Click "Get OTP"
4. **Development:** Check server console for OTP code
   ```
   [Local fallback] Registration OTP for test@gmail.com: 123456
   ```
5. Enter OTP and complete signup
6. **Success:** You've completed signup!

**Test Login:**
1. Click "Back to Login"
2. Enter credentials:
   - Username: `testuser`
   - Password: `TestPassword123`
3. Click "Login"
4. **Success:** Welcome to StegoChat!

---

## Production Deployment

### Deploy to Render.com

#### Step 1: Push to GitHub

```bash
# Create GitHub repository (if not already)
# Go to https://github.com/new

# Initialize git in project (if not already)
git init
git add .
git commit -m "Initial commit: StegoChat"

# Add remote
git remote add origin https://github.com/yourusername/stegochat.git

# Push to GitHub
git push -u origin main
```

#### Step 2: Create Render Service

1. Go to https://render.com (sign up if needed)
2. Go to Dashboard → "New +"
3. Select "Web Service"
4. Connect GitHub repository
5. Select `secure-audio-steganography-platform`

#### Step 3: Configure Build

```
Name: stegochat
Environment: Node
Build Command: npm install && npm run build
Start Command: npm start
```

#### Step 4: Set Environment Variables

In Render Dashboard, go to "Environment" tab and add:

```
MONGODB_URI = mongodb+srv://username:password@cluster.mongodb.net/stegochat
JWT_SECRET = (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NODE_ENV = production
EMAILJS_SERVICE_ID = service_xxxxx
EMAILJS_TEMPLATE_ID = template_xxxxx
EMAILJS_PUBLIC_KEY = public_key_xxxxx
EMAILJS_PRIVATE_KEY = private_key_xxxxx
FRONTEND_URL = https://your-app.onrender.com
```

#### Step 5: Deploy

1. Click "Deploy"
2. Watch deployment logs
3. Once complete, your app is live!

**Access Your App:**
```
https://your-app.onrender.com
```

---

## Develop Locally

### Project Structure

```
secure-audio-steganography-platform/
├── src/                          # Frontend source
│   ├── components/              # React components
│   │   ├── Admin Dashboard.tsx
│   │   ├── Auth.tsx
│   │   ├── ChatArea.tsx
│   │   ├── Dashboard.tsx
│   │   └── Sidebar.tsx
│   ├── utils/                   # Cryptography utilities
│   │   ├── crypto.ts           # AES-256 encryption
│   │   ├── e2ee.ts             # RSA key exchange
│   │   └── stego.ts            # LSB steganography
│   ├── App.tsx                  # Main app component
│   └── main.tsx                 # Entry point
├── server.ts                    # Express backend
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript config
├── vite.config.ts               # Vite bundler config
└── PROJECT_DOCUMENTATION.md     # This file
```

### Available npm Commands

```bash
# Development
npm run dev              # Start dev server with hot reload

# Production
npm run build            # Build for production (creates dist/)
npm run preview          # Preview production build
npm start                # Start production server

# Code Quality
npm run lint             # Run TypeScript type checker
```

### TypeScript Compilation

```bash
# Check for TypeScript errors
npm run lint

# Generate type declarations
tsc --declaration
```

### React Hot Module Replacement (HMR)

Changes to React components automatically reload in browser without losing state.

```bash
# Edit any file in src/
# Save file (Ctrl+S / Cmd+S)
# Component hot-reloads in browser
```

---

## Troubleshooting Installation

### Issue: "npm: command not found"

**Cause:** Node.js not installed or not in PATH

**Solution:**
```bash
# Reinstall Node.js from https://nodejs.org/

# Verify PATH
node --version
npm --version

# If still error, add to PATH:
# Windows: System Properties → Environment Variables → Add Node folder to PATH
# macOS/Linux: Already in PATH after installation
```

### Issue: "Cannot find module 'express'"

**Cause:** Dependencies not installed

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Issue: "ENOENT: no such file or directory, open '.env'"

**Cause:** .env file not created

**Solution:**
```bash
# Create .env file
touch .env

# Edit with your configuration
nano .env
```

### Issue: "MongoDB connection refused"

**Cause:** MongoDB not running

**Solution:**
```bash
# Start MongoDB
# Windows: Services → MongoDB Community Server → Start
# macOS: brew services start mongodb-community
# Linux: sudo systemctl start mongodb

# Verify running
mongosh  # opens shell without error
```

### Issue: "Self-signed certificate error" in browser

**Cause:** Development HTTPS certificate warning (normal)

**Solution:**
```bash
# Click "Advanced" → "Proceed Safely" (Firefox/Chrome)
# Or "Details" → "Proceed" (Safari)

# This is expected for local development
# Production uses valid certificates from Render
```

### Issue: "Too many open files" error

**Cause:** System limit on file descriptors

**Solution:**
```bash
# Increase limit (macOS/Linux)
ulimit -n 10240

# Or add to ~/.zshrc or ~/.bashrc
echo "ulimit -n 10240" >> ~/.zshrc
source ~/.zshrc
```

### Issue: Port 5000 already in use

**Cause:** Another process using port 5000

**Solution:**
```bash
# Method 1: Kill existing process
# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -i :5000
kill -9 <PID>

# Method 2: Use different port
PORT=5001 npm run dev
```

---

## Performance Tips

### Development

- Use VS Code with "Live Preview" for faster iteration
- Enable React DevTools browser extension for debugging
- Use Chrome DevTools Performance tab for profiling

### Production

- Enable MongoDB geospatial indexes for location-based features
- Configure Render auto-scaling
- Use CDN for static assets (optional: Render integration)
- Enable database query optimization

---

## Next Steps

After successful installation:

1. **Read Documentation:**
   - See [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) for complete features
   - See [SECURITY.md](SECURITY.md) for security details

2. **Create Test Users:**
   - Signup first user
   - Signup second user
   - Test messaging & calls between them

3. **Try Admin Panel:**
   - Login as Admin_SaiKiran/kvs007 (dev only)
   - View system statistics
   - Test moderation features

4. **Configure for Production:**
   - Setup MongoDB Atlas
   - Configure EmailJS
   - Deploy to Render.com

---

**Questions or issues?** Check the troubleshooting section above or review the main documentation.

**Version:** 1.0.0  
**Last Updated:** April 10, 2026
