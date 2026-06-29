"use client";

import { useEffect } from "react";
import { logClientError } from "@/lib/logger/client";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        logClientError("sw_register_error", err, { swPath: "/sw.js" });
      });
    }
  }, []);

  return null;
}
