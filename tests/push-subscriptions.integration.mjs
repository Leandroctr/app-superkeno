import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const runRealTests = process.env.RUN_REAL_PUSH_SUBSCRIPTION_TESTS === "1";

if (!runRealTests) {
  test("real A-5 tenant subscription suite", { skip: "set RUN_REAL_PUSH_SUBSCRIPTION_TESTS=1" }, () => {});
} else {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.PUSH_SUBSCRIPTION_TEST_BASE_URL;
  const tenantA = process.env.PUSH_SUBSCRIPTION_TEST_TENANT_A;
  const tenantB = process.env.PUSH_SUBSCRIPTION_TEST_TENANT_B;

  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    PUSH_SUBSCRIPTION_TEST_BASE_URL: baseUrl,
    PUSH_SUBSCRIPTION_TEST_TENANT_A: tenantA,
    PUSH_SUBSCRIPTION_TEST_TENANT_B: tenantB,
  })) {
    assert.ok(value, `${name} is required`);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sharedId = randomUUID();
  const routeId = randomUUID();
  const legacyId = randomUUID();
  const serviceId = randomUUID();
  const anonAttemptId = randomUUID();
  const createdSubscriptionIds = new Set([
    sharedId,
    routeId,
    legacyId,
    serviceId,
    anonAttemptId,
  ]);
  const regularIp = "203.0.113.41";
  const burstIp = "203.0.113.42";
  let settingsA;
  let settingsB;
  let initialSnapshotHash;

  function hashRows(rows) {
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }

  async function snapshotHash() {
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id,onesignal_id,permission_status,user_agent,device_type,last_seen_at,created_at,updated_at,tenant_domain,onesignal_app_id")
      .order("id", { ascending: true });
    assert.ifError(error);
    return hashRows(data);
  }

  async function loadSubscription(id, tenantDomain) {
    let query = admin
      .from("push_subscriptions")
      .select("id,onesignal_id,permission_status,user_agent,device_type,last_seen_at,created_at,updated_at,tenant_domain,onesignal_app_id")
      .eq("onesignal_id", id);

    query = tenantDomain === null
      ? query.is("tenant_domain", null)
      : query.eq("tenant_domain", tenantDomain);

    const { data, error } = await query.maybeSingle();
    assert.ifError(error);
    return data;
  }

  async function routeRequest(body, ip = regularIp) {
    return fetch(new URL("/api/push/subscribe", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vercel-forwarded-for": ip,
      },
      body,
    });
  }

  function rateLimitHash(scope, ip) {
    return createHmac("sha256", serviceRoleKey)
      .update(scope)
      .update("\0")
      .update(`${tenantA}\0${ip}`)
      .digest("hex");
  }

  async function resetRouteRateLimits(ip) {
    for (const scope of ["push_subscribe_minute", "push_subscribe_hour"]) {
      const { error } = await admin.rpc("reset_rate_limit", {
        p_scope: scope,
        p_key_hash: rateLimitHash(scope, ip),
      });
      assert.ifError(error);
    }
  }

  before(async () => {
    const { data, error } = await admin
      .from("app_settings")
      .select("tenant_domain,onesignal_app_id")
      .in("tenant_domain", [tenantA, tenantB]);
    assert.ifError(error);
    settingsA = data.find((item) => item.tenant_domain === tenantA);
    settingsB = data.find((item) => item.tenant_domain === tenantB);
    assert.match(settingsA?.onesignal_app_id || "", /^[0-9a-f-]{36}$/);
    assert.match(settingsB?.onesignal_app_id || "", /^[0-9a-f-]{36}$/);
    initialSnapshotHash = await snapshotHash();
    await resetRouteRateLimits(regularIp);
    await resetRouteRateLimits(burstIp);
  });

  after(async () => {
    await admin
      .from("push_subscriptions")
      .delete()
      .in("onesignal_id", [...createdSubscriptionIds]);
    await resetRouteRateLimits(regularIp);
    await resetRouteRateLimits(burstIp);
    assert.equal(await snapshotHash(), initialSnapshotHash);
  });

  describe("A-5 real tenant isolation matrix", { concurrency: false }, () => {
    test("1. tenant A plus subscription X creates A/X", async () => {
      const now = new Date().toISOString();
      const { error } = await admin.from("push_subscriptions").upsert({
        onesignal_id: sharedId,
        permission_status: "granted",
        device_type: "web",
        user_agent: "CETEC-A5-A",
        last_seen_at: now,
        updated_at: now,
        tenant_domain: tenantA,
        onesignal_app_id: settingsA.onesignal_app_id,
      }, { onConflict: "onesignal_id,tenant_domain" });
      assert.ifError(error);
      assert.equal((await loadSubscription(sharedId, tenantA))?.tenant_domain, tenantA);
    });

    test("2. tenant B plus the same X creates an independent B/X", async () => {
      const now = new Date().toISOString();
      const { error } = await admin.from("push_subscriptions").upsert({
        onesignal_id: sharedId,
        permission_status: "denied",
        device_type: "web",
        user_agent: "CETEC-A5-B",
        last_seen_at: now,
        updated_at: now,
        tenant_domain: tenantB,
        onesignal_app_id: settingsB.onesignal_app_id,
      }, { onConflict: "onesignal_id,tenant_domain" });
      assert.ifError(error);
      const { data, error: selectError } = await admin
        .from("push_subscriptions")
        .select("tenant_domain")
        .eq("onesignal_id", sharedId);
      assert.ifError(selectError);
      assert.deepEqual(data.map((item) => item.tenant_domain).sort(), [tenantA, tenantB].sort());
    });

    test("3. updating A/X leaves B/X byte-for-byte unchanged", async () => {
      const beforeB = await loadSubscription(sharedId, tenantB);
      const now = new Date().toISOString();
      const { error } = await admin.from("push_subscriptions").upsert({
        onesignal_id: sharedId,
        permission_status: "default",
        device_type: "web",
        user_agent: "CETEC-A5-A-UPDATED",
        last_seen_at: now,
        updated_at: now,
        tenant_domain: tenantA,
        onesignal_app_id: settingsA.onesignal_app_id,
      }, { onConflict: "onesignal_id,tenant_domain" });
      assert.ifError(error);
      assert.deepEqual(await loadSubscription(sharedId, tenantB), beforeB);
      assert.equal((await loadSubscription(sharedId, tenantA)).permission_status, "default");
    });

    test("4. updating B/X leaves A/X byte-for-byte unchanged", async () => {
      const beforeA = await loadSubscription(sharedId, tenantA);
      const now = new Date().toISOString();
      const { error } = await admin.from("push_subscriptions").upsert({
        onesignal_id: sharedId,
        permission_status: "granted",
        device_type: "web",
        user_agent: "CETEC-A5-B-UPDATED",
        last_seen_at: now,
        updated_at: now,
        tenant_domain: tenantB,
        onesignal_app_id: settingsB.onesignal_app_id,
      }, { onConflict: "onesignal_id,tenant_domain" });
      assert.ifError(error);
      assert.deepEqual(await loadSubscription(sharedId, tenantA), beforeA);
      assert.equal((await loadSubscription(sharedId, tenantB)).permission_status, "granted");
    });

    test("5. payload tenant/App ID cannot move the route subscription", async () => {
      const response = await routeRequest(JSON.stringify({
        onesignalId: routeId,
        permissionStatus: "granted",
        deviceType: "web",
        tenantDomain: tenantB,
        oneSignalAppId: settingsB.onesignal_app_id,
      }));
      assert.equal(response.status, 200);
      const { data, error } = await admin
        .from("push_subscriptions")
        .select("tenant_domain,onesignal_app_id")
        .eq("onesignal_id", routeId);
      assert.ifError(error);
      assert.deepEqual(data, [{
        tenant_domain: tenantA,
        onesignal_app_id: settingsA.onesignal_app_id,
      }]);
    });

    test("6. invalid UUID is rejected with 400", async () => {
      const response = await routeRequest(JSON.stringify({ onesignalId: "invalid" }));
      assert.equal(response.status, 400);
    });

    test("7. oversized payload is rejected with 413", async () => {
      const response = await routeRequest(JSON.stringify({
        onesignalId: randomUUID(),
        padding: "x".repeat(5000),
      }));
      assert.equal(response.status, 413);
    });

    test("8. previous distributed rate limit still returns 429 and Retry-After", async () => {
      await resetRouteRateLimits(burstIp);
      const responses = await Promise.all(
        Array.from({ length: 61 }, () => routeRequest("{}", burstIp)),
      );
      const limited = responses.filter((response) => response.status === 429);
      assert.equal(limited.length, 1);
      assert.match(limited[0].headers.get("retry-after") || "", /^\d+$/);
      assert.equal(responses.filter((response) => response.status === 400).length, 60);
    });

    test("9. anon cannot insert or update push subscriptions directly", async () => {
      const insert = await anon.from("push_subscriptions").insert({
        onesignal_id: anonAttemptId,
        permission_status: "granted",
        device_type: "web",
        tenant_domain: tenantA,
      }).select("id");
      assert.ok(insert.error);

      const update = await anon.from("push_subscriptions")
        .update({ permission_status: "denied" })
        .eq("onesignal_id", sharedId)
        .select("id");
      assert.ok(update.error);
      assert.equal(await loadSubscription(anonAttemptId, tenantA), null);
    });

    test("10. service_role can still write", async () => {
      const { error } = await admin.from("push_subscriptions").insert({
        onesignal_id: serviceId,
        permission_status: "granted",
        device_type: "web",
        tenant_domain: tenantA,
        onesignal_app_id: settingsA.onesignal_app_id,
      });
      assert.ifError(error);
      assert.ok(await loadSubscription(serviceId, tenantA));
    });

    test("11. tenant-filtered panel queries remain isolated", async () => {
      const [{ data: rowsA, error: errorA }, { data: rowsB, error: errorB }] = await Promise.all([
        admin.from("push_subscriptions").select("onesignal_id").eq("tenant_domain", tenantA).in("onesignal_id", [sharedId, routeId]),
        admin.from("push_subscriptions").select("onesignal_id").eq("tenant_domain", tenantB).in("onesignal_id", [sharedId, routeId]),
      ]);
      assert.ifError(errorA);
      assert.ifError(errorB);
      assert.deepEqual(rowsA.map((item) => item.onesignal_id).sort(), [routeId, sharedId].sort());
      assert.deepEqual(rowsB.map((item) => item.onesignal_id), [sharedId]);
    });

    test("12. push send keeps the server tenant filter", () => {
      const source = readFileSync("app/api/push/send/route.ts", "utf8");
      assert.match(source, /\.eq\("permission_status", "granted"\)[\s\S]*\.eq\("tenant_domain", settings\.tenantDomain\)/);
    });

    test("13. legacy NULL row stays intact when the same ID is added to a tenant", async () => {
      const { error: legacyError } = await admin.from("push_subscriptions").insert({
        onesignal_id: legacyId,
        permission_status: "granted",
        device_type: "web",
        user_agent: "CETEC-A5-LEGACY",
        tenant_domain: null,
        onesignal_app_id: null,
      });
      assert.ifError(legacyError);
      const legacyBefore = await loadSubscription(legacyId, null);

      const { error } = await admin.from("push_subscriptions").upsert({
        onesignal_id: legacyId,
        permission_status: "default",
        device_type: "web",
        tenant_domain: tenantA,
        onesignal_app_id: settingsA.onesignal_app_id,
      }, { onConflict: "onesignal_id,tenant_domain" });
      assert.ifError(error);
      assert.deepEqual(await loadSubscription(legacyId, null), legacyBefore);
      assert.ok(await loadSubscription(legacyId, tenantA));
    });
  });
}
