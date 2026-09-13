const API_BASE = (import.meta.env.VITE_API_BASE as string) || "https://api.opinioninsights.in/api";

export interface UserItem {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "user";
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
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
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
    return request<{ success: boolean; message: string }>(`/admin/sessions/${sessionId}/revoke`, {
      method: "DELETE",
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

  getHealth: async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      return (await res.json()) as HealthStatus;
    } catch {
      return { status: "offline", service: "Backend API", mongodb: "disconnected", timestamp: new Date().toISOString() };
    }
  },

  getUsers: async () => {
    return request<{ users: UserItem[] }>("/admin/users");
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
};

