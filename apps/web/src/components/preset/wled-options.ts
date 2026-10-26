// Option lists as labelled in WLED's own UI (wled00/data/index.htm, index.js).

/** Segment blend mode (seg.bm): how a segment combines with the segments below it. */
export const BLEND_MODES = [
  "Top/Default",
  "Bottom/None",
  "Add",
  "Subtract",
  "Difference",
  "Average",
  "Multiply",
  "Divide",
  "Lighten",
  "Darken",
  "Screen",
  "Overlay",
  "Hard Light",
  "Soft Light",
  "Dodge",
  "Burn",
  "Stencil",
];

/** Transition style (bs) used when a preset loads; 2D styles only apply to matrices. */
export const TRANSITION_STYLES: { value: number; label: string; matrix?: boolean }[] = [
  { value: 0, label: "Fade" },
  { value: 1, label: "Fairy Dust" },
  { value: 2, label: "Swipe right" },
  { value: 3, label: "Swipe left" },
  { value: 16, label: "Push right" },
  { value: 17, label: "Push left" },
  { value: 4, label: "Outside-in" },
  { value: 5, label: "Inside-out" },
  { value: 6, label: "Swipe up", matrix: true },
  { value: 7, label: "Swipe down", matrix: true },
  { value: 8, label: "Open H", matrix: true },
  { value: 9, label: "Open V", matrix: true },
  { value: 18, label: "Push up", matrix: true },
  { value: 19, label: "Push down", matrix: true },
  { value: 10, label: "Swipe TL", matrix: true },
  { value: 11, label: "Swipe TR", matrix: true },
  { value: 12, label: "Swipe BR", matrix: true },
  { value: 13, label: "Swipe BL", matrix: true },
  { value: 14, label: "Circular Out", matrix: true },
  { value: 15, label: "Circular In", matrix: true },
];
