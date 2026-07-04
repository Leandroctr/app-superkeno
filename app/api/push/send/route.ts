import { NextResponse } from "next/server";
import type { AppSettings } from "@/lib/app-settings";
import { getAppSettings } from "@/lib/app-settings.server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logServerInfo, logServerWarn, logServerError } from "@/lib/logger/server";

type SendPayload = {
  title?: string;
  message?: string;
  targetUrl?: string;
  targetType?: string;
};

function isSafeUrl(value: string) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizePayload(payload: SendPayload, settings: AppSettings) {
  const fallbackTargetUrl = isSafeUrl(settings.platformUrl)
    ? settings.platformUrl
    : settings.publicUrl || "/";
  const targetUrl = payload.targetUrl?.trim() || fallbackTargetUrl;

  return {
    title: payload.title?.trim().slice(0, 120) || "",
    message: payload.message?.trim().slice(0, 500) || "",
    targetUrl: isSafeUrl(targetUrl) || targetUrl.startsWith("/") ? targetUrl : fallbackTargetUrl,
    targetType: payload.targetType === "test" ? "test" : "all",
  };
}

function maskAppId(appId: string): string {
  return appId.slice(0, 8) + "...";
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { ok: false, error: "Nao autenticado." },
      { status: 401 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const oneSignalRestApiKey = process.env.ONESIGNAL_REST_API_KEY;
  const settings = await getAppSettings();

  if (!supabase || !settings.oneSignalAppId || !oneSignalRestApiKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase ou OneSignal nao configurado." },
      { status: 503 },
    );
  }

  const maskedAppId = maskAppId(settings.oneSignalAppId);

  let payload: SendPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload invalido." },
      { status: 400 },
    );
  }

  const data = normalizePayload(payload, settings);

  if (!data.title || !data.message) {
    return NextResponse.json(
      { ok: false, error: "Titulo e mensagem sao obrigatorios." },
      { status: 400 },
    );
  }

  const limit = data.targetType === "test" ? 1 : 10000;
  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("push_subscriptions")
    .select("onesignal_id")
    .eq("permission_status", "granted")
    .eq("tenant_domain", settings.tenantDomain)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (subscriptionsError) {
    logServerError("push_send_error", subscriptionsError, {
      step: "fetch_subscriptions",
      targetType: data.targetType,
      maskedAppId,
    });
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel buscar inscritos." },
      { status: 500 },
    );
  }

  const subscriptionIds =
    subscriptions?.map((item) => item.onesignal_id).filter(Boolean) || [];
  const targetCount = subscriptionIds.length;

  if (targetCount === 0) {
    return NextResponse.json(
      { ok: false, error: "Nenhum inscrito disponivel para envio.", targetCount },
      { status: 400 },
    );
  }

  const { data: campaign, error: createCampaignError } = await supabase
    .from("push_campaigns")
    .insert({
      title: data.title,
      message: data.message,
      target_url: data.targetUrl,
      target_type: data.targetType,
      status: "created",
      recipient_count: targetCount,
      tenant_domain: settings.tenantDomain,
      onesignal_app_id: settings.oneSignalAppId || null,
    })
    .select("id")
    .single();

  if (createCampaignError || !campaign) {
    logServerError("push_send_error", createCampaignError, {
      step: "create_campaign",
      targetType: data.targetType,
      recipientCount: targetCount,
      maskedAppId,
    });
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel registrar campanha." },
      { status: 500 },
    );
  }

  logServerInfo("push_send_started", {
    targetType: data.targetType,
    recipientCount: targetCount,
    maskedAppId,
    campaignId: campaign.id,
  });

  const oneSignalResponse = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      Authorization: `Key ${oneSignalRestApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: settings.oneSignalAppId,
      include_subscription_ids: subscriptionIds,
      headings: { en: data.title, pt: data.title },
      contents: { en: data.message, pt: data.message },
      url: data.targetUrl,
    }),
  });

  let oneSignalResult: Record<string, unknown> = {};
  try {
    oneSignalResult = await oneSignalResponse.json();
  } catch (parseErr) {
    logServerWarn("push_send_parse_error", {
      targetType: data.targetType,
      httpStatus: oneSignalResponse.status,
      maskedAppId,
      campaignId: campaign.id,
    });
    logServerError("push_send_parse_error_detail", parseErr);
  }

  const notificationId =
    typeof oneSignalResult.id === "string" ? oneSignalResult.id : null;

  logServerInfo("push_send_onesignal_response", {
    targetType: data.targetType,
    recipientCount: targetCount,
    httpStatus: oneSignalResponse.status,
    ok: oneSignalResponse.ok,
    hasNotificationId: Boolean(notificationId),
    maskedAppId,
    campaignId: campaign.id,
  });

  const { error: campaignError } = await supabase
    .from("push_campaigns")
    .update({
    status: oneSignalResponse.ok ? "sent" : "failed",
    onesignal_notification_id: notificationId,
    error_message: oneSignalResponse.ok ? null : JSON.stringify(oneSignalResult),
    sent_at: oneSignalResponse.ok ? new Date().toISOString() : null,
    })
    .eq("id", campaign.id);

  if (!oneSignalResponse.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "OneSignal recusou o envio.",
        targetCount,
        campaignId: campaign.id,
      },
      { status: 502 },
    );
  }

  if (campaignError) {
    return NextResponse.json(
      { ok: false, error: "Push enviado, mas campanha nao foi registrada." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    notificationId,
    targetCount,
    recipients: targetCount,
    campaignId: campaign.id,
  });
}
