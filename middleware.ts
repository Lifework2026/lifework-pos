import { NextResponse, type NextRequest } from "next/server";
import { isAdminRole, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/** API paths that do not require a session. The EDC webhook authenticates with its own secret. */
const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/edc/webhook", "/api/health"];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PATHS.some((path) => pathname === path);
}

/**
 * Guards pages and APIs:
 * - /pos/*: any signed-in user.
 * - /admin/*: managers and admins only. Cashiers are sent back to /pos.
 * - /api/*: signed-in user, and /api/admin/* needs a manager or admin.
 * Pages redirect to /login. APIs answer 401 or 403 as JSON.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "UNAUTHENTICATED", message: "Sign in to continue." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const needsAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (needsAdmin && !isAdminRole(session.role)) {
    if (isApi) {
      return NextResponse.json({ error: "FORBIDDEN", message: "Manager access required." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/pos", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/pos/:path*", "/admin/:path*", "/api/:path*"],
};
