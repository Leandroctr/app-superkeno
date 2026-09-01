import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSettingsPayload,
  resolveTenantSettings,
} from "../lib/admin-settings-payload.ts";
import {
  extractClientIp,
  hashRateLimitKey,
  normalizeAccountIdentifier,
  normalizeOneSignalId,
} from "../lib/request-security.ts";
import nextConfig, {
  contentSecurityPolicy,
  securityHeaders,
} from "../next.config.ts";

test("M-1 ignores tenantDomain supplied by the client", () => {
  const normalized = normalizeSettingsPayload({
    id: "row-id",
    tenantDomain: "attacker.example",
    appName: " OBA ",
  });

  assert.equal("tenantDomain" in normalized, false);
  assert.equal(normalized.appName, "OBA");
  assert.equal(normalized.id, "row-id");
});

test("M-1 missing tenantDomain cannot become an empty persisted tenant", () => {
  const serverTenant = "pwa.app-obapremios.com";
  const settings = resolveTenantSettings({ appName: "OBA" }, serverTenant);

  assert.equal(settings.tenantDomain, serverTenant);
});

test("M-1 server tenant overrides an attacker tenant on the persisted object", () => {
  const settings = resolveTenantSettings(
    { appName: "OBA", tenantDomain: "pwa.attacker.example" },
    "pwa.app-obapremios.com",
  );

  assert.equal(settings.tenantDomain, "pwa.app-obapremios.com");
});

test("request IP uses Vercel's canonical forwarded header and validates IPs", () => {
  const headers = new Headers({
    "x-vercel-forwarded-for": "203.0.113.10",
    "x-forwarded-for": "198.51.100.1",
  });

  assert.equal(extractClientIp(headers), "203.0.113.10");
  assert.equal(
    extractClientIp(new Headers({ "x-forwarded-for": "spoofed" })),
    "unknown",
  );
});

test("IPv6 rate-limit identity is normalized to a stable /64 prefix", () => {
  const first = extractClientIp(
    new Headers({
      "x-vercel-forwarded-for": "2001:db8:abcd:12:1111:2222:3333:4444",
    }),
  );
  const second = extractClientIp(
    new Headers({
      "x-vercel-forwarded-for": "2001:db8:abcd:12:aaaa:bbbb:cccc:dddd",
    }),
  );

  assert.equal(first, "2001:0db8:abcd:0012::/64");
  assert.equal(second, first);
  assert.notEqual(
    extractClientIp(
      new Headers({ "x-vercel-forwarded-for": "2001:db8:abcd:13::1" }),
    ),
    first,
  );
});

test("rate-limit keys are deterministic HMACs without plaintext identifiers", () => {
  const email = normalizeAccountIdentifier(" Admin@Example.COM ");
  const key = hashRateLimitKey("admin_login_account", email, "test-secret");

  assert.equal(email, "admin@example.com");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key.includes("admin"), false);
});

test("A-5 accepts canonical OneSignal UUIDs and rejects malformed values", () => {
  assert.equal(
    normalizeOneSignalId(" 123E4567-E89B-12D3-A456-426614174000 "),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.equal(normalizeOneSignalId("not-a-subscription"), null);
  assert.equal(normalizeOneSignalId("123e4567-e89b-12d3-7456-426614174000"), null);
});

test("M-2 exposes the required security headers and frame protection", async () => {
  const configuredHeaders = await nextConfig.headers?.();
  const globalRule = configuredHeaders?.find((rule) => rule.source === "/:path*");
  const headerMap = new Map(globalRule?.headers.map(({ key, value }) => [key, value]));

  for (const { key, value } of securityHeaders) {
    assert.equal(headerMap.get(key), value);
  }

  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /https:\/\/cdn\.onesignal\.com/);
  assert.match(contentSecurityPolicy, /https:\/\/\*\.supabase\.co/);
  assert.match(contentSecurityPolicy, /worker-src 'self' blob:/);
});
