"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

/** Ends the session on the server, then returns to the sign-in page. */
export function SignOutButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
      <LogOut className="size-4" />
      {t("common.signOut")}
    </Button>
  );
}
