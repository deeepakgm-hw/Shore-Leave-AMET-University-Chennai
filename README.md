# ⚓ Shore Leave Management System

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.x-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.x-purple.svg)](https://vitejs.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-success.svg)](https://www.mongodb.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Storage-emerald.svg)](https://supabase.com/)
[![Python](https://img.shields.io/badge/Python-InsightFace%20%2F%20ONNX-yellow.svg)](https://insightface.ai/)
[![License](https://img.shields.io/badge/License-MIT-lightgrey.svg)](LICENSE)

An enterprise-grade, real-time **Shore Leave & Biometric Gate Management System** engineered for maritime academies and residential universities. Features seamless leave approval workflows, AI face recognition, Mantra fingerprint biometrics, NFC gate pass verification, and live duty dashboards.

---

## 🏗️ Repository Architecture

```
├── frontend/                  # Modern React 19 + TanStack + Tailwind CSS Web App
│   ├── src/                   # Source code, routes, components, and hooks
│   ├── vite.config.ts         # Vite configuration with API proxying
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                   # Express.js REST API & WebSocket Server
│   ├── server.js              # Main server entrypoint
│   ├── face_service.py        # Python InsightFace / ONNX biometric worker
│   ├── local-fingerprint-adapter.js # Mantra MFS110 USB hardware bridge
│   ├── models/                # Mongoose database models
│   ├── routes/                # Express API route controllers
│   ├── services/              # Gate passes, Supabase storage & notification engines
│   └── modules/               # Biometric security & hardware drivers
│
├── scripts/                   # Watchdog and autostart automation scripts
│   ├── keep-backend-up.ps1
│   └── install-shoreleave-autostart.ps1
│
├── DEPLOYMENT_GUIDE_FREE.md   # 100% Zero-cost production deployment guide (shoreleave.in)
├── package.json               # Monorepo task orchestration
└── .gitignore
```

---

## ✨ Key Features

- **Cadet Self-Service Portal**: Instant leave requests, live pass generation, real-time approval status, and token balances.
- **Biometric Security Gates**:
  - **AI Face Verification**: High-precision cosine similarity matching powered by InsightFace ONNX models.
  - **Mantra MFS110 Fingerprint Verification**: Direct hardware integration via local AVDM bridge.
  - **NFC Tag Scanning**: Instant contactless gate check-in/check-out.
  - **Emergency Offline Passcodes**: Fail-safe fallback codes for duty officers during network outages.
- **Duty Officer & Admin Dashboard**: Live cadet tracking, automated curfew alerts, bulk CSV imports, and audit log generation.
- **Real-Time Synchronisation**: Instant WebSocket status propagation via Socket.IO.
- **Cloud Document Storage**: Secure automated gate pass rendering with PDFKit and Supabase Storage sync.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0 or higher)
- [Python 3.10+](https://www.python.org/)
- [MongoDB Atlas Account](https://www.mongodb.com/cloud/atlas)
- [Supabase Account](https://supabase.com/)

### 1. Installation
Install all dependencies across the monorepo:
```bash
npm run install:all
```

### 2. Configure Environment Variables
Create `.env` in `backend/`:
```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password
```

Create `.env` in `frontend/`:
```env
VITE_API_URL=http://localhost:3000
```

### 3. Run Development Servers

**Run Frontend:**
```bash
npm run dev:frontend
# Running at http://localhost:8080
```

**Run Backend:**
```bash
npm run dev:backend
# Running at http://localhost:3000
```

---

## 🌐 Production Deployment

For complete, zero-cost production deployment instructions to your custom domain (**`shoreleave.in`**) using Cloudflare Pages, Cloudflare Tunnels, or Vercel, refer to:

👉 **[Free Deployment Guide (`DEPLOYMENT_GUIDE_FREE.md`)](./DEPLOYMENT_GUIDE_FREE.md)**

---

## 📜 License
This project is licensed under the MIT License.
