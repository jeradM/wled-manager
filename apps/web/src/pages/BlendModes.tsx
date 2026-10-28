import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { segblend } from "@wled-manager/shared/sim";
import { BLEND_MODES } from "../components/preset/wled-options";
import { Card, PageHeader } from "../components/ui";

/**
 * How each segment blend mode works, with results computed by the simulator's port of WLED's
 * segblend(), so the swatches match what the controller does.
 */

interface ModeHelp {
  summary: string;
  /** Per-channel formula: T is the segment's own color (top), B what's already below it. */
  formula: string;
  details: ReactNode;
  tip: string;
}

const HELP: ModeHelp[] = [
  {
    summary: "The segment covers whatever is below it.",
    formula: "T",
    details: (
      <>
        The normal mode. Every pixel of the segment replaces the pixel below, including black ones: a segment's
        unlit pixels hide the segments below just as much as its lit ones do. White on top gives white.
      </>
    ),
    tip: "Use it when segments don't overlap, or when the top segment should simply win.",
  },
  {
    summary: "The segment is ignored; what's below shows.",
    formula: "B",
    details: (
      <>
        The opposite of Top: the result is always the bottom layer, so where the segment overlaps others it is
        invisible, and where nothing is below it shows black. The effect still runs, so switching back to
        another mode carries on where it is.
      </>
    ),
    tip: "Handy for hiding one layer while you work on the others.",
  },
  {
    summary: "Adds the two colors like overlapping light, without clipping the hue.",
    formula: "T + B, scaled down together if any channel passes 255",
    details: (
      <>
        Red plus blue gives magenta and blue plus cyan gives azure. When a channel would go past 255, WLED scales
        all channels down by the same factor instead of capping each one, so the mix keeps its hue rather than
        washing out. That's why white on orange gives a pale orange, not pure white. Over black (nothing below)
        the segment shows unchanged.
      </>
    ),
    tip: "Good for sparkles, chases or comets over a background effect; both stay visible where they cross.",
  },
  {
    summary: "Removes the segment's color from what's below.",
    formula: "B − T (never below 0)",
    details: (
      <>
        Each channel of the top color is taken away from the bottom. White removes everything, giving black. Red
        over orange takes out the red and leaves green. A dark top color changes little. Over nothing the result
        is black, because there is nothing to subtract from.
      </>
    ),
    tip: "Cut moving dark shapes into an effect, e.g. a white Scanner on top of Rainbow sweeps a black gap across it.",
  },
  {
    summary: "The distance between the two colors; white inverts what's below.",
    formula: "|B − T|",
    details: (
      <>
        Identical colors cancel to black. White on top inverts the bottom, so orange becomes blue and red becomes
        cyan. Black on top changes nothing. Over nothing, the segment shows unchanged.
      </>
    ),
    tip: "A moving white bar inverts the colors it passes over.",
  },
  {
    summary: "An even 50/50 mix of the two colors.",
    formula: "(T + B) ÷ 2",
    details: (
      <>
        Each channel is halved and added. Two bright colors give a mid-brightness mix (red and blue give a dim
        purple). Over nothing, the segment shows at half brightness, since it's averaged with black. Similar to
        Top with the segment's opacity at 50%.
      </>
    ),
    tip: "Blend two full-strip effects into one when neither should dominate.",
  },
  {
    summary: "The segment acts like a colored filter over what's below.",
    formula: "T × B ÷ 255",
    details: (
      <>
        White leaves the bottom unchanged, black blacks it out and 50% gray halves its brightness. Colors only
        pass where both layers share a channel: red on blue gives black, while white-ish tints keep most of the
        color. The result is never brighter than either layer. Over nothing the result is black.
      </>
    ),
    tip: "Put a slow brightness effect (Breathe, Sinewave, Noise) on top in white to mask or dim the effect below.",
  },
  {
    summary: "Brightens what's below by the inverse of the segment; usually saturates to full.",
    formula: "B × 255 ÷ T, or 255 when T ≤ B",
    details: (
      <>
        A white segment leaves the bottom unchanged. The darker the segment, the more the bottom is brightened,
        and any channel where the top is not brighter than the bottom goes straight to full. So black on top
        gives white, and 50% gray on orange gives yellow. This includes channels that are 0 in both layers: on
        RGBW strips the white channel is usually 0 in both, so Divide switches the white LEDs fully on. RGB strips
        ignore the white channel.
      </>
    ),
    tip: "Harsh and mostly blown out; mainly useful with bright top colors for strong highlights.",
  },
  {
    summary: "Keeps the brighter value of each channel.",
    formula: "max(T, B)",
    details: (
      <>
        Works per channel, not per color: red on blue gives magenta because each keeps its own channel, and 50%
        gray on orange gives a light orange. White on top gives white. Black on top changes nothing, and over
        nothing the segment shows unchanged.
      </>
    ),
    tip: "Cross two chases or comets so the brighter one shows where they meet, without the extra glow of Add.",
  },
  {
    summary: "Keeps the darker value of each channel.",
    formula: "min(T, B)",
    details: (
      <>
        Per channel again: red on blue gives black because each color is 0 where the other is lit. White on top
        leaves the bottom unchanged and black on top gives black. Over nothing the result is black.
      </>
    ),
    tip: "A harder-edged mask than Multiply: a white shape on top shows the bottom only inside the shape.",
  },
  {
    summary: "The inverse of Multiply: always brightens, never clips harshly.",
    formula: "255 − (255 − T) × (255 − B) ÷ 255",
    details: (
      <>
        Like shining two projectors on the same spot. White on top gives white, black on top changes nothing, and
        the result is never darker than either layer. 50% gray lightens orange towards peach. Softer than Add,
        which saturates faster. Over nothing, the segment shows unchanged.
      </>
    ),
    tip: "Glows and halos: a dim effect on top lifts the effect below without washing it out.",
  },
  {
    summary: "Raises the contrast of what's below, tinted by the segment.",
    formula: "B < 128: 2 × T × B ÷ 255; otherwise 255 − 2 × (255 − T) × (255 − B) ÷ 255",
    details: (
      <>
        Each channel of the bottom decides: dark channels are multiplied (darkened) and bright channels are
        screened (brightened). Channels that are 0 below stay 0, so the bottom's hue mostly survives. White on top
        pushes every lit channel up (orange becomes yellow), black on top pulls them down (orange becomes
        red-orange), and 50% gray leaves the bottom nearly unchanged. Over nothing the result is black.
      </>
    ),
    tip: "Add punch to an effect by putting a moving gray-to-white pattern on top.",
  },
  {
    summary: "Overlay decided by the segment instead: bright top brightens, dark top darkens.",
    formula: "T < 128: 2 × T × B ÷ 255; otherwise 255 − 2 × (255 − T) × (255 − B) ÷ 255",
    details: (
      <>
        Channels where the top is below half are multiplied, channels at half or above are screened. White on top
        gives white, black on top gives black, and 50% gray leaves the bottom nearly unchanged. Over nothing,
        channels of the top below half go dark and brighter ones are dimmed (orange becomes red-orange). Much
        stronger than Soft Light.
      </>
    ),
    tip: "A strong spotlight or shadow: bright pixels on top light up what's below, dark ones shade it.",
  },
  {
    summary: "A gentle version of Hard Light.",
    formula: "(255 − 2T) × B² ÷ 255² + 2 × T × B ÷ 255",
    details: (
      <>
        Tops above 50% gray brighten the bottom a little, tops below darken it a little, and 50% gray leaves it
        unchanged. It never turns a channel fully on or off unless the bottom already is: white on orange gives a
        warmer yellow-orange, black on orange a deeper orange. Over nothing the result is black.
      </>
    ),
    tip: "A subtle shimmer: a slow noise or wave effect on top gently modulates the effect below.",
  },
  {
    summary: "Brightens what's below strongly as the segment gets brighter.",
    formula: "B × 255 ÷ (255 − T), or 255 when 255 − T ≤ B",
    details: (
      <>
        Also known as color dodge. Black on top changes nothing, brighter tops push the bottom up quickly, and
        white on top gives white (even on channels that are 0 below). 40% gray turns orange almost yellow. Over
        nothing, only channels where the top is fully on light up.
      </>
    ),
    tip: "Hot highlights: a dim moving dot on top makes a bright flare in the effect below.",
  },
  {
    summary: "Darkens what's below strongly as the segment gets darker.",
    formula: "255 − (255 − B) × 255 ÷ T, or 0 when T ≤ 255 − B",
    details: (
      <>
        Also known as color burn. White on top changes nothing, darker tops push the bottom down quickly and
        saturate it (gray on orange gives red-orange, 25% gray gives pure red), and black on top gives black. Over
        nothing the result is black.
      </>
    ),
    tip: "Deepen and saturate colors, or burn dark moving shadows into an effect.",
  },
  {
    summary: "Like Top, but the segment's black pixels are see-through.",
    formula: "T, unless the pixel is completely off; then B",
    details: (
      <>
        Lit pixels cover what's below just like Top, and pixels that are completely off (all channels 0) let the
        bottom show through. A pixel that is merely dim, such as the fading tail of a comet, still covers.
      </>
    ),
    tip: "The usual way to put a sparse effect (Sparkle, Chase, Comet) over a background.",
  },
];

const EXAMPLES: { label: string; top: number; bottom: number }[] = [
  { label: "White on orange", top: 0xffffff, bottom: 0xffaa00 },
  { label: "Red on blue", top: 0xff0000, bottom: 0x0000ff },
  { label: "50% gray on orange", top: 0x808080, bottom: 0xffaa00 },
  { label: "Black on orange", top: 0x000000, bottom: 0xffaa00 },
  { label: "Orange on nothing", top: 0xffaa00, bottom: 0x000000 },
];

const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const fromHex = (h: string) => parseInt(h.slice(1), 16);
/** RGB part only: these examples have no white channel (see Divide for what happens to it). */
const blend = (mode: number, top: number, bottom: number) => segblend(mode, top, bottom) & 0xffffff;

/** Fully saturated hue around the color wheel, for the bottom strip. */
function hue(i: number, n: number): number {
  const h = (i / n) * 6;
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
  const [r, g, b] = [[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]][Math.floor(h) % 6]!;
  return (r! << 16) | (g! << 8) | b!;
}
const STRIP = Array.from({ length: 36 }, (_, i) => hue(i, 36));

function Swatch({ color, title, size = "size-7" }: { color: number; title?: string; size?: string }) {
  return (
    <span
      title={title ?? hex(color)}
      className={`inline-block shrink-0 rounded-full border border-neutral-700 ${size}`}
      style={{ background: hex(color) }}
    />
  );
}

function Example({ top, bottom, result, label }: { top: number; bottom: number; result: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-400" title={`${label}: ${hex(top)} on ${hex(bottom)} = ${hex(result)}`}>
      <Swatch color={bottom} title={`Below: ${hex(bottom)}`} size="size-5" />
      <span>+</span>
      <Swatch color={top} title={`Segment: ${hex(top)}`} size="size-5" />
      <span>=</span>
      <Swatch color={result} />
      <span className="ml-1">{label}</span>
    </div>
  );
}

export function BlendModes() {
  const [top, setTop] = useState(0xffffff);
  const [bottom, setBottom] = useState(0xffaa00);

  // Jump to a mode linked as /simulator/blend-modes#bm-6, after the router's own scroll to the top.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 50);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Blend modes"
        actions={
          <Link to="/simulator" className="text-sm text-sky-400 hover:text-sky-300">
            Back to simulator
          </Link>
        }
      />

      <Card className="space-y-2 text-sm text-neutral-300">
        <p>
          WLED draws segments in order, from the lowest segment ID to the highest. Each segment's blend mode decides how
          its pixels combine with what's already there: the segments drawn before it, or black where nothing is below.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The blend is worked out separately for each channel (red, green, blue and white), with values from 0 to 255.
            In the formulas, <b>T</b> is the segment's own color (on top) and <b>B</b> is the color below it.
          </li>
          <li>
            The segment's opacity (its brightness in a preset) is applied after blending: at 50% you see half of the
            blended result and half of what was below.
          </li>
          <li>
            "On nothing" matters: modes like Multiply, Subtract and Darken turn a segment black where no other segment
            lies under it.
          </li>
          <li>Blending happens before the strip's brightness and gamma correction, so these values are the colors as set.</li>
        </ul>
      </Card>

      <Card className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm shadow-lg shadow-black/60">
        <span className="font-medium">Try your own colors</span>
        <label className="flex items-center gap-2">
          <input type="color" value={hex(bottom)} onChange={(e) => setBottom(fromHex(e.target.value))} className="h-7 w-10 bg-transparent" />
          Below
        </label>
        <label className="flex items-center gap-2">
          <input type="color" value={hex(top)} onChange={(e) => setTop(fromHex(e.target.value))} className="h-7 w-10 bg-transparent" />
          Segment (on top)
        </label>
        <span className="flex gap-1 text-xs">
          {[
            ["White", 0xffffff],
            ["50% gray", 0x808080],
            ["Black", 0x000000],
            ["Red", 0xff0000],
          ].map(([label, c]) => (
            <button
              key={label}
              type="button"
              onClick={() => setTop(c as number)}
              className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700"
            >
              {label}
            </button>
          ))}
        </span>
        <span className="text-xs text-neutral-500">Each mode below shows the result, and the segment's color over a full rainbow.</span>
      </Card>

      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {BLEND_MODES.map((name, m) => (
          <a key={m} href={`#bm-${m}`} className="text-sky-400 hover:text-sky-300">
            {name}
          </a>
        ))}
      </nav>

      {HELP.map((h, m) => (
        <Card key={m}>
          <div id={`bm-${m}`} className="grid scroll-mt-24 gap-4 md:grid-cols-[1fr_20rem]">
            <div className="space-y-2 text-sm">
              <h2 className="text-base font-semibold">
                {BLEND_MODES[m]} <span className="text-xs font-normal text-neutral-500">bm {m}</span>
              </h2>
              <p className="text-neutral-200">{h.summary}</p>
              <p className="text-neutral-400">{h.details}</p>
              <p className="font-mono text-xs text-neutral-400">{h.formula}</p>
              <p className="text-xs text-neutral-400">
                <span className="text-neutral-300">Try it: </span>
                {h.tip}
              </p>
            </div>
            <div className="space-y-2">
              {EXAMPLES.map((e) => (
                <Example key={e.label} {...e} result={blend(m, e.top, e.bottom)} />
              ))}
              <div className="border-t border-neutral-800 pt-2">
                <Example top={top} bottom={bottom} result={blend(m, top, bottom)} label="Your colors" />
              </div>
              <div className="space-y-0.5" title="Rainbow below, your segment color on top">
                <Strip colors={STRIP} label="Below" />
                <Strip colors={STRIP.map(() => top)} label="Segment" />
                <Strip colors={STRIP.map((b) => blend(m, top, b))} label="Result" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Strip({ colors, label }: { colors: number[]; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-[10px] text-neutral-500">{label}</span>
      <div className="flex flex-1 gap-px">
        {colors.map((c, i) => (
          <span key={i} className="h-3 flex-1 rounded-full" style={{ background: hex(c) }} />
        ))}
      </div>
    </div>
  );
}
