"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

const NetworkContext = createContext<boolean>(true);

/**
 * Tracks the browser's connection. While offline, a red banner stays at the top of every page, and the
 * payment, void, refund and shift buttons read useOnline() and disable themselves, so no transaction starts
 * that would only time out. Sales already on screen are not lost: they are simply not submitted.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <NetworkContext.Provider value={online}>
      {!online ? (
        <div
          role="alert"
          aria-live="assertive"
          className="sticky top-0 z-[200] flex items-center justify-center gap-3 bg-red-600 px-4 py-3 text-center text-white shadow-md"
        >
          <WifiOff className="size-5 shrink-0" aria-hidden />
          <div>
            <p className="font-bold">No Internet Connection - System Paused</p>
            <p className="text-sm">{t("network.offlineBody")}</p>
          </div>
        </div>
      ) : null}
      {children}
    </NetworkContext.Provider>
  );
}

/** True while the browser has a connection. Payment, void, refund and shift buttons are disabled when false. */
export function useOnline(): boolean {
  return useContext(NetworkContext);
}
