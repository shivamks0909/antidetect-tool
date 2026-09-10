import type { ProxyEntry } from "../../../entities/proxy";

export type CanonicalField =
  | "name"
  | "folder"
  | "proxy_raw"
  | "proxy_kind"
  | "proxy_host"
  | "proxy_port"
  | "proxy_user"
  | "proxy_pass"
  | "rotate_url"
  | "start_urls"
  | "user_agent"
  | "timezone"
  | "language"
  | "platform"
  | "screen_resolution"
  | "geolocation"
  | "extensions"
  | "extension_set"
  | "bookmarks"
  | "bookmark_set"
  | "tags"
  | "notes"
  | "cookie"
  | "ignore";

export interface FieldDefinition {
  id: CanonicalField;
  label: string;
  required?: boolean;
  description: string;
  aliases: string[];
}

export const CANONICAL_FIELDS: FieldDefinition[] = [
  {
    id: "name",
    label: "Profile Title",
    required: true,
    description: "Unique name of the browser profile",
    aliases: ["name", "title", "profile title", "profile name", "profilename", "profile"],
  },
  {
    id: "folder",
    label: "Folder",
    description: "Folder or group to organize profile under",
    aliases: ["folder", "group", "category", "folder name", "foldername"],
  },
  {
    id: "proxy_raw",
    label: "Proxy Info (Combined)",
    description: "Combined proxy string (e.g. host:port or host:port:user:pass or socks5://...)",
    aliases: ["proxy", "proxy info", "proxy address", "proxy ip", "proxy string", "proxy raw"],
  },
  {
    id: "proxy_kind",
    label: "Proxy Protocol",
    description: "Protocol type: http, https, socks4, socks5",
    aliases: ["proxy type", "proxy kind", "proxy protocol", "protocol", "type"],
  },
  {
    id: "proxy_host",
    label: "Proxy Host / IP",
    description: "IP address or domain of the proxy",
    aliases: ["proxy host", "host", "ip", "proxy ip", "server", "address"],
  },
  {
    id: "proxy_port",
    label: "Proxy Port",
    description: "Port number (1-65535)",
    aliases: ["proxy port", "port"],
  },
  {
    id: "proxy_user",
    label: "Proxy Username",
    description: "Proxy authentication username",
    aliases: ["proxy user", "proxy username", "username", "user", "proxy login", "login"],
  },
  {
    id: "proxy_pass",
    label: "Proxy Password",
    description: "Proxy authentication password",
    aliases: ["proxy pass", "proxy password", "password", "pass"],
  },
  {
    id: "rotate_url",
    label: "Rotate IP URL",
    description: "Webhook URL to trigger mobile/residential IP rotation",
    aliases: ["rotate url", "ip rotate", "rotation url", "change ip url"],
  },
  {
    id: "start_urls",
    label: "Start URLs",
    description: "URLs opened on browser launch (comma or space separated)",
    aliases: ["start urls", "start url", "url", "urls", "startup url", "home page", "target url"],
  },
  {
    id: "user_agent",
    label: "User Agent",
    description: "Custom User-Agent header string",
    aliases: ["user agent", "useragent", "ua"],
  },
  {
    id: "timezone",
    label: "Timezone",
    description: "Timezone ID (e.g. America/New_York or 'auto')",
    aliases: ["timezone", "tz", "time zone"],
  },
  {
    id: "language",
    label: "Language / Locale",
    description: "Browser language (e.g. en-US or 'auto')",
    aliases: ["language", "lang", "locale"],
  },
  {
    id: "platform",
    label: "Operating System",
    description: "Target OS platform: Windows, macOS, Linux",
    aliases: ["platform", "os", "operating system"],
  },
  {
    id: "screen_resolution",
    label: "Screen Resolution",
    description: "Screen width x height (e.g. 1920x1080)",
    aliases: ["screen resolution", "resolution", "screen", "display"],
  },
  {
    id: "geolocation",
    label: "Geolocation (Lat,Lng)",
    description: "Coordinates e.g. 40.7128,-74.0060 or 'auto'",
    aliases: ["geolocation", "geo", "coords", "coordinates", "lat,lng"],
  },
  {
    id: "extensions",
    label: "Extension IDs",
    description: "Comma-separated extension IDs or paths",
    aliases: ["extensions", "extension ids", "extension list"],
  },
  {
    id: "extension_set",
    label: "Extension Set",
    description: "Predefined extension bundle name",
    aliases: ["extension set", "extensions set", "extension pack"],
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    description: "Initial bookmarks (comma-separated URLs)",
    aliases: ["bookmarks", "bookmark list", "bookmark urls"],
  },
  {
    id: "bookmark_set",
    label: "Bookmark Set",
    description: "Predefined bookmark bundle name",
    aliases: ["bookmark set", "bookmarks set", "bookmark pack"],
  },
  {
    id: "tags",
    label: "Tags",
    description: "Tags for categorization (comma-separated)",
    aliases: ["tags", "tag", "labels"],
  },
  {
    id: "notes",
    label: "Notes",
    description: "Free-text notes or remarks",
    aliases: ["notes", "note", "comment", "comments", "description"],
  },
  {
    id: "cookie",
    label: "Cookies (JSON/Netscape)",
    description: "Cookie string or JSON array for session injection",
    aliases: ["cookie", "cookies", "cookie string", "session cookie"],
  },
];

export type RawRow = Record<string, any>;
export type ColumnMapping = Record<string, CanonicalField>;

export type BatchExtensionMode = "apply_all" | "extension_set" | "excel_column";

export interface BatchExtensionConfig {
  enabled: boolean;
  mode: BatchExtensionMode;
  selectedExtensionIds: string[];
  selectedSetId?: string;
  mergeWithExcel: boolean;
  strictMissingExtensions: boolean;
}

export type RowValidationStatus = "valid" | "invalid";
export type RowExecutionStatus = "pending" | "creating" | "completed" | "failed";

export interface RowValidationResult {
  rowIndex: number; // 1-based index (row 2 in spreadsheet = row 1 of data)
  raw: RawRow;
  status: RowValidationStatus;
  errors: string[];
  warnings: string[];
  parsedTitle: string;
  parsedFolder?: string;
  parsedProxy?: ProxyEntry | null;
  parsedStartUrls?: string[];
  parsedUserAgent?: string;
  parsedTimezone?: string;
  parsedLanguage?: string;
  parsedPlatform?: string;
  parsedScreenResolution?: { width: number; height: number };
  parsedGeolocation?: { latitude: number; longitude: number };
  parsedTags?: string[];
  parsedNotes?: string;
  parsedCookie?: string;
  parsedExtensions?: string[];
  resolvedExtensions?: string[];
  missingExtensions?: string[];
  executionStatus?: RowExecutionStatus;
  executionError?: string;
  createdProfileId?: string;
}

export interface BatchImportJob {
  id: string;
  accountId: string;
  fileName: string;
  fileSize: number;
  totalRows: number;
  createdAt: string;
  updatedAt: string;
  rows: RowValidationResult[];
  extensionConfig?: BatchExtensionConfig;
  status: "idle" | "ready" | "running" | "paused" | "completed" | "cancelled";
  completedCount: number;
  failedCount: number;
}
