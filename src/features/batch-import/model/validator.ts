import type {
  RawRow,
  ColumnMapping,
  RowValidationResult,
  CanonicalField,
  BatchExtensionConfig,
} from "./types";
import type { ProxyEntry } from "../../../entities/proxy";
import type { ExtensionEntry, ExtensionSet } from "../../../entities/extension";
import { parseProxyInput } from "../../../shared/lib/proxyParser";

export interface BatchValidationOptions {
  extensionConfig?: BatchExtensionConfig;
  installedExtensions?: ExtensionEntry[];
  extensionSets?: ExtensionSet[];
}

/**
 * Validate all spreadsheet rows based on the configured column mappings
 */
export function validateBatchRows(
  rows: RawRow[],
  mapping: ColumnMapping,
  options?: BatchValidationOptions
): RowValidationResult[] {
  // Invert mapping for fast lookup: canonicalField -> spreadsheetHeader[]
  const fieldToHeaders: Partial<Record<CanonicalField, string[]>> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field === "ignore") continue;
    if (!fieldToHeaders[field]) fieldToHeaders[field] = [];
    fieldToHeaders[field]!.push(header);
  }

  const getFieldValue = (row: RawRow, field: CanonicalField): string => {
    const headers = fieldToHeaders[field];
    if (!headers || headers.length === 0) return "";
    for (const h of headers) {
      const v = row[h];
      if (v !== undefined && v !== null && String(v).trim().length > 0) {
        return String(v).trim();
      }
    }
    return "";
  };

  const titleOccurrences = new Map<string, number[]>();

  // First pass: collect title counts to detect duplicates
  rows.forEach((row, idx) => {
    const rawTitle = getFieldValue(row, "name");
    if (rawTitle) {
      const lower = rawTitle.toLowerCase();
      if (!titleOccurrences.has(lower)) titleOccurrences.set(lower, []);
      titleOccurrences.get(lower)!.push(idx + 1);
    }
  });

  // Second pass: validate each row
  return rows.map((row, idx) => {
    const rowNum = idx + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Profile Title (Required)
    const title = getFieldValue(row, "name");
    if (!title) {
      errors.push("Profile Title is required and cannot be empty.");
    } else {
      const duplicateRows = titleOccurrences.get(title.toLowerCase()) || [];
      if (duplicateRows.length > 1) {
        const otherRows = duplicateRows.filter((r) => r !== rowNum);
        warnings.push(`Duplicate title "${title}" also appears on row(s): ${otherRows.join(", ")}`);
      }
    }

    // 2. Folder
    const folder = getFieldValue(row, "folder") || undefined;

    // 3. Proxy parsing & validation
    let parsedProxy: ProxyEntry | null = null;
    const proxyRaw = getFieldValue(row, "proxy_raw");
    const proxyHost = getFieldValue(row, "proxy_host");
    const proxyPort = getFieldValue(row, "proxy_port");
    const proxyUser = getFieldValue(row, "proxy_user");
    const proxyPass = getFieldValue(row, "proxy_pass");
    const proxyKind = getFieldValue(row, "proxy_kind");
    const rotateUrl = getFieldValue(row, "rotate_url");

    if (proxyRaw || proxyHost) {
      const proxyRes = parseAndValidateProxy({
        raw: proxyRaw,
        host: proxyHost,
        port: proxyPort,
        user: proxyUser,
        pass: proxyPass,
        kind: proxyKind,
        rotateUrl,
        rowTitle: title || `Profile ${rowNum}`,
      });

      if (proxyRes.error) {
        errors.push(proxyRes.error);
      } else if (proxyRes.proxy) {
        parsedProxy = proxyRes.proxy;
      }
    }

    // 4. Start URLs
    let parsedStartUrls: string[] | undefined = undefined;
    const rawUrls = getFieldValue(row, "start_urls");
    if (rawUrls) {
      const splitUrls = rawUrls
        .split(/[\r\n,;\s]+/)
        .map((u) => u.trim())
        .filter(Boolean);

      const validUrls: string[] = [];
      for (const u of splitUrls) {
        try {
          const withProto = u.includes("://") ? u : `https://${u}`;
          new URL(withProto);
          validUrls.push(withProto);
        } catch {
          warnings.push(`Invalid URL ignored: "${u}"`);
        }
      }
      if (validUrls.length > 0) {
        parsedStartUrls = validUrls;
      }
    }

    // 5. Timezone
    let parsedTimezone: string | undefined = undefined;
    const rawTz = getFieldValue(row, "timezone");
    if (rawTz) {
      if (rawTz.toLowerCase() === "auto") {
        parsedTimezone = "auto";
      } else {
        try {
          // Check if valid timezone identifier in browser Intl
          Intl.DateTimeFormat(undefined, { timeZone: rawTz });
          parsedTimezone = rawTz;
        } catch {
          warnings.push(`Unrecognized timezone "${rawTz}", falling back to "auto"`);
          parsedTimezone = "auto";
        }
      }
    }

    // 6. User Agent
    const userAgent = getFieldValue(row, "user_agent") || undefined;

    // 7. Language
    const language = getFieldValue(row, "language") || undefined;

    // 8. Platform
    const platform = getFieldValue(row, "platform") || undefined;

    // 9. Screen Resolution
    let screenRes: { width: number; height: number } | undefined = undefined;
    const rawRes = getFieldValue(row, "screen_resolution");
    if (rawRes) {
      const match = rawRes.match(/(\d+)\s*[xX*×,]\s*(\d+)/);
      if (match) {
        const w = parseInt(match[1], 10);
        const h = parseInt(match[2], 10);
        if (w >= 300 && w <= 7680 && h >= 300 && h <= 4320) {
          screenRes = { width: w, height: h };
        } else {
          warnings.push(`Resolution "${rawRes}" out of bounds, will use standard screen size`);
        }
      }
    }

    // 10. Geolocation
    let geoCoords: { latitude: number; longitude: number } | undefined = undefined;
    const rawGeo = getFieldValue(row, "geolocation");
    if (rawGeo && rawGeo.toLowerCase() !== "auto") {
      const match = rawGeo.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          geoCoords = { latitude: lat, longitude: lng };
        } else {
          warnings.push(`Geolocation "${rawGeo}" invalid coordinates, falling back to auto`);
        }
      }
    }

    // 11. Tags
    let parsedTags: string[] | undefined = undefined;
    const rawTags = getFieldValue(row, "tags");
    if (rawTags) {
      parsedTags = rawTags
        .split(/[,;\s]+/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
    }

    // 12. Notes
    const notes = getFieldValue(row, "notes") || undefined;

    // 13. Cookie
    const cookie = getFieldValue(row, "cookie") || undefined;

    // 14. Extensions
    let parsedExtensions: string[] | undefined = undefined;
    const rawExts = getFieldValue(row, "extensions");
    if (rawExts) {
      parsedExtensions = rawExts
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);
    }

    const rowResult: RowValidationResult = {
      rowIndex: rowNum,
      raw: row,
      status: errors.length > 0 ? "invalid" : "valid",
      errors,
      warnings,
      parsedTitle: title || `(Row ${rowNum} Missing Title)`,
      parsedFolder: folder,
      parsedProxy,
      parsedStartUrls,
      parsedUserAgent: userAgent,
      parsedTimezone,
      parsedLanguage: language,
      parsedPlatform: platform,
      parsedScreenResolution: screenRes,
      parsedGeolocation: geoCoords,
      parsedTags,
      parsedNotes: notes,
      parsedCookie: cookie,
      parsedExtensions,
      executionStatus: "pending",
    };

    if (options?.extensionConfig) {
      return applyExtensionResolutionToRow(
        rowResult,
        options.extensionConfig,
        options.installedExtensions || [],
        options.extensionSets || []
      );
    }

    return rowResult;
  });
}

export function findInstalledExtension(token: string, installed: ExtensionEntry[]): ExtensionEntry | undefined {
  const clean = token.trim().toLowerCase();
  if (!clean) return undefined;

  // 1. Direct ID match
  const byId = installed.find((e) => e.id.toLowerCase() === clean);
  if (byId) return byId;

  // 2. Exact display name match
  const byName = installed.find((e) => e.name.trim().toLowerCase() === clean);
  if (byName) return byName;

  // 3. Normalized alphanumeric match
  const normToken = clean.replace(/[^a-z0-9]/g, "");
  if (normToken.length >= 2) {
    const byNorm = installed.find(
      (e) =>
        e.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normToken ||
        e.id.toLowerCase().replace(/[^a-z0-9]/g, "") === normToken
    );
    if (byNorm) return byNorm;
  }

  return undefined;
}

export function applyExtensionResolutionToRow(
  rowResult: RowValidationResult,
  config?: BatchExtensionConfig,
  installed: ExtensionEntry[] = [],
  sets: ExtensionSet[] = []
): RowValidationResult {
  if (!config || !config.enabled) {
    const baseErrors = rowResult.errors.filter(
      (e) => !e.startsWith("Missing required extension") && !e.startsWith("Missing extension")
    );
    const baseWarnings = rowResult.warnings.filter(
      (w) => !w.startsWith("Uninstalled extension") && !w.startsWith("Selected extension set")
    );
    return {
      ...rowResult,
      errors: baseErrors,
      warnings: baseWarnings,
      status: baseErrors.length > 0 ? "invalid" : "valid",
      resolvedExtensions: [],
      missingExtensions: [],
    };
  }

  const resolved = new Set<string>();
  const missing = new Set<string>();
  const newWarnings: string[] = [];
  const newErrors: string[] = [];

  // 1. Resolve from mode
  if (config.mode === "apply_all") {
    for (const id of config.selectedExtensionIds) {
      const ext = installed.find((e) => e.id === id);
      if (ext) {
        resolved.add(ext.id);
      } else {
        missing.add(id);
      }
    }
  } else if (config.mode === "extension_set") {
    const set = sets.find((s) => s.id === config.selectedSetId);
    if (set) {
      for (const id of set.extension_ids) {
        const ext = installed.find((e) => e.id === id);
        if (ext) {
          resolved.add(ext.id);
        } else {
          missing.add(id);
        }
      }
    } else if (config.selectedSetId) {
      newWarnings.push("Selected extension set not found in account library.");
    }
  }

  // 2. Resolve from Excel column if mode is excel_column OR mergeWithExcel is true
  if (config.mode === "excel_column" || config.mergeWithExcel) {
    if (rowResult.parsedExtensions && rowResult.parsedExtensions.length > 0) {
      for (const token of rowResult.parsedExtensions) {
        const ext = findInstalledExtension(token, installed);
        if (ext) {
          resolved.add(ext.id);
        } else {
          missing.add(token);
        }
      }
    }
  }

  // 3. Handle missing extensions according to strict policy
  const missingList = Array.from(missing);
  if (missingList.length > 0) {
    if (config.strictMissingExtensions) {
      newErrors.push(`Missing required extension(s): ${missingList.join(", ")}`);
    } else {
      newWarnings.push(`Uninstalled extension(s) skipped: ${missingList.join(", ")}`);
    }
  }

  const cleanErrors = rowResult.errors.filter(
    (e) => !e.startsWith("Missing required extension") && !e.startsWith("Missing extension")
  );
  const cleanWarnings = rowResult.warnings.filter(
    (w) => !w.startsWith("Uninstalled extension") && !w.startsWith("Selected extension set")
  );

  const allErrors = [...cleanErrors, ...newErrors];
  const allWarnings = [...cleanWarnings, ...newWarnings];

  return {
    ...rowResult,
    errors: allErrors,
    warnings: allWarnings,
    status: allErrors.length > 0 ? "invalid" : "valid",
    resolvedExtensions: Array.from(resolved),
    missingExtensions: missingList,
  };
}

export function resolveBatchExtensions(
  rows: RowValidationResult[],
  config: BatchExtensionConfig,
  installed: ExtensionEntry[] = [],
  sets: ExtensionSet[] = []
): RowValidationResult[] {
  return rows.map((r) => applyExtensionResolutionToRow(r, config, installed, sets));
}

interface ProxyParseInput {
  raw?: string;
  host?: string;
  port?: string;
  user?: string;
  pass?: string;
  kind?: string;
  rotateUrl?: string;
  rowTitle: string;
}

function parseAndValidateProxy(input: ProxyParseInput): { proxy?: ProxyEntry; error?: string } {
  let kind: ProxyEntry["kind"] = "socks5";
  let host = "";
  let port = 1080;
  let username = "";
  let password = "";
  let location_label: string | undefined = undefined;
  let raw_input: string | undefined = undefined;

  // Normalize kind
  if (input.kind) {
    const k = input.kind.toLowerCase().trim();
    if (k === "http" || k === "https" || k === "socks5" || k === "geolocation") {
      kind = k as ProxyEntry["kind"];
    } else if (k === "socks4") {
      kind = "socks5";
    } else {
      return { error: `Unsupported proxy protocol: "${input.kind}" (must be http, https, socks5, or geolocation).` };
    }
  }

  // 1. If combined raw string is provided, parse it with Universal Proxy Parser
  if (input.raw && input.raw.trim().length > 0) {
    try {
      const parsed = parseProxyInput(input.raw.trim(), input.kind || "socks5");
      host = parsed.host;
      port = parsed.port;
      username = parsed.username || "";
      password = parsed.password || "";
      raw_input = parsed.raw_input;
      location_label = parsed.location_label || undefined;
      kind = (parsed.scheme === "geolocation" ? "geolocation" : (parsed.protocol as ProxyEntry["kind"])) || kind;
    } catch (err: any) {
      return { error: `Invalid proxy format "${input.raw}": ${err.message}` };
    }
  } else if (input.host) {
    // 2. Discrete fields provided
    host = input.host.trim();
    port = parseInt(input.port || "1080", 10);
    username = input.user || "";
    password = input.pass || "";
    raw_input = `${host}:${port}`;
  }

  // Validate Host
  if (!host || host.length === 0) {
    return { error: "Proxy host/IP is required." };
  }

  // Validate Port
  if (isNaN(port) || port < 1 || port > 65535) {
    return { error: `Invalid proxy port "${port}". Port must be a number between 1 and 65535.` };
  }

  const proxyId = `proxy-batch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const displayName = location_label
    ? `${location_label} (${host}:${port})`
    : `${input.rowTitle} Proxy (${host}:${port})`;

  return {
    proxy: {
      id: proxyId,
      name: displayName,
      kind,
      host,
      port,
      username,
      password,
      country: location_label || "",
      location_label,
      raw_input: raw_input || `${host}:${port}`,
      notes: input.rotateUrl
        ? `Rotate IP URL: ${input.rotateUrl}`
        : location_label
        ? `Location: ${location_label}`
        : "Imported via Batch Provisioning",
    },
  };
}
