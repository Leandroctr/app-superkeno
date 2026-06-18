"use client";

import { appConfigClient } from "@/lib/app-config.client";

type OneSignalInstance = {
  init: (options: { appId: string; serviceWorkerPath?: string }) => Promise<void>;
  Notifications: {
    permission: boolean;
    requestPermission: () => Promise<boolean>;
  };
  User: {
    PushSubscription: {
      id?: string;
      optedIn?: boolean;
      addEventListener?: (
        event: "change",
        callback: (event: { current?: { id?: string; optedIn?: boolean } }) => void,
      ) => void;
    };
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalInstance) => void | Promise<void>>;
  }
}

export type OneSignalInitResult = {
  enabled: boolean;
  subscribed: boolean;
  message: string;
};

function debugLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[OneSignal] ${message}`, details ?? "");
  }
}

function loadOneSignalSdk() {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector("[data-onesignal-sdk]")) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.dataset.onesignalSdk = "true";
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Nao foi possivel carregar o OneSignal."));
    document.head.appendChild(script);
  });
}

async function sendSubscription(oneSignal: OneSignalInstance, permissionStatus: string) {
  const onesignalId = oneSignal.User.PushSubscription.id;

  if (!onesignalId) {
    debugLog("Subscription id ainda indisponivel.");
    return false;
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      onesignalId,
      permissionStatus,
      userAgent: navigator.userAgent,
      deviceType: "web",
    }),
  });

  if (!response.ok) {
    debugLog("Falha ao salvar inscricao push.", await response.json().catch(() => null));
  }

  return response.ok;
}

export async function initializeOneSignal(): Promise<OneSignalInitResult> {
  debugLog("Config publica carregada.", {
    hasOneSignalAppId: Boolean(appConfigClient.oneSignalAppId),
  });

  if (!appConfigClient.oneSignalAppId) {
    debugLog("NEXT_PUBLIC_ONESIGNAL_APP_ID vazio; push desativado.");
    return {
      enabled: false,
      subscribed: false,
      message: "OneSignal nao configurado.",
    };
  }

  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return {
      enabled: false,
      subscribed: false,
      message: "Push nao suportado neste navegador.",
    };
  }

  try {
    await loadOneSignalSdk();
    debugLog("SDK carregado.");

    return await new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (oneSignal) => {
        try {
          await oneSignal.init({
            appId: appConfigClient.oneSignalAppId,
            serviceWorkerPath: "/sw.js",
          });
          debugLog("SDK inicializado.");

          const permissionGranted =
            oneSignal.Notifications.permission ||
            (await oneSignal.Notifications.requestPermission());
          const permissionStatus = permissionGranted ? "granted" : Notification.permission;
          debugLog("Status de permissao recebido.", permissionStatus);

          oneSignal.User.PushSubscription.addEventListener?.("change", (event) => {
            if (event.current?.id) {
              void sendSubscription(oneSignal, permissionStatus);
            }
          });

          const subscribed = await sendSubscription(oneSignal, permissionStatus);

          resolve({
            enabled: true,
            subscribed,
            message: subscribed
              ? "Inscricao push registrada."
              : "Permissao recebida, aguardando identificador do dispositivo.",
          });
        } catch {
          debugLog("Erro ao inicializar push.");
          resolve({
            enabled: true,
            subscribed: false,
            message: "Nao foi possivel inicializar o push agora.",
          });
        }
      });
    });
  } catch {
    debugLog("Erro ao carregar SDK.");
    return {
      enabled: true,
      subscribed: false,
      message: "Nao foi possivel carregar o push agora.",
    };
  }
}
