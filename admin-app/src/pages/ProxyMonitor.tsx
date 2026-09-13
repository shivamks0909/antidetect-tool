import React, { useState, useEffect } from "react";
import {
  api,
  ProxyMonitorStats,
  ProxyMonitorItem,
  ProxyAuditEventItem,
} from "../api/client";
import {
  Search,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  X,
  FileSpreadsheet,
  Globe,
  Terminal,
  Lock,
} from "lucide-react";

export function ProxyMonitor() {
  const [stats, setStats] = useState<ProxyMonitorStats | null>(null);
  const [items, setItems] = useState<ProxyMonitorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [configFilter, setConfigFilter] = useState("all");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [connFilter, setConnFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  // Detail Drawer State
  const [selectedProxy, setSelectedProxy] = useState<ProxyMonitorItem | null>(null);
  const [timeline, setTimeline] = useState<ProxyAuditEventItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Privileged Reveal State
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);
  const [reAuthPassword, setReAuthPassword] = useState("");
  const [revealedCreds, setRevealedCreds] = useState<{ username: string | null; password: string | null } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  // Copy Feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fetchStats = async () => {
    try {
      const s = await api.getProxyMonitorStats();
      setStats(s);
    } catch (err) {
      console.error("Failed to fetch proxy stats:", err);
    }
  };

  const fetchList = async (targetPage = 1) => {
    setLoading(true);
    try {
      const res = await api.getProxyMonitorList({
        page: targetPage,
        limit: 15,
        search: search.trim() || undefined,
        protocol: protocolFilter !== "all" ? protocolFilter : undefined,
        configuration_status: configFilter !== "all" ? configFilter : undefined,
        runtime_status: runtimeFilter !== "all" ? runtimeFilter : undefined,
        last_connection_status: connFilter !== "all" ? connFilter : undefined,
        source: sourceFilter !== "all" ? sourceFilter : undefined,
      });
      setItems(res.items);
      setPage(res.pagination.page);
      setTotalPages(res.pagination.pages);
      setTotalCount(res.pagination.total);
    } catch (err) {
      console.error("Failed to fetch proxy monitor list:", err);
    } finally {
      setLoading(false);
    }
  };

  const openDrawer = async (item: ProxyMonitorItem) => {
    setSelectedProxy(item);
    setRevealedCreds(null);
    setRevealError(null);
    setShowRevealConfirm(false);
    setReAuthPassword("");
    setTimelineLoading(true);

    try {
      const tRes = await api.getProxyTimeline(item.id);
      setTimeline(tRes.events || []);
    } catch (err) {
      console.error("Failed to fetch proxy timeline:", err);
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  const closeDrawer = () => {
    setSelectedProxy(null);
    setRevealedCreds(null);
    setRevealError(null);
    setShowRevealConfirm(false);
    setReAuthPassword("");
  };

  const confirmAndReveal = async () => {
    if (!selectedProxy) return;
    if (!reAuthPassword.trim()) {
      setRevealError("Administrator password required to authorize privileged reveal.");
      return;
    }
    setRevealing(true);
    setRevealError(null);
    try {
      const creds = await api.revealProxyCredential(selectedProxy.id, { password: reAuthPassword.trim() });
      setRevealedCreds({ username: creds.username, password: creds.password });
      setShowRevealConfirm(false);
      setReAuthPassword("");

      // Refresh timeline so the new proxy_credential_viewed event appears immediately
      const tRes = await api.getProxyTimeline(selectedProxy.id);
      setTimeline(tRes.events || []);
    } catch (err: any) {
      setRevealError(err.message || "Failed to reveal credential. Check password.");
    } finally {
      setRevealing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchList(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, protocolFilter, configFilter, runtimeFilter, connFilter, sourceFilter]);

  const getRuntimeBadge = (status: string) => {
    switch (status) {
      case "RUNNING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-50 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            Running
          </span>
        );
      case "STOPPED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            Stopped
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
            Idle
          </span>
        );
    }
  };

  const getConnBadge = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Success
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">
            <XCircle className="w-3 h-3 text-red-600" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-400 bg-slate-100 border border-slate-200">
            None
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Configured</span>
            <Server className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{stats?.total_proxies ?? "..."}</span>
            <span className="text-xs text-slate-400 font-semibold">({stats?.configured_count ?? 0} active)</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Currently Running</span>
            <Activity className="w-5 h-5 text-green-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-green-600">{stats?.running_count ?? "..."}</span>
            <span className="text-xs text-slate-400 font-semibold">in active browsers</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Failed Connections</span>
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-red-600">{stats?.failed_count ?? "..."}</span>
            <span className="text-xs text-slate-400 font-semibold">auth / timeout</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Coverage</span>
            <Globe className="w-5 h-5 text-teal-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900">{stats?.profiles_using_count ?? "..."}</span>
            <span className="text-xs text-slate-400 font-semibold">profiles · {stats?.users_using_count ?? 0} users</span>
          </div>
        </div>
      </div>

      {/* Toolbar & Filter Controls */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 w-full min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by user, profile, host, or raw format..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-xs font-semibold transition-all"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Protocol */}
          <select
            value={protocolFilter}
            onChange={(e) => setProtocolFilter(e.target.value)}
            className="text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
          >
            <option value="all">All Protocols</option>
            <option value="geolocation">Geolocation</option>
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>

          {/* Runtime */}
          <select
            value={runtimeFilter}
            onChange={(e) => setRuntimeFilter(e.target.value)}
            className="text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
          >
            <option value="all">All Runtime</option>
            <option value="RUNNING">Running</option>
            <option value="STOPPED">Stopped</option>
            <option value="IDLE">Idle</option>
          </select>

          {/* Connection */}
          <select
            value={connFilter}
            onChange={(e) => setConnFilter(e.target.value)}
            className="text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
          >
            <option value="all">All Connections</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="NONE">None</option>
          </select>

          {/* Source */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs focus:ring-2 focus:ring-green-500 outline-none"
          >
            <option value="all">All Sources</option>
            <option value="manual">Manual</option>
            <option value="batch_import">Batch Import</option>
            <option value="api">API</option>
          </select>

          <button
            onClick={() => {
              fetchStats();
              fetchList(page);
            }}
            title="Refresh list"
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-2xs transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-4 px-5">User</th>
                <th className="py-4 px-5">Profile</th>
                <th className="py-4 px-5">Proxy Host</th>
                <th className="py-4 px-4">Protocol</th>
                <th className="py-4 px-4">Source</th>
                <th className="py-4 px-4">Config</th>
                <th className="py-4 px-4">Runtime</th>
                <th className="py-4 px-4">Last Connection</th>
                <th className="py-4 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="font-semibold text-xs">Loading proxy fleet telemetry...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                    No proxy records found matching filter criteria.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => openDrawer(item)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                  >
                    {/* User */}
                    <td className="py-4 px-5">
                      <div className="font-bold text-slate-900">{item.user_name || "User"}</div>
                      <div className="text-[11px] font-medium text-slate-400">{item.user_email}</div>
                    </td>

                    {/* Profile */}
                    <td className="py-4 px-5">
                      {item.profile_id ? (
                        <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                          {item.profile_id}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic font-normal">Unassigned</span>
                      )}
                    </td>

                    {/* Proxy Host */}
                    <td className="py-4 px-5">
                      <div className="font-mono font-bold text-slate-900">
                        {item.host}:{item.port}
                      </div>
                      {item.location_label && (
                        <div className="text-[11px] font-bold text-emerald-600 truncate max-w-[200px] flex items-center gap-1 mt-0.5">
                          <Globe className="w-3 h-3 shrink-0" />
                          {item.location_label}
                        </div>
                      )}
                      {item.username && (
                        <div className="font-mono text-[11px] text-slate-400 truncate max-w-[180px]">
                          user: {item.username}
                        </div>
                      )}
                    </td>

                    {/* Protocol */}
                    <td className="py-4 px-4">
                      <span className={`font-mono font-bold uppercase text-[10px] px-2 py-0.5 rounded border ${
                        item.protocol === "geolocation"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-indigo-50 text-indigo-700 border-indigo-200"
                      }`}>
                        {item.protocol}
                      </span>
                    </td>

                    {/* Source */}
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1 text-slate-600 font-medium capitalize">
                        {item.source === "batch_import" && <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500" />}
                        {item.source}
                      </div>
                      {item.source_file && (
                        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]" title={item.source_file}>
                          {item.source_file} {item.source_row ? `#${item.source_row}` : ""}
                        </div>
                      )}
                    </td>

                    {/* Config Status */}
                    <td className="py-4 px-4 font-bold text-[11px]">
                      {item.configuration_status === "CONFIGURED" ? (
                        <span className="text-slate-700">Configured</span>
                      ) : (
                        <span className="text-amber-600">Unassigned</span>
                      )}
                    </td>

                    {/* Runtime Status */}
                    <td className="py-4 px-4">{getRuntimeBadge(item.runtime_status)}</td>

                    {/* Last Connection */}
                    <td className="py-4 px-4">{getConnBadge(item.last_connection_status)}</td>

                    {/* Actions */}
                    <td className="py-4 px-5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(item);
                        }}
                        className="p-1.5 text-slate-400 group-hover:text-green-600 rounded-lg hover:bg-slate-100 transition-all"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-6 py-4 bg-slate-50/60 border-t border-slate-200/80 flex items-center justify-between text-xs font-semibold text-slate-500">
          <div>
            Showing {items.length} of {totalCount} proxies
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1 || loading}
              onClick={() => fetchList(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs transition-all cursor-pointer"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages || loading}
              onClick={() => fetchList(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs transition-all cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Slide-Over Detail Drawer */}
      {selectedProxy && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 transform transition-all duration-300">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-slate-900">Proxy Inspection</h3>
                  <span className="font-mono text-xs font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded">
                    {selectedProxy.id}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1 font-medium">
                  Configured for: {selectedProxy.user_email}
                </div>
              </div>
              <button
                onClick={closeDrawer}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Raw Format Preservation Box */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    Exact Raw Input (Verbatim Preserved)
                  </span>
                  <button
                    onClick={() => handleCopy(selectedProxy.raw_input, "raw")}
                    className="flex items-center gap-1 text-[11px] font-bold text-green-600 hover:text-green-700 bg-green-50 px-2 py-1 rounded-md border border-green-200 transition-all cursor-pointer"
                  >
                    {copiedKey === "raw" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === "raw" ? "Copied" : "Copy Raw"}
                  </button>
                </div>
                <div className="p-3 bg-slate-950 text-green-400 font-mono text-xs rounded-xl border border-slate-800 break-all select-all shadow-inner">
                  {selectedProxy.raw_input}
                </div>
              </div>

              {/* Masked Credentials Block */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    Authentication Credentials
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-200/70 px-2 py-0.5 rounded">
                    AES-256-GCM
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400">Username</div>
                    <div className="font-mono font-bold text-slate-800 break-all mt-0.5">
                      {selectedProxy.username || <span className="text-slate-400 italic">None</span>}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400">Password</div>
                    <div className="font-mono font-bold text-slate-800 mt-0.5 flex items-center gap-2">
                      {revealedCreds ? (
                        <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200 select-all">
                          {revealedCreds.password || "(empty)"}
                        </span>
                      ) : (
                        <span>{selectedProxy.password_masked || "None"}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Privileged Reveal Button */}
                {selectedProxy.has_password && !revealedCreds && (
                  <div className="pt-2 border-t border-slate-200/80">
                    <button
                      onClick={() => setShowRevealConfirm(true)}
                      className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Privileged Credential Reveal (Audited)
                    </button>
                  </div>
                )}
              </div>

              {/* Reveal Confirmation Modal inside Drawer */}
              {showRevealConfirm && (
                <div className="p-4 bg-amber-50/90 border-2 border-amber-400 rounded-xl space-y-3 animate-in fade-in zoom-in-95">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-extrabold text-amber-900">Privileged Credential Reveal Warning</h4>
                      <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                        Accessing this secret requires admin re-authentication and generates an immutable <strong>proxy_credential_viewed</strong> audit log attributed to your identity.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1 pt-1">
                    <label className="text-[11px] font-bold text-amber-950 block">
                      Enter Admin Password to Re-authenticate:
                    </label>
                    <input
                      type="password"
                      value={reAuthPassword}
                      onChange={(e) => setReAuthPassword(e.target.value)}
                      placeholder="Your admin password"
                      className="w-full px-3 py-1.5 text-xs bg-white border border-amber-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmAndReveal();
                      }}
                    />
                  </div>
                  {revealError && <div className="text-[11px] text-red-600 font-bold">{revealError}</div>}
                  <div className="flex items-center gap-2 justify-end pt-1">
                    <button
                      onClick={() => setShowRevealConfirm(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmAndReveal}
                      disabled={revealing || !reAuthPassword.trim()}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {revealing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Re-auth & Reveal
                    </button>
                  </div>
                </div>
              )}

              {/* Normalized Config Specs */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Normalized Specifications
                </span>
                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs font-mono">
                  <div>
                    <span className="text-slate-400 font-sans text-[11px]">Protocol:</span>
                    <div className="font-bold text-slate-900 uppercase">{selectedProxy.protocol}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans text-[11px]">Host / IP:</span>
                    <div className="font-bold text-slate-900">{selectedProxy.host}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans text-[11px]">Port:</span>
                    <div className="font-bold text-slate-900">{selectedProxy.port}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans text-[11px]">Source Origin:</span>
                    <div className="font-bold text-slate-900 capitalize font-sans">{selectedProxy.source}</div>
                  </div>
                  {selectedProxy.location_label && (
                    <div className="col-span-2">
                      <span className="text-slate-400 font-sans text-[11px]">Location Metadata:</span>
                      <div className="font-bold text-emerald-700 flex items-center gap-1 font-sans">
                        <Globe className="w-3.5 h-3.5" />
                        {selectedProxy.location_label}
                      </div>
                    </div>
                  )}
                  {selectedProxy.source_file && (
                    <div className="col-span-2">
                      <span className="text-slate-400 font-sans text-[11px]">Source File / Row:</span>
                      <div className="font-bold text-slate-900 break-all">
                        {selectedProxy.source_file} (Row {selectedProxy.source_row})
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Deterministic Chronological Timeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Audit & Runtime Lifecycle Timeline
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">ORDER: created_at ASC, id ASC</span>
                </div>

                {timelineLoading ? (
                  <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Loading ordered audit trail...
                  </div>
                ) : timeline.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                    No timeline events recorded yet.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {timeline.map((event, idx) => {
                      const isSuccess = event.event_type.includes("success");
                      const isFailed = event.event_type.includes("failed");
                      const isViewed = event.event_type === "proxy_credential_viewed";

                      return (
                        <div key={`${event.id}-${idx}`} className="relative group">
                          {/* Dot marker */}
                          <div
                            className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 border-white shadow-xs ${
                              isSuccess
                                ? "bg-green-500 ring-2 ring-green-200"
                                : isFailed
                                ? "bg-red-500 ring-2 ring-red-200"
                                : isViewed
                                ? "bg-amber-500 ring-2 ring-amber-200"
                                : "bg-indigo-500 ring-2 ring-indigo-200"
                            }`}
                          ></div>

                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {event.event_type}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                #{event.id} · {new Date(event.created_at).toLocaleString()}
                              </span>
                            </div>

                            <div className="text-[11px] text-slate-600 flex items-center gap-2">
                              <span>Source: <strong>{event.source}</strong></span>
                              {event.status && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-bold">
                                  {event.status}
                                </span>
                              )}
                            </div>

                            {event.metadata && Object.keys(event.metadata).length > 0 && (
                              <div className="mt-2 p-2 bg-slate-950 text-slate-300 font-mono text-[10px] rounded-lg overflow-x-auto">
                                <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                              </div>
                            )}

                            {event.ip_address && (
                              <div className="text-[10px] text-slate-400 font-mono pt-1">
                                IP: {event.ip_address}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
