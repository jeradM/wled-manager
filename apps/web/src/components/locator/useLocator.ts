import { useCallback, useEffect, useRef, useState } from "react";
import { indicesToSpans, spansToIndices, type LedSpan } from "@wled-manager/shared";
import { api } from "../../api";
import type { SelectMods } from "./LedMap";

const NO_MODS: SelectMods = { range: false, toggle: false };
const between = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k);

/**
 * Drives a locator session on a controller. Selecting LEDs starts a session if needed (the server saves
 * the controller's state first) and lights the selection. Rapid changes are coalesced so only the latest
 * selection is sent once the previous request finishes. Leaving the page ends the session, which
 * restores the controller.
 */
export function useLocator(controllerId: string) {
  const [active, setActive] = useState(false);
  /** The LED last clicked or stepped to. */
  const [index, setIndex] = useState<number | null>(null);
  const [selection, setSelectionState] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const color = useRef("#ffffff");
  const activeRef = useRef(false);
  const inFlight = useRef(false);
  const pending = useRef<LedSpan[] | null>(null);
  const selected = useRef<ReadonlySet<number>>(new Set());
  /** Where Shift-click ranges start: the last plain or Ctrl/Cmd click. */
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    api<{ active: boolean }>(`/controllers/${controllerId}/locate`).then((r) => {
      activeRef.current = r.active;
      setActive(r.active);
    });
  }, [controllerId]);

  const flush = useCallback(async () => {
    if (inFlight.current || pending.current === null) return;
    const spans = pending.current;
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
        body: JSON.stringify({ spans, color: color.current }),
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

  const setSelection = useCallback(
    (next: ReadonlySet<number>, focus: number | null) => {
      selected.current = next;
      setSelectionState(next);
      setIndex(focus);
      pending.current = indicesToSpans(next);
      void flush();
    },
    [flush],
  );

  /** Plain click: just this LED. Shift: the run from the anchor. Ctrl/Cmd: add or remove. Both: add the run. */
  const select = useCallback(
    (i: number, mods: SelectMods = NO_MODS) => {
      const from = anchor.current ?? i;
      let next: Set<number>;
      if (mods.range) {
        next = new Set(mods.toggle ? selected.current : []);
        for (const k of between(from, i)) next.add(k);
      } else if (mods.toggle) {
        next = new Set(selected.current);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        anchor.current = i;
      } else {
        next = new Set([i]);
        anchor.current = i;
      }
      setSelection(next, i);
    },
    [setSelection],
  );

  const selectSpans = useCallback(
    (spans: LedSpan[]) => {
      anchor.current = spans[0]?.start ?? null;
      setSelection(new Set(spansToIndices(spans)), anchor.current);
    },
    [setSelection],
  );

  const clear = useCallback(() => {
    anchor.current = null;
    setSelection(new Set(), null);
  }, [setSelection]);

  const setColor = useCallback(
    (c: string) => {
      color.current = c;
      if (activeRef.current && selected.current.size) setSelection(selected.current, index);
    },
    [index, setSelection],
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

  return { active, index, selection, busy, error, select, selectSpans, clear, stop, setColor };
}
