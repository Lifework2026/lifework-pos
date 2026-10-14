import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health: pings the database. Public, so the connection can be checked
 * from a browser on any deployment without signing in.
 */
export async function GET(): Promise<Response> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, database: "up", latencyMs: Date.now() - started });
  } catch (err) {
    console.error("[GET /api/health]", err);
    return Response.json({ ok: false, database: "down", message: "Database is not reachable." }, { status: 503 });
  }
}
