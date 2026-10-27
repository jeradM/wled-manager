import { useEffect, useId, useMemo, useRef, useState } from "react";

interface Props {
  /** Selected effect ID, or undefined to leave the controller's effect alone. */
  value: number | undefined;
  /** Name saved with the preset, shown when the ID isn't in this controller's list. */
  savedName?: string;
  /** Effect names indexed by ID, from the controller. */
  effects: string[];
  /** Effect metadata indexed by ID, used to mark 2D-only effects. */
  fxdata?: string[];
  onChange: (id: number, name: string) => void;
}

/** Reserved slots for removed effects; they can't be used. */
const isPlaceholder = (name: string) => name === "RSVD" || name === "-" || name === "";

/** fxdata flags (4th field): "1" = 1D, "2" = 2D. Effects flagged only 2D need a matrix. */
const is2dOnly = (data: string | undefined) => {
  const flags = data?.split(";")[3] ?? "";
  return flags.includes("2") && !flags.includes("1");
};

/** Searchable effect list in alphabetical order. Type to filter; ↑/↓ and Enter to pick. */
export function EffectPicker({ value, savedName, effects, fxdata, onChange }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () =>
      effects
        .map((name, id) => ({ id, name, matrix: is2dOnly(fxdata?.[id]) }))
        .filter((e) => !isPlaceholder(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })),
    [effects, fxdata],
  );
  const q = query.trim().toLowerCase();
  const matches = q ? sorted.filter((e) => e.name.toLowerCase().includes(q)) : sorted;

  const currentName =
    value === undefined ? "" : value < effects.length && !isPlaceholder(effects[value]!) ? effects[value]! : (savedName ?? `Effect ${value}`);

  const show = () => {
    setQuery("");
    setOpen(true);
    const at = sorted.findIndex((e) => e.id === value);
    setActive(Math.max(0, at));
  };
  const pick = (e: { id: number; name: string }) => {
    onChange(e.id, e.name);
    setOpen(false);
    // The input keeps focus after a keyboard pick; select the name so typing starts a new search.
    requestAnimationFrame(() => inputRef.current?.select());
  };

  // Keep the highlighted entry visible while moving with the keyboard or opening on the current effect.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        value={open ? query : currentName}
        placeholder={open ? currentName || "Search effects" : "(unchanged)"}
        onFocus={show}
        onClick={() => !open && show()}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return show();
            const delta = e.key === "ArrowDown" ? 1 : -1;
            setActive((a) => Math.min(matches.length - 1, Math.max(0, a + delta)));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && matches[active]) pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
      />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
        >
          {matches.length === 0 && <li className="px-2 py-1 text-neutral-500">No effects match "{query}"</li>}
          {matches.map((e, i) => (
            <li
              key={e.id}
              id={`${listId}-${e.id}`}
              role="option"
              aria-selected={e.id === value}
              // mousedown, not click: picking must happen before the input's blur closes the list.
              onMouseDown={(ev) => {
                ev.preventDefault();
                pick(e);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer justify-between px-2 py-1 ${i === active ? "bg-neutral-700" : ""} ${e.id === value ? "text-sky-400" : ""}`}
            >
              {e.name}
              {e.matrix && <span className="text-xs text-neutral-500" title="Needs a 2D matrix">2D</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
