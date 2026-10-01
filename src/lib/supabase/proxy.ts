import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { missingEnv, missingEnvMessage } from "@/lib/env";

const PUBLIC_PATHS = ["/login"];
/** Set for a few seconds after a bounce so a redirect loop is impossible. */
const BOUNCE_COOKIE = "daylog_renewed";

/** A Supabase session cookie is present, even if it could not be verified right now. */
function hasAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some((c) => c.name.includes("auth-token") && c.value !== "");
}

export async function updateSession(request: NextRequest) {
  // Say what is wrong instead of failing with a blank 500.
  const missing = missingEnv();
  if (missing.length > 0) {
    return new NextResponse(missingEnvMessage(missing), {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });
  // Cookies Supabase writes when it renews the session during this request.
  const renewed: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          renewed.push(...cookiesToSet);
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims — it refreshes the session.
  // Refresh tokens are single-use, so parallel requests with an expired token can
  // lose the race. Treat that as "still signed in" rather than erroring or logging out;
  // the request that won the race has already written fresh cookies.
  let signedIn: boolean;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims;
  } catch {
    signedIn = hasAuthCookie(request);
  }
  if (!signedIn && hasAuthCookie(request)) signedIn = true;
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // The session was renewed while handling this request. Rendering now would use
  // the token the browser sent (already expired), which fails and leaves you on an
  // error page until you reload by hand. Bounce once instead: the browser repeats
  // the request with the cookies attached below, and the page renders signed in.
  const isPageLoad =
    request.method === "GET" &&
    (request.headers.get("accept") ?? "").includes("text/html") &&
    !request.headers.has("rsc") &&
    !request.cookies.has(BOUNCE_COOKIE);

  if (renewed.length > 0 && signedIn && isPageLoad) {
    const bounce = NextResponse.redirect(request.nextUrl, { status: 307 });
    renewed.forEach(({ name, value, options }) => bounce.cookies.set(name, value, options));
    bounce.cookies.set(BOUNCE_COOKIE, "1", { maxAge: 10, httpOnly: true, sameSite: "lax", path: "/" });
    return bounce;
  }
  if (request.cookies.has(BOUNCE_COOKIE)) response.cookies.delete(BOUNCE_COOKIE);

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
