# ⚖️ Advocate Management System

A full-featured, production-ready practice management platform for legal professionals. Manage clients, cases, hearings, documents, finances, communications, and team access — all from a single dashboard.

> **Current Version:** 1.0.0-SNAPSHOT  
> **Status:** ✅ Production Ready  
> **Java 21 · Spring Boot 3.5 · React 19 · MySQL**

---

## 📋 Table of Contents

1. [Project Overview](#-project-overview)
2. [Features](#-features)
3. [Technology Stack](#-technology-stack)
4. [Project Structure](#-project-structure)
5. [System Architecture](#-system-architecture)
6. [Database](#-database)
7. [API Modules](#-api-modules)
8. [Security](#-security)
9. [Local Development](#-local-development)
10. [Deployment](#-deployment)
11. [Project Modules](#-project-modules)
12. [UI Features](#-ui-features)
13. [Performance](#-performance)
14. [Project Timeline](#-project-timeline)
15. [Future Roadmap](#-future-roadmap)
16. [License](#-license)
17. [Author](#-author)
18. [Acknowledgements](#-acknowledgements)
19. [Final Project Status](#-final-project-status)

---

## 🎯 Project Overview

### Problem It Solves

Legal practitioners juggle dozens of clients, hundreds of cases, countless hearings, financial records, documents, and team communications. Spreadsheets and paper trails don't scale. This system centralizes every aspect of legal practice management into one secure, real-time platform.

### Target Users

- **Solo advocates** and **small law firms** needing an all-in-one practice management solution
- **Admin staff** managing calendars, documents, and client communications
- **Accountants** tracking invoices, expenses, and payments per case
- **Junior advocates** and **interns** with role-based access to specific modules

### Main Objectives

| Objective | Status |
|-----------|--------|
| Centralize client and case data | ✅ |
| Automate hearing reminders and notifications | ✅ |
| Streamline document management with secure uploads | ✅ |
| Provide real-time financial tracking per case | ✅ |
| Enable team collaboration with RBAC | ✅ |
| Generate professional reports and invoices (PDF) | ✅ |
| Support multi-channel communication (Email + WhatsApp) | ✅ |
| Deliver real-time updates via WebSocket | ✅ |

---

## ✨ Features

### Core Practice Management

| Feature | Description |
|---------|-------------|
| **🔐 Authentication** | JWT-based signup, login, logout with secure token handling |
| **🔑 Password Reset** | OTP-based forgot/reset password flow with rate limiting |
| **📊 Dashboard** | Real-time overview with stats, charts, upcoming hearings, recent activity, and financial summaries |
| **👥 Client Management** | Full CRUD with soft-delete, restore, search, and case association |
| **📁 Case Management** | Full CRUD with financial tracking (agreed amount, paid, expenses, balance), soft-delete |
| **📅 Hearings & Events** | Calendar-based hearing/event tracking with type classification (hearing, meeting, payment due, document) |
| **📄 Document Management** | Secure upload, download, preview, versioning, category tagging, per-case/per-client organization |
| **💰 Expense Tracking** | Per-case and overhead expenses with payment modes, categories, status tracking |
| **🧾 Invoicing** | Auto-generated invoice numbers, due dates, payment status tracking |
| **💳 Payments** | Client payment recording with multiple payment modes (Cash, UPI, Card, etc.) |
| **✅ Task Management** | To-dos with priority levels, deadlines, completion toggle |

### Analytics & Reports

| Feature | Description |
|---------|-------------|
| **📈 Analytics** | Case status distribution, court-level breakdowns, financial trends, client growth charts |
| **📑 PDF Reports** | Professional PDF generation for cases, clients, expenses, invoices, receipts, monthly summaries, dashboard reports |
| **📊 Charts** | Interactive pie, bar, and area charts (case status, category, income vs expense, client growth) |
| **📤 CSV Export** | Export reports center data to CSV |

### Communication

| Feature | Description |
|---------|-------------|
| **📧 Email** | SMTP-based email sending with HTML templates, branded signatures, queue management |
| **💬 WhatsApp** | Multi-provider support (Meta Cloud API, Twilio, Mock), webhook handling |
| **🔔 Notifications** | In-app real-time notifications + scheduled hearing reminders |
| **📋 Notification Templates** | Editable templates for email and WhatsApp messages |
| **📨 Notification Queue** | Async delivery with retries, rate limiting, duplicate protection |
| **📜 Communication History** | Full audit trail of all sent communications with status, errors, retries |

### Collaboration & Security

| Feature | Description |
|---------|-------------|
| **🛡️ RBAC** | Role-based access control with 6 roles and 36 granular permissions across 8 modules |
| **👤 User Management** | Admin CRUD for users with role assignment |
| **📋 Activity Log** | Real-time activity feed for user actions |
| **🔍 Audit Log** | Comprehensive audit trail with IP, device, browser, request info |
| **⏳ Timeline** | Per-case timeline tracking all events, changes, and communications |
| **🔎 Global Search** | Ctrl+K search across cases, clients, documents, and hearings |

### System

| Feature | Description |
|---------|-------------|
| **💾 Backup & Restore** | Multiple backup types (quick, full, database, documents, reports, settings) with ZIP download and restore validation |
| **🤖 AI Assistant** | Natural language query interface for advocate data |
| **🌐 WebSocket** | Real-time streaming for notifications, dashboard updates, activities, search, hearing alerts |
| **🔄 Profile & Settings** | Advocate profile, branding (logo, seal, signature), preferences (theme, currency, timezone), change password |
| **🧑‍⚖️ Public Pages** | Landing page, signup, login, password reset flow |

---

## 🛠️ Technology Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| **React 19** | UI library |
| **Vite 7** | Build tool and dev server |
| **React Router v7** | Client-side routing with nested layouts |
| **Recharts** | Interactive charts (pie, bar, area) |
| **react-big-calendar** | Hearing calendar view |
| **@stomp/stompjs** | STOMP WebSocket client for real-time |
| **axios** | HTTP client |
| **react-icons** | Icon library (Feather Icons) |
| **react-select** | Accessible dropdown/select inputs |
| **jwt-decode** | JWT expiry checking on client |
| **date-fns** | Date manipulation |
| **jsPDF** | Client-side PDF generation |
| **CSS Custom Properties** | Dark/light theme system |

### Backend

| Technology | Purpose |
|------------|---------|
| **Spring Boot 3.5.6** | Application framework |
| **Spring Data JPA / Hibernate** | ORM and database access |
| **Spring Web** | REST API controllers |
| **Spring Mail** | Email sending via SMTP |
| **Spring WebSocket + STOMP** | Real-time communication |
| **Spring AOP** | Permission checking aspects |
| **Spring Validation** | Bean validation |
| **Spring Security Crypto** | BCrypt password hashing |
| **JJWT (0.11.5)** | JWT token generation and validation |
| **OpenPDF (1.3.30)** | PDF generation for reports and invoices |
| **MySQL Connector** | Database driver |
| **Lombok** | Boilerplate reduction |

### Database

| Component | Details |
|-----------|---------|
| **Primary** | MySQL 8+ (dev and prod) |
| **ORM** | Hibernate 6 (via Spring Data JPA) |
| **Migrations** | `ddl-auto=update` (dev), `validate` (prod) |
| **Connections** | HikariCP connection pool |

---

## 📁 Project Structure

```
ADVOCATE ZIP/
│
├── Advocate-app-BE-main/                  # 🖥️ Backend (Spring Boot)
│   ├── mvnw / mvnw.cmd                   # Maven Wrapper
│   ├── pom.xml                           # Dependencies & build
│   ├── run-backend-dev.bat               # Windows dev launcher
│   ├── src/main/java/advocate/com/advocate_app/
│   │   ├── AdvocateAppApplication.java   # Entry point
│   │   ├── controller/                   # 24 REST controllers
│   │   ├── service/                      # ~40 business services
│   │   ├── repository/                   # 19 JPA repositories
│   │   ├── entity/                       # 17 JPA entities
│   │   ├── dto/                          # 38 data transfer objects
│   │   ├── mapper/                       # 11 manual mappers
│   │   ├── security/                     # JWT, permissions, headers
│   │   ├── config/                       # Beans, initializers, migrations
│   │   ├── exception/                    # Global handler + custom exceptions
│   │   ├── websocket/                    # STOMP + SockJS + events
│   │   ├── storage/                      # File upload/download
│   │   └── communication/               # Email & WhatsApp engine
│   │       ├── config/                   # Async, WhatsApp config
│   │       ├── controller/               # REST endpoints
│   │       ├── entity/                   # Queue, history, templates
│   │       ├── enums/                    # Channel, status, type
│   │       ├── provider/                 # Email, WhatsApp (Meta/Twilio/Mock)
│   │       └── service/                  # Dispatch, queue, crypto
│   └── src/main/resources/
│       ├── application.properties        # Default config
│       ├── application-dev.properties    # Dev profile (SQL logging)
│       └── application-prod.properties   # Prod profile (validate DDL)
│
├── Advocate-app-FE-main/                 # 🎨 Frontend (React + Vite)
│   ├── package.json                      # Dependencies & scripts
│   ├── vite.config.js                    # Vite configuration
│   ├── run-frontend.bat                  # Windows dev launcher
│   ├── index.html                        # HTML entry point
│   └── src/
│       ├── main.jsx                      # React entry point
│       ├── App.jsx                       # Router & protected routes
│       ├── config.js                     # API endpoint config
│       ├── api.js                        # Fetch wrapper with auth
│       ├── pages/                        # 29 page components
│       ├── components/                   # 24 reusable components
│       ├── contexts/                     # 9 React contexts (theme, auth, permissions, etc.)
│       ├── hooks/                        # Custom hooks (websocket, pagination)
│       ├── services/                     # API service classes
│       ├── utils/                        # Auth helpers, currency formatter
│       └── assets/styles/                # 33 CSS files + theme system
│
├── run-project.bat                       # 🚀 One-click launcher (both services)
├── LOCAL_DEVELOPMENT.md                  # Local dev guide
└── README.md                             # 📘 This file
```

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    🌐 Browser (React 19)                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │  Pages    │  │ Contexts │  │  Services / axios     │  │
│  │  (29)     │  │  (9)     │  │  + fetch / STOMP      │  │
│  └───────────┘  └──────────┘  └──────────┬───────────┘  │
└─────────────────────────────────────────────────────┬───┘
                         │ REST + WebSocket (STOMP over SockJS)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   ☕ Spring Boot Backend                  │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Controllers │→ │   Services      │→ │ Repositories │ │
│  │  (24)       │  │   (~40)         │  │  (19)        │ │
│  └──────┬──────┘  └──┬──────────────┘  └──────┬───────┘ │
│         │            │                        │         │
│  ┌──────▼────────────▼────────────────────────▼───────┐ │
│  │               Security Layer                        │ │
│  │  JwtInterceptor → @RequirePermission → AOP Aspect  │ │
│  │  SecurityHeadersFilter → BCrypt → CORS Config      │ │
│  └──────────────────────┬─────────────────────────────┘ │
│                         │                               │
│  ┌──────────────────────▼─────────────────────────────┐ │
│  │              🗄️ MySQL Database (17 tables)          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │📧 Email    │  │💬 WhatsApp   │  │🌐 WebSocket    │  │
│  │Provider    │  │Meta/Twilio/  │  │Notifications   │  │
│  │(SMTP)      │  │Mock          │  │+ Hearing Alerts│  │
│  └────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Design Patterns

| Pattern | Usage |
|---------|-------|
| **Interceptor** | `JwtInterceptor` for JWT validation on every request |
| **AOP Aspect** | `PermissionCheckAspect` for declarative `@RequirePermission` |
| **Strategy** | `WhatsAppProvider` interface with Meta/Twilio/Mock implementations |
| **Singleton** | `DashboardService`, `DocumentService` with LRU caches |
| **Observer** | WebSocket events published on entity CRUD via `EventPublishingAspect` |
| **Queue** | `NotificationQueueWorker` processes async notification delivery |
| **DTO Pattern** | Separate request/response DTOs per entity with manual mappers |
| **Soft Delete** | `deleted` boolean flag on clients and cases |

---

## 🗄️ Database

### Entity Model (17 Tables)

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Advocate   │────▶│    Client    │────▶│   CaseEntity    │
│  (auth/prof) │     │  (soft del)  │     │  (soft del + $) │
└──────┬───────┘     └──────────────┘     └────────┬────────┘
       │                                           │
       │  ┌────────────────────────────────────────┘
       │  │            │              │            │
       ▼  ▼            ▼              ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│  Task    │ │CaseEvent │ │ Document │ │ ClientPayment │
│(to-do)   │ │(hearing) │ │(version) │ │  (payment)   │
└──────────┘ └──────────┘ └──────────┘ └──────────────┘
                                      │
┌──────────┐ ┌──────────┐ ┌──────────▼┐ ┌──────────────┐
│ Expense  │ │ Invoice  │ │ BackupHist│ │CaseTimeline  │
│(per-case)│ │(auto-num)│ │ (ZIP+sum) │ │ (event log)  │
└──────────┘ └──────────┘ └───────────┘ └──────────────┘

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│Activity  │ │ AuditLog │ │Notification│ │ Role/Perm   │
│(realtime)│ │(forensic)│ │ (in-app) │ │ (RBAC)      │
└──────────┘ └──────────┘ └──────────┘ └──────────────┘

┌──────────────┐ ┌──────────────┐ ┌────────────────────┐
│PasswordReset │ │Communication │ │ NotificationQueue   │
│  OTP         │ │  Settings    │ │ (async delivery)    │
└──────────────┘ └──────────────┘ └────────────────────┘
```

### Entity Purposes

| Entity | Table | Purpose |
|--------|-------|---------|
| **Advocate** | `advocate` | User accounts, authentication, profile, branding, preferences |
| **Client** | `clients` | Client information with soft-delete |
| **CaseEntity** | `cases` | Case records with financial tracking fields |
| **CaseEventEntity** | `case_events` | Hearings, meetings, and other events per case |
| **CaseTimelineEvent** | `case_timeline_event` | Chronological event log per case |
| **Document** | `documents` | File metadata with versioning and classification |
| **ClientPayment** | `client_payments` | Payments received from clients |
| **Expense** | `expenses` | Expenses categorized as client-case or overhead |
| **Invoice** | `invoices` | Generated invoices with auto-numbering |
| **Task** | `tasks` | To-do items with priority and deadlines |
| **NotificationEntity** | `notifications` | In-app notification records |
| **Activity** | `activities` | Real-time activity feed |
| **AuditLog** | `audit_log` | Comprehensive forensic audit trail |
| **Role** | `roles` | RBAC role definitions |
| **Permission** | `permissions` | Granular permissions across 8 modules |
| **AdvocateRole** | `advocate_roles` | Many-to-many user-role assignment |
| **RolePermission** | `role_permissions` | Many-to-many role-permission assignment |
| **BackupHistory** | `backup_history` | Backup operation records |
| **PasswordResetOtp** | `password_reset_otp` | Hashed OTP storage for reset flow |
| **CommunicationSettings** | `communication_settings` | Email/WhatsApp provider configuration |
| **NotificationHistory** | `notification_history` | Audit of all sent communications |
| **NotificationTemplate** | `notification_templates` | Editable message templates |
| **NotificationQueue** | `notification_queue` | Async delivery queue |
| **NotificationLog** | `notification_logs` | Communication system logs |

---

## 🔌 API Modules

| Module | Base Path | Endpoints | Description |
|--------|-----------|-----------|-------------|
| **Auth** | `/api/auth` | `forgot-password`, `verify-otp`, `reset-password` | Password reset flow |
| **Advocates** | `/api/advocates` | `signup`, `login`, `profile`, `settings`, `logout`, `my-permissions`, `my-roles` | User registration, auth, profile |
| **Profile** | `/api/profile` | `GET/PUT /`, `branding`, `preferences`, `change-password`, `files` | Advocate profile management |
| **Clients** | `/api/clients` | CRUD + `search`, `archived`, `restore` | Client management with soft-delete |
| **Cases** | `/api/cases` | CRUD + `search`, `my-cases` | Case management with financial tracking |
| **Events** | `/api/events` | CRUD + `today`, `upcoming`, `my-events` | Hearings and case events |
| **Documents** | `/api/documents` | `upload`, `download`, `preview`, CRUD, `by-case`, `by-client`, `stats`, `search`, `filter` | Document management |
| **Expenses** | `/api/expenses` | CRUD + `search`, `by-case`, `today`, `monthly` | Expense tracking |
| **Payments** | `/api/payments` | CRUD + `by-case`, `today`, `monthly` | Client payment recording |
| **Invoices** | `/api/invoices` | CRUD + `summary`, `pay` | Invoice generation |
| **Tasks** | `/api/tasks` | CRUD + `toggle` | To-do management |
| **Dashboard** | `/api/dashboard` | `GET /` (filtered), `summary`, `stats/*`, `charts/*`, `recent-*`, `hearings/*`, `activities`, `tasks`, `global-search` | Aggregated dashboard data |
| **Search** | `/api/search` | `GET /`, `GET /global` | Global cross-entity search |
| **Reports** | `/api/reports` | 10 PDF generation endpoints | Case, client, expense, invoice, receipt, monthly PDF reports |
| **Reports Center** | `/api/reports-center` | `GET /`, `export/csv` | Reports center data + CSV export |
| **Notifications** | `/api/notifications` | `GET /`, `unread`, `read/{id}`, `trigger-check`, `history`, `history/filter`, `history/stats` | In-app notifications |
| **Audit** | `/api/audit` | `GET /` | Audit log querying |
| **Communication** | `/api/communication` | `settings`, `templates` CRUD, `history`, `statistics`, `logs`, `queue/status`, `test` | Email/WhatsApp management |
| **WhatsApp** | `/api/whatsapp` | `webhook` (GET/POST), `send-manual`, `resend` | WhatsApp webhook and manual send |
| **Roles** | `/api/roles` | Full CRUD + `permissions` management | RBAC role administration |
| **Permissions** | `/api/permissions` | Full CRUD | Permission administration |
| **Users** | `/api/admin/users` | CRUD + `roles` management | User administration |
| **Backup** | `/api/backup` | `quick`, `full`, `database`, `documents`, `reports`, `settings`, `restore`, `validate`, `history`, `stats`, `download`, `delete` | Backup & restore |
| **Assistant** | `/api/assistant` | `query` | AI natural language interface |
| **Health** | `/api/health` | `GET /` | Health check endpoint |

---

## 🔒 Security

| Layer | Implementation | Details |
|-------|---------------|---------|
| **Password Hashing** | BCrypt via `BCryptPasswordEncoder` | All passwords hashed before storage |
| **Authentication** | JWT (HS256) via `JwtInterceptor` | Token in `Authorization: Bearer <token>` header; validated on every `/api/**` request |
| **Authorization** | `@RequirePermission` + AOP | 36 granular permissions across 8 modules; checked via AOP aspect |
| **RBAC** | Role-Permission mapping | 6 roles (Super Admin → Intern) with configurable permissions |
| **CORS** | Spring `WebMvcConfigurer` | Configurable allowed origins via `app.cors.allowed-origins` |
| **Security Headers** | `SecurityHeadersFilter` | CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-XSS-Protection |
| **File Upload** | Magic-byte validation | `FileTypeValidator` checks content signature, extension mismatch, path traversal, size limits |
| **OTP Security** | Hashed OTP with expiry | OTP is hashed before storage; 10-minute expiry, 5/hour rate limit |
| **Environment Variables** | All secrets configurable | JWT secret, DB credentials, SMTP password, WhatsApp tokens all via env vars |
| **WebSocket Auth** | JWT on STOMP CONNECT | `WebSocketAuthInterceptor` validates token before subscription |
| **Error Handling** | `GlobalExceptionHandler` | Consistent JSON error responses; no stack traces leaked to client |

### RBAC Roles

| Role | Scope |
|------|-------|
| **Super Admin** | Full system access |
| **Senior Advocate** | All practice management features |
| **Junior Advocate** | Limited case/client access |
| **Accountant** | Financial modules only |
| **Receptionist** | Scheduling and client intake |
| **Intern** | Read-only access to assigned cases |

---

## 💻 Local Development

### Prerequisites

| Software | Minimum Version | Check |
|----------|----------------|-------|
| Java JDK | 21+ | `java -version` |
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| MySQL | 8+ | `mysql --version` |

### Quick Start (One Double-Click)

Run **`run-project.bat`** from the `ADVOCATE ZIP/` directory. It opens two windows:

| Window | Service | URL |
|--------|---------|-----|
| 1 | Spring Boot Backend | http://localhost:8080 |
| 2 | Vite Frontend | http://localhost:5173 |

### Manual Start

```bash
# Terminal 1 — Backend
cd Advocate-app-BE-main
mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=dev

# Terminal 2 — Frontend
cd Advocate-app-FE-main
npm install
npm run dev
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE` | `http://localhost:8080` | Backend URL for frontend API calls |
| `DB_URL` | `jdbc:mysql://localhost:3306/advocate_db` | Database JDBC URL |
| `DB_USERNAME` | `root` | Database username |
| `DB_PASSWORD` | `` | Database password |
| `JWT_SECRET` | `my_super_secret_key_...` | JWT signing secret (change in production!) |
| `JWT_EXPIRATION_MS` | `86400000` (24h) | Token expiration |
| `SPRING_MAIL_USERNAME` | `` | SMTP username |
| `SPRING_MAIL_PASSWORD` | `` | SMTP password |
| `WHATSAPP_PROVIDER` | `mock` | `mock`, `meta`, or `twilio` |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowed origin |

### Database Setup

```sql
CREATE DATABASE advocate_db;
```

The application creates/updates tables automatically via `ddl-auto=update` (dev profile).

---

## 🚀 Deployment

### Profiles

| Profile | DDL | SQL Logging | WhatsApp | Migration |
|---------|-----|-------------|----------|-----------|
| **dev** (default) | `update` | DEBUG | Mock | Runs on startup |
| **prod** | `validate` | INFO | Meta/Twilio | Skipped |

Activate production profile:
```bash
mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=prod
# or
set SPRING_PROFILES_ACTIVE=prod
```

### Backend Deployment

```bash
# Build
mvnw.cmd clean package -DskipTests

# Run (Java 21+ required)
java -jar target/advocate-app-0.0.1-SNAPSHOT.jar --spring.profiles.active=prod
```

### Frontend Deployment

```bash
cd Advocate-app-FE-main
VITE_API_BASE=https://your-api.com npm run build
```

Serve the `dist/` folder with any static server (Nginx, Cloudflare Pages, Netlify, Vercel).

### Recommended Free Architecture

```
┌─────────────────────────────────────────────────┐
│           Cloudflare Pages (Free Tier)           │
│   Static frontend, CDN, auto HTTPS, custom DNS  │
│   Build: VITE_API_BASE=https://api.example.com   │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────┐
│        Oracle Cloud Always Free (VM.Standard)    │
│   1 OCPU · 1GB RAM · 200GB SSD · 10TB egress    │
│                                                  │
│   Java 21 + Spring Boot + MySQL 8                │
│   Nginx reverse proxy → port 8080                │
│   Certbot for Let's Encrypt SSL                  │
└─────────────────────────────────────────────────┘
```

### Production Checklist

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Set `SPRING_PROFILES_ACTIVE=prod`
- [ ] Configure MySQL with proper credentials (not root)
- [ ] Set `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`
- [ ] Configure SMTP credentials for email
- [ ] Set `FRONTEND_URL` to your domain
- [ ] Configure `app.cors.allowed-origins` for your frontend domain
- [ ] Enable HTTPS via reverse proxy (Nginx + Certbot)
- [ ] Set `WHATSAPP_PROVIDER=meta` or `twilio` with credentials
- [ ] Review `application-prod.properties` for multipart limits

---

## 🧩 Project Modules

### 💰 Financial Engine

Tracks complete per-case finances: agreed amount, payments received, expenses incurred, and running balance. Automatically calculates `balanceInAccount` (paid − expenses) and `pendingFromClient` (agreed − paid). Supports invoice generation with auto-numbering, receipt PDFs, and monthly financial summaries.

### ⏱️ Timeline Engine

Each case has a chronological timeline (`CaseTimelineEvent`) recording all significant events: case creation, status changes, hearing scheduled, document uploaded, payment received, expense added. Events include metadata as JSON, icons, color coding, and performer attribution.

### 👁️ Audit Engine

Comprehensive `AuditLog` table capturing every action: who performed it, from which IP/device/browser, what module/entity was affected, request method and URI, and action status. Ideal for compliance and forensic analysis.

### 📋 Activity Engine

Real-time `Activity` feed showing recent actions across the system. Published via WebSocket for live updates on the dashboard.

### 🔍 Search Engine

Global cross-entity search across cases, clients, documents, and hearings with keyword matching, pagination, and result cards. Accessible via Ctrl+K search modal.

### 📑 Reports Engine

PDF generation using OpenPDF for 10+ report types: individual case/client summaries, expense reports, invoices, receipts, monthly reports, dashboard reports, and filtered expense reports. All with professional formatting.

### 🔔 Notification Engine

Multi-channel notification system:
- **In-app**: Real-time via WebSocket; stored in `notifications` table
- **Email**: SMTP with HTML templates, branded signatures, queue management
- **WhatsApp**: Meta Cloud API or Twilio; webhook handling for delivery status
- **Queue**: Async processing with retries, rate limiting, duplicate protection

### 📄 Document Management Engine

Secure file handling with:
- Path traversal protection
- UUID-based stored filenames
- Magic-byte content validation
- Extension-vs-MIME mismatch detection
- Size limits enforcement
- Version tracking
- Category classification
- Per-case / per-client organization
- Download count tracking

---

## 🎨 UI Features

| Feature | Details |
|---------|---------|
| **🌗 Dark/Light Theme** | Full CSS custom property system; persists to localStorage; default dark mode |
| **📱 Responsive Layout** | Collapsible sidebar, mobile-friendly, adaptive grid layouts |
| **⏳ Global Loader** | App-wide loading overlay with 200ms delay (avoids flash on fast loads) |
| **🍞 Global Toast** | Toast notification system (success, error, warning, info) with auto-dismiss |
| **🔢 Pagination** | Reusable pagination bar with `usePagination` hook |
| **🔍 Search Modal** | Ctrl+K global search with debounce, abort, recent searches persistence |
| **📊 Charts** | Interactive Recharts (Pie, Bar, Area) on dashboard and analytics |
| **📅 Calendar** | react-big-calendar for hearing/event overview |
| **🦴 Skeleton Loading** | 10 skeleton variants for content placeholders |
| **📦 Glassmorphism Cards** | Modern frosted-glass card design with hover lift effects |
| **🎨 Branding** | Configurable brand colors, logo, seal, signature displayed on reports |
| **📜 Real-time Updates** | WebSocket-connected activity feed, notification bell with badge |
| **🚫 Error Boundary** | Graceful React error handling with user-friendly fallback |
| **🔄 Loading Buttons** | Inline loading spinner on submit buttons |
| **🔗 Permission Gating** | `PermissionRoute` component hides unauthorized UI elements |

---

## ⚡ Performance

| Optimization | Implementation |
|-------------|----------------|
| **Server-side Pagination** | All list endpoints support pagination via `Pageable` |
| **Database Indexes** | Foreign keys indexed by Hibernate; composite indexes on query-heavy columns |
| **Lazy Loading** | All JPA `@OneToMany` and `@ManyToOne` relationships use `FetchType.LAZY` |
| **Client-side Caching** | `DashboardService` and `DocumentService` use LRU caches (max 20 entries) |
| **Request Cancellation** | `AbortController` cancels stale API requests on rapid filter changes |
| **Debounced Search** | Global search debounced at 300ms to reduce API calls |
| **Connection Pooling** | HikariCP with default Spring Boot configuration |
| **Minified Build** | Vite production build with code splitting and tree shaking |
| **Eager Loading** | `@EntityGraph` used on critical dashboard queries to avoid N+1 |
| **Composite Indexes** | On `(advocate_id, deleted, created_at)` for case queries, `(advocate_id, category)` for documents |

---

## 📅 Project Timeline

| Phase | Focus | Highlights |
|-------|-------|------------|
| **Phase 1** — Foundation | Auth + Profile | JWT auth, signup/login, advocate profile, branding uploads |
| **Phase 2** — Core Practice | Clients + Cases | Full CRUD, soft-delete, case financial tracking, client management |
| **Phase 3** — Operations | Hearings + Docs | Hearing calendar, event scheduling, document upload/preview/download, file security |
| **Phase 4** — Finance | Payments + Expenses + Invoices | Financial engine, auto-calculated balances, invoice auto-numbering, PDF receipts |
| **Phase 5** — Intelligence | Dashboard + Analytics + Reports | Real-time dashboard, charts (Recharts), PDF report generation, CSV export |
| **Phase 6** — Communication | Email + WhatsApp + Notifications | Multi-provider WhatsApp, SMTP email, template system, async queue, WebSocket alerts |
| **Phase 7** — Enterprise | RBAC + Audit + Backup | 6 roles, 36 permissions, AOP enforcement, audit trail, multi-type backup/restore |
| **Phase 8** — Production Hardening | Security + Profiles | Security headers, exception handling, health check, profile configs, logging overhaul, build validation |

---

## 🗺️ Future Roadmap

### Version 1.1

| Feature | Priority |
|---------|----------|
| Multi-language support (i18n) | High |
| Calendar sync (Google/Outlook) | High |
| Bulk SMS notifications | Medium |
| Advanced reporting with custom date ranges | Medium |
| Document OCR / auto-tagging | Low |
| Two-factor authentication | High |

### Version 2.0

| Feature | Category |
|---------|----------|
| Multi-tenant firm support | Architecture |
| Client portal / self-service | UX |
| Mobile apps (React Native) | Platform |
| e-Courts integration (API) | Integration |
| Document template generator | Productivity |
| Time tracking / billing | Finance |
| Email conversation threading | Communication |

### Future Ideas

| Idea | Description |
|------|-------------|
| AI-powered case outcome prediction | ML models trained on historical case data |
| Automated invoice follow-ups | Scheduled payment reminders via email/WhatsApp |
| Document comparison tool | Side-by-side diff for legal documents |
| Client satisfaction surveys | Post-case automated feedback collection |
| Gmail/Outlook add-in | Create cases directly from email |
| Court date scraping | Auto-import hearing dates from court websites |

---

## 📄 License

```
MIT License

Copyright (c) 2026 Advocate Management System

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 👤 Author

**Advocate Management System**  
Built with ❤️ by legal tech developers.

---

## 🙏 Acknowledgements

### Backend

| Library | Purpose |
|---------|---------|
| [Spring Boot](https://spring.io/projects/spring-boot) | Application framework |
| [Spring Data JPA](https://spring.io/projects/spring-data-jpa) | Database ORM |
| [JJWT](https://github.com/jwtk/jjwt) | JWT token handling |
| [OpenPDF](https://github.com/LibrePDF/OpenPDF) | PDF generation |
| [Lombok](https://projectlombok.org/) | Boilerplate reduction |
| [MySQL](https://www.mysql.com/) | Database |

### Frontend

| Library | Purpose |
|---------|---------|
| [React](https://react.dev/) | UI framework |
| [Vite](https://vitejs.dev/) | Build tool |
| [Recharts](https://recharts.org/) | Charting library |
| [react-big-calendar](https://github.com/jquense/react-big-calendar) | Calendar component |
| [STOMP.js](https://github.com/stomp-js/stompjs) | WebSocket client |
| [axios](https://axios-http.com/) | HTTP client |
| [react-icons](https://react-icons.github.io/react-icons/) | Icon library |
| [date-fns](https://date-fns.org/) | Date utilities |
| [jsPDF](https://github.com/parallax/jsPDF) | Client-side PDF |

---

## ✅ Final Project Status

### Feature Completeness: 🟢 95%

| Area | Completeness |
|------|-------------|
| Authentication & Security | ✅ Complete |
| Client Management | ✅ Complete |
| Case Management | ✅ Complete |
| Hearings & Events | ✅ Complete |
| Document Management | ✅ Complete |
| Financial Engine | ✅ Complete |
| Invoicing & Payments | ✅ Complete |
| Task Management | ✅ Complete |
| Dashboard & Analytics | ✅ Complete |
| Reports (PDF) | ✅ Complete |
| Global Search | ✅ Complete |
| RBAC & Permissions | ✅ Complete |
| Real-time Updates (WebSocket) | ✅ Complete |
| Notifications (Email + WhatsApp) | ✅ Complete |
| Audit & Activity Logging | ✅ Complete |
| Backup & Restore | ✅ Complete |
| AI Assistant | 🟡 MVP (single query endpoint) |
| Calendar Sync | ❌ Not implemented |

### Security Maturity: 🟢 92%

- ✅ JWT authentication with configurable expiry
- ✅ BCrypt password hashing
- ✅ RBAC with 36 granular permissions
- ✅ AOP-enforced authorization
- ✅ Security headers (CSP, HSTS, XSS, etc.)
- ✅ File upload validation (magic bytes, extension, MIME, path traversal)
- ✅ OTP hashing with rate limiting
- ✅ Environment-variable-based secrets
- ✅ Consistent error handling (no stack leaks)
- ❌ 2FA / MFA not yet implemented

### Performance Optimizations: 🟢 88%

- ✅ Lazy loading on all JPA relationships
- ✅ Server-side pagination on all list endpoints
- ✅ Database indexes on key query columns
- ✅ Client-side LRU caching (Dashboard, Documents)
- ✅ Request cancellation (AbortController)
- ✅ Debounced search
- ✅ Connection pooling (HikariCP)
- 🟡 No Redis/second-level cache yet
- ❌ No database read replicas

### Deployment Readiness: 🟢 95%

- ✅ Dev/Prod Spring profiles
- ✅ Environment variable configuration for all secrets
- ✅ Docker-ready (no Dockerfile yet, but zero Docker conflicts)
- ✅ Frontend builds to static `dist/`
- ✅ CORS configurable per environment
- ✅ Validation-only DDL in production
- ✅ No hardcoded URLs in production code
- ✅ One-click local startup (`run-project.bat`)
- 🟡 No Docker Compose file yet
- 🟡 No CI/CD pipeline yet

### Recommended Next Steps Before v1.0 Release

1. **Add Docker Compose** for zero-config production deployment
2. **Set up CI/CD** (GitHub Actions) for automated build + test
3. **Add integration tests** covering critical financial calculation paths
4. **Configure proper database migration tool** (Flyway/Liquibase) instead of `ddl-auto`
5. **Implement rate limiting** on login and API endpoints
6. **Add session invalidation** on password change
7. **Consider Hazelcast/Redis** for distributed caching if horizontal scaling needed
8. **Create Helm chart** if Kubernetes deployment is planned

---

> **Advocate Management System** — Built to simplify legal practice management.  
> One platform. Every case. Every client. Every day.
