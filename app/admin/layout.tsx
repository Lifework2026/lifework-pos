import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getCurrentSession } from "@/lib/auth/server";
import { isAdminRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/orders", label: "Sales" },
  { href: "/admin/inventory", label: "Stock" },
  { href: "/admin/inventory/receive", label: "Receive / adjust" },
  { href: "/admin/products/new", label: "New product" },
  { href: "/admin/promotions", label: "Promotions" },
];

/** Back-office shell. Only managers and admins get past this layout. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/admin");
  if (!isAdminRole(session.role)) redirect("/pos");

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/admin" className="text-lg font-bold tracking-tight">
              Lifework Back Office
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/pos" className="rounded-md px-3 py-1.5 font-medium text-primary hover:bg-muted">
                Open POS
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {session.fullName} · {session.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
