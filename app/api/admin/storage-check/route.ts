import { requireManager } from "@/lib/api-helpers";
import { checkStorage, getStorageConfig } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage-check
 *
 * Tests the photo storage settings of the server that answers: URL, key, bucket and a small write. Managers only.
 * The answer says what is wrong in plain words and never contains the key. Open it in the browser while signed in.
 */
export async function GET(): Promise<Response> {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;
  return Response.json(await checkStorage(getStorageConfig()));
}
