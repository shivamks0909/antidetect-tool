import assert from "node:assert";
import { parseProxyInput, defaultProxyRegistry, GeolocationFormatHandler } from "../src/proxyParser.js";

console.log("=== RUNNING GEOLOCATION PROXY PARSER TEST SUITE ===");

// 1. Canonical Floppydata example
{
  const raw = "geolocation://tUhY0cjVkiqkHtHB:dnIjmKY2muiahDgv@geo.floppydata.com:10080:United States - 54";
  const parsed = parseProxyInput(raw);

  assert.strictEqual(parsed.raw_input, raw, "Verbatim raw_input must be preserved exactly");
  assert.strictEqual(parsed.scheme, "geolocation", "Scheme must be geolocation");
  assert.strictEqual(parsed.protocol, "geolocation", "Protocol must be geolocation");
  assert.strictEqual(parsed.username, "tUhY0cjVkiqkHtHB", "Username must match");
  assert.strictEqual(parsed.password, "dnIjmKY2muiahDgv", "Password must match");
  assert.strictEqual(parsed.host, "geo.floppydata.com", "Host must match");
  assert.strictEqual(parsed.port, 10080, "Port must match integer 10080");
  assert.strictEqual(parsed.location_label, "United States - 54", "Location label must not be confused with port");
  console.log("✔ Canonical Floppydata geolocation proxy parsed successfully");
}

// 2. Varied Location Labels (spaces, hyphens, parentheses, special characters)
{
  const cases = [
    {
      raw: "geolocation://user1:pass1@1.2.3.4:8080:US - California (Bay Area #9)",
      expectedLoc: "US - California (Bay Area #9)",
      expectedHost: "1.2.3.4",
      expectedPort: 8080,
    },
    {
      raw: "geolocation://alice:secret@proxy.global.net:3128:United Kingdom - London 01",
      expectedLoc: "United Kingdom - London 01",
      expectedHost: "proxy.global.net",
      expectedPort: 3128,
    },
    {
      raw: "geolocation://u:p@geo.provider.org:9050:FRANCE:PARIS:REGION-3",
      expectedLoc: "FRANCE:PARIS:REGION-3",
      expectedHost: "geo.provider.org",
      expectedPort: 9050,
    },
  ];

  for (const c of cases) {
    const res = parseProxyInput(c.raw);
    assert.strictEqual(res.raw_input, c.raw);
    assert.strictEqual(res.host, c.expectedHost);
    assert.strictEqual(res.port, c.expectedPort);
    assert.strictEqual(res.location_label, c.expectedLoc);
  }
  console.log("✔ Complex location labels with spaces, dashes, and extra colons parsed successfully");
}

// 3. Password containing colons or encoded characters
{
  const raw = "geolocation://admin:p@ss:w0rd:extra@geo.secure.com:10080:Germany - Berlin";
  const parsed = parseProxyInput(raw);
  assert.strictEqual(parsed.username, "admin");
  assert.strictEqual(parsed.password, "p@ss:w0rd:extra");
  assert.strictEqual(parsed.host, "geo.secure.com");
  assert.strictEqual(parsed.port, 10080);
  assert.strictEqual(parsed.location_label, "Germany - Berlin");
  console.log("✔ Password with internal colons parsed successfully");
}

// 4. Object input preservation
{
  const obj = {
    raw_input: "geolocation://user:pass@host:10080:Label",
    host: "geo.floppydata.com",
    port: 10080,
    scheme: "geolocation",
    username: "testuser",
    password: "testpass",
    location_label: "United States - 54",
  };
  const parsed = parseProxyInput(obj);
  assert.strictEqual(parsed.host, "geo.floppydata.com");
  assert.strictEqual(parsed.port, 10080);
  assert.strictEqual(parsed.location_label, "United States - 54");
  assert.strictEqual(parsed.raw_input, "geolocation://user:pass@host:10080:Label");
  console.log("✔ Discrete object input parsed and normalized with location_label intact");
}

// 5. Strict Error & Malformed Validation
{
  const invalidCases = [
    { raw: "geolocation://missing_at_separator", errorMatch: /missing credentials delimiter/ },
    { raw: "geolocation://onlyuser@host:1080:Location", errorMatch: /missing password delimiter/ },
    { raw: "geolocation://:pass@host:1080:Location", errorMatch: /username cannot be empty/ },
    { raw: "geolocation://user:@host:1080:Location", errorMatch: /password cannot be empty/ },
    { raw: "geolocation://user:pass@:1080:Location", errorMatch: /host cannot be empty/ },
    { raw: "geolocation://user:pass@host", errorMatch: /missing host:port delimiter/ },
    { raw: "geolocation://user:pass@host:1080", errorMatch: /missing location label delimiter/ },
    { raw: "geolocation://user:pass@host:notaport:Location", errorMatch: /Invalid geolocation proxy port/ },
    { raw: "geolocation://user:pass@host:999999:Location", errorMatch: /Port must be between 1 and 65535/ },
    { raw: "geolocation://user:pass@host:1080:   ", errorMatch: /location metadata cannot be empty/ },
  ];

  for (const inv of invalidCases) {
    assert.throws(
      () => parseProxyInput(inv.raw),
      inv.errorMatch,
      `Expected error matching ${inv.errorMatch} for input: ${inv.raw}`
    );
  }
  console.log("✔ All 10 malformed/invalid geolocation proxy tests rejected as expected");
}

// 6. Regression: standard formats remain fully intact
{
  const s5 = parseProxyInput("socks5://u:p@127.0.0.1:1080");
  assert.strictEqual(s5.protocol, "socks5");
  assert.strictEqual(s5.host, "127.0.0.1");
  assert.strictEqual(s5.port, 1080);
  assert.strictEqual(s5.location_label, null);

  const http = parseProxyInput("http://proxy.company.com:8080");
  assert.strictEqual(http.protocol, "http");
  assert.strictEqual(http.host, "proxy.company.com");
  assert.strictEqual(http.port, 8080);

  const userPassAt = parseProxyInput("myuser:mypass@192.168.0.5:3128");
  assert.strictEqual(userPassAt.username, "myuser");
  assert.strictEqual(userPassAt.password, "mypass");
  assert.strictEqual(userPassAt.host, "192.168.0.5");
  assert.strictEqual(userPassAt.port, 3128);

  const colon4 = parseProxyInput("host.com:8000:alice:bob");
  assert.strictEqual(colon4.host, "host.com");
  assert.strictEqual(colon4.port, 8000);
  assert.strictEqual(colon4.username, "alice");
  assert.strictEqual(colon4.password, "bob");

  console.log("✔ Standard proxy formats regression tests passed");
}

console.log("\n=== ALL GEOLOCATION PROXY PARSER TESTS PASSED! ===");
