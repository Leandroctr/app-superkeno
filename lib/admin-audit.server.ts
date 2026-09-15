import "server-only";

import { randomUUID } from "node:crypto";
import { appConfig } from "@/lib/app-config";
import { extractHostname } from "@/lib/app-settings";
import type { CurrentAdmin } from "@/lib/admin-identity.server";
import {
  assertSafeAuditJson,
  emptyAuditJson,
  type AdminAuditAction,
  type AdminAuditOutcome,
  type SafeAuditJson,
} from "@/lib/admin-audit";
import { logServerError } from "@/lib/logger/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type AuditEntityType =
  | "settings"
  | "asset"
  | "push_campaign";

export class AdminAuditUnavailableError extends Error {
  constructor() {
    super("Administrative audit persistence is unavailable");
    this.name = "AdminAuditUnavailableError";
  }
}

export type AdminAuditContext = {
  correlationId: string;
  sourceTenantDomain: string;
  targetTenantDomain: string | null;
  actorAdminUserId: string;
  actorAuthUserId: string;
  actorEmailSnapshot: string;
  actorRoleSnapshot: string;
  action: AdminAuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  beforeJson: SafeAuditJson;
  sourceCommitSha: string | null;
  sourceDeploymentId: string | null;
};

type BeginAdminAuditInput = {
  actor: CurrentAdmin;
  action: AdminAuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  targetTenantDomain?: string | null;
  beforeJson?: SafeAuditJson;
  metadataJson?: SafeAuditJson;
};

type CompleteAdminAuditInput = {
  outcome: Exclude<AdminAuditOutcome, "attempt">;
  action?: AdminAuditAction;
  entityId?: string | null;
  targetTenantDomain?: string | null;
  afterJson?: SafeAuditJson;
  metadataJson?: SafeAuditJson;
};

function normalizeTenantDomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 253 ||
    !/^[a-z0-9.-]+$/.test(normalized)
  ) {
    throw new Error("Invalid audit tenant domain");
  }

  return normalized;
}

function optionalIdentifier(
  value: string | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim();
  if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeEntityId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, 500) : null;
}

async function insertAuditEvent(row: {
  correlation_id: string;
  source_tenant_domain: string;
  target_tenant_domain: string | null;
  actor_admin_user_id: string;
  actor_auth_user_id: string;
  actor_email_snapshot: string;
  actor_role_snapshot: string;
  action: AdminAuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  outcome: AdminAuditOutcome;
  before_json: SafeAuditJson;
  after_json: SafeAuditJson;
  metadata_json: SafeAuditJson;
  source_commit_sha: string | null;
  source_deployment_id: string | null;
}): Promise<void> {
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    throw new Error("Supabase admin client unavailable");
  }

  const { error } = await adminClient.from("admin_audit_logs").insert(row);
  if (error) {
    throw error;
  }
}

export async function beginAdminAudit(
  input: BeginAdminAuditInput,
): Promise<AdminAuditContext> {
  const correlationId = randomUUID();
  const beforeJson = input.beforeJson ?? emptyAuditJson();
  const metadataJson = input.metadataJson ?? emptyAuditJson();

  try {
    assertSafeAuditJson(beforeJson);
    assertSafeAuditJson(metadataJson);

    const context: AdminAuditContext = {
      correlationId,
      sourceTenantDomain: normalizeTenantDomain(
        extractHostname(appConfig.publicUrl),
      ),
      targetTenantDomain: input.targetTenantDomain
        ? normalizeTenantDomain(input.targetTenantDomain)
        : null,
      actorAdminUserId: input.actor.id,
      actorAuthUserId: input.actor.authUserId,
      actorEmailSnapshot: input.actor.email.slice(0, 320),
      actorRoleSnapshot: input.actor.role,
      action: input.action,
      entityType: input.entityType,
      entityId: normalizeEntityId(input.entityId),
      beforeJson,
      sourceCommitSha: optionalIdentifier(
        process.env.VERCEL_GIT_COMMIT_SHA,
        64,
      ),
      sourceDeploymentId: optionalIdentifier(
        process.env.VERCEL_DEPLOYMENT_ID,
        200,
      ),
    };

    await insertAuditEvent({
      correlation_id: context.correlationId,
      source_tenant_domain: context.sourceTenantDomain,
      target_tenant_domain: context.targetTenantDomain,
      actor_admin_user_id: context.actorAdminUserId,
      actor_auth_user_id: context.actorAuthUserId,
      actor_email_snapshot: context.actorEmailSnapshot,
      actor_role_snapshot: context.actorRoleSnapshot,
      action: context.action,
      entity_type: context.entityType,
      entity_id: context.entityId,
      outcome: "attempt",
      before_json: context.beforeJson,
      after_json: emptyAuditJson(),
      metadata_json: metadataJson,
      source_commit_sha: context.sourceCommitSha,
      source_deployment_id: context.sourceDeploymentId,
    });

    return context;
  } catch (error) {
    logServerError("admin_audit_write_error", error, {
      phase: "attempt",
      action: input.action,
      correlationId,
    });
    throw new AdminAuditUnavailableError();
  }
}

export async function completeAdminAudit(
  context: AdminAuditContext,
  input: CompleteAdminAuditInput,
): Promise<boolean> {
  const afterJson = input.afterJson ?? emptyAuditJson();
  const metadataJson = input.metadataJson ?? emptyAuditJson();

  try {
    assertSafeAuditJson(afterJson);
    assertSafeAuditJson(metadataJson);

    await insertAuditEvent({
      correlation_id: context.correlationId,
      source_tenant_domain: context.sourceTenantDomain,
      target_tenant_domain:
        input.targetTenantDomain === undefined
          ? context.targetTenantDomain
          : input.targetTenantDomain
            ? normalizeTenantDomain(input.targetTenantDomain)
            : null,
      actor_admin_user_id: context.actorAdminUserId,
      actor_auth_user_id: context.actorAuthUserId,
      actor_email_snapshot: context.actorEmailSnapshot,
      actor_role_snapshot: context.actorRoleSnapshot,
      action: input.action ?? context.action,
      entity_type: context.entityType,
      entity_id:
        input.entityId === undefined
          ? context.entityId
          : normalizeEntityId(input.entityId),
      outcome: input.outcome,
      before_json: context.beforeJson,
      after_json: afterJson,
      metadata_json: metadataJson,
      source_commit_sha: context.sourceCommitSha,
      source_deployment_id: context.sourceDeploymentId,
    });

    return true;
  } catch (error) {
    logServerError("admin_audit_write_error", error, {
      phase: "terminal",
      action: input.action ?? context.action,
      outcome: input.outcome,
      correlationId: context.correlationId,
    });
    return false;
  }
}
