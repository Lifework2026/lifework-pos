import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleToggle } from "@/components/locale-toggle";
import { getCurrentSession } from "@/lib/auth/server";
import { isAdminRole } from "@/lib/auth/session";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

const NAV_ITEMS: { href: string; key: MessageKey }[] = [
  { href: "/admin", key: "nav.dashboard" },
  { href: "/admin/orders", key: "nav.sales" },
  { href: "/admin/inventory", key: "nav.stock" },
  { href: "/admin/inventory/receive", key: "nav.receive" },
  { href: "/admin/products/new", key: "nav.newProduct" },
  { href: "/admin/promotions", key: "nav.promotions" },
];

/** Back-office shell. Only managers and admins get past this layout. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/admin");
  if (!isAdminRole(session.role)) redirect("/pos");

  const locale = getServerLocale();
  const t = serverT(locale);

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/admin" className="text-lg font-bold tracking-tight">
              Lifework {t("common.backOffice")}
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {t(item.key)}
                </Link>
              ))}
              <Link href="/pos" className="rounded-md px-3 py-1.5 font-medium text-primary hover:bg-muted">
                {t("common.openPos")}
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LocaleToggle />
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
