// Defensive Survey Security Monitor for Authorized Survey QA & Verification
// Evaluates session, network, and browser runtime constraints without anti-detection/stealth bypass.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveySecurityConfig {
    #[serde(default)]
    pub require_proxy: bool,
    #[serde(default)]
    pub allowed_countries: Option<Vec<String>>,
    #[serde(default)]
    pub max_latency_ms: Option<u64>,
    #[serde(default)]
    pub allowed_runtimes: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub enforce_session_integrity: bool,
    #[serde(default)]
    pub hard_fail_on_warning: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SurveySecurityConfig {
    fn default() -> Self {
        Self {
            require_proxy: true,
            allowed_countries: None,
            max_latency_ms: Some(3000),
            allowed_runtimes: Some(vec!["chromium".into(), "chrome".into()]),
            enforce_session_integrity: true,
            hard_fail_on_warning: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurveySecurityStatus {
    Pass,
    Warning,
    Terminate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityCheckItem {
    pub name: String,
    pub passed: bool,
    pub severity: String, // "info" | "warning" | "critical"
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveySecurityReport {
    pub status: SurveySecurityStatus,
    pub checks: Vec<SecurityCheckItem>,
    pub sanitized_reason: Option<String>,
    pub evaluated_at: String,
    pub session_id: String,
    pub termination_html: Option<String>,
}

// In-memory replay guard for active survey sessions
static ACTIVE_SESSIONS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn is_session_replayed(session_id: &str) -> bool {
    if session_id.trim().is_empty() {
        return true;
    }
    let mut guard = ACTIVE_SESSIONS.lock().unwrap();
    let set = guard.get_or_insert_with(HashSet::new);
    if set.contains(session_id) {
        true
    } else {
        set.insert(session_id.to_string());
        false
    }
}

pub fn clear_session_cache() {
    let mut guard = ACTIVE_SESSIONS.lock().unwrap();
    if let Some(ref mut set) = *guard {
        set.clear();
    }
}

pub fn generate_termination_page(reason: &str, session_id: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Survey Session Terminated</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }}
    .card {{
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }}
    .icon {{
      width: 48px;
      height: 48px;
      color: #ef4444;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 20px;
      margin: 0 0 12px 0;
      color: #f1f5f9;
    }}
    p {{
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
      margin: 0 0 20px 0;
    }}
    .meta {{
      background: #0f172a;
      padding: 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #64748b;
      word-break: break-all;
    }}
  </style>
</head>
<body>
  <div class="card">
    <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
    <h1>Survey Verification Check Failed</h1>
    <p>{reason}</p>
    <div class="meta">Session ID: {session_id}</div>
  </div>
</body>
</html>"#
    )
}

pub async fn evaluate_survey_security(
    config: &SurveySecurityConfig,
    session_id: &str,
    active_runtime: &str,
    bound_proxy: Option<&crate::proxy::ProxyEntry>,
    measured_latency_ms: Option<u64>,
) -> SurveySecurityReport {
    let mut checks = Vec::new();
    let mut critical_failed = false;
    let mut warning_failed = false;
    let mut reasons = Vec::new();

    let now_iso = {
        let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{}s", dur.as_secs())
    };

    // 1. Session integrity check
    if config.enforce_session_integrity {
        let is_empty = session_id.trim().is_empty();
        let is_replayed = if !is_empty {
            is_session_replayed(session_id)
        } else {
            true
        };

        if is_empty {
            critical_failed = true;
            reasons.push("Missing survey session token");
            checks.push(SecurityCheckItem {
                name: "session_token".into(),
                passed: false,
                severity: "critical".into(),
                message: "Survey session identifier cannot be blank".into(),
            });
        } else if is_replayed {
            critical_failed = true;
            reasons.push("Duplicate or replayed survey session detected");
            checks.push(SecurityCheckItem {
                name: "session_token".into(),
                passed: false,
                severity: "critical".into(),
                message: "Session token was already utilized in an active test session".into(),
            });
        } else {
            checks.push(SecurityCheckItem {
                name: "session_token".into(),
                passed: true,
                severity: "info".into(),
                message: "Session token format and freshness verified".into(),
            });
        }
    }

    // 2. Proxy requirement check
    if config.require_proxy {
        match bound_proxy {
            Some(p) if !p.host.trim().is_empty() && p.port > 0 => {
                checks.push(SecurityCheckItem {
                    name: "proxy_routing".into(),
                    passed: true,
                    severity: "info".into(),
                    message: format!("Authenticated proxy configured ({}:{})", p.host, p.port),
                });

                // Country constraint check if specified
                if let Some(ref allowed) = config.allowed_countries {
                    if !p.country.is_empty() {
                        let allowed_upper: Vec<String> = allowed.iter().map(|c| c.to_uppercase()).collect();
                        let p_upper = p.country.to_uppercase();
                        if allowed_upper.contains(&p_upper) {
                            checks.push(SecurityCheckItem {
                                name: "geo_alignment".into(),
                                passed: true,
                                severity: "info".into(),
                                message: format!("Proxy location '{p_upper}' matches survey region"),
                            });
                        } else {
                            warning_failed = true;
                            reasons.push("Proxy location does not match expected survey jurisdiction");
                            checks.push(SecurityCheckItem {
                                name: "geo_alignment".into(),
                                passed: false,
                                severity: "warning".into(),
                                message: format!("Proxy country '{p_upper}' outside allowed list: {:?}", allowed),
                            });
                        }
                    }
                }
            }
            _ => {
                critical_failed = true;
                reasons.push("Survey environment requires an isolated authenticated proxy; direct connection rejected");
                checks.push(SecurityCheckItem {
                    name: "proxy_routing".into(),
                    passed: false,
                    severity: "critical".into(),
                    message: "No active proxy configured for this survey profile".into(),
                });
            }
        }
    }

    // 3. Runtime integrity check
    if let Some(ref allowed_rts) = config.allowed_runtimes {
        let rt_lower = active_runtime.to_lowercase();
        let is_allowed = allowed_rts.iter().any(|r| rt_lower.contains(&r.to_lowercase()));
        if is_allowed {
            checks.push(SecurityCheckItem {
                name: "runtime_compatibility".into(),
                passed: true,
                severity: "info".into(),
                message: format!("Browser runtime '{active_runtime}' matches supported profile"),
            });
        } else {
            critical_failed = true;
            reasons.push("Unauthorized browser runtime engine detected");
            checks.push(SecurityCheckItem {
                name: "runtime_compatibility".into(),
                passed: false,
                severity: "critical".into(),
                message: format!("Runtime '{active_runtime}' is not within allowed list: {:?}", allowed_rts),
            });
        }
    }

    // 4. Latency bounds check
    if let Some(max_lat) = config.max_latency_ms {
        if let Some(actual) = measured_latency_ms {
            if actual <= max_lat {
                checks.push(SecurityCheckItem {
                    name: "latency_sla".into(),
                    passed: true,
                    severity: "info".into(),
                    message: format!("Network round-trip {actual}ms within survey threshold ({max_lat}ms)"),
                });
            } else {
                warning_failed = true;
                reasons.push("Proxy latency exceeds survey responsiveness SLA");
                checks.push(SecurityCheckItem {
                    name: "latency_sla".into(),
                    passed: false,
                    severity: "warning".into(),
                    message: format!("Latency {actual}ms exceeded target {max_lat}ms"),
                });
            }
        }
    }

    let status = if critical_failed || (config.hard_fail_on_warning && warning_failed) {
        SurveySecurityStatus::Terminate
    } else if warning_failed {
        SurveySecurityStatus::Warning
    } else {
        SurveySecurityStatus::Pass
    };

    let sanitized_reason = if reasons.is_empty() {
        None
    } else {
        Some(reasons.join("; "))
    };

    let termination_html = if status == SurveySecurityStatus::Terminate {
        Some(generate_termination_page(
            sanitized_reason.as_deref().unwrap_or("Security conditions not met"),
            session_id,
        ))
    } else {
        None
    };

    SurveySecurityReport {
        status,
        checks,
        sanitized_reason,
        evaluated_at: now_iso,
        session_id: session_id.to_string(),
        termination_html,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_survey_security_pass() {
        clear_session_cache();
        let config = SurveySecurityConfig::default();
        let proxy = crate::proxy::ProxyEntry {
            id: "p1".into(),
            name: "Test".into(),
            kind: crate::proxy::ProxyKind::Http,
            host: "127.0.0.1".into(),
            port: 8080,
            username: "u".into(),
            password: "p".into(),
            country: "US".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };

        let report = evaluate_survey_security(
            &config,
            "session-unique-101",
            "chromium",
            Some(&proxy),
            Some(120),
        )
        .await;

        assert_eq!(report.status, SurveySecurityStatus::Pass);
        assert!(report.termination_html.is_none());
        assert!(report.sanitized_reason.is_none());
    }

    #[tokio::test]
    async fn test_survey_security_terminate_when_proxy_missing() {
        clear_session_cache();
        let config = SurveySecurityConfig {
            require_proxy: true,
            ..Default::default()
        };

        let report = evaluate_survey_security(
            &config,
            "session-unique-102",
            "chromium",
            None,
            None,
        )
        .await;

        assert_eq!(report.status, SurveySecurityStatus::Terminate);
        assert!(report.termination_html.is_some());
        assert!(report.sanitized_reason.unwrap().contains("requires an isolated authenticated proxy"));
    }

    #[tokio::test]
    async fn test_survey_security_replay_detection() {
        clear_session_cache();
        let config = SurveySecurityConfig::default();
        let proxy = crate::proxy::ProxyEntry {
            id: "p1".into(),
            name: "Test".into(),
            kind: crate::proxy::ProxyKind::Http,
            host: "127.0.0.1".into(),
            port: 8080,
            username: "".into(),
            password: "".into(),
            country: "".into(),
            notes: "".into(),
            source_format: None,
            location_label: None,
            raw_input: None,
        };

        let report1 = evaluate_survey_security(&config, "session-replay-test", "chromium", Some(&proxy), None).await;
        assert_eq!(report1.status, SurveySecurityStatus::Pass);

        // Second run with same session id -> Terminate
        let report2 = evaluate_survey_security(&config, "session-replay-test", "chromium", Some(&proxy), None).await;
        assert_eq!(report2.status, SurveySecurityStatus::Terminate);
        assert!(report2.sanitized_reason.unwrap().contains("Duplicate or replayed"));
    }
}
