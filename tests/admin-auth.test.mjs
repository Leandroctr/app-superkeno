import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const guardedFiles = [
  "app/admin/page.tsx",
  "app/admin/settings/page.tsx",
  "app/api/admin/settings/route.ts",
  "app/api/admin/upload/route.ts",
  "app/api/push/send/route.ts",
];

test("A-1 removes the deterministic legacy session implementation", () => {
  assert.equal(existsSync("lib/admin-auth.ts"), false);
});

test("A-1 removes ADMIN_EMAIL and ADMIN_PASSWORD from functional source", () => {
  const source = [
    read("app/admin/login/page.tsx"),
    read("lib/admin-identity.server.ts"),
    read("lib/supabase/admin-session.ts"),
    ...guardedFiles.map(read),
  ].join("\n");

  assert.doesNotMatch(source, /ADMIN_EMAIL|ADMIN_PASSWORD/);
  assert.doesNotMatch(source, /createHash\(|sha256/i);
});

test("login requires both Supabase Auth and tenant authorization", () => {
  const source = read("app/admin/login/page.tsx");

  assert.match(source, /signInWithPassword/);
  assert.match(source, /getAuthorizedAdminForTenant/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(source, /validateAdminCredentials|createAdminSession|legacy/i);
});

test("all five CETEC guards use only requireTenantAccess", () => {
  for (const path of guardedFiles) {
    const source = read(path);
    assert.match(source, /requireTenantAccess\(\)/, path);
    assert.doesNotMatch(
      source,
      /isAdminAuthenticated|hasLegacySession|currentAdmin\s*\|\|/,
      path,
    );
  }
});

test("identity is revalidated by Supabase Auth instead of trusting getSession", () => {
  const source = read("lib/admin-identity.server.ts");

  assert.match(source, /auth\.getUser\(\)/);
  assert.doesNotMatch(source, /auth\.getSession\(\)/);
  assert.match(source, /!data\.active/);
});

test("only super_admin and admin are accepted at runtime", () => {
  const source = read("lib/admin-identity.server.ts");

  assert.match(source, /value === "super_admin" \|\| value === "admin"/);
  assert.match(source, /admin\.role === "super_admin"/);
  assert.match(source, /admin_tenant_access/);
  assert.match(source, /\.eq\("active", true\)/);
});

test("Supabase admin cookies use the required security attributes", () => {
  const source = read("lib/supabase/admin-session.ts");

  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: "lax"/);
  assert.match(source, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(source, /cookieOptions: adminSessionCookieOptions/);
});

test("proxy refreshes Supabase sessions and never authorizes with getSession", () => {
  const source = read("lib/supabase/proxy.ts");

  assert.match(source, /auth\.getClaims\(\)/);
  assert.doesNotMatch(source, /auth\.getSession\(\)/);
  assert.match(source, /Cache-Control|responseHeaders/);
});

test("the obsolete admin_session cookie is only expired, never read as auth", () => {
  const source = read("lib/supabase/proxy.ts");

  assert.match(source, /obsoleteLegacyCookieName = "admin_session"/);
  assert.match(source, /maxAge: 0/);
  assert.doesNotMatch(source, /request\.cookies\.get\(obsoleteLegacyCookieName\)/);
});

test("logout performs remote revocation and local cleanup fallback", () => {
  const source = read("app/api/admin/logout/route.ts");

  assert.match(source, /signOut\(\{ scope: "global" \}\)/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /Cache-Control/);
});
