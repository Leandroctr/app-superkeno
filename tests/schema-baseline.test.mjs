import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("supabase/schema.sql", "utf8");
const auditReport = readFileSync("docs/AUDIT_REPORT.md", "utf8");
const safetyPlan = readFileSync("docs/PRODUCTION_SAFETY_PLAN.md", "utf8");
const onboarding = readFileSync("docs/ONBOARDING_CLIENTE.md", "utf8");

function tableDefinition(qualifiedName) {
  const escapedName = qualifiedName.replaceAll(".", "\\.");
  const match = schema.match(
    new RegExp(
      `create table if not exists ${escapedName} \\(([\\s\\S]*?)\\n\\);`,
      "i",
    ),
  );

  assert.ok(match, `missing table ${qualifiedName}`);
  return match[1];
}

test("baseline is complete and tenant-neutral", () => {
  assert.match(schema, /PWA-WL application baseline/i);
  assert.match(schema, /Do not run this file on an existing environment/i);
  assert.doesNotMatch(schema, /insert into public\.app_settings/i);
  assert.doesNotMatch(schema, /pwa\.app-(?:obapremios|bigpix|megabingo7|premiosaovivo|pixkeno|superkeno)\.com/i);
  assert.doesNotMatch(schema, /create schema if not exists cetec_audit/i);
});

test("app_settings uses tenant_domain instead of singleton uniqueness", () => {
  const definition = tableDefinition("public.app_settings");

  assert.match(definition, /tenant_domain text/i);
  assert.match(definition, /singleton_key boolean not null default true/i);
  assert.doesNotMatch(definition, /^\s*singleton_key[^,\n]*\bunique\b/im);
  assert.match(
    schema,
    /create unique index if not exists app_settings_tenant_domain_idx\s+on public\.app_settings \(tenant_domain\)/i,
  );
});

test("admin authentication tables match the shared database model", () => {
  const users = tableDefinition("public.admin_users");
  const access = tableDefinition("public.admin_tenant_access");

  assert.match(users, /auth_user_id uuid not null unique[\s\S]*references auth\.users \(id\) on delete cascade/i);
  assert.match(users, /email text not null unique/i);
  assert.match(users, /role text not null check \(role in \('super_admin', 'admin'\)\)/i);
  assert.match(access, /references public\.admin_users \(id\) on delete cascade/i);
  assert.match(access, /unique \(admin_user_id, tenant_domain\)/i);
  assert.match(schema, /admin_tenant_access_admin_user_idx/i);
});

test("push tables preserve tenant isolation and migration 006 uniqueness", () => {
  const subscriptions = tableDefinition("public.push_subscriptions");
  const campaigns = tableDefinition("public.push_campaigns");

  for (const definition of [subscriptions, campaigns]) {
    assert.match(definition, /tenant_domain text/i);
    assert.match(definition, /onesignal_app_id text/i);
  }

  assert.match(
    subscriptions,
    /constraint push_subscriptions_onesignal_id_tenant_domain_key\s+unique \(onesignal_id, tenant_domain\)/i,
  );
  assert.doesNotMatch(subscriptions, /unique \(onesignal_id\)/i);
  assert.match(campaigns, /constraint push_campaigns_status_check/i);
});

test("rate limiter 005 and RPC permissions are represented", () => {
  const buckets = tableDefinition("cetec_security.rate_limit_buckets");

  assert.match(buckets, /primary key \(scope, key_hash\)/i);
  assert.match(buckets, /rate_limit_scope_format/i);
  assert.match(buckets, /rate_limit_key_hash_format/i);
  assert.match(schema, /create or replace function public\.consume_rate_limit/i);
  assert.match(schema, /create or replace function public\.reset_rate_limit/i);
  assert.match(schema, /security definer\s+set search_path = ''/i);
  assert.match(
    schema,
    /grant execute on function public\.consume_rate_limit\(text, text, integer, integer\)\s+to service_role/i,
  );
  assert.match(
    schema,
    /grant execute on function public\.reset_rate_limit\(text, text\)\s+to service_role/i,
  );
});

test("C-1, C-3 and M-9 stay closed", () => {
  assert.doesNotMatch(schema, /create policy "Allow anonymous push subscription/i);
  assert.doesNotMatch(schema, /create policy "Allow public read app_settings"/i);
  assert.doesNotMatch(
    schema,
    /create policy[\s\S]*?on storage\.objects[\s\S]*?for (?:insert|update|delete|all)/i,
  );

  const createdPolicies = schema.match(/create policy\s+/gi) ?? [];
  assert.equal(createdPolicies.length, 1);
  assert.match(
    schema,
    /create policy app_assets_public_read[\s\S]*?on storage\.objects[\s\S]*?for select[\s\S]*?using \(bucket_id = 'app-assets'\)/i,
  );

  for (const table of [
    "app_settings",
    "push_subscriptions",
    "push_campaigns",
    "admin_users",
    "admin_tenant_access",
  ]) {
    assert.match(
      schema,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      schema,
      new RegExp(
        `revoke all on table public\\.${table} from public, anon, authenticated`,
        "i",
      ),
    );
  }
});

test("baseline statements are predictably re-runnable", () => {
  const createTables = schema.match(/create table/gi) ?? [];
  const guardedTables = schema.match(/create table if not exists/gi) ?? [];
  const createIndexes = schema.match(/create (?:unique )?index/gi) ?? [];
  const guardedIndexes = schema.match(/create (?:unique )?index if not exists/gi) ?? [];

  assert.equal(guardedTables.length, createTables.length);
  assert.equal(guardedIndexes.length, createIndexes.length);
  assert.match(schema, /insert into storage\.buckets[\s\S]*?on conflict \(id\) do update/i);
  assert.ok(
    schema.indexOf("drop policy if exists app_assets_public_read") <
      schema.indexOf("create policy app_assets_public_read"),
  );
});

test("documentation defines one reconstruction path", () => {
  for (const document of [auditReport, safetyPlan, onboarding]) {
    assert.match(document, /baseline completo/i);
    assert.match(document, /supabase\/schema\.sql/i);
    assert.match(document, /projeto Supabase\s+(?:novo|vazio)/i);
    assert.match(
      document,
      /não (?:aplicar|executar|reaplicar)[\s\S]{0,40}migrations 002/i,
    );
  }
});
