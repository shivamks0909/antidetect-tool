import React, { useEffect, useState } from "react";
import { api, UserItem, AuditLogItem, HealthStatus, getAuthToken, getRefreshToken, getCachedUser, setAuthSession, clearAuthSession } from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Dashboard } from "./pages/Dashboard";
import { Users } from "./pages/Users";
import { SecuritySettings } from "./pages/SecuritySettings";
import { AuditLogs } from "./pages/AuditLogs";
import { ProxyMonitor } from "./pages/ProxyMonitor";
import { Settings } from "./pages/Settings";
import { UserPlus } from "lucide-react";
import { CreateUserModal } from "./components/CreateUserModal";

const VALID_PAGES = ["dashboard", "users", "security", "proxies", "audit", "settings"] as const;
type PageType = (typeof VALID_PAGES)[number];

function getInitialPage(): PageType {
  const hash = window.location.hash.replace("#", "").toLowerCase() as PageType;
  return VALID_PAGES.includes(hash) ? hash : "dashboard";
}

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserItem | null>(null);
  const [activePage, setActivePageState] = useState<PageType>(getInitialPage());
  const [showForgotPassword, setShowForgotPassword] = useState<boolean>(false);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showGlobalCreateModal, setShowGlobalCreateModal] = useState<boolean>(false);

  const setActivePage = (page: PageType) => {
    if (currentUser?.role !== "admin" && (page === "users" || page === "audit")) {
      setActivePageState("dashboard");
      window.location.hash = "dashboard";
      return;
    }
    setActivePageState(page);
    window.location.hash = page;
  };

  useEffect(() => {
    const onHashChange = () => {
      const page = window.location.hash.replace("#", "").toLowerCase() as PageType;
      if (VALID_PAGES.includes(page)) {
        if (currentUser?.role !== "admin" && (page === "users" || page === "audit")) {
          setActivePageState("dashboard");
          window.location.hash = "dashboard";
          return;
        }
        setActivePageState(page);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [currentUser]);

  const checkAuth = async (isRetry = false) => {
    let token = getAuthToken();
    const refreshToken = getRefreshToken();

    if (!token && !refreshToken) {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    // Pre-populate user from cache if available so UI doesn't flicker
    const cachedUser = getCachedUser();
    if (cachedUser) {
      setCurrentUser(cachedUser);
      setIsAuthenticated(true);
    }

    try {
      // If access token is absent but refresh token exists, attempt refresh first
      if (!token && refreshToken) {
        token = await api.refreshToken();
        if (!token) {
          setIsAuthenticated(false);
          setCurrentUser(null);
          setLoading(false);
          return;
        }
      }

      const user = await api.getMe();
      if (user.role !== "admin" && user.role !== "vendor" && user.role !== "user") {
        console.warn("[Auth Bootstrap] Role not authorized for web console:", user.role);
        clearAuthSession();
        setCurrentUser(null);
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }
      setAuthSession(token, refreshToken, user);
      setCurrentUser(user);
      setIsAuthenticated(true);
    } catch (err: any) {
      console.warn("[Auth Bootstrap] Validation check failed:", err.message);

      if (err.message && err.message.startsWith("NETWORK_ERROR")) {
        // Network offline or server cold start: NEVER log out!
        if (cachedUser || token) {
          setIsAuthenticated(true);
        }
        setLoading(false);
        return;
      }

      // If token expired, try silent refresh once
      if (refreshToken) {
        const refreshedToken = await api.refreshToken();
        if (refreshedToken) {
          try {
            const user = await api.getMe();
            if (user.role === "admin" || user.role === "vendor" || user.role === "user") {
              setAuthSession(refreshedToken, getRefreshToken(), user);
              setCurrentUser(user);
              setIsAuthenticated(true);
              setLoading(false);
              return;
            }
          } catch (_) {}
        }
      }

      // True invalidation (refresh token rejected and wiped)
      if (!getRefreshToken()) {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const uData = await api.getUsers();
      setUsers(uData.users || []);
    } catch (err: any) {
      console.error("[Users] Fetch failed:", err.message);
      setUsersError(err.message || "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  };

  const refreshData = async () => {
    if (!isAuthenticated) return;
    if (currentUser?.role === "admin") {
      fetchUsers();
      try {
        const aData = await api.getAuditLogs().catch(() => ({ logs: [] }));
        setAuditLogs(aData.logs || []);
      } catch (err) {
        console.error("Failed to refresh admin audit data:", err);
      }
    }
    try {
      const hData = await api.getHealth();
      setHealth(hData);
    } catch (err) {
      console.error("Failed to refresh health data:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setCurrentUser(null);
      setIsAuthenticated(false);
      window.location.hash = "";
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      refreshData();
    }
  }, [isAuthenticated, currentUser?.role]);

  // Silent refresh keepalive: periodically renews access token every 5 minutes
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      try {
        await api.refreshToken();
      } catch (err) {
        console.warn("[AdminAuth] Periodic refresh keepalive notice:", err);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-bold tracking-wide">Loading Admin Console...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (showForgotPassword) {
      return <ForgotPassword onBackToLogin={() => setShowForgotPassword(false)} />;
    }
    return (
      <Login
        onLoginSuccess={() => {
          checkAuth();
        }}
        onForgotPasswordClick={() => setShowForgotPassword(true)}
      />
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        onLogout={handleLogout}
        currentUserEmail={currentUser?.email}
        currentUserRole={currentUser?.role}
        mongoStatus={health?.mongodb}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <Header
          title={
            activePage === "dashboard"
              ? "Dashboard Overview"
              : activePage === "users"
              ? "User & Access Control"
              : activePage === "security"
              ? "Security & 2FA"
              : activePage === "proxies"
              ? "Proxy Fleet & Usage Monitor"
              : activePage === "audit"
              ? "Security Audit Trail"
              : "System Infrastructure"
          }
          subtitle={
            activePage === "dashboard"
              ? "Real-time backend user statistics and audit stream"
              : activePage === "users"
              ? "Create, search, filter, disable, reset password, and edit users"
              : activePage === "security"
              ? "Manage admin password policy, authenticator TOTP 2FA, and active login sessions"
              : activePage === "proxies"
              ? "Verbatim raw proxy format preservation, runtime lifecycle telemetry, and audited credential access"
              : activePage === "audit"
              ? "Live logs captured directly from REST API operations"
              : "MongoDB Atlas cluster and backend service status"
          }
          onRefresh={refreshData}
          actionButton={
            activePage === "users" ? (
              <button
                onClick={() => setShowGlobalCreateModal(true)}
                className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl shadow-md shadow-green-600/20 flex items-center gap-2 transition-all cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                + Create User
              </button>
            ) : undefined
          }
        />

        <main className="flex-1 overflow-y-auto p-8">
          {activePage === "dashboard" && (
            <Dashboard
              users={users}
              auditLogs={auditLogs}
              health={health}
              onNavigateToUsers={() => setActivePage("users")}
              onNavigateToAudit={() => setActivePage("audit")}
            />
          )}

          {activePage === "users" && (
            <Users
              users={users}
              isLoading={usersLoading}
              error={usersError}
              onRefresh={fetchUsers}
            />
          )}

          {activePage === "security" && <SecuritySettings />}

          {activePage === "proxies" && <ProxyMonitor />}

          {activePage === "audit" && <AuditLogs logs={auditLogs} onRefresh={refreshData} />}

          {activePage === "settings" && <Settings health={health} />}
        </main>
      </div>

      {showGlobalCreateModal && (
        <CreateUserModal
          onClose={() => setShowGlobalCreateModal(false)}
          onSuccess={() => {
            refreshData();
          }}
        />
      )}
    </div>
  );
}

