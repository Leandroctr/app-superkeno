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

let initPromise: Promise<OneSignalInitResult> | null = null;

function debugLog(message: string, details?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[OneSignal] ${message}`, details ?? "");
  }
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
    debugLog(
      "Falha ao salvar inscricao push.",
      await response.json().catch((error) => {
        console.error("[OneSignal] Init error:", error);
        return null;
      }),
    );
  }

  return response.ok;
}

export function initializeOneSignal(
  oneSignalAppId = appConfigClient.oneSignalAppId,
): Promise<OneSignalInitResult> {
  if (initPromise) return initPromise;
  initPromise = _initializeOneSignal(oneSignalAppId);
  return initPromise;
}

async function _initializeOneSignal(
  oneSignalAppId: string,
): Promise<OneSignalInitResult> {
  debugLog("Config publica carregada.", {
    hasOneSignalAppId: Boolean(oneSignalAppId),
  });

  if (!oneSignalAppId) {
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
    return await new Promise((resolve) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (oneSignal) => {
        try {
          debugLog("SDK inicializado, solicitando permissao.");
          debugLog("Notification.permission atual.", Notification.permission);

          const permissionGranted =
            oneSignal.Notifications.permission ||
            (await oneSignal.Notifications.requestPermission());
          const permissionStatus = permissionGranted ? "granted" : Notification.permission;
          debugLog("Notification.permission apos request.", Notification.permission);
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
        } catch (error) {
          console.error("[OneSignal] Init error:", error);
          debugLog("Erro ao inicializar push.");
          resolve({
            enabled: true,
            subscribed: false,
            message: "Nao foi possivel inicializar o push agora.",
          });
        }
      });
    });
  } catch (error) {
    console.error("[OneSignal] Init error:", error);
    return {
      enabled: true,
      subscribed: false,
      message: "Nao foi possivel inicializar o push agora.",
    };
  }
}
