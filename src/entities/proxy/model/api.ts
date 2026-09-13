import { safeInvoke } from "../../../shared/lib/tauriHelper";
import type { ProxyEntry, ProxyTestSnapshot } from "./types";
import { parseProxyInput } from "../../../shared/lib/proxyParser";

const MOCK_PROXIES_KEY = "oi_mock_proxies";

function getMockProxies(): ProxyEntry[] {
  try {
    return JSON.parse(localStorage.getItem(MOCK_PROXIES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMockProxies(list: ProxyEntry[]) {
  try {
    localStorage.setItem(MOCK_PROXIES_KEY, JSON.stringify(list));
  } catch {}
}

const mockProxyList = (): ProxyEntry[] => getMockProxies();
const mockProxySave = (entry: ProxyEntry): ProxyEntry => {
  const list = getMockProxies();
  const id = entry.id || `proxy-${Date.now()}`;
  const full: ProxyEntry = { ...entry, id };
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = full; else list.push(full);
  saveMockProxies(list);
  return full;
};
const mockProxyDelete = (id: string): void => {
  saveMockProxies(getMockProxies().filter((p) => p.id !== id));
};

const mockSnapshot: ProxyTestSnapshot = {
  first_seen: new Date().toISOString(),
  last_seen: new Date().toISOString(),
  ip: "1.2.3.4",
  country_code: "US",
  country: "United States",
  region: "California",
  city: "Los Angeles",
  isp: "Mock ISP",
  timezone: "America/Los_Angeles",
  latitude: 34.05,
  longitude: -118.24,
  tcp_ms: 45,
  udp_ms: 50,
  udp_error: null,
  provider: "Mock Provider",
};

export const proxyList = () => safeInvoke<ProxyEntry[]>("proxy_list", undefined, mockProxyList);
export const proxySave = (entry: ProxyEntry) => safeInvoke<ProxyEntry>("proxy_save", { entry }, () => mockProxySave(entry));

export const emptyProxy = (): ProxyEntry => ({
  id: "",
  name: "",
  kind: "socks5",
  host: "",
  port: 1080,
  username: "",
  password: "",
  country: "",
  notes: "",
});

const mockProxyBulkParse = (text: string, defaultKind: ProxyEntry["kind"]): ProxyEntry[] => {
  const lines = text.split("\n");
  const result: ProxyEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const hashIdx = line.indexOf("#");
    const main = hashIdx >= 0 ? line.slice(0, hashIdx).trim() : line;
    const comment = hashIdx >= 0 ? line.slice(hashIdx + 1).trim() : "";

    try {
      const parsed = parseProxyInput(main, defaultKind);
      const id = `proxy-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const kind = (parsed.scheme === "geolocation" ? "geolocation" : parsed.protocol) as ProxyEntry["kind"];
      result.push({
        id,
        name: comment || (parsed.location_label ? `${parsed.location_label} (${parsed.host}:${parsed.port})` : `${parsed.host}:${parsed.port}`),
        kind,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username || "",
        password: parsed.password || "",
        country: parsed.location_label || "",
        location_label: parsed.location_label || undefined,
        raw_input: parsed.raw_input,
        scheme: parsed.scheme,
        notes: comment ? `# ${comment}` : (parsed.location_label ? `Location: ${parsed.location_label}` : ""),
      });
    } catch (_) {
      continue;
    }
  }
  return result;
};

const mockProxyBulkSave = (entries: ProxyEntry[]): number => {
  const list = getMockProxies();
  let count = 0;
  for (const entry of entries) {
    const dup = list.some((p) => p.host === entry.host && p.port === entry.port && p.username === entry.username);
    if (!dup) {
      const id = entry.id || `proxy-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      list.push({ ...entry, id });
      count++;
    }
  }
  saveMockProxies(list);
  return count;
};

const mockProxyBulkImport = (text: string, kind: string): number => {
  const parsed = mockProxyBulkParse(text, kind as any);
  return mockProxyBulkSave(parsed);
};

export const proxyDelete = (id: string) => safeInvoke("proxy_delete", { id }, () => mockProxyDelete(id));
export const proxyFullTest = (entry: ProxyEntry) => safeInvoke<ProxyTestSnapshot>("proxy_full_test", { entry }, mockSnapshot);
export const proxyLastTest = (id: string) => safeInvoke<ProxyTestSnapshot | null>("proxy_last_test", { id }, null);
export const proxyHistory = (id: string) => safeInvoke<ProxyTestSnapshot[]>("proxy_history", { id }, []);
export const proxyBulkParse = (text: string, kind: ProxyEntry["kind"]) => safeInvoke<ProxyEntry[]>("proxy_bulk_parse", { text, kind }, () => mockProxyBulkParse(text, kind));
export const proxyBulkSave = (entries: any[]) => safeInvoke<number>("proxy_bulk_save", { entries }, () => mockProxyBulkSave(entries));
export const proxyBulkImport = (text: string, kind: string) => safeInvoke<number>("proxy_bulk_import", { text, kind }, () => mockProxyBulkImport(text, kind));
