import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { appConfig } from "@/lib/app-config";

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

// Cliente Supabase com sessao baseada em cookies (App Router), usado para
// ler/validar a sessao Supabase Auth do administrador logado. Diferente de
// createSupabaseAdminClient() (service role, ignora RLS): este cliente usa a
// anon key e respeita RLS, exatamente como o navegador do usuario faria.
//
// Usado pelo login, pelos guards administrativos e pelo logout.
export async function createSupabaseSessionClient() {
  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
    cookieOptions: adminSessionCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignorado quando chamado a partir de um Server Component sem
          // permissao de escrita de cookies (ex.: renderizacao de pagina).
          // O proxy atualiza a sessao antes dos Server Components e persiste
          // os cookies renovados na resposta.
        }
      },
    },
  });
}
