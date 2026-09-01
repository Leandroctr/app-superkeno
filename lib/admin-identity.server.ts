import "server-only";

import { cache } from "react";
import { extractHostname } from "@/lib/app-settings";
import { appConfig } from "@/lib/app-config";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logServerError, logServerWarn } from "@/lib/logger/server";

// Fonte unica de identidade/autorizacao administrativa:
// Supabase Auth -> admin_users -> admin_tenant_access.

export type AdminRole = "super_admin" | "admin";

export type CurrentAdmin = {
  id: string;
  authUserId: string;
  email: string;
  name: string | null;
  role: AdminRole;
  active: boolean;
};

type AdminUserRow = {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  role: unknown;
  active: boolean;
};

function isAdminRole(value: unknown): value is AdminRole {
  return value === "super_admin" || value === "admin";
}

async function findActiveAdminByAuthUserId(
  authUserId: string,
): Promise<CurrentAdmin | null> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    logServerWarn("admin_identity_skip", { reason: "supabase_admin_not_configured" });
    return null;
  }

  const { data, error } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, name, role, active")
    .eq("auth_user_id", authUserId)
    .maybeSingle<AdminUserRow>();

  if (error) {
    logServerError("admin_identity_lookup_error", error, { authUserId });
    return null;
  }

  if (!data || !data.active || !isAdminRole(data.role)) {
    return null;
  }

  return {
    id: data.id,
    authUserId: data.auth_user_id,
    email: data.email,
    name: data.name,
    role: data.role,
    active: data.active,
  };
}

async function hasTenantAccess(admin: CurrentAdmin, tenantDomain: string) {
  if (admin.role === "super_admin") {
    return true;
  }

  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return false;
  }

  const { data, error } = await adminClient
    .from("admin_tenant_access")
    .select("id")
    .eq("admin_user_id", admin.id)
    .eq("tenant_domain", tenantDomain)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    logServerError("admin_tenant_access_lookup_error", error, {
      adminId: admin.id,
      tenantDomain,
    });
    return false;
  }

  return Boolean(data);
}

export async function getAuthorizedAdminForTenant(
  authUserId: string,
  tenantDomain: string,
): Promise<CurrentAdmin | null> {
  const admin = await findActiveAdminByAuthUserId(authUserId);

  if (!admin || !(await hasTenantAccess(admin, tenantDomain))) {
    return null;
  }

  return admin;
}

export const getCurrentAdmin = cache(async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const sessionClient = await createSupabaseSessionClient();

  if (!sessionClient) {
    logServerWarn("admin_identity_skip", { reason: "supabase_session_not_configured" });
    return null;
  }

  // getUser() contacts Supabase Auth on every guard evaluation. A cookie or
  // getSession() payload alone is never trusted as administrative identity.
  const { data: userData, error: userError } = await sessionClient.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  return findActiveAdminByAuthUserId(userData.user.id);
});

export async function requireSuperAdmin(): Promise<CurrentAdmin | null> {
  const admin = await getCurrentAdmin();

  if (!admin || admin.role !== "super_admin") {
    return null;
  }

  return admin;
}

export async function requireTenantAccess(): Promise<CurrentAdmin | null> {
  const admin = await getCurrentAdmin();

  if (!admin) {
    return null;
  }

  const tenantDomain = extractHostname(appConfig.publicUrl);
  return (await hasTenantAccess(admin, tenantDomain)) ? admin : null;
}
