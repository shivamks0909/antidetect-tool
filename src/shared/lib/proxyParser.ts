/**
 * Universal Proxy Parser with Extensible Format Registry (TypeScript)
 * Guarantees exact raw_input preservation alongside normalized fields:
 * scheme, protocol, host, port, username, password, location_label.
 * Shared across manual input, batch spreadsheet import, and UI components.
 */

export interface ParsedProxyResult {
  raw_input: string;
  scheme: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  location_label: string | null;
}

export interface ProxyFormatHandler {
  matches(rawString: string): boolean;
  parse(rawString: string, fallbackProtocol?: string): ParsedProxyResult;
}

export class ProxyFormatRegistry {
  private handlers: ProxyFormatHandler[] = [];

  register(handler: ProxyFormatHandler): void {
    this.handlers.push(handler);
  }

  parse(input: unknown, fallbackProtocol = "http"): ParsedProxyResult {
    if (!input) {
      throw new Error("Proxy input cannot be empty");
    }

    if (typeof input === "object" && input !== null) {
      const obj = input as Record<string, any>;
      const raw_input = obj.raw_input || obj.proxy_raw || `${obj.host || ""}:${obj.port || ""}`;
      const host = (obj.host || obj.proxy_host || "").trim();
      const portNum = parseInt(obj.port || obj.proxy_port, 10);
      const scheme = (obj.scheme || obj.protocol || obj.proxy_kind || fallbackProtocol || "http").toLowerCase().replace(":", "");
      const protocol = (obj.protocol || scheme).toLowerCase().replace(":", "");
      const username = (obj.username || obj.proxy_user) ? String(obj.username || obj.proxy_user).trim() : null;
      const password = (obj.password || obj.proxy_pass) ? String(obj.password || obj.proxy_pass) : null;
      const location_label = (obj.location_label || obj.location || obj.label) ? String(obj.location_label || obj.location || obj.label).trim() : null;

      if (!host) throw new Error("Proxy host is required");
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) throw new Error(`Invalid proxy port: ${obj.port}`);

      return {
        raw_input: String(raw_input).trim(),
        scheme,
        protocol,
        host,
        port: portNum,
        username,
        password,
        location_label,
      };
    }

    const rawString = String(input).trim();
    if (!rawString) {
      throw new Error("Proxy input cannot be empty");
    }

    for (const handler of this.handlers) {
      if (handler.matches(rawString)) {
        return handler.parse(rawString, fallbackProtocol);
      }
    }

    throw new Error(`Unrecognized proxy string syntax: "${rawString}"`);
  }
}

/**
 * Geolocation Proxy Format Handler
 * Format: geolocation://USERNAME:PASSWORD@HOST:PORT:LOCATION_LABEL
 * Example: geolocation://tUhY0cjVkiqkHtHB:dnIjmKY2muiahDgv@geo.floppydata.com:10080:United States - 54
 */
export class GeolocationFormatHandler implements ProxyFormatHandler {
  matches(rawString: string): boolean {
    return rawString.toLowerCase().startsWith("geolocation://");
  }

  parse(rawString: string): ParsedProxyResult {
    const afterScheme = rawString.slice("geolocation://".length);
    if (!afterScheme.includes("@")) {
      throw new Error("Malformed geolocation proxy: missing credentials delimiter (@)");
    }

    const atIdx = afterScheme.lastIndexOf("@");
    const authPart = afterScheme.slice(0, atIdx);
    const restPart = afterScheme.slice(atIdx + 1);

    const colonIdx = authPart.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Malformed geolocation proxy: missing password delimiter (:) in credentials");
    }

    const username = decodeURIComponent(authPart.slice(0, colonIdx)).trim();
    const password = decodeURIComponent(authPart.slice(colonIdx + 1));

    if (!username) {
      throw new Error("Geolocation proxy username cannot be empty");
    }
    if (!password) {
      throw new Error("Geolocation proxy password cannot be empty");
    }

    // Parse HOST:PORT:LOCATION_LABEL
    const hostColonIdx = restPart.indexOf(":");
    if (hostColonIdx === -1) {
      throw new Error("Malformed geolocation proxy: missing host:port delimiter");
    }

    const host = restPart.slice(0, hostColonIdx).trim();
    if (!host) {
      throw new Error("Geolocation proxy host cannot be empty");
    }

    const remainder = restPart.slice(hostColonIdx + 1);
    const portColonIdx = remainder.indexOf(":");
    if (portColonIdx === -1) {
      throw new Error("Malformed geolocation proxy: missing location label delimiter (:LOCATION_LABEL)");
    }

    const portStr = remainder.slice(0, portColonIdx).trim();
    const location_label = remainder.slice(portColonIdx + 1).trim();

    const portNum = parseInt(portStr, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(`Invalid geolocation proxy port: "${portStr}". Port must be between 1 and 65535.`);
    }

    if (!location_label) {
      throw new Error("Geolocation proxy location metadata cannot be empty");
    }

    return {
      raw_input: rawString,
      scheme: "geolocation",
      protocol: "geolocation",
      host,
      port: portNum,
      username,
      password,
      location_label,
    };
  }
}

/**
 * Standard URI Format Handler
 * Handles: socks5://user:pass@host:port, http://host:port, https://...
 */
export class StandardUriFormatHandler implements ProxyFormatHandler {
  matches(rawString: string): boolean {
    return rawString.includes("://") && !rawString.toLowerCase().startsWith("geolocation://");
  }

  parse(rawString: string, _fallbackProtocol = "http"): ParsedProxyResult {
    try {
      const url = new URL(rawString);
      const protocol = url.protocol.replace(":", "").toLowerCase();
      const host = url.hostname;
      let port = parseInt(url.port, 10);
      const username = url.username ? decodeURIComponent(url.username) : null;
      const password = url.password ? decodeURIComponent(url.password) : null;

      if (!host) throw new Error("Invalid host in proxy URI");
      if (isNaN(port) || port < 1 || port > 65535) {
        port = protocol === "socks5" || protocol === "socks4" ? 1080 : 8080;
      }

      return {
        raw_input: rawString,
        scheme: protocol,
        protocol,
        host,
        port,
        username,
        password,
        location_label: null,
      };
    } catch (err: any) {
      throw new Error(`Invalid proxy URI: ${err.message}`);
    }
  }
}

/**
 * UserPassAtHostPort Handler
 * Handles: username:password@host:port
 */
export class UserPassAtHostPortHandler implements ProxyFormatHandler {
  matches(rawString: string): boolean {
    return rawString.includes("@") && !rawString.includes("://");
  }

  parse(rawString: string, fallbackProtocol = "http"): ParsedProxyResult {
    const protocol = (fallbackProtocol || "http").toLowerCase().replace(":", "");
    const [authPart, hostPortPart] = rawString.split("@");
    if (authPart && hostPortPart) {
      const [u, ...pParts] = authPart.split(":");
      const username = u || null;
      const password = pParts.join(":") || null;

      const [h, pt] = hostPortPart.split(":");
      const host = (h || "").trim();
      const port = parseInt(pt, 10);

      if (!host) throw new Error("Missing host in proxy string");
      if (isNaN(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${pt}`);

      return {
        raw_input: rawString,
        scheme: protocol,
        protocol,
        host,
        port,
        username,
        password,
        location_label: null,
      };
    }
    throw new Error(`Invalid user:pass@host:port syntax: "${rawString}"`);
  }
}

/**
 * Colon Delimited Format Handler
 * Handles: host:port:username:password, user:pass:host:port, host:port, host:port:username
 */
export class ColonDelimitedHandler implements ProxyFormatHandler {
  matches(rawString: string): boolean {
    return rawString.includes(":") && !rawString.includes("@") && !rawString.includes("://");
  }

  parse(rawString: string, fallbackProtocol = "http"): ParsedProxyResult {
    const protocol = (fallbackProtocol || "http").toLowerCase().replace(":", "");
    const parts = rawString.split(":");
    let host = "";
    let port = 0;
    let username: string | null = null;
    let password: string | null = null;

    if (parts.length >= 4) {
      const testPort = parseInt(parts[1], 10);
      if (!isNaN(testPort) && testPort >= 1 && testPort <= 65535) {
        host = parts[0].trim();
        port = testPort;
        username = parts[2].trim();
        password = parts.slice(3).join(":");
      } else {
        const altPort = parseInt(parts[3], 10);
        if (!isNaN(altPort) && altPort >= 1 && altPort <= 65535) {
          username = parts[0].trim();
          password = parts[1];
          host = parts[2].trim();
          port = altPort;
        } else {
          throw new Error("Unable to parse colon-delimited proxy format");
        }
      }
    } else if (parts.length === 2) {
      host = parts[0].trim();
      port = parseInt(parts[1], 10);
      if (!host) throw new Error("Host cannot be empty");
      if (isNaN(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${parts[1]}`);
    } else if (parts.length === 3) {
      host = parts[0].trim();
      port = parseInt(parts[1], 10);
      username = parts[2].trim();
      if (isNaN(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${parts[1]}`);
    } else {
      throw new Error(`Unrecognized proxy string syntax: "${rawString}"`);
    }

    return {
      raw_input: rawString,
      scheme: protocol,
      protocol,
      host,
      port,
      username,
      password,
      location_label: null,
    };
  }
}

export const defaultProxyRegistry = new ProxyFormatRegistry();
defaultProxyRegistry.register(new GeolocationFormatHandler());
defaultProxyRegistry.register(new StandardUriFormatHandler());
defaultProxyRegistry.register(new UserPassAtHostPortHandler());
defaultProxyRegistry.register(new ColonDelimitedHandler());

export function parseProxyInput(input: unknown, fallbackProtocol = "http"): ParsedProxyResult {
  return defaultProxyRegistry.parse(input, fallbackProtocol);
}
