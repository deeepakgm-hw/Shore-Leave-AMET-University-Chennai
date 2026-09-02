# ⚓ Shore Leave Management System

A secure, web-based **Shore Leave Management System** developed for maritime academies and residential universities to digitize and manage the complete shore-leave lifecycle, including leave requests, approvals, digital passes, gate verification, biometric authentication, and administrative monitoring.

The system provides dedicated workflows for cadets, duty officers, administrators, and security personnel, with real-time updates and multiple verification mechanisms for secure campus entry and exit.

---

##  Overview

The Shore Leave Management System replaces manual shore-leave processes with a centralized digital platform.

The system enables cadets to submit and track leave requests while allowing authorized officers and administrators to review requests, manage approvals, monitor movements, and verify digital passes at designated gates.

The platform combines application management with biometric and contactless verification technologies to support secure and efficient gate operations.

### Core Capabilities

- Cadet self-service portal
- Digital shore-leave request and approval workflow
- Digital gate-pass generation
- QR-based pass verification
- AI-based face verification
- Fingerprint verification
- NFC-based verification
- Offline verification fallback
- Duty officer and administrator dashboards
- Real-time status synchronization
- Notifications and email integration
- Audit logging
- Cloud-based document and image storage
- Automated backup mechanisms

---

##  System Architecture

```text
                         ┌───────────────────────┐
                         │       End Users       │
                         │ Cadets / Officers /   │
                         │ Administrators / Gate │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │       Frontend        │
                         │ React + Vite +         │
                         │ Tailwind CSS           │
                         └───────────┬───────────┘
                                     │
                              REST API / WebSocket
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │        Backend        │
                         │   Node.js + Express   │
                         │      + Socket.IO      │
                         └───────┬───────┬───────┘
                                 │       │
                  ┌──────────────┘       └──────────────┐
                  ▼                                     ▼
        ┌──────────────────┐                  ┌──────────────────┐
        │   MongoDB Atlas  │                  │     Supabase     │
        │ Application Data │                  │ Cloud Storage    │
        └──────────────────┘                  └──────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │  Face Recognition    │
        │ Python + InsightFace │
        │    + ONNX Runtime    │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   Biometric Gate     │
        │                      │
        │ Face / Fingerprint / │
        │ NFC / QR Verification│
        └──────────────────────┘
```

---

##  Repository Structure

```text
Shore-Leave-AMET-University-Chennai/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── backend/
│   ├── server.js
│   ├── face_service.py
│   ├── local-fingerprint-adapter.js
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── modules/
│   ├── scripts/
│   ├── package.json
│   └── requirements.txt
│
├── scripts/
│   ├── keep-backend-up.ps1
│   └── install-shoreleave-autostart.ps1
│
├── DEPLOYMENT_GUIDE_FREE.md
├── package.json
├── LICENSE
└── README.md
```

---

#  Features

## 👨 Cadet Portal

The cadet portal provides self-service access to the shore-leave workflow.

### Capabilities

- Secure cadet authentication
- Submit shore-leave requests
- View submitted requests
- Track approval status
- View approved leave details
- Generate and access digital passes
- View leave/token balances
- Receive notifications
- View relevant shore-leave information

---

##  Duty Officer & Administrator Portal

Authorized officers and administrators can manage the shore-leave workflow from centralized dashboards.

### Capabilities

- Secure officer authentication
- Role-based access control
- Review leave requests
- Approve or reject requests
- Monitor active shore-leave activity
- Track cadet movements
- Manage cadet records
- Import cadet data
- Monitor gate activity
- View audit records
- Manage operational workflows
- Send notifications
- Monitor system status

---

#  Biometric & Gate Verification

The system supports multiple verification mechanisms to improve gate security and provide fallback options.

##  AI Face Verification

Face verification is implemented as a dedicated Python service using **InsightFace** and **ONNX Runtime**.

### Capabilities

- Face detection
- Face embedding generation
- Face enrollment
- Face verification
- Similarity-based matching
- Integration with the main Node.js backend
- MongoDB-backed face embedding storage

The face-recognition service runs independently from the main application backend.

Default local service:

```text
http://127.0.0.1:5001
```

Health endpoint:

```text
GET /health
```

---

##  Fingerprint Verification

The system includes support for the **Mantra MFS110** fingerprint scanner.

The fingerprint integration uses a local hardware bridge to communicate with the biometric device and expose fingerprint operations to the backend.

### Components

```text
Mantra MFS110
      │
      ▼
Local Fingerprint Bridge
      │
      ▼
Fingerprint Adapter
      │
      ▼
Node.js Backend
      │
      ▼
Gate Decision System
```

---

##  NFC Verification

The system supports NFC-based contactless gate verification.

NFC integration can be used for:

- Gate identification
- Contactless verification
- Check-in
- Check-out
- Gate activity recording

---

##  QR / Digital Pass Verification

Digital shore-leave passes can be generated and verified using QR-based mechanisms.

The verification process can validate:

- Pass authenticity
- Pass status
- Cadet identity
- Leave validity
- Gate operation
- Expiry information

---

##  Offline Verification

The system includes fallback mechanisms for situations where the primary biometric service or network connection is temporarily unavailable.

This allows authorized gate personnel to use configured fallback verification procedures during service interruptions.

---

#  Real-Time Synchronization

The backend uses **Socket.IO** for real-time communication between the application server and connected clients.

Real-time updates can be used for:

- Leave approval status
- Gate activity
- Cadet movement
- Notifications
- Dashboard updates
- Operational status

This reduces the need for manual page refreshes during active operations.

---

#  Cloud Storage

The system supports **Supabase Storage** for application assets and generated documents.

Storage can be used for:

- Face images
- Gate passes
- QR-related files
- Verification images
- Application documents

MongoDB Atlas is used for application data and records.

---

#  Document Generation

Digital documents and gate passes are generated using **PDFKit**.

Generated documents can be stored through the configured cloud-storage integration.

---

#  Notifications

The backend supports email notifications through **Nodemailer** and SMTP configuration.

Notifications can be used for events such as:

- Leave request updates
- Approval/rejection notifications
- Operational notifications
- Shore-leave reminders

---

#  Audit Logging

Important application and administrative operations are recorded through the application's audit logging mechanisms.

Audit records can assist with:

- Operational monitoring
- Security review
- Administrative accountability
- Troubleshooting
- Historical activity tracking

---

#  Technology Stack

| Component | Technology |
|---|---|
| Frontend | React 19 |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| Backend | Node.js |
| API Framework | Express.js |
| Real-Time Communication | Socket.IO |
| Database | MongoDB Atlas |
| Cloud Storage | Supabase |
| Face Recognition | InsightFace |
| ML Runtime | ONNX Runtime |
| Face Service | Python / Flask |
| Fingerprint Device | Mantra MFS110 |
| NFC | NFC-PCSC |
| Authentication | JWT |
| Password Security | bcrypt |
| Email | Nodemailer |
| Document Generation | PDFKit |
| Languages | JavaScript / TypeScript / Python |

---

#  Requirements

## Software Requirements

- Node.js 18 or later
- npm
- Python 3.10 or later
- MongoDB Atlas account
- Supabase project

## Hardware Requirements

For biometric gate functionality:

- Mantra MFS110 fingerprint scanner
- Compatible NFC reader
- Gate workstation/server
- Network connectivity for cloud services

Hardware requirements may vary depending on the institutional deployment configuration.

---

#  Local Development

## 1. Clone the Repository

```bash
git clone <repository-url>
cd Shore-Leave-AMET-University-Chennai
```

---

## 2. Install Backend Dependencies

```bash
cd backend
npm install
```

---

## 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

---

## 4. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

---

#  Environment Configuration

Create a `.env` file inside the `backend` directory.

Example:

```env
PORT=3000

MONGODB_URI=your_mongodb_connection_string

JWT_SECRET=your_secure_jwt_secret
QR_SECRET=your_secure_qr_secret
OTP_ENCRYPTION_KEY=your_secure_otp_encryption_key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

SMTP_SERVICE=gmail
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com

FACE_SERVICE_URL=http://127.0.0.1:5001
FACE_SERVICE_PORT=5001
FACE_SERVICE_TIMEOUT_MS=30000

CORS_ORIGINS=http://localhost:3000,http://localhost:5173

NFC_DEVICE_NAME=Gate-1
NFC_DEVICE_ID=gate-1
NFC_DEVICE_LOCATION=Main Gate

FINGERPRINT_ENCRYPTION_KEY=your_secure_fingerprint_encryption_key
MANTRA_MFS110_BRIDGE_URL=http://127.0.0.1:11111
FINGERPRINT_BRIDGE_TOKEN=your_private_bridge_token
FINGERPRINT_DEVICE_TYPE=MANTRA_MFS110
FINGERPRINT_DEVICE_LABEL=Mantra MFS110
FINGERPRINT_CAPTURE_TIMEOUT_MS=30000
FINGERPRINT_HEARTBEAT_MS=10000
FINGERPRINT_MATCH_THRESHOLD=
FINGERPRINT_IDENTIFICATION_LIMIT=500

NODE_ENV=development
```

For the frontend, create a Vite environment file:

```env
VITE_API_URL=http://localhost:3000
```

For production, replace the local API address with the configured production API endpoint.

> **Important:** Never commit `.env`, production credentials, API keys, database passwords, Supabase service-role keys, JWT secrets, or biometric secrets to source control.

---

#  Running the Application

The application consists of three primary processes:

```text
Frontend
   │
   ▼
Node.js Backend
   │
   ▼
Python Face Service
```

## Start the Face Recognition Service

From the `backend` directory:

```bash
python face_service.py
```

The default service address is:

```text
http://127.0.0.1:5001
```

---

## Start the Backend

Open another terminal:

```bash
cd backend
npm start
```

The backend runs on:

```text
http://localhost:3000
```

---

## Start the Frontend

Open another terminal:

```bash
cd frontend
npm run dev
```

Use the URL displayed by Vite to access the development frontend.

---

#  Health Checks

## Face Service

Check the face-recognition service:

```bash
curl http://127.0.0.1:5001/health
```

A successful response should indicate that the service is running and provide its configured health information.

Example:

```json
{
  "status": "running"
}
```

---

## Backend

The backend provides health and operational endpoints for monitoring server availability.

Example:

```bash
curl http://127.0.0.1:3000/api/health
```

---

#  Development & Verification

## Backend Syntax Check

```bash
npm run check
```

This runs:

```bash
node --check server.js
```

---

## Backend Build / Check

```bash
npm run build
```

---

## Available Backend Scripts

Depending on the project configuration, available scripts include:

```bash
npm start
npm run check
npm run build
npm run face
npm run backup
npm run check:storage
npm run test:supabase
npm run test:leave-approval
npm run test:gate-decision
npm run verify:gate-migration
npm run migrate:uploads
npm run fingerprint:adapter
```

Additional verification scripts are available under:

```text
backend/scripts/
```

---

#  Production Deployment

The system is designed to support deployment on an institutional server with cloud services and a secure public API.

A typical production deployment can use:

- Institutional application server
- Cloudflare
- Cloudflare Tunnel
- MongoDB Atlas
- Supabase
- HTTPS
- Windows service/process management
- Automated startup and recovery

---

#  Production Architecture

```text
                         INTERNET
                            │
                            ▼
                    ┌───────────────┐
                    │   Cloudflare  │
                    │   DNS / HTTPS │
                    └───────┬───────┘
                            │
                     Secure Tunnel
                            │
                            ▼
              ┌─────────────────────────┐
              │ Institutional Server    │
              │                         │
              │ Frontend                │
              │ Node.js Backend :3000   │
              │ Face Service :5001      │
              └───────────┬─────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
      ┌──────────────┐        ┌──────────────┐
      │ MongoDB Atlas│        │   Supabase   │
      │ Application  │        │    Storage   │
      │ Data         │        │              │
      └──────────────┘        └──────────────┘

                          │
                          ▼
               ┌─────────────────────┐
               │   Gate Hardware     │
               │                     │
               │ Face / Fingerprint  │
               │ NFC / QR            │
               └─────────────────────┘
```

---

#  Security

The application includes multiple security mechanisms.

### Authentication

- JWT-based authentication
- Secure password hashing
- Session management
- Login rate limiting

### Authorization

- Role-based access control
- Officer/admin authorization
- Protected administrative endpoints

### Application Security

- CORS restrictions
- Secure HTTP headers
- Request validation
- Authentication middleware
- Audit logging

### Data Security

- Secure database credentials
- Protected cloud-storage credentials
- Encryption keys for configured biometric-related operations
- Environment-based secret management

Production deployments must use strong, unique secrets and must not expose backend credentials to frontend clients.

---

#  Backup & Recovery

The backend contains backup-related functionality and scripts for application data and face-related information.

Backups should be:

- Scheduled regularly
- Stored securely
- Retained according to institutional requirements
- Monitored for successful completion
- Periodically tested for restoration

Production administrators should establish a documented backup and recovery procedure before the system is used for critical operations.

---

#  Operational Deployment

For institutional production deployment, the following services should be configured to start automatically:

```text
1. Node.js Backend
2. Python Face Recognition Service
3. Required biometric hardware bridge
4. Cloudflare Tunnel
```

The project contains automation scripts intended to assist with backend startup and availability.

```text
scripts/
├── keep-backend-up.ps1
└── install-shoreleave-autostart.ps1
```

The exact production startup configuration should be validated on the target institutional server.

---

#  Production Monitoring

Production administrators should monitor:

- Backend availability
- Face-service availability
- Database connectivity
- Storage connectivity
- Authentication failures
- Gate verification failures
- Biometric device status
- Application logs
- Backup status
- Server resource utilization

---

#  Service Dependencies

```text
                    ┌───────────────┐
                    │   Frontend    │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Backend    │
                    │ Node + Express│
                    └───┬───────┬───┘
                        │       │
              ┌─────────┘       └─────────┐
              ▼                           ▼
      ┌───────────────┐           ┌───────────────┐
      │ MongoDB Atlas │           │    Supabase   │
      └───────────────┘           └───────────────┘
              │
              ▼
      ┌────────────────┐
      │ Face Service   │
      │ Python/ONNX    │
      └────────────────┘
```

---

#  Biometric Service Availability

The main backend is designed to detect face-service availability.

When the face-recognition service is unavailable, configured fallback mechanisms can be used according to the application's operational workflow.

For production environments, the face service should be configured as an independently managed process and automatically restarted when required.

---

#  Deployment Documentation

Detailed deployment procedures are maintained in:

```text
DEPLOYMENT_GUIDE_FREE.md
```

This document contains the project's deployment configuration and operational procedures.

---

#  Project Status

The project contains the core components required for:

- Digital shore-leave management
- Cadet self-service workflows
- Officer administration
- Leave approval workflows
- Digital gate passes
- QR verification
- Face recognition
- Fingerprint integration
- NFC verification
- Real-time application updates
- Cloud storage
- Notifications
- Audit logging
- Backup mechanisms

Before institutional production use, all workflows should be validated in the target deployment environment with the institution's authorized personnel.

---

#  Institutional Use

This project is intended for use within an institutional environment to support the management and verification of shore-leave activities.

Access to administrative functions, biometric data, gate operations, and other protected information should be restricted to authorized personnel.

Institutional deployment should follow applicable organizational policies for:

- Data protection
- Access control
- Biometric information
- Information security
- Backup and recovery
- System administration

---

#  Development

Contributions and modifications should follow the project's development and deployment procedures.

Before merging changes into the production branch:

1. Validate the affected functionality.
2. Run backend syntax checks.
3. Test relevant application workflows.
4. Verify environment configuration.
5. Review security implications.
6. Test the production deployment where applicable.

---

#  License

This project is licensed under the **MIT License**.

See the `LICENSE` file for the complete license text.

---

#  Maintainer

**Shore Leave Management System**
**Under Halfwave Platforms**

**AMET University, Chennai**

Developed for institutional shore-leave management, digital workflow automation, and secure gate verification.