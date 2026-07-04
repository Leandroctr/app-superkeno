import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings.server";

type SubscribePayload = {
  onesignalId?: string;
  permissionStatus?: string;
  userAgent?: string;
  deviceType?: string;
};

const allowedPermissionStatus = new Set(["granted", "denied", "default", "unknown"]);

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase nao configurado." },
      { status: 503 },
    );
  }

  let payload: SubscribePayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload invalido." },
      { status: 400 },
    );
  }

  const onesignalId = sanitizeText(payload.onesignalId, 256);
  const permissionStatus = sanitizeText(payload.permissionStatus, 32) || "unknown";
  const userAgent =
    sanitizeText(payload.userAgent, 512) ||
    sanitizeText(request.headers.get("user-agent"), 512) ||
    null;
  const deviceType = sanitizeText(payload.deviceType, 32) || "web";

  if (!onesignalId) {
    return NextResponse.json(
      { ok: false, error: "onesignalId e obrigatorio." },
      { status: 400 },
    );
  }

  if (!allowedPermissionStatus.has(permissionStatus)) {
    return NextResponse.json(
      { ok: false, error: "permissionStatus invalido." },
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
