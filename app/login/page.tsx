"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LocaleToggle } from "@/components/locale-toggle";
import { useI18n } from "@/lib/i18n/client";
import type { ApiErrorBody } from "@/lib/pos-types";

/** Only same-site relative paths are allowed, so `next` cannot send users off-site. */
function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/pos";
  return value;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setError(body?.message ?? t("login.failed"));
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex justify-end">
          <LocaleToggle />
        </div>
        <CardTitle className="text-xl">{t("login.title")}</CardTitle>
        <CardDescription>{t("login.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <label htmlFor="username" className="text-sm font-medium">
              {t("login.username")}
            </label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("login.password")}
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              className="h-11"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="h-11" disabled={submitting || !username || !password}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {t("login.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
