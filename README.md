# Safe Harbour - Anonymous POSH Compliance Platform

A comprehensive, privacy-first platform for reporting and managing workplace harassment cases under India's POSH Act (Prevention of Sexual Harassment).

## 🛡️ Features

### For Employees
- **Anonymous Reporting**: Submit reports without revealing identity
- **Non-Enumerable UIN**: Unique identifier that can't be guessed or enumerated
- **Real-time Chat**: Anonymous two-way communication with IC committee
- **Case Tracking**: Track report status with secure case tokens

### For Internal Committee (IC)
- **Dashboard**: View and manage all reports in your organization
- **Quorum-Based Actions**: Critical actions require multi-member approval
- **Timeline Alerts**: POSH-compliant deadline notifications (90/180 days)
- **Direct Signup**: Create organization and admin account directly from UI
- **Audit Logs**: Complete audit trail of all actions

### Security Features
- **Break-Glass Reveal**: Multi-signature (2 IC members) required to reveal respondent identity
- **Row-Level Security**: Organization isolation at database level
- **PDF Sanitization**: Strip metadata from all generated reports
- **Blind Indexing**: Email hashed for privacy, searchable without exposure

## 🏗️ Architecture

```
Safe Harbour/
├── client/                 # React + TypeScript frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Route pages
│   │   ├── context/        # React contexts (Auth)
│   │   └── config/         # Supabase client
│   └── package.json
│
├── server/                 # Express + TypeScript backend
│   ├── src/
│   │   ├── controllers/    # API route handlers
│   │   ├── middleware/     # Anonymization, auth
│   │   ├── socket/         # Real-time chat handlers
│   │   ├── workers/        # BullMQ timeline workers
│   │   └── utils/          # Identity generation, crypto
│   ├── scripts/
│   │   ├── ner_extract.py  # Named entity extraction
│   │   └── sanitize_pdf.py # PDF metadata stripping
│   ├── supabase/
│   │   └── migrations/     # Database schema migrations
│   └── package.json
│
└── .venv/                  # Python virtual environment
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Python 3.9+
- Supabase account
- Redis (Optional - for timeline alerts only)

### Installation

1. **Clone and install dependencies**
```bash
git clone <repository-url>
cd "Safe Harbour"

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

2. **Set up Python environment**
```bash
cd ..
python -m venv .venv
.venv/Scripts/activate  # Windows
source .venv/bin/activate  # Mac/Linux
pip install pypdf spacy
python -m spacy download en_core_web_sm
```

3. **Configure environment variables**

Copy the example files and fill in your credentials:

```bash
# Server
cp server/.env.example server/.env

# Client
cp client/.env.example client/.env
```

**Required Credentials:**
- **Supabase**: URL and Keys from Supabase Dashboard
- **SKIP32_KEY**: Any 32-byte hex string (for UIN generation)
- **REDIS_URL**: Optional (leave empty if not using Redis)

4. **Run database migrations**
- Open Supabase SQL Editor
- Run migrations in order: `001_initial_schema.sql` through `009_reveal_requests.sql`

6. **Create Organization & Admin Account**
- Go to `http://localhost:5173/create-organization`
- Enter your Organization Name and Admin Details
- **Set a secure password** for the Admin account
- After creation, you will be redirected to the login page
- Login with your email and password to access the **IC Dashboard**

7. **Start development servers**
```bash
# Terminal 1: Server
cd server
npm run dev

# Terminal 2: Client
cd client
npm run dev
```

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signup` | Create user account |
| POST | `/api/auth/webhook` | Supabase auth webhook |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/organizations` | Create organization |
| POST | `/api/organizations/:orgId/invite` | Generate invite code |
| GET | `/api/organizations/join/:code` | Validate invite code |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reports` | Submit anonymous report |
| GET | `/api/reports/:caseToken` | Get report status |

### IC Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ic/reports` | List organization reports |
| POST | `/api/ic/actions` | Initiate IC action |
| POST | `/api/ic/approve` | Cast approval vote |
| GET | `/api/ic/audit-logs` | View audit trail |

### Break-Glass Reveal (High Security)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ic/reveal-request` | Initiate reveal request |
| POST | `/api/ic/reveal-approve` | Approve reveal (2 required) |
| GET | `/api/ic/reveal/:requestId` | Execute reveal after quorum |

## 🔒 Security Model

### Row-Level Security (RLS)
- All database queries filtered by `organization_id` from JWT
- Cross-organization data access is impossible at database level

### Break-Glass Protocol
1. IC member initiates reveal request with reason
2. Two different IC members must approve
3. Only after quorum: respondent identity revealed
4. Complete audit log of who requested, approved, and executed

### PDF Sanitization
All generated PDF reports are sanitized to remove:
- Author name
- File paths
- Creation/modification dates
- Software identifiers

## 📋 POSH Compliance

- **90-day inquiry deadline**: Alerts sent at 60, 75, 85, 90 days
- **180-day reporting deadline**: Alerts for final submission
- **Audit trail**: All actions logged with timestamps
- **Quorum requirements**: Critical actions need 3+ IC members

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite |
| Backend | Express, TypeScript, Node.js |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Real-time | Socket.io |
| Queue | BullMQ + Redis |
| NLP | spaCy (Python) |
| PDF | pypdf (Python) |

## 📄 License

This project is proprietary and confidential.

---

Built with ❤️ for workplace safety
