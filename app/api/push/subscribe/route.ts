import { NextResponse } from "next/server";
import { appConfig } from "@/lib/app-config";
import { extractHostname } from "@/lib/app-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings.server";
import { logServerWarn } from "@/lib/logger/server";
import { consumeRateLimits } from "@/lib/rate-limit.server";
import {
  extractClientIp,
  normalizeOneSignalId,
} from "@/lib/request-security";

type SubscribePayload = {
  onesignalId?: string;
  permissionStatus?: string;
  userAgent?: string;
  deviceType?: string;
};

const allowedPermissionStatus = new Set(["granted", "denied", "default", "unknown"]);
const MAX_REQUEST_BODY_LENGTH = 4096;

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  const tenantDomain = extractHostname(appConfig.publicUrl);
  const clientIp = extractClientIp(request.headers);
  const rateLimitIdentifier = `${tenantDomain}\0${clientIp}`;
  const rateLimit = await consumeRateLimits([
    {
      scope: "push_subscribe_minute",
      identifier: rateLimitIdentifier,
      limit: 60,
      windowSeconds: 60,
    },
    {
      scope: "push_subscribe_hour",
      identifier: rateLimitIdentifier,
      limit: 500,
      windowSeconds: 60 * 60,
    },
  ]);

  if (rateLimit.unavailable) {
    logServerWarn("push_subscribe_rate_limit_unavailable", { tenantDomain });
    return NextResponse.json(
      { ok: false, error: "Servico temporariamente indisponivel." },
      { status: 503 },
    );
  }

  if (!rateLimit.allowed) {
    logServerWarn("push_subscribe_rate_limited", {
      tenantDomain,
      scope: rateLimit.limitedScope,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
    return NextResponse.json(
      { ok: false, error: "Muitas solicitacoes. Tente novamente mais tarde." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  let rawPayload: string;

  try {
    rawPayload = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload invalido." },
      { status: 400 },
    );
  }

  if (rawPayload.length > MAX_REQUEST_BODY_LENGTH) {
    return NextResponse.json(
      { ok: false, error: "Payload excede o limite permitido." },
      { status: 413 },
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase nao configurado." },
      { status: 503 },
    );
  }

  let payload: SubscribePayload;

  try {
    payload = JSON.parse(rawPayload) as SubscribePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload invalido." },
      { status: 400 },
    );
  }

  const onesignalId = normalizeOneSignalId(payload.onesignalId);
  const permissionStatus = sanitizeText(payload.permissionStatus, 32) || "unknown";
  const userAgent =
    sanitizeText(payload.userAgent, 512) ||
    sanitizeText(request.headers.get("user-agent"), 512) ||
    null;
  const deviceType = sanitizeText(payload.deviceType, 32) || "web";

  if (!onesignalId) {
    return NextResponse.json(
      { ok: false, error: "onesignalId invalido." },
      { status: 400 },
    );
  }

  if (!allowedPermissionStatus.has(permissionStatus)) {
    return NextResponse.json(
      { ok: false, error: "permissionStatus invalido." },
      { status: 400 },
    );
  }

  if (deviceType !== "web") {
    return NextResponse.json(
      { ok: false, error: "deviceType invalido." },
      { status: 400 },
    );
  }

  const settings = await getAppSettings();
  const now = new Date().toISOString();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      onesignal_id: onesignalId,
      permission_status: permissionStatus,
      user_agent: userAgent,
      device_type: deviceType,
      last_seen_at: now,
      updated_at: now,
      tenant_domain: settings.tenantDomain,
      onesignal_app_id: settings.oneSignalAppId || null,
    },
    {
      onConflict: "onesignal_id",
    },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel salvar inscricao push." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription: {
      onesignalId,
      permissionStatus,
      deviceType,
      lastSeenAt: now,
    },
  });
}
