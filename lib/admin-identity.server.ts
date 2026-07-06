import "server-only";

import { cache } from "react";
import { extractHostname } from "@/lib/app-settings";
import { appConfig } from "@/lib/app-config";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logServerError, logServerWarn } from "@/lib/logger/server";

// Helpers de identidade/autorizacao para o painel admin real (Supabase Auth).
// Ainda NAO conectados a nenhuma pagina/rota existente — preparados para a
// proxima etapa de implementacao. Ate la, /admin/* e /api/admin/* continuam
// usando isAdminAuthenticated() (lib/admin-auth.ts) como hoje.
//
// Convencao adotada, igual a isAdminAuthenticated(): estes helpers retornam
// null quando nao autorizado, em vez de fazer redirect() ou responder
// NextResponse diretamente. Cada pagina decide redirect(); cada rota de API
// decide o status HTTP (401/403) — mesma divisao de responsabilidade que
// o codigo atual ja usa.

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
  role: AdminRole;
  active: boolean;
};

export const getCurrentAdmin = cache(async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const sessionClient = await createSupabaseSessionClient();

  if (!sessionClient) {
    logServerWarn("admin_identity_skip", { reason: "supabase_session_not_configured" });
    return null;
  }

  const { data: userData, error: userError } = await sessionClient.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    logServerWarn("admin_identity_skip", { reason: "supabase_admin_not_configured" });
    return null;
  }

  const { data, error } = await adminClient
    .from("admin_users")
    .select("id, auth_user_id, email, name, role, active")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle<AdminUserRow>();

  if (error) {
    logServerError("admin_identity_lookup_error", error, {
      authUserId: userData.user.id,
    });
    return null;
  }

  if (!data || !data.active) {
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

  if (admin.role === "super_admin") {
    return admin;
  }

  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const tenantDomain = extractHostname(appConfig.publicUrl);

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
    return null;
  }

  return data ? admin : null;
}
