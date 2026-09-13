function resolveApiBase(): string {
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "http://127.0.0.1:5000/api";
  }
  return (import.meta.env.VITE_API_BASE as string) || "https://api.opinioninsights.in/api";
}

const API_BASE = resolveApiBase();

export interface UserItem {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "vendor" | "user";
  isActive: boolean;
  createdAt: string;
  profilesCount?: number;
  proxiesCount?: number;
}

export interface AuditLogItem {
  _id?: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string | null;
  details?: Record<string, any>;
  timestamp: string;
}

export interface HealthStatus {
  status: string;
  service: string;
  mongodb: string;
  timestamp: string;
}

export interface ProxyMonitorStats {
  total_proxies: number;
  configured_count: number;
  running_count: number;
  failed_count: number;
  profiles_using_count: number;
  users_using_count: number;
}

export interface ProxyMonitorItem {
  id: string;
  account_id: string;
  user_id: string;
  profile_id: string | null;
  user_email: string;
  user_name: string;
  raw_input: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  password_masked: string | null;
  has_password: boolean;
  location_label?: string | null;
  source: string;
  source_file: string | null;
  source_row: number | null;
  configuration_status: "CONFIGURED" | "UNASSIGNED";
  runtime_status: "RUNNING" | "STOPPED" | "IDLE";
  last_connection_status: "SUCCESS" | "FAILED" | "PENDING" | "NONE";
  last_used_at: string | null;
  last_connection_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProxyAuditEventItem {
  id: number;
  account_id: string;
  user_id: string;
  profile_id: string | null;
  proxy_id: string;
  event_type: string;
  source: string;
  status: string | null;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ProxyMonitorListResponse {
  items: ProxyMonitorItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface ActiveSessionItem {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export function getAuthToken(): string | null {
  return localStorage.getItem("opinion_admin_token");
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem("opinion_admin_token", token);
  } else {
    localStorage.removeItem("opinion_admin_token");
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any).error || `HTTP ${res.status}: ${res.statusText}`);
  }

  return data as T;
}

export const api = {
  login: async (email: string, password: string) => {
    const data = await request<{
      success: boolean;
      token?: string;
      user?: UserItem;
      require2FA?: boolean;
      tempToken?: string;
      message?: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  autoFix: async () => {
    return request<{ success: boolean; message: string; report?: any }>("/auth/auto-fix", {
      method: "POST",
    });
  },

  login2FA: async (tempToken: string, code: string) => {
    const data = await request<{
      success: boolean;
      token: string;
      user: UserItem;
    }>("/auth/login/2fa", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    });
    setAuthToken(data.token);
    return data;
  },

  forgotPassword: async (email: string) => {
    return request<{ success: boolean; message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
  },

  resetPassword: async (token: string, newPassword: string) => {
    return request<{ success: boolean; message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: token.trim(), newPassword }),
    });
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    return request<{ success: boolean; message: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  setup2FA: async () => {
    return request<{ secret: string; qrCode: string }>("/auth/2fa/setup", {
      method: "POST",
    });
  },

  verify2FA: async (code: string) => {
    return request<{ success: boolean; message: string; recoveryCodes: string[] }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ code: code.trim() }),
    });
  },

  disable2FA: async (password: string) => {
    return request<{ success: boolean; message: string }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  getActiveSessions: async () => {
    return request<{
      sessions: Array<{
        id: string;
        userAgent: string;
        ip: string;
        createdAt: string;
        lastActiveAt: string;
        isCurrent: boolean;
      }>;
    }>("/admin/sessions");
  },

  revokeSessionById: async (sessionId: string) => {
    return request<{ success: boolean; message: string }>("/admin/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  },

  revokeAllSessions: async (keepCurrent: boolean = true) => {
    return request<{ success: boolean; message: string }>("/admin/sessions/revoke-all", {
      method: "POST",
      body: JSON.stringify({ keepCurrent }),
    });
  },

  getMe: async () => {
    return request<UserItem>("/auth/me");
  },

  logout: async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch (_) {}
    setAuthToken(null);
  },

  getHealth: async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      return (await res.json()) as HealthStatus;
    } catch {
      return { status: "offline", service: "Backend API", mongodb: "disconnected", timestamp: new Date().toISOString() };
    }
  },

  getUsers: async (params: { role?: string; status?: string; search?: string; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.role && params.role !== "all") query.set("role", params.role);
    if (params.status && params.status !== "all") query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<{ users: UserItem[]; pagination?: { total: number; page: number; limit: number; pages: number } }>(
      `/admin/users${qs ? `?${qs}` : ""}`
    );
  },

  createUser: async (userData: { email: string; password: string; fullName?: string; role: string }) => {
    return request<{ success: boolean; user: UserItem }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  },

  updateUser: async (id: string, updates: { isActive?: boolean; role?: string; fullName?: string; password?: string }) => {
    return request<{ success: boolean; message: string }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  },

  deleteUser: async (id: string) => {
    return request<{ success: boolean; message: string }>(`/admin/users/${id}`, {
      method: "DELETE",
    });
  },

  getAuditLogs: async () => {
    return request<{ logs: AuditLogItem[] }>("/admin/audit-logs");
  },

  getProxyMonitorStats: async () => {
    return request<ProxyMonitorStats>("/admin/proxy-monitor/stats");
  },

  getProxyMonitorList: async (params: {
    page?: number;
    limit?: number;
    search?: string;
    protocol?: string;
    configuration_status?: string;
    runtime_status?: string;
    last_connection_status?: string;
    source?: string;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.search) query.set("search", params.search);
    if (params.protocol) query.set("protocol", params.protocol);
    if (params.configuration_status) query.set("configuration_status", params.configuration_status);
    if (params.runtime_status) query.set("runtime_status", params.runtime_status);
    if (params.last_connection_status) query.set("last_connection_status", params.last_connection_status);
    if (params.source) query.set("source", params.source);

    const qs = query.toString();
    return request<ProxyMonitorListResponse>(`/admin/proxy-monitor${qs ? `?${qs}` : ""}`);
  },

  getProxyTimeline: async (proxyId: string) => {
    return request<{ events: ProxyAuditEventItem[] }>(`/admin/proxy-monitor/${proxyId}/timeline`);
  },

  revealProxyCredential: async (proxyId: string, payload?: { password?: string; reauthToken?: string }) => {
    return request<{
      success: boolean;
      id: string;
      raw_input: string;
      username: string | null;
      password: string | null;
    }>(`/admin/proxy-monitor/${proxyId}/reveal-credential`, {
      method: "POST",
      body: payload ? JSON.stringify(payload) : undefined,
    });
  },

  getSessions: async () => {
    return request<{ sessions: ActiveSessionItem[] }>("/auth/sessions");
  },

  revokeSession: async (sessionId: string) => {
    return request<{ success: boolean; message: string }>("/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  },

  revokeOtherSessions: async () => {
    return request<{ success: boolean; message: string; count: number }>("/auth/sessions/revoke-others", {
      method: "POST",
    });
  },

  reAuth: async (password: string) => {
    return request<{ success: boolean; reAuthToken: string; expiresInSeconds: number }>("/auth/reauth", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },
};

