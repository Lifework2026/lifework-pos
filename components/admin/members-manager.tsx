"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ActionBar } from "@/components/admin/action-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatBaht } from "@/lib/format";
import { requestJson } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";

interface MemberRow {
  id: string;
  name: string;
  phone: string;
  points: number;
  isActive: boolean;
  createdAt: string;
  orderCount: number;
  totalSpent: string;
}

type Panel =
  | { kind: "create" }
  | { kind: "edit"; member: MemberRow }
  | { kind: "points"; member: MemberRow }
  | null;

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Customer list for managers: find, add, edit and adjust loyalty points. */
export function MembersManager() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await requestJson<{ members: MemberRow[] }>(`/api/admin/members?q=${encodeURIComponent(debounced)}`, { method: "GET" });
    if (result.ok) {
      setMembers(result.data.members);
      setError(null);
    } else {
      setError(t("common.networkError"));
    }
    setLoading(false);
  }, [debounced, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function done(successKey: Parameters<typeof t>[0]): void {
    setPanel(null);
    toast.add({ title: t(successKey), type: "success" });
    void load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("members.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("members.desc")}</p>
        </div>
        <ActionBar onCreate={() => setPanel({ kind: "create" })} template="F" exportKind="members" />
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("members.search")} aria-label={t("members.search")} className="h-10 max-w-md" />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t("members.name")}</th>
              <th className="px-4 py-2 font-medium">{t("members.phone")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("members.points")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("members.orders")}</th>
              <th className="px-4 py-2 text-right font-medium">{t("members.spent")}</th>
              <th className="px-4 py-2 font-medium">{t("members.status")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && members.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-4 animate-spin" />
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t("members.none")}
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className={`border-t ${member.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2 font-medium">{member.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{member.phone}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{member.points}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{member.orderCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBaht(Number(member.totalSpent))}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${member.isActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
                    >
                      {member.isActive ? t("members.active") : t("members.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "points", member })}>
                        {t("members.adjust")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: "edit", member })}>
                        {t("members.edit")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {panel?.kind === "create" ? <MemberFormDialog onClose={() => setPanel(null)} onSaved={() => done("members.added")} /> : null}
      {panel?.kind === "edit" ? <MemberFormDialog member={panel.member} onClose={() => setPanel(null)} onSaved={() => done("members.saved")} /> : null}
      {panel?.kind === "points" ? <PointsDialog member={panel.member} onClose={() => setPanel(null)} onSaved={() => done("members.pointsUpdated")} /> : null}
    </div>
  );
}

function MemberFormDialog({ member, onClose, onSaved }: { member?: MemberRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(member?.name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const result = member
      ? await requestJson(`/api/admin/members/${member.id}`, jsonInit("PATCH", { name, phone, isActive }), { retries: 0 })
      : await requestJson("/api/admin/members", jsonInit("POST", { name, phone }), { retries: 0 });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? t("common.networkError"));
      return;
    }
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? t("members.editTitle") : t("members.add")}</DialogTitle>
          <DialogDescription>{member ? member.phone : t("member.phoneHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("members.name")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("members.phone")}</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} placeholder={t("member.phoneHint")} />
          </label>
          {member ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4" />
              {t("members.activeToggle")}
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !phone.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("catalog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointsDialog({ member, onClose, onSaved }: { member: MemberRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(delta);
  const valid = delta.trim() !== "" && Number.isInteger(amount) && amount !== 0 && member.points + amount >= 0 && reason.trim().length >= 3;

  async function apply(): Promise<void> {
    setSaving(true);
    setError(null);
    const result = await requestJson(`/api/admin/members/${member.id}/points`, jsonInit("POST", { delta: amount, reason: reason.trim() }), { retries: 0 });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? t("common.networkError"));
      return;
    }
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("members.adjustTitle", { name: member.name })}</DialogTitle>
          <DialogDescription>{t("members.adjustHint", { points: member.points })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("members.delta")}</span>
            <Input type="number" step={1} value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+50 / -20" />
          </label>
          {delta.trim() !== "" && Number.isInteger(amount) ? (
            <p className="text-sm text-muted-foreground">
              {member.points} → <span className="font-semibold">{member.points + amount}</span>
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("members.reason")}</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={apply} disabled={saving || !valid}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("members.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
