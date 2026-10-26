import { useEffect, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import type { WledColor } from "@wled-manager/shared";
import { channelsToHex, colorCss, hexToChannels, toChannels } from "./color";

/** Swatch that opens a color picker; shows a white-channel slider for RGBW colors. */
export function ColorField({
  label,
  value,
  rgbw,
  onChange,
}: {
  label: string;
  value: WledColor | undefined;
  rgbw: boolean;
  onChange: (c: WledColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ch = toChannels(value);
  const white = rgbw || ch.length === 4 ? (ch[3] ?? 0) : undefined;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md border border-neutral-700 px-2 py-1 text-xs hover:border-neutral-500"
      >
        <span className="size-4 rounded-sm border border-neutral-600" style={{ background: colorCss(value) }} />
        {label}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 flex flex-col gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl">
          <HexColorPicker color={channelsToHex(ch)} onChange={(hex) => onChange(hexToChannels(hex, white))} />
          <HexColorInput
            prefixed
            color={channelsToHex(ch)}
            onChange={(hex) => hex.length === 7 && onChange(hexToChannels(hex, white))}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs"
          />
          {white !== undefined && (
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              White {white}
              <input
                type="range"
                min={0}
                max={255}
                value={white}
                onChange={(e) => onChange(hexToChannels(channelsToHex(ch), Number(e.target.value)))}
                className="accent-neutral-200"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
