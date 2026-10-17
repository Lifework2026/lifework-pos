"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  href: string;
  label: string;
}

export interface AdminNavGroup {
  /** Small heading above the group. Null for the first group, which stands alone. */
  title: string | null;
  items: AdminNavItem[];
}

/**
 * The back office menu, as a column on the left. The current page is highlighted. An item is current when the address
 * matches it exactly, or starts with it and no longer item matches better (so "Stock history" does not light up "Stock").
 */
export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname();
  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  const current = hrefs
    .filter((href) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5 text-sm" aria-label="Back office">
      {groups.map((group, index) => (
        <div key={group.title ?? index} className="flex flex-col gap-0.5">
          {group.title ? <p className="px-2.5 pb-1 text-[10px] font-bold tracking-[0.16em] text-zinc-500 uppercase">{group.title}</p> : null}
          {group.items.map((item) => {
            const active = item.href === current;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[3px] px-2.5 py-1 leading-snug transition-colors",
                  active ? "bg-white font-bold text-black" : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
