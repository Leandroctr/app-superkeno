import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const runRealTests = process.env.RUN_REAL_ADMIN_AUTH_TESTS === "1";

if (!runRealTests) {
  test("real A-1/A-2/A-3 integration suite", { skip: "set RUN_REAL_ADMIN_AUTH_TESTS=1" }, () => {});
} else {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.ADMIN_AUTH_TEST_BASE_URL;
  const tenantDomain = process.env.ADMIN_AUTH_TEST_TENANT;

  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ADMIN_AUTH_TEST_BASE_URL: baseUrl,
    ADMIN_AUTH_TEST_TENANT: tenantDomain,
  })) {
    assert.ok(value, `${name} is required`);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomBytes(8).toString("hex");
  const password = `C3tec!${randomBytes(24).toString("base64url")}`;
  const createdAuthUserIds = [];
  const createdAdminUserIds = [];
  const createdStoragePaths = [];
  const identities = {};
  const sessions = {};
  const factors = {};

  function decodeBase32(value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const normalized = value.toUpperCase().replace(/=+$/g, "");
    let bits = "";

    for (const character of normalized) {
      const index = alphabet.indexOf(character);
      assert.notEqual(index, -1, "invalid base32 TOTP secret");
      bits += index.toString(2).padStart(5, "0");
    }

    const bytes = [];
    for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
      bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
    }
    return Buffer.from(bytes);
  }

  function totpCode(secret, timestamp = Date.now()) {
    const counter = BigInt(Math.floor(timestamp / 30_000));
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(counter);
    const digest = createHmac("sha1", decodeBase32(secret))
      .update(buffer)
      .digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, "0");
  }

  function applyCookies(jar, cookiesToSet) {
    for (const { name, value, options = {} } of cookiesToSet) {
      if (options.maxAge === 0 || value === "") {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
  }

  function cookieHeader(jar) {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  function applyResponseCookies(jar, response) {
    const setCookies = response.headers.getSetCookie?.() || [];

    for (const setCookie of setCookies) {
      const [pair, ...attributes] = setCookie.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some((attribute) =>
        /^\s*max-age=0\s*$/i.test(attribute),
      );

      if (expired || value === "") {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }

    return setCookies;
  }

  function createSsrClient(jar) {
    return createServerClient(supabaseUrl, anonKey, {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      },
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => applyCookies(jar, cookiesToSet),
      },
    });
  }

  async function signIn(email) {
    const jar = new Map();
    const client = createSsrClient(jar);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(error);
    assert.ok(data.user);
    return { client, jar, user: data.user, session: data.session };
  }

  async function enrollTotp(sessionState) {
    const { data: enrollment, error: enrollmentError } =
      await sessionState.client.auth.mfa.enroll({ factorType: "totp" });
    assert.ifError(enrollmentError);
    assert.ok(enrollment.totp.secret);

    const { data: challenge, error: challengeError } =
      await sessionState.client.auth.mfa.challenge({ factorId: enrollment.id });
    assert.ifError(challengeError);

    const { error: verifyError } = await sessionState.client.auth.mfa.verify({
      factorId: enrollment.id,
      challengeId: challenge.id,
      code: totpCode(enrollment.totp.secret),
    });
    assert.ifError(verifyError);

    const { data: assurance, error: assuranceError } =
      await sessionState.client.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.ifError(assuranceError);
    assert.equal(assurance.currentLevel, "aal2");
    assert.equal(assurance.nextLevel, "aal2");

    return { id: enrollment.id, secret: enrollment.totp.secret };
  }

  async function challengeTotp(sessionState, enrolledFactor, code) {
    const { data: challenge, error: challengeError } =
      await sessionState.client.auth.mfa.challenge({ factorId: enrolledFactor.id });
    assert.ifError(challengeError);
    return sessionState.client.auth.mfa.verify({
      factorId: enrolledFactor.id,
      challengeId: challenge.id,
      code: code || totpCode(enrolledFactor.secret),
    });
  }

  async function appRequest(path, options = {}, jar = new Map()) {
    const headers = new Headers(options.headers);
    const cookies = cookieHeader(jar);

    if (cookies) {
      headers.set("Cookie", cookies);
    }

    return fetch(new URL(path, baseUrl), {
      ...options,
      headers,
      redirect: "manual",
    });
  }

  async function createAuthIdentity(label) {
    const email = `cetec-${label}-${suffix}@example.com`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.ifError(error);
    assert.ok(data.user);
    createdAuthUserIds.push(data.user.id);
    identities[label] = { email, authUserId: data.user.id };
    return identities[label];
  }

  async function createAdminIdentity(label, role, grantedTenant) {
    const identity = await createAuthIdentity(label);
    const { data, error } = await adminClient
      .from("admin_users")
      .insert({
        auth_user_id: identity.authUserId,
        email: identity.email,
        name: `CETEC ${label}`,
        role,
        active: true,
      })
      .select("id")
      .single();
    assert.ifError(error);
    createdAdminUserIds.push(data.id);
    identity.adminUserId = data.id;

    if (grantedTenant) {
      const { error: accessError } = await adminClient
        .from("admin_tenant_access")
        .insert({
          admin_user_id: data.id,
          tenant_domain: grantedTenant,
          active: true,
        });
      assert.ifError(accessError);
    }

    return identity;
  }

  function makeExpiredJar(sessionJar, authUserId) {
    const authCookie = [...sessionJar.keys()].find((name) => name.includes("-auth-token"));
    assert.ok(authCookie, "Supabase auth cookie not found");
    const baseCookieName = authCookie.replace(/\.\d+$/, "");
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const expiredJwt = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: authUserId,
      exp: 1,
    })}.invalid`;
    const value = `base64-${Buffer.from(
      JSON.stringify({
        access_token: expiredJwt,
        refresh_token: "expired-and-invalid",
        expires_at: 1,
        expires_in: 0,
        token_type: "bearer",
      }),
    ).toString("base64url")}`;
    return new Map([[baseCookieName, value]]);
  }

  before(async () => {
    await createAdminIdentity("super", "super_admin", null);
    await createAdminIdentity("allowed", "admin", tenantDomain);
    await createAdminIdentity("denied", "admin", "pwa.app-bigpix.com");
    await createAdminIdentity("disabled", "admin", tenantDomain);
    await createAuthIdentity("nonadmin");

    sessions.super = await signIn(identities.super.email);
    factors.super = await enrollTotp(sessions.super);
    sessions.superAal1 = await signIn(identities.super.email);
    sessions.superChallenge = await signIn(identities.super.email);
    sessions.allowed = await signIn(identities.allowed.email);
    factors.allowed = await enrollTotp(sessions.allowed);
    sessions.allowedAal1 = await signIn(identities.allowed.email);
    sessions.denied = await signIn(identities.denied.email);
    factors.denied = await enrollTotp(sessions.denied);
    sessions.disabled = await signIn(identities.disabled.email);
    factors.disabled = await enrollTotp(sessions.disabled);
    sessions.nonadmin = await signIn(identities.nonadmin.email);
  });

  after(async () => {
    if (createdStoragePaths.length > 0) {
      const { error } = await adminClient.storage
        .from("app-assets")
        .remove(createdStoragePaths);
      assert.ifError(error);
    }

    if (createdAdminUserIds.length > 0) {
      await adminClient
        .from("admin_tenant_access")
        .delete()
        .in("admin_user_id", createdAdminUserIds);
      await adminClient.from("admin_users").delete().in("id", createdAdminUserIds);
    }

    for (const userId of createdAuthUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  describe("A-1/A-2/A-3 real authorization matrix", { concurrency: false }, () => {
    test("1. super_admin authenticates with Supabase Auth", () => {
      assert.ok(sessions.super.session?.access_token);
      assert.ok(sessions.super.session?.expires_at > Math.floor(Date.now() / 1000));
    });

    test("A-2: TOTP enrollment promoted the disposable session to aal2", async () => {
      assert.ok(factors.super.id);
      const assurance =
        await sessions.super.client.auth.mfa.getAuthenticatorAssuranceLevel();
      assert.ifError(assurance.error);
      assert.equal(assurance.data.currentLevel, "aal2");
      assert.equal(assurance.data.nextLevel, "aal2");
    });

    test("A-2: an existing aal2 session skips the MFA gate", async () => {
      const response = await appRequest("/admin/mfa", {}, sessions.super.jar);
      assert.equal(response.status, 307);
      assert.match(response.headers.get("location") || "", /\/admin$/);
    });

    test("A-2: password-only super_admin remains blocked at aal1", async () => {
      const assurance =
        await sessions.superAal1.client.auth.mfa.getAuthenticatorAssuranceLevel();
      assert.ifError(assurance.error);
      assert.equal(assurance.data.currentLevel, "aal1");
      assert.equal(assurance.data.nextLevel, "aal2");

      const [admin, settings] = await Promise.all([
        appRequest("/admin", {}, sessions.superAal1.jar),
        appRequest("/admin/settings", {}, sessions.superAal1.jar),
      ]);
      assert.equal(admin.status, 307);
      assert.equal(settings.status, 307);
    });

    test("A-2: authorized aal1 admin can open only the MFA gate", async () => {
      const response = await appRequest("/admin/mfa", {}, sessions.allowedAal1.jar);
      assert.equal(response.status, 200);
    });

    test("A-2: users without tenant authorization cannot start MFA", async () => {
      const [nonadmin, denied] = await Promise.all([
        appRequest("/admin/mfa", {}, sessions.nonadmin.jar),
        appRequest("/admin/mfa", {}, sessions.denied.jar),
      ]);
      assert.equal(nonadmin.status, 307);
      assert.equal(denied.status, 307);
    });

    test("A-2: all administrative APIs reject aal1 before business work", async () => {
      const checks = [
        ["/api/admin/settings", { method: "POST" }, 401],
        ["/api/admin/upload", { method: "POST" }, 401],
        ["/api/push/send", { method: "POST" }, 401],
      ];

      for (const [path, options, status] of checks) {
        const response = await appRequest(path, options, sessions.superAal1.jar);
        assert.equal(response.status, status, path);
      }
    });

    test("A-2: a correct TOTP challenge promotes aal1 to aal2", async () => {
      const { error } = await challengeTotp(
        sessions.superChallenge,
        factors.super,
      );
      assert.ifError(error);
      const assurance =
        await sessions.superChallenge.client.auth.mfa.getAuthenticatorAssuranceLevel();
      assert.ifError(assurance.error);
      assert.equal(assurance.data.currentLevel, "aal2");
      const response = await appRequest(
        "/admin",
        {},
        sessions.superChallenge.jar,
      );
      assert.equal(response.status, 200);
    });

    test("A-2: an incorrect TOTP code leaves the session blocked", async () => {
      const validCode = totpCode(factors.allowed.secret);
      const invalidCode = String((Number(validCode) + 1) % 1_000_000).padStart(
        6,
        "0",
      );
      const { error } = await challengeTotp(
        sessions.allowedAal1,
        factors.allowed,
        invalidCode,
      );
      assert.ok(error);
      const assurance =
        await sessions.allowedAal1.client.auth.mfa.getAuthenticatorAssuranceLevel();
      assert.ifError(assurance.error);
      assert.equal(assurance.data.currentLevel, "aal1");
      const response = await appRequest("/admin", {}, sessions.allowedAal1.jar);
      assert.equal(response.status, 307);
    });

    test("2. super_admin accesses the tenant admin pages", async () => {
      const [admin, settings] = await Promise.all([
        appRequest("/admin", {}, sessions.super.jar),
        appRequest("/admin/settings", {}, sessions.super.jar),
      ]);
      assert.equal(admin.status, 200);
      assert.equal(settings.status, 200);
    });

    test("3. super_admin reaches authorized administrative APIs", async () => {
      const settings = await appRequest(
        "/api/admin/settings",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
        sessions.super.jar,
      );
      const upload = await appRequest(
        "/api/admin/upload",
        { method: "POST", body: new FormData() },
        sessions.super.jar,
      );
      const push = await appRequest(
        "/api/push/send",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
        sessions.super.jar,
      );
      assert.equal(settings.status, 400);
      assert.equal(upload.status, 400);
      // O guard passou; OneSignal esta deliberadamente desconectado nesta
      // etapa, portanto a rota encerra em 503 antes de validar o JSON.
      assert.equal(push.status, 503);
    });

    test("3b. authorized upload writes only the validated PNG path and is publicly readable", async () => {
      const png = await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 4,
          background: { r: 15, g: 90, b: 180, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const formData = new FormData();
      formData.append("kind", "logo");
      formData.append(
        "file",
        new Blob([png], { type: "image/png" }),
        "cetec-upload-test.png",
      );

      const response = await appRequest(
        "/api/admin/upload",
        { method: "POST", body: formData },
        sessions.super.jar,
      );
      const result = await response.json();

      if (result?.path) {
        createdStoragePaths.push(result.path);
      }

      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true);
      assert.match(
        result.path,
        /^logo\/\d+-[0-9a-f-]{36}-cetec-upload-test\.png$/,
      );
      assert.match(result.url, /\/storage\/v1\/object\/public\/app-assets\/logo\//);

      const publicResponse = await fetch(result.url);
      const publicBytes = new Uint8Array(await publicResponse.arrayBuffer());
      assert.equal(publicResponse.status, 200);
      assert.equal(publicResponse.headers.get("content-type"), "image/png");
      assert.deepEqual(
        [...publicBytes.subarray(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    });

    test("4. admin authenticates with Supabase Auth", () => {
      assert.ok(sessions.allowed.session?.access_token);
    });

    test("5. admin accesses an explicitly granted tenant", async () => {
      const response = await appRequest("/admin", {}, sessions.allowed.jar);
      assert.equal(response.status, 200);
    });

    test("6. admin is blocked from a tenant without an active grant", async () => {
      const page = await appRequest("/admin", {}, sessions.denied.jar);
      const api = await appRequest(
        "/api/admin/settings",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
        sessions.denied.jar,
      );
      assert.equal(page.status, 307);
      assert.equal(api.status, 401);
    });

    test("7. tenant selection remains exclusively server-side", () => {
      const route = readFileSync("app/api/admin/settings/route.ts", "utf8");
      const payload = readFileSync("lib/admin-settings-payload.ts", "utf8");
      assert.match(route, /extractHostname\(appConfig\.publicUrl\)/);
      assert.match(
        route,
        /resolveTenantSettings\(\s*\{\s*\.\.\.payload,\s*splashHtmlUrl\s*\},\s*hostname,\s*\)/s,
      );
      assert.doesNotMatch(payload, /tenantDomain:\s*payload\.tenantDomain/);
    });

    test("8. authenticated admin cannot manipulate authorization tables", async () => {
      const client = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await client.auth.signInWithPassword({
        email: identities.allowed.email,
        password,
      });
      assert.ifError(signInError);

      let roleEscalated = false;
      let accessInserted = false;

      try {
        const roleAttempt = await client
          .from("admin_users")
          .update({ role: "super_admin" })
          .eq("id", identities.allowed.adminUserId)
          .select("id");
        roleEscalated = !roleAttempt.error && (roleAttempt.data?.length || 0) > 0;

        const accessAttempt = await client
          .from("admin_tenant_access")
          .insert({
            admin_user_id: identities.allowed.adminUserId,
            tenant_domain: "attacker.invalid",
            active: true,
          })
          .select("id");
        accessInserted = !accessAttempt.error && (accessAttempt.data?.length || 0) > 0;
      } finally {
        await adminClient
          .from("admin_users")
          .update({ role: "admin" })
          .eq("id", identities.allowed.adminUserId);
        await adminClient
          .from("admin_tenant_access")
          .delete()
          .eq("admin_user_id", identities.allowed.adminUserId)
          .eq("tenant_domain", "attacker.invalid");
      }

      assert.equal(roleEscalated, false);
      assert.equal(accessInserted, false);
    });

    test("9. valid Supabase user without admin_users is blocked", async () => {
      const page = await appRequest("/admin", {}, sessions.nonadmin.jar);
      const api = await appRequest(
        "/api/admin/settings",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
        sessions.nonadmin.jar,
      );
      assert.equal(page.status, 307);
      assert.equal(api.status, 401);
    });

    test("10. missing session is blocked", async () => {
      const page = await appRequest("/admin");
      const api = await appRequest("/api/admin/settings", { method: "POST" });
      assert.equal(page.status, 307);
      assert.equal(api.status, 401);
    });

    test("11. expired session with no valid refresh token is blocked", async () => {
      const expiredJar = makeExpiredJar(
        sessions.allowed.jar,
        identities.allowed.authUserId,
      );
      const response = await appRequest("/admin", {}, expiredJar);
      assert.equal(response.status, 307);
    });

    test("12. disabled Auth user loses administrative access", async () => {
      const { error } = await adminClient.auth.admin.updateUserById(
        identities.disabled.authUserId,
        { ban_duration: "876000h" },
      );
      assert.ifError(error);
      const [adminPage, mfaPage] = await Promise.all([
        appRequest("/admin", {}, sessions.disabled.jar),
        appRequest("/admin/mfa", {}, sessions.disabled.jar),
      ]);
      assert.equal(adminPage.status, 307);
      assert.equal(mfaPage.status, 307);
    });

    test("13. ADMIN_EMAIL and ADMIN_PASSWORD cannot grant access", () => {
      const functionalSource = [
        readFileSync("app/admin/login/page.tsx", "utf8"),
        readFileSync("lib/admin-identity.server.ts", "utf8"),
        readFileSync("lib/supabase/admin-session.ts", "utf8"),
      ].join("\n");
      assert.doesNotMatch(functionalSource, /ADMIN_EMAIL|ADMIN_PASSWORD/);
    });

    test("14. the former deterministic cookie is rejected and expired", async () => {
      const legacyJar = new Map([["admin_session", "legacy-cookie-cannot-authorize"]]);
      const response = await appRequest("/admin", {}, legacyJar);
      assert.equal(response.status, 307);
      const setCookies = response.headers.getSetCookie?.() || [];
      assert.ok(
        setCookies.some(
          (value) => value.startsWith("admin_session=") && /Max-Age=0/i.test(value),
        ),
      );
    });

    test("15. all five CETEC guards reject legacy-only access", async () => {
      const legacyJar = new Map([["admin_session", "legacy-cookie-cannot-authorize"]]);
      const checks = [
        ["/admin", { method: "GET" }, 307],
        ["/admin/settings", { method: "GET" }, 307],
        ["/api/admin/settings", { method: "POST" }, 401],
        ["/api/admin/upload", { method: "POST" }, 401],
        ["/api/push/send", { method: "POST" }, 401],
      ];

      for (const [path, options, status] of checks) {
        const response = await appRequest(path, options, legacyJar);
        assert.equal(response.status, status, path);
      }
    });

    test("logout clears local cookies and revokes the refresh session", async () => {
      const logoutSession = await signIn(identities.super.email);
      const { error: challengeError } = await challengeTotp(
        logoutSession,
        factors.super,
      );
      assert.ifError(challengeError);
      const oldJar = new Map(logoutSession.jar);
      const response = await appRequest(
        "/api/admin/logout",
        { method: "POST" },
        logoutSession.jar,
      );
      assert.equal(response.status, 303);
      const setCookies = applyResponseCookies(logoutSession.jar, response);
      assert.ok(setCookies.some((value) => /Max-Age=0/i.test(value)));
      const afterLogout = await appRequest("/admin", {}, logoutSession.jar);
      assert.equal(afterLogout.status, 307);

      const oldClient = createSsrClient(oldJar);
      const { error } = await oldClient.auth.refreshSession();
      assert.ok(error, "revoked refresh token was unexpectedly accepted");
    });
  });
}
