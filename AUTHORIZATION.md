# Opinion Insights Browser - Authorization & Access Control Architecture

## 1. Overview & Core Tenet

Opinion Insights Browser enforces a strict **Account/Tenant Isolation Model**.
Every profile, proxy, fingerprint preset, bookmark, extension assignment, folder, and running process belongs to exactly one authenticated account.

> **CRITICAL RULE**:
> Admin is an account namespace, NOT a global profile owner.
> Normal user profiles, proxies, and session data MUST NEVER be visible to Admin through the normal profile UI, nor accessible via normal profile APIs.

---

## 2. Authentication & Identity Lifecycle

```
Client Request
      │
      ▼
Bearer JWT Token
      │
      ▼
Auth Middleware (server/src/index.js)
      │
      ├─► Verify JWT signature & expiration
      ├─► Fetch User from DB (check is_active)
      └─► Inject `req.user = { id, email, role }`
```

On Desktop (Tauri IPC):
1. Upon successful login, the frontend passes session info to `auth_verify_session(token, user_id, email)`.
2. The Tauri backend records the active user scope in `store::set_user_scope(Some(user_id))`.
3. If unauthenticated, all profile, proxy, fingerprint, and runtime commands reject with:
   `Authentication required. Please log in.`
4. On logout, `auth_logout()` is invoked:
   - Kills all running Chromium child processes.
   - Clears active user scope `store::set_user_scope(None)`.
   - Rotates local automation API JWT signing secret to invalidate any issued tokens.
   - Resets all frontend stores (`useProfile`, `useProxy`, `useBookmarks`, etc.) and purges cached storage.

---

## 3. Ownership Validation Engine

### Function: `canAccessProfile(accountId, profileId)`

```
function canAccessProfile(accountId, profileId):
    profile = loadProfile(profileId)
    if profile is None:
        return False, NOT_FOUND
    if profile.owner_account_id != accountId:
        return False, FORBIDDEN
    return True, SUCCESS
```

### Layer Enforcement Matrix

| Layer | Implementation Point | Enforcement Mechanism |
|---|---|---|
| **Database** | MongoDB Atlas `profiles`, `proxies`, `fingerprints` | Queries require `{ $or: [{ owner_account_id: req.user.id }, { userId: req.user.id }] }` and index `(owner_account_id, id)` |
| **Backend API** | `server/src/index.js` routes | Strict 403 Forbidden / 404 if requested resource does not match `req.user.id` |
| **Desktop IPC** | `src-tauri/src/lib.rs` commands | `if !is_authenticated() { return Err(...) }` on all operations |
| **Filesystem** | `src-tauri/src/store.rs` & `profile.rs` | Storage isolated under `data/accounts/<account-id>/profiles/<profile-id>/` |
| **Browser Runtime** | `src-tauri/src/launch.rs` | Asserts `stored.meta.owner_account_id == active_account_id` before spawning Chromium binary |
| **Frontend State** | Zustand entity stores | `reset()` clears in-memory state on sign-out; `reload()` only syncs current account data |

---

## 4. Administrative Privileges vs Normal User Isolation

1. **Profile Management**: Admin has their own separate profile list (`owner_account_id = admin_id`). Admin never sees normal users' profiles in `/api/data/profiles` or in the desktop dashboard.
2. **User Administration**: Admin has access to `/api/admin/users` to view account status and total count metrics. Even in user metrics, profiles are not exposed in plaintext or accessible for launch.
3. **Audit Trails**: Security actions are logged in the `audit_logs` collection with timestamp, IP, actor ID, and action name.

---

## 5. Defense-in-Depth Violations & Responses

- **Cross-Account Read Attempt**: Returns HTTP 404 (or 403), audit log recorded, zero profile data leaked.
- **Cross-Account Launch Attempt**: Rejected in `launch_profile_synced` with `Security violation: Profile does not belong to active account`.
- **Unauthenticated Localhost Port Probing**: IPC commands and CDP debugging ports bound strictly to `127.0.0.1` and require authenticated session + local secret.
