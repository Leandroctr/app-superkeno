"use server";

import { redirect } from "next/navigation";
import {
  getAdminPendingMfaForTenant,
  isAdminMfaAssuranceSatisfied,
} from "@/lib/admin-identity.server";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";

export type MfaActionState = {
  status: "idle" | "ready" | "error";
  message?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
};

const genericError =
  "Nao foi possivel confirmar o codigo. Verifique e tente novamente.";

async function requirePendingMfaAdmin() {
  const admin = await getAdminPendingMfaForTenant();
  const sessionClient = await createSupabaseSessionClient();

  if (!admin || !sessionClient) {
    if (sessionClient) {
      await sessionClient.auth.signOut({ scope: "local" });
    }
    redirect("/admin/login?error=1");
  }

  return sessionClient;
}

export async function beginMfaEnrollment(
  _previousState: MfaActionState,
): Promise<MfaActionState> {
  void _previousState;
  const sessionClient = await requirePendingMfaAdmin();
  const { data: factors, error: factorsError } =
    await sessionClient.auth.mfa.listFactors();

  if (factorsError) {
    return { status: "error", message: genericError };
  }

  if (factors.totp.length > 0) {
    return {
      status: "error",
      message: "O estado do MFA mudou. Atualize a pagina e tente novamente.",
    };
  }

  // Um fator TOTP nao verificado nao pode ser retomado porque o segredo nao
  // deve ser persistido pela aplicacao. Remova somente esses enrollments
  // abandonados antes de gerar um novo; fatores verificados nunca sao tocados.
  const abandonedTotpFactors = factors.all.filter(
    (factor) =>
      factor.factor_type === "totp" && factor.status === "unverified",
  );

  for (const factor of abandonedTotpFactors) {
    const { error } = await sessionClient.auth.mfa.unenroll({
      factorId: factor.id,
    });

    if (error) {
      return { status: "error", message: genericError };
    }
  }

  const { data, error } = await sessionClient.auth.mfa.enroll({
    factorType: "totp",
  });

  if (error) {
    return { status: "error", message: genericError };
  }

  return {
    status: "ready",
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function verifyMfaCode(
  _previousState: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  void _previousState;
  const sessionClient = await requirePendingMfaAdmin();
  const factorId = String(formData.get("factorId") || "").trim();
  const code = String(formData.get("code") || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) {
    return { status: "error", message: genericError };
  }

  const { data: factors, error: factorsError } =
    await sessionClient.auth.mfa.listFactors();
  const ownedTotpFactor = factors?.all.some(
    (factor) => factor.id === factorId && factor.factor_type === "totp",
  );

  if (factorsError || !ownedTotpFactor) {
    return { status: "error", message: genericError };
  }

  const { data: challenge, error: challengeError } =
    await sessionClient.auth.mfa.challenge({ factorId });

  if (challengeError) {
    return { status: "error", message: genericError };
  }

  const { error: verifyError } = await sessionClient.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    return { status: "error", message: genericError };
  }

  const { data: assurance, error: assuranceError } =
    await sessionClient.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assuranceError || !isAdminMfaAssuranceSatisfied(assurance)) {
    return { status: "error", message: genericError };
  }

  redirect("/admin");
}
