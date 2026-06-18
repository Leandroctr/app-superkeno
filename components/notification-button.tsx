"use client";

import { useState } from "react";
import { initializeOneSignal } from "@/lib/onesignal/client";

type NotificationButtonProps = {
  themeColor: string;
};

type Status = {
  type: "idle" | "loading" | "success" | "error";
  message: string;
};

export function NotificationButton({ themeColor }: NotificationButtonProps) {
  const [status, setStatus] = useState<Status>({
    type: "idle",
    message: "",
  });

  async function activateNotifications() {
    setStatus({
      type: "loading",
      message: "Ativando notificacoes...",
    });

    const result = await initializeOneSignal();

    setStatus({
      type: result.subscribed ? "success" : "error",
      message: result.message,
    });
  }

  return (
    <div className="grid gap-2">
      <button
        className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-800 shadow-sm transition hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={status.type === "loading"}
        onClick={activateNotifications}
        type="button"
      >
        {status.type === "loading" ? "Ativando..." : "Ativar notificacoes"}
      </button>

      {status.message ? (
        <p
          className={
            status.type === "success"
              ? "rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
              : "rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
          }
          style={
            status.type === "success"
              ? { borderLeft: `4px solid ${themeColor}` }
              : undefined
          }
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
