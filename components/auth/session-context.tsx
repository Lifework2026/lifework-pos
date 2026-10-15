"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/auth/session";

const SessionContext = createContext<SessionUser | null>(null);

/** Makes the signed-in user available to till components, so they can hide manager-only actions. */
export const SessionProvider = SessionContext.Provider;

export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext);
}

/** Managers and admins. Client-side hint only: the server enforces the same rule on every route. */
export function canManage(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}
