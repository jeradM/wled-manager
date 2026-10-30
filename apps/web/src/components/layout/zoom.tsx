import { useEffect, useRef, useState } from "react";

const MAX_ZOOM = 20;
const FIT: View = { z: 1, ox: 0, oy: 0 };
/** Zoom (1 = the whole picture fits) and where the picture's top left corner sits in the view, in pixels. */
export type View = { z: number; ox: number; oy: number };
/** The view's size, and the picture's size when it fits. */
export type Geo = { w: number; h: number; bw: number; bh: number };

/** `v` kept in bounds: a picture smaller than the view is centered, a larger one leaves no empty edge. */
function fitView(v: View, g: Geo): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  const cw = g.bw * z;
  const ch = g.bh * z;
  return {
    z,
    ox: cw <= g.w ? (g.w - cw) / 2 : Math.min(0, Math.max(g.w - cw, v.ox)),
    oy: ch <= g.h ? (g.h - ch) / 2 : Math.min(0, Math.max(g.h - ch, v.oy)),
  };
}

export const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Zooming and panning a picture inside the element `ref`, whose size and the picture's fitted size are `geo`.
 * When `enabled`: pinch or Ctrl/⌘ + scroll zooms around the cursor, scroll pans once zoomed in, and + / − / 0
 * zoom from anywhere on the page (not while typing). Drag panning is the caller's to start (`startPan`) and
 * feed (`movePan`, `endPan`), as only it knows which presses pan.
 */
export function useZoomPan(ref: React.RefObject<HTMLElement | null>, geo: Geo, enabled: boolean) {
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [raw, setRaw] = useState<View>(FIT);
  const view = fitView(raw, geo);
  const zoomRef = useRef(view.z);
  zoomRef.current = view.z;
  const [pan, setPan] = useState<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  /** Zooms by `f`, keeping the picture under view point (`sx`, `sy`) where it is. */
  const zoomAt = (sx: number, sy: number, f: number) =>
    setRaw((v) => {
      const g = geoRef.current;
      const c = fitView(v, g);
      const z = Math.min(MAX_ZOOM, Math.max(1, c.z * f));
      const u = (sx - c.ox) / (g.bw * c.z);
      const t = (sy - c.oy) / (g.bh * c.z);
      return fitView({ z, ox: sx - u * g.bw * z, oy: sy - t * g.bh * z }, g);
    });
  const zoomCenter = (f: number) => zoomAt(geoRef.current.w / 2, geoRef.current.h / 2, f);
  const fit = () => setRaw(FIT);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    // Not a React handler: those are passive, and the page mustn't zoom or scroll instead.
    const wheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? geoRef.current.h : 1;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Pinches arrive as Ctrl + scroll with small steps; a mouse wheel's steps are big.
        e.preventDefault();
        const d = Math.max(-100, Math.min(100, e.deltaY * unit));
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-d * 0.0035));
        return;
      }
      if (zoomRef.current === 1) return; // all in view: let the page scroll
      e.preventDefault();
      setRaw((v) => {
        const g = geoRef.current;
        const c = fitView(v, g);
        return fitView({ ...c, ox: c.ox - e.deltaX * unit, oy: c.oy - e.deltaY * unit }, g);
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomCenter(1.5);
      else if (e.key === "-" || e.key === "_") zoomCenter(1 / 1.5);
      else if (e.key === "0") fit();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    view,
    /** The picture's size on screen. */
    cw: geo.bw * view.z,
    ch: geo.bh * view.z,
    zoomCenter,
    fit,
    panning: !!pan,
    startPan: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setPan({ x: e.clientX, y: e.clientY, view, moved: false });
    },
    /** Follows a pan in progress; false when there's none. */
    movePan: (e: React.PointerEvent) => {
      if (!pan) return false;
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) > 3) setPan({ ...pan, moved: true });
      setRaw(fitView({ ...pan.view, ox: pan.view.ox + dx, oy: pan.view.oy + dy }, geo));
      return true;
    },
    /** Ends a pan: "click" if the pointer barely moved, so the caller can treat it as one; null without a pan. */
    endPan: () => {
      setPan(null);
      return pan ? (pan.moved ? "pan" : "click") : null;
    },
  };
}

/** − / zoom level (click to fit) / + buttons, for the top right corner of a zoomable view. */
export function ZoomControls({ zoom, title }: { zoom: ReturnType<typeof useZoomPan>; title: string }) {
  const z = zoom.view.z;
  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center overflow-hidden rounded-md border border-neutral-700 bg-neutral-900/90 text-xs text-neutral-200 shadow"
      title={title}
    >
      <button type="button" onClick={() => zoom.zoomCenter(1 / 1.5)} disabled={z <= 1} className="px-2 py-1 hover:bg-neutral-800 disabled:opacity-40" aria-label="Zoom out">
        −
      </button>
      <button type="button" onClick={zoom.fit} className="min-w-14 px-2 py-1 tabular-nums hover:bg-neutral-800" aria-label="Fit picture">
        {z === 1 ? "Fit" : `${Math.round(z * 100)}%`}
      </button>
      <button type="button" onClick={() => zoom.zoomCenter(1.5)} disabled={z >= MAX_ZOOM} className="px-2 py-1 hover:bg-neutral-800 disabled:opacity-40" aria-label="Zoom in">
        +
      </button>
    </div>
  );
}
