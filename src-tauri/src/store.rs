// Storage architecture: strict multi-tenant account isolation.
// All user-owned data lives under:
//   $CONFIG/opinion-insights-browser/data/accounts/<account-id>/
//     ├── profiles/
//     │   └── <profile-id>/
//     │       ├── config.json
//     │       ├── fingerprint.json
//     │       └── chromium/ (user-data-dir)
//     ├── proxies.json
//     ├── proxies-history.json
//     ├── bookmarks.json
//     ├── fingerprints/
//     ├── extensions/
//     ├── trash/
//     └── settings.json
//
// Unauthenticated access or missing account scope is immediately rejected.
// Ambiguous legacy records are moved to quarantine/ and never assigned to admin.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

pub fn config_root() -> Result<PathBuf> {
    let base = dirs::config_dir().context("OS config dir unavailable")?;
    let root = base.join("opinion-insights-browser");
    std::fs::create_dir_all(&root)?;
    Ok(root)
}

fn user_scope_cell() -> &'static RwLock<Option<String>> {
    static CELL: OnceLock<RwLock<Option<String>>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(None))
}

pub fn set_user_scope(user_id: Option<String>) {
    if let Ok(mut g) = user_scope_cell().write() {
        *g = user_id;
    }
}

pub fn current_user_scope() -> Option<String> {
    user_scope_cell().read().ok().and_then(|g| g.clone())
}

pub fn sanitize_account_id(account_id: &str) -> Result<String> {
    let sanitized: String = account_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if sanitized.is_empty() {
        anyhow::bail!("Invalid account identity");
    }
    Ok(sanitized)
}

pub fn active_account_id() -> Result<String> {
    let uid = current_user_scope()
        .ok_or_else(|| anyhow::anyhow!("Unauthorized: No active authenticated account session"))?;
    sanitize_account_id(&uid)
}

fn data_root_cell() -> &'static RwLock<Option<PathBuf>> {
    static CELL: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(None))
}

/// Point the heavy directories at `root` (None = back to the config dir / data).
pub fn set_data_root(root: Option<PathBuf>) {
    if let Ok(mut g) = data_root_cell().write() {
        *g = root;
    }
}

/// Root directory where accounts data is stored.
pub fn data_root() -> Result<PathBuf> {
    let base = if let Some(p) = data_root_cell().read().ok().and_then(|g| g.clone()) {
        std::fs::create_dir_all(&p)?;
        p
    } else {
        let default_data = config_root()?.join("data");
        std::fs::create_dir_all(&default_data)?;
        default_data
    };
    Ok(base)
}

pub fn accounts_root() -> Result<PathBuf> {
    let p = data_root()?.join("accounts");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn quarantine_dir() -> Result<PathBuf> {
    let p = config_root()?.join("quarantine");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn account_dir(account_id: &str) -> Result<PathBuf> {
    let sanitized = sanitize_account_id(account_id)?;
    let p = accounts_root()?.join(sanitized);
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn active_account_dir() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_dir(&act_id)
}

pub fn account_profiles_dir(account_id: &str) -> Result<PathBuf> {
    let p = account_dir(account_id)?.join("profiles");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn profile_dir(account_id: &str, profile_id: &str) -> Result<PathBuf> {
    if profile_id.is_empty() || profile_id.contains(['/', '\\', '.']) {
        anyhow::bail!("Invalid profile id: {profile_id}");
    }
    let p = account_profiles_dir(account_id)?.join(profile_id);
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn profile_config_path(account_id: &str, profile_id: &str) -> Result<PathBuf> {
    let dir = profile_dir(account_id, profile_id)?;
    Ok(dir.join("config.json"))
}

pub fn profile_fingerprint_path(account_id: &str, profile_id: &str) -> Result<PathBuf> {
    let dir = profile_dir(account_id, profile_id)?;
    Ok(dir.join("fingerprint.json"))
}

pub fn profile_user_data_dir(account_id: &str, profile_id: &str) -> Result<PathBuf> {
    let dir = profile_dir(account_id, profile_id)?;
    let p = dir.join("chromium");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn account_proxies_path(account_id: &str) -> Result<PathBuf> {
    Ok(account_dir(account_id)?.join("proxies.json"))
}

pub fn account_proxies_history_path(account_id: &str) -> Result<PathBuf> {
    Ok(account_dir(account_id)?.join("proxies-history.json"))
}

pub fn account_bookmarks_path(account_id: &str) -> Result<PathBuf> {
    Ok(account_dir(account_id)?.join("bookmarks.json"))
}

pub fn account_fingerprints_dir(account_id: &str) -> Result<PathBuf> {
    let p = account_dir(account_id)?.join("fingerprints");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn account_extensions_dir(account_id: &str) -> Result<PathBuf> {
    let p = account_dir(account_id)?.join("extensions");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn account_trash_dir(account_id: &str) -> Result<PathBuf> {
    let p = account_dir(account_id)?.join("trash");
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

pub fn account_settings_path(account_id: &str) -> Result<PathBuf> {
    Ok(account_dir(account_id)?.join("settings.json"))
}

// ─── Active Scoped Getters (Fail immediately when unauthenticated) ───

pub fn profiles_dir() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_profiles_dir(&act_id)
}

pub fn user_data_root() -> Result<PathBuf> {
    // In new architecture, user-data is inside profile_user_data_dir
    let act_id = active_account_id()?;
    account_profiles_dir(&act_id)
}

pub fn extensions_dir() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_extensions_dir(&act_id)
}

pub fn trash_dir() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_trash_dir(&act_id)
}

pub fn fingerprints_dir() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_fingerprints_dir(&act_id)
}

pub fn proxies_path() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_proxies_path(&act_id)
}

pub fn proxies_history_path() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_proxies_history_path(&act_id)
}

pub fn bookmarks_path() -> Result<PathBuf> {
    let act_id = active_account_id()?;
    account_bookmarks_path(&act_id)
}

// ─── Global System Resources (Shared across accounts, read-only/system) ───

pub fn widevine_cache_dir() -> Result<PathBuf> {
    Ok(config_root()?.join("widevine-cdm"))
}

pub fn settings_path() -> Result<PathBuf> {
    // Global launcher hardware / network settings
    Ok(config_root()?.join("settings.json"))
}

pub fn psapi_path() -> Result<PathBuf> {
    Ok(config_root()?.join("psapi.json"))
}

pub fn bundled_fingerprints_dir() -> Result<PathBuf> {
    let p = config_root()?.join("bundled-fingerprints");
    if !p.exists() {
        let old = config_root()?.join("fingerprints");
        if old.exists() {
            let _ = copy_dir_all(&old, &p);
        }
    }
    std::fs::create_dir_all(&p)?;
    Ok(p)
}

/// Migrate legacy data to data/accounts/<account_id>/ and quarantine unowned records.
pub fn migrate_legacy_filesystem() -> Result<()> {
    let root = config_root()?;
    let q_dir = quarantine_dir()?;

    // 1. Move legacy users/<uid> into data/accounts/<uid>
    let legacy_users = root.join("users");
    if legacy_users.exists() {
        if let Ok(entries) = std::fs::read_dir(&legacy_users) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let uid = entry.file_name().to_string_lossy().to_string();
                    if let Ok(sanitized) = sanitize_account_id(&uid) {
                        let target_act = accounts_root()?.join(&sanitized);
                        if !target_act.exists() {
                            let _ = copy_dir_all(&entry.path(), &target_act);
                            let _ = std::fs::remove_dir_all(entry.path());
                            eprintln!("[store] Migrated legacy user {} to accounts/{}", uid, sanitized);
                        }
                    }
                }
            }
        }
    }

    // 2. Inspect root profiles/ - move ambiguous ones to quarantine
    let legacy_profiles = root.join("profiles");
    if legacy_profiles.exists() {
        if let Ok(entries) = std::fs::read_dir(&legacy_profiles) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();
                let q_target = q_dir.join(&file_name);
                eprintln!("[store] Quarantining unowned legacy profile record: {}", path.display());
                if path.is_dir() {
                    let _ = copy_dir_all(&path, &q_target);
                    let _ = std::fs::remove_dir_all(&path);
                } else {
                    let _ = std::fs::copy(&path, &q_target);
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&legacy_profiles);
    }

    Ok(())
}

// ─── OS-Protected Secure Session Storage ───

#[cfg(windows)]
pub fn save_secure_auth_session(json: &str) -> Result<()> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    use windows_sys::Win32::Foundation::LocalFree;

    let path = config_root()?.join("session.enc");
    let input = json.as_bytes();
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out_blob,
        )
    };
    if ok == 0 {
        return Err(anyhow::anyhow!("Failed to protect session with Windows DPAPI"));
    }
    let encrypted = unsafe {
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let data = slice.to_vec();
        LocalFree(out_blob.pbData as _);
        data
    };
    std::fs::write(&path, encrypted)?;
    Ok(())
}

#[cfg(windows)]
pub fn load_secure_auth_session() -> Result<Option<String>> {
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    use windows_sys::Win32::Foundation::LocalFree;

    let path = config_root()?.join("session.enc");
    if !path.exists() {
        return Ok(None);
    }
    let encrypted = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[store] failed to read session.enc: {e}");
            return Ok(None);
        }
    };
    if encrypted.is_empty() {
        return Ok(None);
    }
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out_blob,
        )
    };
    if ok == 0 {
        eprintln!("[store] Windows DPAPI unprotect failed; session may be corrupted or from different Windows user");
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    let decrypted = unsafe {
        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let data = slice.to_vec();
        LocalFree(out_blob.pbData as _);
        data
    };
    let json = String::from_utf8(decrypted).context("Invalid UTF-8 in decrypted session")?;
    Ok(Some(json))
}

#[cfg(windows)]
pub fn clear_secure_auth_session() -> Result<()> {
    let path = config_root()?.join("session.enc");
    if path.exists() {
        let _ = std::fs::write(&path, [0u8; 64]);
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn save_secure_auth_session(json: &str) -> Result<()> {
    let path = config_root()?.join("session.enc");
    std::fs::write(&path, json)?;
    Ok(())
}

#[cfg(not(windows))]
pub fn load_secure_auth_session() -> Result<Option<String>> {
    let path = config_root()?.join("session.enc");
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path)?;
    Ok(Some(json))
}

#[cfg(not(windows))]
pub fn clear_secure_auth_session() -> Result<()> {
    let path = config_root()?.join("session.enc");
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

