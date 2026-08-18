# 🚀 Free Deployment Guide for ShoreLeave.in (100% Zero Cost)

This guide walks you through deploying the **Shore Leave Management System** to your custom domain **`shoreleave.in`** completely free of cost using industry-standard free tier services.

---

## 📑 Architecture Overview

| Component | Technology | Free Hosting Provider | Free Tier Limits |
| :--- | :--- | :--- | :--- |
| **Frontend** | React 19 / Vite / TanStack | **Cloudflare Pages** or **Vercel** | Unlimited bandwidth, custom domain + Free SSL |
| **Backend API** | Node.js Express 5 + Socket.IO | **Cloudflare Tunnel (Self-Hosted)** or **Render.com** | 100% Free, unlimited requests |
| **Face Recognition** | Python InsightFace / ONNX | Local / Cloudflare Tunnel / Free Cloud VM | Included |
| **Database** | MongoDB Atlas | **MongoDB Atlas M0 Free Cluster** | 512 MB forever free (Already configured) |
| **Asset Storage** | Supabase Storage | **Supabase Free Tier** | 1 GB storage, 2 GB transfer (Already configured) |
| **Domain & SSL** | `shoreleave.in` | **Cloudflare DNS** | Free DNS management & Universal SSL |

---

## 🌟 Choose Your Deployment Option

You can choose either of two 100% free methods:

- **Option A (Recommended: Cloudflare Pages + Cloudflare Tunnel)**:
  - **Best for:** Supporting USB biometrics (Mantra scanner & NFC reader), running Python face models with maximum speed, zero server costs, and zero cloud hosting fees.
- **Option B (Vercel Frontend + Render Backend in the Cloud)**:
  - **Best for:** 100% pure cloud deployment without keeping a local computer turned on.

---

# 🛠️ OPTION A: Cloudflare Pages + Cloudflare Tunnel (Recommended)

This method hosts the frontend globally on Cloudflare's CDN and securely tunnels your backend from your campus/local machine to `api.shoreleave.in` without needing a static IP or opening router ports.

### Step 1: Add `shoreleave.in` to Cloudflare (Free DNS & SSL)
1. Go to [Cloudflare.com](https://dash.cloudflare.com/) and create a free account.
2. Click **Add a site** and enter `shoreleave.in`. Select the **Free** plan.
3. Cloudflare will give you two nameservers (e.g., `aria.ns.cloudflare.com`, `bob.ns.cloudflare.com`).
4. Go to your domain registrar (where you bought `shoreleave.in`, like GoDaddy/Namecheap) and change the nameservers to Cloudflare's nameservers.

---

### Step 2: Deploy Frontend on Cloudflare Pages (Free)
1. In Cloudflare Dashboard, go to **Workers & Pages** > **Create application** > **Pages**.
2. Connect your GitHub repository (or upload the folder `frontend`).
3. Set the build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `.output/public`
   - **Root directory:** `frontend`
4. In **Environment Variables**, add:
   - `VITE_API_URL` = `https://api.shoreleave.in`
5. Click **Save and Deploy**.
6. Once deployed, go to **Custom Domains** inside your Pages project, click **Set up a custom domain**, and enter `shoreleave.in` and `www.shoreleave.in`.

---

### Step 3: Set Up Cloudflare Zero Trust Tunnel for Backend
Cloudflare Tunnel securely connects your local Node.js backend & Python face worker to `api.shoreleave.in` for free.

1. In Cloudflare Dashboard, go to **Zero Trust** (free plan).
2. Go to **Networks** > **Tunnels** > **Create a Tunnel**.
3. Name your tunnel: `shoreleave-backend`.
4. Choose your operating system (**Windows**) and copy the installation command provided on screen.
5. In PowerShell (Administrator), run the installer command.
6. In Cloudflare tunnel configuration under **Public Hostname**:
   - **Subdomain:** `api`
   - **Domain:** `shoreleave.in`
   - **Type:** `HTTP`
   - **URL:** `localhost:3000`
7. Click **Save Hostname**.

Now, whenever your backend is running locally on port 3000, `https://api.shoreleave.in` is live, secure with HTTPS, and connected to your frontend!

---

# ☁️ OPTION B: 100% Cloud Deployment (Vercel + Render)

### Step 1: Deploy Backend to Render.com (Free)
1. Push your project to GitHub.
2. Sign up at [Render.com](https://render.com/).
3. Click **New +** > **Web Service** and connect your GitHub repository.
4. Configure settings:
   - **Name:** `shoreleave-api`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Under **Environment Variables**, copy the keys from your `backend/.env`:
   - `MONGO_URI`: *Your MongoDB connection string*
   - `JWT_SECRET`: *Your JWT secret*
   - `SUPABASE_URL`: *Your Supabase project URL*
   - `SUPABASE_SERVICE_ROLE_KEY`: *Your Supabase Service key*
   - `CORS_ORIGINS`: `https://shoreleave.in,https://www.shoreleave.in`
   - `SMTP_USER`: *Your Gmail address*
   - `SMTP_PASS`: *Your Google App Password*
6. Click **Create Web Service**.
7. In Render settings, go to **Custom Domains** and add `api.shoreleave.in`. Add the CNAME record in your domain DNS as instructed by Render.

---

### Step 2: Deploy Frontend to Vercel (Free)
1. Sign up at [Vercel.com](https://vercel.com/) with GitHub.
2. Click **Add New...** > **Project** and select your repo.
3. Configure settings:
   - **Root Directory:** click Edit and select `frontend`.
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `.output/public`
4. Under **Environment Variables**, add:
   - `VITE_API_URL` = `https://api.shoreleave.in` (or your Render service URL)
5. Click **Deploy**.
6. Go to **Project Settings** > **Domains** > Add `shoreleave.in` and `www.shoreleave.in`.
7. Add the DNS records (A record or CNAME) shown by Vercel in your domain DNS manager.

---

## 🔒 Free Database & Storage Verification

Both database and file storage are already configured to use perpetual free tiers:

1. **MongoDB Atlas Database**:
   - Cluster: Free Tier M0 Sandbox (512 MB storage).
   - Access: In MongoDB Atlas dashboard under **Network Access**, ensure IP whitelist is set to `0.0.0.0/0` (Allow Access from Anywhere) so your cloud server can connect.

2. **Supabase Storage**:
   - Free Tier includes 1 GB storage and 2 GB monthly egress bandwidth.
   - Buckets (`face-images`, `gate-passes`, `qr-codes`, `verification-images`) are automatically connected.

3. **Email (Gmail SMTP)**:
   - Free 500 emails/day using Gmail SMTP with an **App Password** (enabled under Google Account Security > 2-Step Verification > App passwords).

---

## 🖥️ Security Gate PC Setup (Biometrics & Scanners)

When deploying to production at `https://shoreleave.in`:

1. Open the gate computer's browser and navigate to:
   - Check-in: `https://shoreleave.in/checkin`
   - Check-out: `https://shoreleave.in/checkout`
2. If using the **Mantra MFS110 USB Fingerprint Scanner**:
   - Ensure the Mantra USB Driver / AVDM service is installed on the gate PC.
   - Run the local bridge adapter on the gate PC:
     ```powershell
     cd "backend"
     node local-fingerprint-adapter.js
     ```
   - The browser at `https://shoreleave.in` connects to `http://127.0.0.1:8791` on the local PC to read fingerprint biometric scans without needing any server hardware!

---

## ✅ Deployment Checklist

- [ ] Domain nameservers routed through Cloudflare DNS.
- [ ] Frontend deployed and pointing to `https://shoreleave.in`.
- [ ] Backend API reachable at `https://api.shoreleave.in` or via Cloudflare Tunnel.
- [ ] MongoDB Atlas Network Access configured to `0.0.0.0/0`.
- [ ] Supabase storage buckets active.
- [ ] HTTPS (SSL) active on both `shoreleave.in` and `api.shoreleave.in`.
