"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n/client";

interface SignOutButtonProps {
  /** Called when the server refuses to sign out because a shift is still open. The till uses it to ask for the cash count. */
  onShiftOpen?: () => void;
}

/** Ends the session on the server, then returns to the sign-in page. Blocked while a cash-drawer shift is open. */
export function SignOutButton({ onShiftOpen }: SignOutButtonProps = {}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      if (res.status === 409) {
        if (onShiftOpen) onShiftOpen();
        else toast.add({ title: t("signout.shiftOpen"), description: t("signout.shiftOpenBody"), type: "error" });
        return;
      }
    } catch {
      // The request never reached the server. Leaving anyway is the safer choice for a shared till.
    } finally {
      setPending(false);
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={signOut} disabled={pending}>
      <LogOut className="size-4" />
      {t("common.signOut")}
    </Button>
  );
}
