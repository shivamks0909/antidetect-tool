# Product Requirements Document (PRD)
## Windows-Based Offline-First Multi-Profile Browser Platform

**Version**: 2.1.0  
**Target OS**: Windows 10 / 11 (64-bit)  
**Architecture**: Offline-First Local Desktop Platform (Tauri v2 + Rust Core + React 19 UI)

---

## 1. Executive Summary & Core Identity

The **Opinion Insights Browser** is an offline-first Windows desktop platform designed to manage hundreds of completely independent, isolated Chromium browser environments within a unified interface.

Rather than acting simply as a browser profile switcher, the platform merges seven major systems into a cohesive product:
1. **Multi-Tenant User Isolation**: Strict data segregation between Admin and normal user accounts across database, filesystem, and browser runtimes.
2. **Browser Runtime & Antidetect Engine**: Deterministic seed-based environment/fingerprint generation (User-Agent, Canvas, WebGL, Audio, Screen, Platform, Timezone, Geolocation).
3. **Proxy Management**: First-class support for HTTP, HTTPS, SOCKS4, SOCKS5 protocols with health checking and bulk assignment.
4. **Bulk Provisioning & Batch Import**: Spreadsheet-driven provisioning engine (Excel/CSV) mapping 1 row to 1 profile with auto-configured proxies.
5. **Extensions & Bookmarks**: Custom sets and bulk application across profile fleets.
6. **Local Automation**: Scriptable task workflows (launch profile, navigate, wait, close).
7. **Application Auto-Update**: Seamless distribution via GitHub Releases preserving local profile data across updates.

---

## 2. System Architecture

```text
                               YOUR WINDOWS APP (Tauri Desktop)
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               │                               │                               │
        Authentication                     Dashboard                    Browser Runtime
               │                               │                               │
          Admin / User                      Profiles                   Isolated Chromium
               │                               │                               │
               └───────────────────────────────┼───────────────────────────────┘
                                               │
                                        PROFILE ENGINE
                                               │
             ┌───────────────┬─────────────────┼────────────────┬───────────────┐
             │               │                 │                │               │
       Proxy Manager   Fingerprints       Extensions        Bookmarks      Automation
             │               │                 │                │               │
             └───────────────┴─────────────────┼────────────────┴───────────────┘
                                               │
                                       BULK PROVISIONING
                                               │
                             ┌─────────────────┴─────────────────┐
                             │                                   │
                      Bulk Generator                       Batch Import
                             │                                   │
                     100+ Clean Profiles                    XLSX / CSV
                                                                 │
                                                        1 Row = 1 Profile
                                                                 │
                                                    Row Proxy = Profile Proxy
                                               │
                                         LOCAL STORAGE
                                               │
                              Account-Partitioned Filesystem:
                      `data/accounts/<account-id>/profiles/<profile-id>/`
                                               │
                                       UPDATE DISTRIBUTION
                                               │
                                         GitHub Releases
```

---

## 3. Detailed Requirements by Feature Area

### 3.1. User Isolation & Anti-Leak Architecture
- **Multi-Tenant Segregation**:
  - Admin and normal users operate in separate namespaces.
  - Zero cross-tenant visibility for profiles, fingerprints, extensions, proxies, bookmarks, folders, tags, or automation jobs.
  - Enforced at the database, backend API, filesystem, and browser launch levels.
- **Zero Random Profile Creation**:
  - No profiles may ever be generated automatically upon login, logout, navigation, refresh, or app boot.
  - Profiles are created **only** via explicit user actions (Create Profile button, Bulk Generator, or Batch Import).

### 3.2. Browser Runtime & Fingerprint Consistency
- **Deterministic Fingerprints**:
  - Generated from a stable per-profile seed.
  - Enforces internal coherence: screen resolution, WebGL vendor/renderer, canvas noise, audio buffer, platform, user-agent, and timezone must be logically consistent and persist across launches.
- **Runtime Process Isolation**:
  - Profile launch verifies `profile.owner_account_id == authenticated_account_id`.
  - Chromium runs with `--user-data-dir` pointed exclusively to `data/accounts/<account-id>/profiles/<profile-id>/chromium/`.

### 3.3. Proxy Manager & Strategies
- **Supported Protocols**: HTTP, HTTPS, SOCKS4, SOCKS5 (with user:pass authentication).
- **Operations**: Add, edit, delete, live latency/health check, bulk paste import (`host:port:user:pass`).
- **Assignment Modes**:
  - Direct profile assignment.
  - Sequential distribution across profiles.
  - Random distribution.
  - Selected proxy pool rotation.

### 3.4. Bulk Profile Generator
- Generate $N$ profiles (e.g., 50 to 500+) in a single batch.
- Configurable templates:
  - Naming pattern (`Profile 001`, `Profile 002`, ...).
  - Folder & Tag assignment.
  - Proxy distribution strategy (Sequential, Random, Round-Robin).
  - Timezone, Language, and Geolocation matching.
  - Default Extension Set and Bookmark Set.
  - Startup URLs.

### 3.5. Batch Import Engine (Spreadsheet-Driven Provisioning) `[STATUS: IMPLEMENTED & VERIFIED]`
- **Concept**: *“Spreadsheet as a Profile Blueprint — 1 Row = 1 Complete Profile”*.
- **Supported Formats**: Excel (`.xlsx`), CSV (`.csv`).
- **Workflow Pipeline**:
  1. **Upload**: Select local `.xlsx` or `.csv` file.
  2. **Column Mapping**: Interactive UI to map spreadsheet columns to application fields:
     - `Title / Name` $\rightarrow$ Profile Name
     - `Proxy Info` (Host, Port, User, Pass, Protocol) $\rightarrow$ Profile Proxy
     - `Folder` $\rightarrow$ Target Folder
     - `Tags` $\rightarrow$ Comma-separated tags
     - `Start URLs` $\rightarrow$ Startup tabs
     - `User Agent / OS` $\rightarrow$ Custom environment override
     - `Cookies` $\rightarrow$ Injected cookie bundle
  3. **Validation & Preview**:
     - Pre-flight scan of all rows.
     - Highlights format errors, missing required fields, or invalid proxies.
     - Summary display: `"493 Valid Rows / 7 Errors"`.
  4. **Provisioning Queue**:
     - Executes profile creation with live progress tracking bar.
     - Creates profile $\rightarrow$ extracts row proxy $\rightarrow$ attaches proxy to profile $\rightarrow$ writes isolated directory.
     - Partial failure resilience: Valid rows are committed; invalid rows are quarantined into an exportable error report for re-upload.

### 3.6. Extension & Bookmark Systems
- **Extensions**:
  - Available catalog vs Installed profile list.
  - **Extension Sets**: Pre-configured bundles (e.g., "Research Set", "E-Commerce Set") applicable to individual profiles or bulk jobs.
- **Bookmarks**:
  - Independent per-profile bookmarks with tree folder structure.
  - HTML Import / Export.
  - **Bookmark Sets**: Shared bookmark folders that can be deployed across multiple profiles.

### 3.7. Folders, Tags & Search
- Hierarchical folders (`Work`, `Client A`, `Archived`).
- Multi-tagging support (`#testing`, `#resi`, `#high-priority`).
- Instant client-side search across profile names, proxies, and tags.

### 3.8. Local Automation Workflows
- Built-in headless/desktop job runner.
- Step primitives: `Launch Profile` $\rightarrow$ `Navigate to URL` $\rightarrow$ `Wait / Sleep` $\rightarrow$ `Execute Action` $\rightarrow$ `Close Profile`.
- Local task queue with status reporting.

### 3.9. Application Auto-Update
- Automatic version checking against GitHub Releases.
- Release payload downloads update binary, verifies integrity, and updates the application executable.
- **Data Safety Guarantee**: Application binary updates leave all local profile data, cookies, extensions, and configurations completely untouched.

---

## 4. Technical Constraints & Assumptions

1. **Operating System**: Windows 10/11 x64.
2. **Local Storage Guarantee**: Profiles, credentials, and browser data are stored strictly on the local machine (`APPDATA/opinion-insights-browser/accounts/<account-id>/`).
3. **Resilience**: Import and generation queues must not crash on network blips or bad rows.
4. **Ownership Invariant**: No profile directory or runtime process may be launched or viewed without validating that the authenticated session account ID matches the profile owner ID.
