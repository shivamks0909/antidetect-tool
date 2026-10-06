export type ProxyEntry = {
  id: string;
  name: string;
  kind: "socks5" | "http" | "https" | "geolocation";
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  notes: string;
  source_format?: string;
  location_label?: string;
  raw_input?: string;
  scheme?: string;
};

export type ProxyTestSnapshot = {
  first_seen: string;
  last_seen: string;
  ip: string;
  country_code: string;
  country: string;
  region: string;
  city: string;
  isp: string;
  timezone: string;
  latitude: number;
  longitude: number;
  tcp_ms: number | null;
  udp_ms: number | null;
  udp_error: string | null;
  provider: string;
};

export type BulkRowState = {
  entry: ProxyEntry;
  selected: boolean;
  status: "idle" | "testing" | "ok" | "fail";
  tcp_ms?: number | null;
  udp_ms?: number | null;
  country?: string;
  error?: string;
};

export type ProxyErrorCategory =
  | "SUCCESS"
  | "INVALID_PROXY_URL"
  | "INVALID_CREDENTIALS_FORMAT"
  | "DNS_FAILURE"
  | "TCP_CONNECTION_FAILED"
  | "CONNECTION_TIMEOUT"
  | "PROXY_AUTH_FAILED"
  | "HTTP_PROXY_REQUEST_FAILED"
  | "HTTPS_CONNECT_FAILED"
  | "TLS_HANDSHAKE_FAILED"
  | "TARGET_CONNECTION_FAILED"
  | "TARGET_TIMEOUT"
  | "CONNECTION_RESET"
  | "PROXY_RETURNED_4XX"
  | "PROXY_RETURNED_5XX";

export type ProxyConfig = {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  source_format?: string;
  location_label?: string;
  raw_input?: string;
};

export type ProxyDiagnosticResult = {
  proxy_id: string;
  proxy_index: number;
  sanitized_host_port: string;
  protocol: string;
  test_type: string;
  success: boolean;
  error_category: ProxyErrorCategory;
  latency_ms: number | null;
  total_time_ms: number | null;
  status_code: number | null;
  retry_count: number;
  tested_at: string;
  tcp_ok: boolean;
  auth_ok: boolean;
  connect_ok: boolean;
  request_ok: boolean;
  details?: string;
};

export type ProxyHealthState =
  | "HEALTHY"
  | "TEMPORARILY_FAILED"
  | "AUTH_FAILED"
  | "DEAD"
  | "COOLDOWN";
