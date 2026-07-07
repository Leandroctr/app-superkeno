"use client";

import { useEffect } from "react";
import OneSignal from "react-onesignal";

declare global {
  interface Window {
    __ONESIGNAL_INITED__?: boolean;
  }
}

// Evento disparado sempre que uma tentativa de sincronizar a inscricao push
// termina (com sucesso ou falha) — inclusive quando nao ha nada para
// sincronizar (usuario ainda nao optou por notificacoes). app/page.tsx ouve
// este evento (uma vez) para saber quando e seguro redirecionar para
// platformUrl sem depender apenas do timeout fixo.
function dispatchPushSyncSettled(ok: boolean) {
  window.dispatchEvent(new CustomEvent("push-sync-settled", { detail: { ok } }));
}

async function sendSubscription(id: string): Promise<boolean> {
  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive garante que a requisicao nao seja abortada pelo navegador
      // se o redirect de topo para platformUrl disparar logo em seguida.
      keepalive: true,
      body: JSON.stringify({
        onesignalId: id,
        permissionStatus: Notification.permission,
        userAgent: navigator.userAgent,
        deviceType: "web",
      }),
    });

    return response.ok;
  } catch (err) {
    console.error("[OS] Falha ao sincronizar inscricao push:", err);
    return false;
  }
}

export function OneSignalInitializer() {
  useEffect(() => {
    if (window.__ONESIGNAL_INITED__) return;
    window.__ONESIGNAL_INITED__ = true;

    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

    console.log("[OS] === OneSignal init start ===");
    console.log("[OS] appId present:", Boolean(appId));
    console.log("[OS] serviceWorker supported:", "serviceWorker" in navigator);
    console.log("[OS] Notification supported:", "Notification" in window);
    console.log("[OS] Notification.permission:", typeof Notification !== "undefined" ? Notification.permission : "N/A");

    if (!appId) {
      console.warn("[OS] NEXT_PUBLIC_ONESIGNAL_APP_ID not set — aborting.");
      dispatchPushSyncSettled(false);
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        console.log("[OS] SW registrations before init:", regs.length);
        regs.forEach((r, i) =>
          console.log(`[OS]   SW[${i}] scope="${r.scope}" state="${r.active?.state ?? "no active worker"}"`)
        );
      });
    }

    console.log("[OS] Calling OneSignal.init() with:", {
      appId: appId.slice(0, 8) + "...",
      autoResubscribe: true,
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "onesignal/OneSignalSDKWorker.js",
    });

    void OneSignal.init({
      appId,
      autoResubscribe: true,
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "onesignal/OneSignalSDKWorker.js",
    }).then(async () => {
      console.log("[OS] init() resolved successfully.");

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          console.log("[OS] SW registrations after init:", regs.length);
          regs.forEach((r, i) =>
            console.log(`[OS]   SW[${i}] scope="${r.scope}" state="${r.active?.state ?? "no active worker"}"`)
          );
        });
      }

      console.log("[OS] PushSubscription.id:", OneSignal.User.PushSubscription.id ?? "null");
      console.log("[OS] PushSubscription.optedIn:", OneSignal.User.PushSubscription.optedIn);
      console.log("[OS] Notifications.permission:", OneSignal.Notifications.permission);

      OneSignal.User.PushSubscription.addEventListener("change", (event) => {
        console.log("[OS] PushSubscription changed:", event.current);
        const { id, optedIn } = event.current;
        if (id && optedIn) {
          void sendSubscription(id).then((ok) => {
            console.log(ok ? "[OS] Sync (change) ok." : "[OS] Sync (change) falhou.");
            dispatchPushSyncSettled(ok);
          });
        }
      });

      const currentId = OneSignal.User.PushSubscription.id;
      const currentOptedIn = OneSignal.User.PushSubscription.optedIn;

      if (currentId && currentOptedIn) {
        console.log("[OS] Already subscribed — syncing to API.");
        const ok = await sendSubscription(currentId);
        console.log(ok ? "[OS] Sync inicial ok." : "[OS] Sync inicial falhou.");
        dispatchPushSyncSettled(ok);
      } else {
        console.log("[OS] Nenhuma inscricao ativa ainda — nada para sincronizar.");
        dispatchPushSyncSettled(false);
      }
    }).catch((error: unknown) => {
      console.error("[OS] init() FAILED.");
      console.error("[OS] Error:", error);
      if (error instanceof Error) {
        console.error("[OS] Message:", error.message);
        console.error("[OS] Stack:", error.stack);
      }
      dispatchPushSyncSettled(false);
    });
  }, []);

  return null;
}
