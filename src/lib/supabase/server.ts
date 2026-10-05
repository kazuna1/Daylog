import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { missingEnv, missingEnvMessage } from "@/lib/env";

/**
 * `attempt` is only for retries. Next remembers the result of a fetch for the
 * rest of the render, so repeating the identical request hands back the first
 * answer — including its failure — without going near the network. The header
 * makes a retry a different request, so it really is one.
 */
export async function createClient(attempt = 0) {
  const missing = missingEnv();
  if (missing.length > 0) throw new Error(missingEnvMessage(missing));

  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: attempt > 0 ? { headers: { "x-daylog-attempt": String(attempt) } } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — the proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

/** Returns the signed-in user's id, or null. Uses verified JWT claims. */
export async function getUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}
