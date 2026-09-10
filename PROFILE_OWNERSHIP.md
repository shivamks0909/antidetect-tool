# Opinion Insights Browser - Profile Ownership Model

## 1. Principle of Strict Ownership

Every browser profile created in Opinion Insights Browser is strictly owned by the authenticated account that created it.
Under no circumstances can an account access, launch, modify, or view a profile owned by another account.

```
+-------------------------------------------------------------------+
|                        Account (Tenant)                           |
|  id: "acc_user_123"                                               |
+-------------------------------------------------------------------+
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
+-----------------------+             +-----------------------+
|      Profile A        |             |      Profile B        |
| id: "prof_abc"        |             | id: "prof_def"        |
| owner_account_id:     |             | owner_account_id:     |
|   "acc_user_123"      |             |   "acc_user_123"      |
+-----------------------+             +-----------------------+
```

---

## 2. Profile Data Isolation Components

Each profile comprises four isolated vectors:

1. **Configuration & Metadata (`config.json`)**:
   - `_meta.id`: Globally unique profile UUID.
   - `_meta.owner_account_id`: The owning account ID.
   - `_meta.created_at`, `_meta.updated_at`: Audit timestamps.
   - `_meta.proxy_id`: Bound proxy identifier (scoped to the same account).
   - `_meta.folder`: Folder organization tag.
   - `_meta.extensions`: List of installed extension IDs.

2. **Hardware & Canvas Fingerprint (`fingerprint.json`)**:
   - Audio, Canvas, WebGL, ClientRects, Sensors, and Fonts noise seeds.
   - Deterministically seeded per-profile using profile UUID + slot hash.
   - Presets generated inside the owning account scope.

3. **Chromium User-Data-Directory (`chromium/`)**:
   - Completely isolated Chromium storage tree containing:
     - Cookies (`Default/Cookies`)
     - LocalStorage (`Default/Local Storage/leveldb/`)
     - IndexedDB (`Default/IndexedDB/`)
     - History (`Default/History`)
     - Cache & Code Cache
   - Absolute filesystem path: `data/accounts/<account-id>/profiles/<profile-id>/chromium/`

4. **Running Process (`Tracker`)**:
   - Tracked child PID mapped directly to profile ID.
   - CDP endpoint restricted to `127.0.0.1`.

---

## 3. Operations & Authorization Checks

| Operation | Enforced Precondition |
|---|---|
| **Create** | Caller must be authenticated; `profile.owner_account_id` set to active `user_id`. |
| **List** | Scoped exclusively to active `user_id`; never returns global profile set. |
| **Get** | Asserts `profile.owner_account_id == active_account_id`. |
| **Save / Update** | Rejects if `stored.meta.owner_account_id != active_account_id`. |
| **Delete / Trash** | Only allowed if owned by active account. Archived under `<account-id>/trash/`. |
| **Restore** | Validates archive profile ownership before extracting back into account profile dir. |
| **Launch** | Resolves `profile_user_data_dir(&account_id, &profile_id)` and verifies ownership. |
| **Clone** | Duplicates config with new UUID, assigns `owner_account_id = active_account_id`, re-randomizes fingerprint noise seeds. |
| **Proxy Bind** | Verifies both profile and proxy belong to active account. |

---

## 4. Elimination of Random / Unexpected Profile Creation

Investigated root causes and resolutions:
1. **Mock Seed Elimination**:
   Removed `defaultInitialProfile` ("test-profile-1") and `localStorage.setItem(MOCK_PROFILES_KEY, ...)` fallbacks.
2. **Launch Resurrection Disabled**:
   Eliminated silent `profile_save` calls on missing profiles during `launch()`.
3. **Store Reset on Logout**:
   `useProfile`, `useProxy`, `useBookmarks`, `useExtensions`, `useTrash`, `useFingerprint` reset in-memory state on `signOut()`.
4. **Startup Sweep Elimination**:
   Removed unauthenticated migrations, trash purges, and temp profile cleanup from Tauri app `setup()`.
   Migrations and purges now run strictly on authenticated session verification.
