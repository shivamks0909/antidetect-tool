# BATCH IMPORT PROVISIONING SPECIFICATION (PRD Sections 13, 14, 15)

**Feature**: Spreadsheet-Driven Batch Import Provisioning Engine  
**Version**: 2.1.0  
**Target Systems**: Desktop UI (`src/features/batch-import`), Local Engine, Backend API  
**Status**: **IMPLEMENTED & VERIFIED (100% Core Verification)**

---

## 1. Overview & Core Invariant

The **Batch Import Provisioning Engine** enables bulk creation of browser profiles directly from Excel (`.xlsx`, `.xls`) or CSV (`.csv`) spreadsheets.

### Core Architectural Invariant:
> **One Valid Spreadsheet Row = One Real Browser Profile + Auto-Attached Row Proxy + Isolated Account Storage**

```text
┌─────────────────────────────────────────────────────────────┐
│                       SPREADSHEET ROW                       │
│  [Title, Folder, Proxy, Start URLs, Timezone, Tags, Notes]  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    PROVISIONING ENGINE                      │
├──────────────────────────────┬──────────────────────────────┤
│ 1. Extract & Validate Proxy  │ 2. Build Profile Form        │
│ 3. Save to Account Storage   │ 4. Deterministic Seed Noise  │
│ 5. Bind Proxy to Profile     │ 6. Auto-Assign Folder & Tags │
└──────────────────────────────┴──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     COMMITTED ARTIFACTS                     │
│  • Profile: `data/accounts/<account-id>/profiles/<id>/`     │
│  • Proxy: `data/accounts/<account-id>/proxies.json`         │
│  • Bound Proxy ID strictly scoped to Row Profile            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Supported Spreadsheet Column Mappings

The engine automatically inspects headers on file upload and performs fuzzy auto-mapping to the following canonical application fields:

| Canonical Field | Description | Required? | Example Values & Aliases |
| :--- | :--- | :---: | :--- |
| **`name`** | Profile Title | **YES** | `Profile Alpha`, `Worker 01` (Aliases: `Title`, `Name`, `Profile Name`) |
| **`folder`** | Folder / Group Assignment | No | `Marketing`, `Crypto`, `Research` (Aliases: `Folder`, `Group`) |
| **`proxy_raw`** | Combined Proxy String | No | `1.2.3.4:8080:usr:pass`, `socks5://user:pwd@1.2.3.4:1080` |
| **`proxy_host`** | Proxy Host / IP | No | `192.168.1.1`, `proxy.example.com` |
| **`proxy_port`** | Proxy Port | No | `1080`, `8080` (Must be 1–65535) |
| **`proxy_user`** | Proxy Username | No | `myuser` |
| **`proxy_pass`** | Proxy Password | No | `mypassword` |
| **`proxy_kind`** | Proxy Protocol | No | `socks5`, `http`, `https` (Default: `socks5`) |
| **`rotate_url`** | IP Rotation Webhook | No | `https://api.proxyservice.com/rotate?key=123` |
| **`start_urls`** | Startup Tabs | No | `https://google.com, https://twitter.com` |
| **`user_agent`** | Custom User-Agent | No | `Mozilla/5.0 (Windows NT 10.0; Win64; x64)...` |
| **`timezone`** | Timezone Identifier | No | `America/New_York`, `Europe/London`, `auto` |
| **`language`** | Locale / Language | No | `en-US`, `es-ES`, `auto` |
| **`tags`** | Categorization Tags | No | `residential, tier1, test` |
| **`notes`** | User Notes / Description | No | `Imported for client outreach` |
| **`cookie`** | Initial Session Cookies | No | Netscape format or JSON string |

---

## 3. Pre-Flight Validation Rules

Every row is validated before any filesystem or database mutation occurs:

1. **Title Validation**:
   - Must be present and non-empty.
   - Whitespace is trimmed.
   - Duplicate titles within the batch are detected and flagged with duplicate warnings.
2. **Proxy Parsing & Validation**:
   - If proxy data is present (either combined `proxy_raw` or discrete fields):
     - Host must not be empty.
     - Port must be a valid integer between $1$ and $65535$.
     - Protocols supported: `http`, `https`, `socks5` (or `socks4` mapped to socks5).
     - Malformed formats (e.g. missing port or out-of-range port) cause the row to be marked `invalid` with an explicit error message.
3. **Start URLs**:
   - Multiple URLs can be separated by commas, semicolons, or newlines.
   - Non-empty URLs are validated for standard protocol schemes (`http://`, `https://`).
4. **Timezone**:
   - Validated against browser/system `Intl.DateTimeFormat` timezone database. Unrecognized strings fall back to `"auto"` with a warning.
5. **Partial Failure Policy**:
   - Invalid rows do **not** abort the import.
   - Users can proceed to import only the valid rows.
   - Invalid rows are downloadable as an Error CSV (`Row, Status, Errors, [Original Columns]`) for offline correction and re-upload.

---

## 4. Provisioning Queue & Concurrency Controls

To maintain desktop and database stability when importing large fleets (500+ profiles):
- Concurrency is throttled to **3–5 parallel worker tasks**.
- Real-time animated progress bar with live counters:
  - `Completed Rows`
  - `Failed Rows`
  - `Total Rows`
- Support for `Pause`, `Resume`, and `Cancel` at any point.

---

## 5. Job Persistence & Interrupted Recovery (Crash Proof)

In-progress imports are persisted per account in `localStorage` under `oi_batch_import_job_<account_id>`.

If the app is closed, refreshed, or restarted during an active import:
1. On next launch / modal open, the engine detects the paused/incomplete job.
2. Displays an alert banner: `"Interrupted Import Job Found: X of Y rows completed."`
3. Allows the user to click **Resume Import** or **Discard**.
4. **Zero Duplicate Invariant**: Rows marked `executionStatus == "completed"` are skipped; only pending rows are provisioned.

---

## 6. Strict Multi-Tenant Isolation Guarantees

1. **Owner Attribution**: Every created profile and proxy is assigned `owner_account_id = active_account_id`.
2. **Filesystem Partitioning**: Stored strictly under `data/accounts/<account-id>/profiles/<profile-id>/`.
3. **Cross-Tenant Secrecy**: User B cannot view, query, mutate, delete, or launch any profile or proxy provisioned by User A.
