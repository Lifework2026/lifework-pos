"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiErrorBody, MemberSummary } from "@/lib/pos-types";

interface MemberPickerProps {
  selected: MemberSummary | null;
  onSelect: (member: MemberSummary | null) => void;
  disabled?: boolean;
}

/** Finds a member by phone digits or name, or registers a new one at the till. */
export function MemberPicker({ selected, onSelect, disabled }: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSummary[]>([]);
  const [registering, setRegistering] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Lookup failed");
        const body: { members: MemberSummary[] } = await res.json();
        setResults(body.members);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setResults([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function register(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, phone: newPhone }),
      });
      const body = (await res.json().catch(() => null)) as { member?: MemberSummary } & ApiErrorBody;
      if (res.status === 409 && (body?.details as { member?: MemberSummary } | undefined)?.member) {
        onSelect((body.details as { member: MemberSummary }).member);
        setRegistering(false);
        return;
      }
      if (!res.ok || !body.member) {
        setError(body?.message ?? "Could not register the member.");
        return;
      }
      onSelect(body.member);
      setRegistering(false);
      setNewName("");
      setNewPhone("");
    } catch {
      setError("Network error. Check the connection and try again.");
    }
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{selected.name}</p>
          <p className="text-xs text-muted-foreground">
            {selected.phone} · {selected.points} points
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Remove member" onClick={() => onSelect(null)} disabled={disabled}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  if (registering) {
    return (
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" maxLength={100} />
        <Input
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          placeholder="Phone, e.g. 0812345678"
          inputMode="tel"
          maxLength={20}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRegistering(false)}>
            Back
          </Button>
          <Button size="sm" className="flex-1" onClick={register} disabled={!newName.trim() || !newPhone.trim()}>
            Register member
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Member: phone or name"
        aria-label="Find member"
        disabled={disabled}
      />
      {results.length > 0 ? (
        <ul className="max-h-40 divide-y overflow-y-auto rounded-md border">
          {results.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onSelect(member);
                  setQuery("");
                }}
              >
                <span className="truncate">{member.name}</span>
                <span className="text-xs text-muted-foreground">
                  {member.phone} · {member.points} pts
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setRegistering(true)} disabled={disabled}>
        <UserPlus className="size-4" /> New member
      </Button>
    </div>
  );
}
