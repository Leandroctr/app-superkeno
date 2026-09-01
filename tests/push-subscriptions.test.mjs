import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeOneSignalId } from "../lib/request-security.ts";

const routeSource = readFileSync("app/api/push/subscribe/route.ts", "utf8");
const schemaSource = readFileSync("supabase/schema.sql", "utf8");
const migrationSource = readFileSync(
  "supabase/migrations/006_scope_push_subscriptions_by_tenant.sql",
  "utf8",
);
const rollbackSource = readFileSync(
  "supabase/migrations/006_scope_push_subscriptions_by_tenant.rollback.sql",
  "utf8",
);

test("A-5 accepts only canonical UUID v4 subscription IDs", () => {
  assert.equal(
    normalizeOneSignalId("123E4567-E89B-42D3-A456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(normalizeOneSignalId("123e4567-e89b-12d3-a456-426614174000"), null);
  assert.equal(normalizeOneSignalId(" 123e4567-e89b-42d3-a456-426614174000 "), null);
  assert.equal(normalizeOneSignalId("123e4567-e89b-42d3-7456-426614174000"), null);
  assert.equal(normalizeOneSignalId("not-a-subscription"), null);
  assert.equal(normalizeOneSignalId({}), null);
});

test("A-5 route upserts only the server tenant composite key", () => {
  assert.match(routeSource, /onConflict:\s*"onesignal_id,tenant_domain"/);
  assert.match(routeSource, /tenant_domain:\s*tenantDomain/);
  assert.doesNotMatch(routeSource, /payload\.tenantDomain/);
  assert.doesNotMatch(routeSource, /onConflict:\s*"onesignal_id"/);
});

test("A-5 route requires the tenant App ID to match the SDK build App ID", () => {
  assert.match(routeSource, /normalizeOneSignalId\(appConfig\.oneSignalAppId\)/);
  assert.match(routeSource, /normalizeOneSignalId\(settings\.oneSignalAppId\)/);
  assert.match(routeSource, /configuredAppId !== tenantAppId/);
  assert.match(routeSource, /onesignal_app_id:\s*tenantAppId/);
});

test("A-5 base schema has tenant-scoped uniqueness only", () => {
  assert.doesNotMatch(schemaSource, /onesignal_id text not null unique/);
  assert.match(
    schemaSource,
    /unique index[^\n]+push_subscriptions_onesignal_id_tenant_domain_key[\s\S]+\(onesignal_id, tenant_domain\)/i,
  );
});

test("migration 006 is transactional, preserves rows and creates composite uniqueness", () => {
  assert.match(migrationSource, /^begin;/m);
  assert.match(migrationSource, /^commit;/m);
  assert.match(migrationSource, /lock table public\.push_subscriptions/i);
  assert.match(migrationSource, /v_before_count/);
  assert.match(migrationSource, /v_after_count <> v_before_count/);
  assert.match(
    migrationSource,
    /unique \(onesignal_id, tenant_domain\)/i,
  );
  assert.doesNotMatch(migrationSource, /\b(update|delete|insert into)\s+public\.push_subscriptions\b/i);
  assert.doesNotMatch(migrationSource, /\b(grant|revoke|policy)\b/i);
});

test("rollback 006 fails closed when global uniqueness cannot be restored", () => {
  assert.match(rollbackSource, /^begin;/m);
  assert.match(rollbackSource, /^commit;/m);
  assert.match(rollbackSource, /having count\(\*\) > 1/);
  assert.match(rollbackSource, /no data was changed/);
  assert.match(rollbackSource, /unique \(onesignal_id\)/i);
  assert.match(rollbackSource, /v_after_count <> v_before_count/);
});

test("existing tenant filters remain present in panel and push send", () => {
  const panel = readFileSync("app/admin/page.tsx", "utf8");
  const send = readFileSync("app/api/push/send/route.ts", "utf8");

  assert.match(panel, /\.eq\("tenant_domain", settings\.tenantDomain\)/);
  assert.match(send, /\.eq\("tenant_domain", settings\.tenantDomain\)/);
});
