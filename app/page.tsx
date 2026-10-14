import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** The root route sends signed-in users to the POS and everyone else to sign-in. */
export default async function RootPage(): Promise<never> {
  const session = await getCurrentSession();
  redirect(session ? "/pos" : "/login");
}
