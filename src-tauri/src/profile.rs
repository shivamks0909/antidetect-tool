use crate::store;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Launcher-side view of a profile (wraps raw FingerprintConfig JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileMeta {
    pub id: String,
    #[serde(default)]
    pub owner_account_id: String,
    pub name: String,
    pub notes: String,
    pub proxy_id: Option<String>,
    pub last_launched_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub pinned: bool,
    pub folder: String,
    /// Accumulated runtime across every launch; UI shows this plus the
    /// current-session uptime when the profile is running.
    #[serde(default)]
    pub total_runtime_ms: u64,
    /// Icon accent, `#rrggbb`. None = derived from the name, which is what the
    /// browser does on its own.
    #[serde(default)]
    pub color: Option<String>,
    /// Extension ids from the library, loaded at launch.
    #[serde(default)]
    pub extensions: Vec<String>,
}

/// On-disk `<profiles_dir>/<id>/config.json`: FingerprintConfig + `_meta` envelope.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoredProfile {
    #[serde(rename = "_meta", default)]
    pub meta: StoredMeta,
    /// Verbatim FingerprintConfig payload (round-trip, not parsed).
    #[serde(flatten)]
    pub config: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoredMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub owner_account_id: String,
    #[serde(default)]
    pub proxy_id: Option<String>,
    #[serde(default)]
    pub last_launched_at: Option<String>,
    /// "@<unix_secs>" creation marker.
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    /// Empty = unfiled (All tab).
    #[serde(default)]
    pub folder: String,
    /// Cumulative engine uptime in milliseconds; bumped by the Tracker
    /// when the child exits.  Persists across launcher restarts.
    #[serde(default)]
    pub total_runtime_ms: u64,
    /// Source library fingerprint id; MUST round-trip — drives the editor GPU select.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpu_preset_id: Option<String>,
    /// Inline proxy from temporary profile API; not in proxy store.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_proxy: Option<crate::proxy::ProxyEntry>,
    /// Hidden from listings; auto-deleted on close.
    #[serde(default, skip_serializing_if = "is_false")]
    pub temporary: bool,
    /// Icon accent, `#rrggbb`; absent = derived from the name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Extension ids from the library.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

pub fn path_for(id: &str) -> Result<PathBuf> {
    let account_id = store::active_account_id()?;
    path_for_account(&account_id, id)
}

pub fn path_for_account(account_id: &str, id: &str) -> Result<PathBuf> {
    if id.contains(['/', '\\', '.']) {
        anyhow::bail!("invalid profile id");
    }
    let config_p = store::profile_config_path(account_id, id)?;
    if config_p.exists() {
        return Ok(config_p);
    }
    // Check legacy single-file profile
    let legacy_p = store::account_profiles_dir(account_id)?.join(format!("{id}.json"));
    if legacy_p.exists() {
        return Ok(legacy_p);
    }
    Ok(config_p)
}

pub fn list_all() -> Result<Vec<ProfileMeta>> {
    let account_id = store::active_account_id()?;
    let dir = store::account_profiles_dir(&account_id)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let p = entry.path();
        let (config_path, is_legacy) = if p.is_dir() {
            (p.join("config.json"), false)
        } else if p.extension().and_then(|s| s.to_str()) == Some("json") {
            (p.clone(), true)
        } else {
            continue;
        };

        if !config_path.exists() {
            continue;
        }

        let body = match fs::read_to_string(&config_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let Ok(mut stored): std::result::Result<StoredProfile, _> = serde_json::from_str(&body) else {
            continue;
        };
        // Hide ephemeral profiles.
        if stored.meta.temporary {
            continue;
        }
        // Strict ownership check: reject or quarantine foreign records
        if !stored.meta.owner_account_id.is_empty() && stored.meta.owner_account_id != account_id {
            eprintln!("[profile] Security: Skipping profile {} belonging to {}", stored.meta.id, stored.meta.owner_account_id);
            continue;
        }
        if stored.meta.owner_account_id.is_empty() {
            stored.meta.owner_account_id = account_id.clone();
        }

        // Migrate legacy single-file into directory format
        if is_legacy {
            let proper_dir = store::profile_dir(&account_id, &stored.meta.id)?;
            let proper_config = proper_dir.join("config.json");
            let _ = fs::write(&proper_config, serde_json::to_string_pretty(&stored)?);
            let _ = fs::remove_file(&p);
        }

        // Backfill legacy profiles' created_at from file mtime, then persist.
        if stored.meta.created_at.is_none() {
            let mtime = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| format!("@{}", d.as_secs()));
            if let Some(ts) = mtime {
                stored.meta.created_at = Some(ts);
                if let Ok(body) = serde_json::to_string_pretty(&stored) {
                    let _ = fs::write(&config_path, body);
                }
            }
        }
        let name = stored
            .config
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("(unnamed)")
            .to_string();
        let notes = stored
            .config
            .get("notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        out.push(ProfileMeta {
            id: stored.meta.id,
            owner_account_id: stored.meta.owner_account_id,
            name,
            notes,
            proxy_id: stored.meta.proxy_id,
            last_launched_at: stored.meta.last_launched_at,
            created_at: stored.meta.created_at,
            updated_at: stored.meta.updated_at,
            pinned: stored.meta.pinned,
            folder: stored.meta.folder,
            total_runtime_ms: stored.meta.total_runtime_ms,
            color: stored.meta.color,
            extensions: stored.meta.extensions,
        });
    }
    // Pinned first, then newest-first by created_at; name fallback for same-second ties.
    out.sort_by(|a, b| {
        match (a.pinned, b.pinned) {
            (true, false) => return std::cmp::Ordering::Less,
            (false, true) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        match (&b.created_at, &a.created_at) {
            (Some(bv), Some(av)) => bv.cmp(av),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.name.cmp(&b.name),
        }
    });
    Ok(out)
}

/// Delete leftover temporary profiles after a crash; returns count.
pub fn purge_temporary() -> Result<usize> {
    let dir = store::profiles_dir()?;
    let mut n = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(body) = fs::read_to_string(entry.path()) else { continue; };
        let Ok(stored): std::result::Result<StoredProfile, _> = serde_json::from_str(&body) else {
            continue;
        };
        if stored.meta.temporary && !stored.meta.id.is_empty() {
            let _ = delete(&stored.meta.id);
            n += 1;
        }
    }
    Ok(n)
}

/// Deterministic non-zero 32-bit seed from the profile id + noise slot (FNV-1a).
/// Same id + slot always yields the same seed (stable fingerprint across
/// launches/edits); different ids yield different seeds (unique per profile).
fn derive_noise_seed(id: &str, slot: &str) -> u32 {
    let s = format!("{id}::{slot}");
    let mut h: u32 = 2166136261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    // 0 is the "derive automatically" sentinel — never hand it back as a value.
    if h == 0 {
        1
    } else {
        h
    }
}

/// Replace every auto-sentinel noise seed (`seed == 0` or absent) with a
/// stable per-profile value derived from the final profile id.  The UI can't
/// know the id at create time, so it sends `seed: 0` for every vector; without
/// this every freshly-created profile would otherwise share one placeholder
/// seed and produce an identical canvas/audio/WebGL fingerprint.
fn fill_noise_seeds(config: &mut serde_json::Map<String, serde_json::Value>, id: &str) {
    let Some(noise) = config.get_mut("noise").and_then(|n| n.as_object_mut()) else {
        return;
    };
    for (slot, block) in noise.iter_mut() {
        let Some(obj) = block.as_object_mut() else {
            continue;
        };
        let needs = obj
            .get("seed")
            .and_then(|v| v.as_u64())
            .map(|n| n == 0)
            .unwrap_or(true);
        if needs {
            obj.insert("seed".into(), serde_json::Value::from(derive_noise_seed(id, slot)));
        }
    }
}

/// Reset every noise seed back to the auto sentinel so the next `save_raw`
/// re-derives them from a fresh id.  Used when cloning so the copy doesn't
/// inherit the source's canvas/audio/WebGL fingerprint.
fn clear_noise_seeds(config: &mut serde_json::Map<String, serde_json::Value>) {
    let Some(noise) = config.get_mut("noise").and_then(|n| n.as_object_mut()) else {
        return;
    };
    for (_, block) in noise.iter_mut() {
        if let Some(obj) = block.as_object_mut() {
            obj.insert("seed".into(), serde_json::Value::from(0u32));
        }
    }
}

pub fn load_raw(id: &str) -> Result<StoredProfile> {
    let account_id = store::active_account_id()?;
    let path = path_for_account(&account_id, id)?;
    let body = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let mut stored: StoredProfile = serde_json::from_str(&body)?;
    if stored.meta.owner_account_id.is_empty() {
        stored.meta.owner_account_id = account_id.clone();
    } else if stored.meta.owner_account_id != account_id {
        anyhow::bail!("Access denied: Profile belongs to another account");
    }
    Ok(stored)
}

pub fn save_raw(stored: &mut StoredProfile) -> Result<()> {
    let account_id = store::active_account_id()?;
    let is_new = stored.meta.id.trim().is_empty();
    if is_new {
        if let Some(existing_id) = stored.config.get("id").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()) {
            stored.meta.id = existing_id.to_string();
        } else {
            stored.meta.id = uuid::Uuid::new_v4().to_string();
        }
    }

    if stored.meta.owner_account_id.is_empty() {
        stored.meta.owner_account_id = account_id.clone();
    } else if stored.meta.owner_account_id != account_id {
        anyhow::bail!("Security violation: Cannot modify profile belonging to another account");
    }

    // Carry created_at/pinned/folder/last_launched_at through edits.
    // pinned and folder are owned by set_pin/set_folder respectively.
    if !is_new {
        if let Ok(existing) = load_raw(&stored.meta.id) {
            if stored.meta.created_at.is_none() {
                stored.meta.created_at = existing.meta.created_at;
            }
            stored.meta.pinned = existing.meta.pinned;
            if stored.meta.folder.is_empty() {
                stored.meta.folder = existing.meta.folder;
            }
            if stored.meta.last_launched_at.is_none() {
                stored.meta.last_launched_at = existing.meta.last_launched_at;
            }
            if stored.meta.total_runtime_ms == 0 {
                stored.meta.total_runtime_ms = existing.meta.total_runtime_ms;
            }
        }
    }
    if stored.meta.created_at.is_none() {
        stored.meta.created_at = Some(chrono_now_iso());
    }
    stored.meta.updated_at = Some(chrono_now_iso());

    fill_noise_seeds(&mut stored.config, &stored.meta.id);

    // Save under data/accounts/<account-id>/profiles/<profile-id>/
    let _ = store::profile_dir(&account_id, &stored.meta.id)?;
    let _ = store::profile_user_data_dir(&account_id, &stored.meta.id)?;
    let config_path = store::profile_config_path(&account_id, &stored.meta.id)?;
    let fp_path = store::profile_fingerprint_path(&account_id, &stored.meta.id)?;

    let body = serde_json::to_string_pretty(stored)?;
    fs::write(&config_path, body)?;

    // Persist raw fingerprint config directly for launch runtime isolation
    let fp_body = serde_json::to_string_pretty(&stored.config)?;
    fs::write(&fp_path, fp_body)?;

    // Clean up legacy single file if exists
    let legacy_p = store::account_profiles_dir(&account_id)?.join(format!("{}.json", stored.meta.id));
    if legacy_p.exists() {
        let _ = fs::remove_file(legacy_p);
    }

    Ok(())
}

pub fn delete(id: &str) -> Result<()> {
    // Terminate any active process holding file locks before filesystem purge
    crate::process::Tracker::shared().kill_sync(id);

    let account_id = store::active_account_id()?;
    let p_dir = store::profile_dir(&account_id, id)?;
    if p_dir.exists() {
        let _ = fs::remove_dir_all(p_dir);
    }
    let legacy_p = store::account_profiles_dir(&account_id)?.join(format!("{id}.json"));
    if legacy_p.exists() {
        let _ = fs::remove_file(legacy_p);
    }
    Ok(())
}

/// Add `ms` to the persisted total_runtime_ms counter.  Called by the
/// process Tracker when the engine exits — totals survive launcher restarts.
pub fn add_runtime(id: &str, ms: u64) -> Result<()> {
    let mut p = load_raw(id)?;
    p.meta.total_runtime_ms = p.meta.total_runtime_ms.saturating_add(ms);
    save_raw(&mut p)?;
    Ok(())
}

/// Touch last_launched_at; optionally switch bound proxy.
pub fn touch_launched(id: &str, proxy_id: Option<String>) -> Result<()> {
    let mut p = load_raw(id)?;
    p.meta.last_launched_at = Some(chrono_now_iso());
    if proxy_id.is_some() {
        p.meta.proxy_id = proxy_id;
    }
    save_raw(&mut p)?;
    Ok(())
}

pub fn clone_profile(id: &str) -> Result<ProfileMeta> {
    let account_id = store::active_account_id()?;
    let mut src = load_raw(id)?;
    let new_id = uuid::Uuid::new_v4().to_string();
    let old_name = src
        .config
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("profile")
        .to_string();
    src.meta.id = new_id.clone();
    src.meta.owner_account_id = account_id;
    src.meta.last_launched_at = None;
    src.meta.created_at = None;
    src.meta.updated_at = None;
    src.meta.pinned = false;
    src.config
        .insert("name".into(), serde_json::Value::String(format!("{old_name} (copy)")));
    // Re-randomize CPU/RAM/platform_version so the copy doesn't collide on those axes.
    crate::randomize_platform_version(&mut src.config);
    crate::randomize_hardware(&mut src.config);
    clear_noise_seeds(&mut src.config);
    save_raw(&mut src)?;
    Ok(ProfileMeta {
        id: src.meta.id,
        owner_account_id: src.meta.owner_account_id,
        name: format!("{old_name} (copy)"),
        notes: src
            .config
            .get("notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        proxy_id: src.meta.proxy_id,
        last_launched_at: None,
        created_at: src.meta.created_at,
        updated_at: src.meta.updated_at,
        pinned: false,
        folder: src.meta.folder,
        total_runtime_ms: 0,
        color: src.meta.color,
        extensions: src.meta.extensions,
    })
}

/// Flip pin flag.
pub fn set_pin(id: &str, pinned: bool) -> Result<()> {
    let mut p = load_raw(id)?;
    p.meta.pinned = pinned;
    save_raw(&mut p)?;
    Ok(())
}

/// Assign folder tag (empty string clears).
pub fn set_folder(id: &str, folder: &str) -> Result<()> {
    let mut p = load_raw(id)?;
    p.meta.folder = folder.trim().to_string();
    save_raw(&mut p)?;
    Ok(())
}

/// Retag profiles from folder `old` to `new`; returns count.
pub fn rename_folder(old: &str, new: &str) -> Result<usize> {
    let account_id = store::active_account_id()?;
    let dir = store::account_profiles_dir(&account_id)?;
    let new = new.trim();
    let mut n = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let p = entry.path();
        let config_path = if p.is_dir() {
            p.join("config.json")
        } else if p.extension().and_then(|s| s.to_str()) == Some("json") {
            p.clone()
        } else {
            continue;
        };
        if !config_path.exists() {
            continue;
        }
        let Ok(body) = fs::read_to_string(&config_path) else { continue; };
        let Ok(mut stored): std::result::Result<StoredProfile, _> = serde_json::from_str(&body)
        else {
            continue;
        };
        if stored.meta.folder == old {
            stored.meta.folder = new.to_string();
            let _ = save_raw(&mut stored);
            n += 1;
        }
    }
    Ok(n)
}

/// Delete folder; `delete_profiles` true removes, false unfiles. Returns count.
pub fn delete_folder(name: &str, delete_profiles: bool) -> Result<usize> {
    let account_id = store::active_account_id()?;
    let dir = store::account_profiles_dir(&account_id)?;
    let mut n = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let p = entry.path();
        let config_path = if p.is_dir() {
            p.join("config.json")
        } else if p.extension().and_then(|s| s.to_str()) == Some("json") {
            p.clone()
        } else {
            continue;
        };
        if !config_path.exists() {
            continue;
        }
        let Ok(body) = fs::read_to_string(&config_path) else { continue; };
        let Ok(mut stored): std::result::Result<StoredProfile, _> = serde_json::from_str(&body)
        else {
            continue;
        };
        if stored.meta.folder == name {
            if delete_profiles {
                if crate::trash::move_to_trash(&stored.meta.id).is_err() {
                    let _ = delete(&stored.meta.id);
                }
            } else {
                stored.meta.folder = String::new();
                let _ = save_raw(&mut stored);
            }
            n += 1;
        }
    }
    Ok(n)
}

/// Per-profile user-data-dir; created on first call under the account's profile directory.
pub fn user_data_dir(id: &str) -> Result<PathBuf> {
    let account_id = store::active_account_id()?;
    store::profile_user_data_dir(&account_id, id)
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{s}")
}
