import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { AdminNav, type AdminNavGroup } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleToggle } from "@/components/locale-toggle";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentSession } from "@/lib/auth/server";
import { isAdminRole } from "@/lib/auth/session";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** The menu, grouped by the job it belongs to. The first group has no heading. */
const NAV_GROUPS: { title: MessageKey | null; items: { href: string; key: MessageKey }[] }[] = [
  { title: null, items: [{ href: "/admin", key: "nav.dashboard" }] },
  {
    title: "nav.groupSales",
    items: [
      { href: "/admin/orders", key: "nav.sales" },
      { href: "/admin/shifts", key: "nav.shifts" },
      { href: "/admin/eod", key: "nav.eod" },
      { href: "/admin/promotions", key: "nav.promotions" },
      { href: "/admin/members", key: "nav.members" },
    ],
  },
  {
    title: "nav.groupProducts",
    items: [
      { href: "/admin/products", key: "nav.products" },
      { href: "/admin/catalog", key: "nav.catalog" },
      { href: "/admin/colors", key: "nav.colors" },
      { href: "/admin/master-data", key: "nav.masterData" },
      { href: "/admin/excel", key: "nav.excel" },
    ],
  },
  {
    title: "nav.groupStock",
    items: [
      { href: "/admin/inventory", key: "nav.stock" },
      { href: "/admin/inventory/receive", key: "nav.receive" },
      { href: "/admin/inventory/ledger", key: "nav.ledger" },
    ],
  },
];

/**
 * Back-office shell for a laptop screen: the menu is a fixed column on the left and the page gets the whole width to the
 * right of it, so wide tables do not wrap. Only managers and admins get past this layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/login?next=/admin");
  if (!isAdminRole(session.role)) redirect("/pos");

  const locale = getServerLocale();
  const t = serverT(locale);
  const groups: AdminNavGroup[] = NAV_GROUPS.map((group) => ({
    title: group.title ? t(group.title) : null,
    items: group.items.map((item) => ({ href: item.href, label: t(item.key) })),
  }));

  return (
    <div className="flex h-dvh min-w-[1100px] bg-canvas">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex flex-col gap-2.5 border-b px-4 py-3">
          <Link href="/admin" className="text-[15px] leading-tight font-semibold tracking-tight">
            Lifework
            <span className="block text-xs font-normal text-muted-foreground">{t("common.backOffice")}</span>
          </Link>
          <Link href="/pos" className={cn(buttonVariants({ size: "sm" }), "h-9 w-full justify-center text-sm font-medium")}>
            <ShoppingCart className="size-4" />
            {t("common.openPos")}
          </Link>
        </div>
        <AdminNav groups={groups} />
        <div className="flex flex-col gap-2 border-t px-4 py-3">
          <p className="truncate text-xs text-muted-foreground" title={`${session.fullName} · ${session.role}`}>
            {session.fullName} · {session.role}
          </p>
          <div className="flex items-center justify-between gap-2">
            <LocaleToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
