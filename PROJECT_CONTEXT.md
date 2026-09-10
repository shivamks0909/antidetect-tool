# Opinion Insights Browser — Complete Project Context

**Version**: 2.1.0 | **Target**: Windows 10/11 x64 | **Architecture**: Tauri v2 + Rust Core + React 19 UI + Node.js Backend API

---

## 1. Product Overview

**Opinion Insights Browser** is an offline-first Windows desktop platform managing hundreds of completely isolated Chromium browser environments within a unified interface. It merges 7 major systems:

1. **Multi-Tenant User Isolation** — Strict data segregation (Admin vs User)
2. **Browser Runtime & Antidetect Engine** — Deterministic seed-based fingerprint generation
3. **Proxy Management** — HTTP/HTTPS/SOCKS4/SOCKS5 with health checking & bulk assignment
4. **Bulk Provisioning & Batch Import** — Spreadsheet-driven (1 Row = 1 Profile)
5. **Extensions & Bookmarks** — Custom sets, bulk application across profile fleets
6. **Local Automation** — Scriptable task workflows (launch, navigate, wait, close)
7. **Application Auto-Update** — GitHub Releases with zero-data-loss guarantee

---

## 2. System Architecture

```
YOUR WINDOWS APP (Tauri Desktop)
        │
        ├── Authentication (Admin / User)
        ├── Dashboard (Profiles, Proxies, Fingerprints, Extensions, Bookmarks)
        └── Browser Runtime (Isolated Chromium)
                │
        PROFILE ENGINE
                │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
Proxy Mgr Fingerprints Extensions Bookmarks Automation
    │         │         │         │
    └─────────┴─────────┘
                │
        BULK PROVISIONING
                │
        ┌───────┴───────┐
        ▼               ▼
Bulk Generator   Batch Import (XLSX/CSV)
        │               │
        └───────┬───────┘
                ▼
        LOCAL STORAGE (Account-Partitioned)
        data/accounts/<account-id>/profiles/<profile-id>/
                │
        UPDATE DISTRIBUTION (GitHub Releases)
```

---

## 3. Technology Stack

### Frontend (React 19 + Vite + Tailwind CSS v4)
- **UI Framework**: React 19, Zustand (state), React Router
- **Styling**: Tailwind CSS v4, custom UI kit (`@proxyshard/shardx-ui-kit`)
- **Build**: Vite 5, TypeScript 5.8
- **Desktop**: Tauri v2 (Rust backend)

### Backend (Node.js + Express + MongoDB)
- **API Server**: Express.js on port 5000
- **Database**: MongoDB Atlas (collections: users, profile_metas, profiles, user_proxies, fingerprints, bookmarks, extension_sets, active_sessions, audit_logs, system_config)
- **Auth**: JWT (12h expiry), bcrypt (passwords), TOTP 2FA (speakeasy), refresh token rotation
- **Security**: Helmet, CORS, rate limiting, audit logging

### Desktop Runtime (Rust + Tauri v2)
- **Core**: Profile management, fingerprint engine, proxy handling, launch orchestration
- **Storage**: Local filesystem (`%APPDATA%/opinion-insights-browser/data/accounts/`)
- **IPC**: Tauri commands (all require authentication)
- **Process**: Chromium spawning with `--user-data-dir` isolation
- **Update**: Tauri updater with Ed25519 signatures

---

## 4. Key Data Models

### Profile (`ProfileMeta`)
```rust
id: String
owner_account_id: String          // CRITICAL: Tenant isolation
name: String
notes: String
proxy_id: Option<String>
last_launched_at: Option<String>
created_at: Option<String>
updated_at: Option<String>
pinned: bool
folder: String
total_runtime_ms: u64
color: Option<String>
extensions: Vec<String>
```

### Proxy (`ProxyEntry`)
```rust
id: String
name: String
kind: ProxyKind (Socks5 | Http | Https)
host: String
port: u16
username: String
password: String (encrypted at rest)
country: String
notes: String
```

### Fingerprint (`LibraryEntry`)
- Deterministic per-profile seeds (FNV-1a hash of `profile_id::slot`)
- Canvas, WebGL, Audio, ClientRects, Sensors, Fonts noise
- GPU preset mapping (macOS models, Windows, Linux)
- Auto-resolution: timezone/language/geolocation from proxy geo

---

## 5. Multi-Tenant Isolation Architecture (CRITICAL)

### Filesystem Partitioning
```
%APPDATA%/opinion-insights-browser/
├── data/
│   └── accounts/
│       ├── <account-id-1>/
│       │   ├── profiles/
│       │   │   └── <profile-id>/
│       │   │       ├── config.json
│       │   │       ├── fingerprint.json
│       │   │       └── chromium/ (user-data-dir)
│       │   ├── proxies.json
│       │   ├── proxies-history.json
│       │   ├── bookmarks.json
│       │   ├── fingerprints/
│       │   ├── extensions/
│       │   ├── trash/
│       │   └── settings.json
│       └── <account-id-2>/
│           └── ...
├── quarantine/          // Legacy/unowned records
├── widevine-cdm/        // Shared system resource
├── bundled-fingerprints/
└── settings.json        // Global launcher settings
```

### Enforcement Layers
| Layer | Mechanism |
|-------|-----------|
| **Database** | Queries scoped: `{ $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] }` |
| **Backend API** | 403/404 on cross-tenant access; compound indexes `(owner_account_id, id)` |
| **Desktop IPC** | `is_authenticated()` check on every command; `active_account_id()` validates scope |
| **Filesystem** | `store::profile_dir(account_id, profile_id)` — no cross-account traversal |
| **Browser Runtime** | `launch_profile_synced` asserts `stored.meta.owner_account_id == active_account_id` |
| **Frontend State** | Zustand stores reset on `signOut()` (`resetUserSessionState`) |

### Admin vs User
- **Admin**: Separate account namespace (`role: "admin"`), own profiles/proxies
- **Admin NEVER sees** normal users' profiles in dashboard or normal APIs
- **Admin CAN** manage users via `/api/admin/users` (metrics only, no profile access)

---

## 6. Core Features Implementation Status

| Feature | Status | Key Files |
|---------|--------|-----------|
| **Multi-Tenant Isolation** | ✅ 100% Verified | `store.rs`, `profile.rs`, `lib.rs`, `server/src/index.js` |
| **Profile CRUD** | ✅ Complete | `profile.rs`, `manage-profiles/*` |
| **Fingerprint Engine** | ✅ Complete | `fingerprints.rs`, `lib.rs` (enrichment) |
| **Proxy Manager** | ✅ Complete | `proxy.rs`, `manage-proxies/*` |
| **Batch Import (XLSX/CSV)** | ✅ Implemented & Verified | `batch-import/*`, `server/test_batch_import.js` |
| **Bulk Profile Generator** | ✅ Complete | `manage-profiles/TemplatePicker.tsx` |
| **Extensions/Bookmarks** | ✅ Complete | `extensions.rs`, `bookmarks.rs` |
| **Auto-Update (GitHub)** | ✅ Verified | `tauri.conf.json`, `updater/*`, `test_auto_updater.js` |
| **Local Automation** | ✅ Complete | `api.rs`, `sync_bus.rs` |

---

## 7. Batch Import Engine (Spreadsheet-Driven)

**Core Invariant**: `1 Valid Row = 1 Real Profile + Auto-Attached Proxy + Isolated Storage`

### Pipeline
1. **Upload** → Excel (`.xlsx`) / CSV via SheetJS (`xlsx`)
2. **Column Mapping** → Fuzzy auto-detection to 27 canonical fields
3. **Validation** → Pre-flight scan (titles, proxies, URLs, duplicates)
4. **Provisioning Queue** → 3-5 parallel workers, live progress, pause/resume/cancel
5. **Persistence** → `localStorage` key `oi_batch_import_job_<account_id>` for crash recovery

### Canonical Fields (27)
- `name` (required), `folder`, `proxy_raw` / `proxy_host`+`proxy_port`+`proxy_user`+`proxy_pass`+`proxy_kind`
- `rotate_url`, `start_urls`, `user_agent`, `timezone`, `language`, `platform`
- `screen_resolution`, `geolocation`, `extensions`, `extension_set`
- `bookmarks`, `bookmark_set`, `tags`, `notes`, `cookie`, `ignore`

---

## 8. Auto-Update System

- **Distribution**: GitHub Releases (primary) + `api.opinioninsights.in` (fallback)
- **Signing**: Ed25519 public key embedded in `tauri.conf.json`
- **Manifest**: `/api/updates/latest.json` served by backend
- **Zero-Data-Loss**: NSIS installer with safe hooks; profile data in `%APPDATA%` untouched
- **Downgrade Protection**: SemVer comparison blocks downgrades

---

## 9. Project Structure

```
antidetecr browser/
├── src/                          # React Frontend
│   ├── app/                      # App shell, routing
│   ├── entities/                 # TypeScript types (proxy, profile, etc.)
│   ├── features/
│   │   ├── auth/                 # Login, 2FA, session
│   │   ├── batch-import/         # Spreadsheet import engine
│   │   ├── manage-profiles/      # Profile CRUD, templates, bulk gen
│   │   ├── manage-proxies/       # Proxy CRUD, bulk import, health
│   │   ├── manage-fingerprints/  # Fingerprint library
│   │   ├── proxyshard/           # Residential proxy marketplace
│   │   └── updater/              # Auto-update UI
│   ├── pages/                    # Route pages (browsers, proxies, settings, admin)
│   ├── shared/                   # UI components, hooks, lib, constants
│   └── widgets/                  # Reusable UI widgets (Sidebar, Tables, Modals)
├── ui-kit/                       # Shared UI component library
├── admin-app/                    # Admin dashboard (separate Vite app)
├── src-tauri/                    # Rust Backend
│   ├── src/
│   │   ├── lib.rs                # Tauri commands, auth, enrichment
│   │   ├── main.rs               # Entry point
│   │   ├── profile.rs            # Profile CRUD, noise seeds, clone
│   │   ├── launch.rs             # Chromium launch, fingerprint resolution
│   │   ├── store.rs              # Filesystem paths, account isolation
│   │   ├── proxy.rs              # Proxy CRUD, probe, UDP, geo
│   │   ├── fingerprints.rs       # Library management
│   │   ├── extensions.rs         # Extension import/management
│   │   ├── bookmarks.rs          # Bookmark CRUD, folder trees
│   │   ├── process.rs            # Process tracker, CDP
│   │   ├── api.rs                # Local automation API (Axum)
│   │   ├── settings.rs           # Global settings
│   │   ├── migrate.rs            # Data migration
│   │   └── trash.rs              # Soft delete with TTL
│   └── tauri.conf.json           # Tauri config, updater pubkey
├── server/                       # Node.js Backend API
│   ├── src/index.js              # Express server, all endpoints
│   ├── src/db.js                 # MongoDB connection
│   └── test_*.js                 # Automated test suites (39+ tests pass)
├── PRD.md                        # Product Requirements Document
├── PROJECT_STATUS.md             # Test results, verification matrix
├── PROFILE_OWNERSHIP.md          # Ownership model, anti-leak
├── BATCH_IMPORT_SPEC.md          # Batch import technical spec
├── AUTHORIZATION.md              # AuthZ architecture
└── TEST_PLAN.md                  # Test matrix
```

---

## 10. Critical Invariants (Never Violate)

1. **No Random Profile Creation** — Profiles only via explicit user action (Create, Bulk Gen, Batch Import)
2. **Owner Account ID Required** — Every profile/proxy/fingerprint must have `owner_account_id`
3. **Authentication Required** — All Tauri commands & API endpoints check `is_authenticated()`
4. **Profile Launch Verification** — `stored.meta.owner_account_id == active_account_id` before spawn
5. **Store Reset on Logout** — All Zustand stores cleared, `auth_logout()` kills processes
6. **Proxy Encryption** — Passwords encrypted at rest (AES-256-CBC)
7. **Fingerprint Determinism** — Same profile ID + slot = same noise seed (FNV-1a)
8. **Batch Import Idempotency** — Resume skips `executionStatus == "completed"` rows

---

## 11. Test Results (100% Pass)

| Test Suite | Tests | Passed | Failed |
|------------|-------|--------|--------|
| Multi-Tenant Isolation | 12 | 12 | 0 |
| Batch Import Provisioning | 14 | 14 | 0 |
| Comprehensive Audit | 13 | 13 | 0 |
| Auto-Update System | 6 | 6 | 0 |
| **Total** | **45** | **45** | **0** |

---

## 12. Key Configuration Files

- **`tauri.conf.json`** — Product name, version, updater pubkey, NSIS installer config
- **`vite.config.ts`** — Vite config, UI kit aliases, Tauri dev server proxy
- **`package.json`** — Dependencies: React 19, Tauri 2, Zustand, Supabase, xlsx, playwright
- **`server/.env`** — MongoDB URI, JWT secret, SMTP, admin origin

---

## 13. Common Commands

```bash
# Development
npm run dev                 # Start Vite + Tauri dev
npm run tauri dev           # Tauri dev mode

# Build
npm run build:ui-kit        # Build UI kit library
npm run build               # TypeScript + Vite build

# Testing
cd server && node test_multi_user_isolation.js
cd server && node test_batch_import.js
cd server && node test_comprehensive_audit.js
cd server && node test_auto_updater.js

# Rust
cd src-tauri && cargo check
cd src-tauri && cargo test --no-run
```

---

## 14. Security Notes

- **JWT Secret**: In `server/.env` (production) or fallback in `index.js`
- **Proxy Passwords**: AES-256-CBC encrypted at rest (key derived from JWT secret)
- **2FA**: TOTP (RFC 6238) + 10 single-use recovery codes (bcrypt hashed)
- **Session Management**: `active_sessions` collection, revoked on logout/password change
- **CSP**: Disabled in Tauri (`"csp": null`) for dev flexibility
- **CDP**: Bound to `127.0.0.1` only, restricted origins

---

## 15. Known Legacy Handling

- **Migration**: `migrate_legacy_filesystem()` moves `users/<uid>` → `accounts/<uid>`, quarantines ambiguous root profiles
- **Legacy Profiles**: Single-file `.json` in `profiles/` auto-migrated to directory format on read
- **Quarantine**: Unowned legacy records moved to `config/quarantine/`, never auto-assigned

---

This context file captures the complete architecture, invariants, and implementation status. Reference `PROJECT_STATUS.md` for detailed test evidence and `PRD.md` for full requirements.