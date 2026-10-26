import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

/**
 * Drives a locator session on a controller. Selecting an LED starts a session if needed (the server
 * saves the controller's state first). Rapid steps are coalesced so only the latest LED is sent once
 * the previous request finishes. Leaving the page ends the session, which restores the controller.
 */
export function useLocator(controllerId: string) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const color = useRef("#ffffff");
  const activeRef = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    api<{ active: boolean }>(`/controllers/${controllerId}/locate`).then((r) => {
      activeRef.current = r.active;
      setActive(r.active);
    });
  }, [controllerId]);

  const flush = useCallback(async () => {
    if (inFlight.current || pending.current === null) return;
    const target = pending.current;
    pending.current = null;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!activeRef.current) {
        await api(`/controllers/${controllerId}/locate/start`, { method: "POST" });
        activeRef.current = true;
        setActive(true);
      }
      await api(`/controllers/${controllerId}/locate`, {
        method: "POST",
        body: JSON.stringify({ index: target, color: color.current }),
      });
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      void flush();
    }
  }, [controllerId]);

  const select = useCallback(
    (i: number) => {
      setIndex(i);
      pending.current = i;
      void flush();
    },
    [flush],
  );

  const setColor = useCallback(
    (c: string) => {
      color.current = c;
      if (activeRef.current && index !== null) select(index);
    },
    [index, select],
  );

  const stop = useCallback(async () => {
    pending.current = null;
    activeRef.current = false;
    setActive(false);
    await api(`/controllers/${controllerId}/locate/stop`, { method: "POST" }).catch((e) => setError(String(e)));
  }, [controllerId]);

  // Restore the controller when the user navigates away or closes the tab.
  useEffect(() => {
    const url = `/api/controllers/${controllerId}/locate/stop`;
    const onUnload = () => activeRef.current && navigator.sendBeacon(url);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      if (activeRef.current) void fetch(url, { method: "POST", keepalive: true });
    };
  }, [controllerId]);

  return { active, index, busy, error, select, stop, setColor };
}
