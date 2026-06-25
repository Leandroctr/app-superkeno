"use client";

import { useEffect } from "react";
import OneSignal from "react-onesignal";

export function OneSignalInitializer() {
  useEffect(() => {
    OneSignal.init({
      appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "",
    }).then(() => {
      OneSignal.Notifications.requestPermission();

      OneSignal.User.PushSubscription.addEventListener("change", (event) => {
        const id = event.current?.id;
        if (id && event.current?.optedIn) {
          void fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              onesignalId: id,
              permissionStatus: "granted",
              userAgent: navigator.userAgent,
              deviceType: "web",
            }),
          });
        }
      });
    });
  }, []);

  return null;
}
