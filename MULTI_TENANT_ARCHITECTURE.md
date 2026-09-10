# Opinion Insights Browser - Multi-Tenant Architecture

## 1. Tenancy Model Overview

Opinion Insights Browser utilizes a partitioned single-database, directory-isolated multi-tenant design:

```
Tenant (Account: Admin OR Normal User)
  ├── Account Ident: { id, email, role, is_active }
  ├── Profiles
  │     ├── Profile 1 [owner_account_id: Account.id]
  │     ├── Profile 2 [owner_account_id: Account.id]
  │     └── Profile N [owner_account_id: Account.id]
  ├── Proxies [owner_account_id: Account.id]
  ├── Bookmarks [owner_account_id: Account.id]
  ├── Extensions [owner_account_id: Account.id]
  └── Fingerprint Presets [owner_account_id: Account.id]
```

---

## 2. Filesystem Hierarchy & Isolation

The desktop client stores all profile data in strict account-scoped directories:

```
data/
  └── accounts/
        ├── <account-id-A>/
        │     ├── profiles/
        │     │     ├── <profile-id-1>/
        │     │     │     ├── config.json         (Profile configuration & metadata)
        │     │     │     ├── fingerprint.json    (Engine runtime fingerprint payload)
        │     │     │     └── chromium/           (Isolated Chromium --user-data-dir)
        │     │     │           ├── Default/
        │     │     │           │     ├── Cookies
        │     │     │           │     ├── History
        │     │     │           │     ├── Local Storage/
        │     │     │           │     └── IndexedDB/
        │     │     │           └── Local State
        │     │     └── <profile-id-2>/
        │     ├── proxies.json                    (Account proxy inventory)
        │     ├── proxies-history.json            (Proxy latency/geo test history)
        │     ├── bookmarks.json                  (Account bookmark rules)
        │     ├── extensions/                     (Installed unpacked extensions)
        │     ├── fingerprints/                   (Custom user fingerprint configs)
        │     └── trash/                          (Archived deleted profiles)
        ├── <account-id-B>/
        │     └── ...
        └── quarantine/                           (Unowned/orphaned legacy profiles)
```

### Safety Guarantees
- Paths are resolved via `store::account_dir(account_id)` and checked against directory traversal (`..`, slashes in ID).
- An account's directory is never traversed or queried during another account's session.
- Any unowned profiles found from legacy versions are automatically moved to `quarantine/` upon application startup and NEVER assigned to the Admin or active user.

---

## 3. Database Schema & Indexing

The following collections in MongoDB Atlas (`opinion_insights`) enforce tenant scoping:

### `profiles` & `profile_metas`
- Primary Key: `id: String` (UUID)
- Tenant Key: `owner_account_id: String` (UUID)
- Indexes:
  - `{ owner_account_id: 1, id: 1 }` (unique compound)
  - `{ owner_account_id: 1, updated_at: -1 }`

### `proxies` & `user_proxies`
- Tenant Key: `owner_account_id: String`
- Indexes:
  - `{ owner_account_id: 1, id: 1 }`

### `fingerprints`, `bookmarks`, `folders`, `tags`
- Tenant Key: `owner_account_id: String`
- Indexes:
  - `{ owner_account_id: 1, id: 1 }`

### `quarantined_records`
- Used to isolate records missing ownership that cannot be verified against any active account.

---

## 4. Browser Runtime & Process Isolation

1. **Chromium Process Spawning**:
   Chromium is launched with `--user-data-dir=".../data/accounts/<account-id>/profiles/<profile-id>/chromium"`.
   No two profiles or accounts ever share a Chromium user-data-dir.
2. **Process Tracking**:
   `process::Tracker` tracks running child processes by `profile_id`.
3. **Session Teardown**:
   When an account logs out or disconnects:
   - `Tracker::shared().kill_all()` terminates all running Chromium instances immediately.
   - The user-data directory locks are released.
   - Local state is cleared before any subsequent login can occur.
