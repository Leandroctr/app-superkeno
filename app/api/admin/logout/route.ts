import { NextResponse } from "next/server";
import { logServerWarn } from "@/lib/logger/server";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";

export async function POST(request: Request) {
  const sessionClient = await createSupabaseSessionClient();

  if (sessionClient) {
    const { error } = await sessionClient.auth.signOut({ scope: "global" });

    if (error) {
      logServerWarn("admin_logout_remote_error", {
        errorMessage: error.message,
      });
      // Remove a sessao deste navegador mesmo se a revogacao remota falhar.
      await sessionClient.auth.signOut({ scope: "local" });
    }
  }

  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
