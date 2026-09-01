import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { appConfig } from "@/lib/app-config";
import { adminSessionCookieOptions } from "@/lib/supabase/admin-session";

const obsoleteLegacyCookieName = "admin_session";

function expireLegacyCookie(response: NextResponse) {
  response.cookies.set(obsoleteLegacyCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function updateAdminSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    expireLegacyCookie(response);
    return response;
  }

  const supabase = createServerClient(
    appConfig.supabaseUrl,
    appConfig.supabaseAnonKey,
    {
      cookieOptions: adminSessionCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, responseHeaders) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(responseHeaders).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  // Atualiza tokens expirados antes dos Server Components. Os guards ainda
  // usam getUser(), que consulta o Auth server e reflete usuario removido ou
  // desabilitado; getSession() nunca e usado para autorizar.
  await supabase.auth.getClaims();
  expireLegacyCookie(response);
  return response;
}
