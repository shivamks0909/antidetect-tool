import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { API_BASE, apiFetch } from "../../../config/api";
import { useProfile } from "../../../entities/profile";
import { useProxy } from "../../../entities/proxy";
import { useBookmarks } from "../../../entities/bookmark";
import { useExtensions } from "../../../entities/extension";
import { useTrash } from "../../../entities/trash";
import { useFingerprint } from "../../../entities/fingerprint";

export interface AuthUser {
  id: string;
  email: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  role?: string | null;
}

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "deactivated"
  | "unconfigured";

export interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  token: string | null;
  status: AuthStatus;
  error: string | null;
  isBusy: boolean;
  require2FA: boolean;
  tempToken: string | null;

  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  signOut: () => Promise<void>;
  clearError: () => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

export const resetUserSessionState = () => {
  try {
    useProfile.getState().reset?.();
    useProxy.getState().reset?.();
    useBookmarks.getState().reset?.();
    useExtensions.getState().reset?.();
    useTrash.getState().reset?.();
    useFingerprint.getState().reset?.();
  } catch (e) {
    console.warn("[auth] error resetting user stores:", e);
  }
  try {
    localStorage.removeItem("opinion_jwt_token");
    localStorage.removeItem("oi_mock_profiles");
    localStorage.removeItem("oi_mock_proxies");
    localStorage.removeItem("shardx-folders");
  } catch {}
};

async function safeInvoke(cmd: string, args?: Record<string, any>): Promise<any> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      return await invoke(cmd, args);
    } catch (e) {
      console.warn(`[auth] safeInvoke ${cmd} failed:`, e);
      return null;
    }
  }
  return null;
}

let heartbeatTimer: any = null;
let consecutiveNetworkFails = 0;

export const useAuthStore = create<AuthState>((set, get) => {
  const handleDeactivation = async (reason?: string) => {
    get().stopHeartbeat();
    resetUserSessionState();
    await safeInvoke("kill_all_user_browsers");
    await safeInvoke("auth_logout");
    set({
      user: null,
      profile: null,
      token: null,
      status: "deactivated",
      error: reason || "Your account has been deactivated. Please contact your administrator.",
      isBusy: false,
      require2FA: false,
      tempToken: null,
    });
  };

  return {
    user: null,
    profile: null,
    token: null,
    status: "loading",
    error: null,
    isBusy: false,
    require2FA: false,
    tempToken: null,

    clearError: () => set({ error: null }),

    startHeartbeat: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      consecutiveNetworkFails = 0;

      heartbeatTimer = setInterval(async () => {
        const storedToken = localStorage.getItem("opinion_jwt_token");
        if (!storedToken) {
          get().stopHeartbeat();
          return;
        }

        try {
          const res = await apiFetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` },
          });

          // Reset network fails count on receiving any HTTP response from server
          consecutiveNetworkFails = 0;

          if (res.status === 401 || res.status === 403) {
            await handleDeactivation("Your account has been deactivated or session revoked.");
            return;
          }

          if (res.ok) {
            const userData = await res.json();
            if (!userData.is_active) {
              await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
              return;
            }
          }
        } catch (netErr) {
          consecutiveNetworkFails++;
          // Network transport glitch (e.g. WiFi flap): do NOT log out user!
          console.warn(`[auth] Heartbeat network glitch (#${consecutiveNetworkFails}):`, netErr);
        }
      }, 45000); // 45 seconds interval
    },

    stopHeartbeat: () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    init: async () => {
      const storedToken = localStorage.getItem("opinion_jwt_token");
      if (!storedToken) {
        await safeInvoke("auth_logout");
        set({ user: null, profile: null, token: null, status: "unauthenticated", require2FA: false, tempToken: null });
        return;
      }

      try {
        const res = await apiFetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            await handleDeactivation("Your account has been deactivated or session revoked.");
            return;
          }
          localStorage.removeItem("opinion_jwt_token");
          await safeInvoke("auth_logout");
          set({ user: null, profile: null, token: null, status: "unauthenticated", require2FA: false, tempToken: null });
          return;
        }

        const userData = await res.json();
        if (!userData.is_active) {
          await handleDeactivation("Your account has been deactivated. Please contact your administrator.");
          return;
        }

        await safeInvoke("auth_verify_session", {
          token: storedToken,
          userId: userData.id,
          email: userData.email,
        });

        set({
          user: { id: userData.id, email: userData.email },
          profile: userData,
          token: storedToken,
          status: "authenticated",
          error: null,
          require2FA: false,
          tempToken: null,
        });

        // Start background security heartbeat
        get().startHeartbeat();
      } catch (err) {
        console.error("[auth] Backend session check error:", err);
        // On network error during init with existing token, allow graceful retry
        set({ status: "unauthenticated", error: null, require2FA: false, tempToken: null });
      }
    },

    signIn: async (identifier: string, password: string) => {
      set({ isBusy: true, error: null });

      const rawInput = identifier.trim();
      const resolvedEmail =
        !rawInput.includes("@") && rawInput.toLowerCase() === "admin"
          ? "admin@opinioninsights.in"
          : rawInput;

      try {
        let res = await apiFetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: resolvedEmail, password }),
        });

        // If server experienced cold-start DB error, auto-fix and retry once
        if (!res.ok && res.status >= 500) {
          try {
            await apiFetch(`${API_BASE}/auth/auto-fix`, { method: "POST" });
            res = await apiFetch(`${API_BASE}/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: resolvedEmail, password }),
            });
          } catch (_) {}
        }

        const data = await res.json();

        if (!res.ok || !data.success) {
          set({
            error: data.error || "Invalid email or password.",
            isBusy: false,
          });
          return false;
        }

        // Check if 2FA is required by the backend
        if (data.require2FA) {
          set({
            require2FA: true,
            tempToken: data.tempToken,
            isBusy: false,
            error: null,
          });
          return true;
        }

        const token = data.token;
        const userObj = data.user;

        if (!userObj.is_active) {
          set({
            error: "Your account has been deactivated. Please contact your administrator.",
            isBusy: false,
          });
          return false;
        }

        localStorage.setItem("opinion_jwt_token", token);

        await safeInvoke("auth_verify_session", {
          token,
          userId: userObj.id,
          email: userObj.email,
        });

        set({
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          token,
          status: "authenticated",
          error: null,
          isBusy: false,
          require2FA: false,
          tempToken: null,
        });

        // Start background security heartbeat
        get().startHeartbeat();
        return true;
      } catch (err: any) {
        set({
          error: err?.message || "Failed to connect to backend server.",
          isBusy: false,
        });
        return false;
      }
    },

    verify2FA: async (code: string) => {
      const tempToken = get().tempToken;
      if (!tempToken) {
        set({ error: "2FA session expired. Please sign in again.", isBusy: false });
        return false;
      }

      set({ isBusy: true, error: null });

      try {
        const res = await apiFetch(`${API_BASE}/auth/login/2fa`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tempToken, code: code.trim() }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          set({
            error: data.error || "Invalid 2FA code.",
            isBusy: false,
          });
          return false;
        }

        const token = data.token;
        const userObj = data.user;

        if (!userObj.is_active) {
          set({
            error: "Your account has been deactivated. Please contact your administrator.",
            isBusy: false,
          });
          return false;
        }

        localStorage.setItem("opinion_jwt_token", token);

        await safeInvoke("auth_verify_session", {
          token,
          userId: userObj.id,
          email: userObj.email,
        });

        set({
          user: { id: userObj.id, email: userObj.email },
          profile: userObj,
          token,
          status: "authenticated",
          require2FA: false,
          tempToken: null,
          error: null,
          isBusy: false,
        });

        get().startHeartbeat();
        return true;
      } catch (err: any) {
        set({
          error: err?.message || "2FA verification failed.",
          isBusy: false,
        });
        return false;
      }
    },

    cancel2FA: () => {
      set({ require2FA: false, tempToken: null, error: null, isBusy: false });
    },

    signOut: async () => {
      set({ isBusy: true });
      get().stopHeartbeat();
      const token = get().token || localStorage.getItem("opinion_jwt_token");
      if (token) {
        try {
          await apiFetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (err) {
          console.warn("[auth] backend session revocation notice:", err);
        }
      }
      try {
        resetUserSessionState();
      } finally {
        await safeInvoke("kill_all_user_browsers");
        await safeInvoke("auth_logout");
        set({
          user: null,
          profile: null,
          token: null,
          status: "unauthenticated",
          error: null,
          isBusy: false,
          require2FA: false,
          tempToken: null,
        });
      }
    },
  };
});
