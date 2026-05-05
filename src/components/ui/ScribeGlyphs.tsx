import { useEffect, useRef, useState } from 'react';

// Curated Unicode ranges from ancient scripts. Each tuple is an inclusive
// codepoint range. Some ranges have reserved/unassigned codepoints inside
// them, but the system font stack tends to render them as a tofu glyph
// silently rather than failing — keeping the curation simple is fine for
// an ambient ornament. If a particular OS lacks the Noto Sans Historical
// font (or equivalent), users will see boxes; that's an acceptable trade
// for not shipping our own font subset.
const SCRIPT_RANGES: Array<[number, number]> = [
  [0x12000, 0x123ff], // Cuneiform
  [0x11f00, 0x11f5f], // Kawi
  [0x10080, 0x100fa], // Linear B Ideograms
  [0x1d2e0, 0x1d2f3], // Mayan Numerals (full block, 0–19)
  [0x14400, 0x14646], // Anatolian Hieroglyphs
];

// Pre-flatten the codepoint pool so picking a random glyph is one
// random-int call instead of two (range, then offset). Computed once at
// module load.
const GLYPH_POOL: number[] = (() => {
  const out: number[] = [];
  for (const [start, end] of SCRIPT_RANGES) {
    for (let cp = start; cp <= end; cp++) out.push(cp);
  }
  return out;
})();

// Mayan numerals 10–19 form a natural counting cycle. Used as the
// "loading" animation in place of a spinner — visually consistent with
// the scribe-glyph theme and language-agnostic.
const MAYAN_LOADER_CODEPOINTS: number[] = (() => {
  const out: number[] = [];
  for (let cp = 0x1d2ea; cp <= 0x1d2f3; cp++) out.push(cp);
  return out;
})();

const GLYPH_COUNT = 7;
const REGEN_THROTTLE_MS = 50;

function randomGlyph(): string {
  const cp = GLYPH_POOL[Math.floor(Math.random() * GLYPH_POOL.length)];
  return String.fromCodePoint(cp);
}

function initialGlyphs(): string[] {
  return Array.from({ length: GLYPH_COUNT }, () => randomGlyph());
}

/**
 * Ambient 7-character display of randomly-sampled ancient-script glyphs.
 * Rotates one glyph (LRU-style) on every input or selection change in the
 * document, throttled so heavy typing doesn't churn the DOM. Initial state
 * is randomized at mount.
 */
export function ScribeGlyphs() {
  const [glyphs, setGlyphs] = useState<string[]>(initialGlyphs);
  const cursorRef = useRef(0);
  const lastRegenRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      if (now - lastRegenRef.current < REGEN_THROTTLE_MS) return;
      lastRegenRef.current = now;
      setGlyphs((prev) => {
        const next = prev.slice();
        next[cursorRef.current] = randomGlyph();
        cursorRef.current = (cursorRef.current + 1) % GLYPH_COUNT;
        return next;
      });
    };

    document.addEventListener('input', tick, { capture: true });
    document.addEventListener('selectionchange', tick);
    return () => {
      document.removeEventListener('input', tick, { capture: true });
      document.removeEventListener('selectionchange', tick);
    };
  }, []);

  return (
    <span
      aria-hidden
      title="Scribe glyphs"
      className="font-mono tracking-wider text-[12px] leading-none opacity-60 select-none"
      // System-side historical-script fonts. Browsers will fall back through
      // this list when codepoints aren't covered by the default monospace.
      style={{ fontFamily: '"Noto Sans Cuneiform", "Noto Sans Linear B", "Noto Sans Anatolian Hieroglyphs", "Noto Sans Kawi", "Noto Sans Mayan Numerals", "Noto Sans", system-ui, sans-serif' }}
    >
      {glyphs.join('')}
    </span>
  );
}

/**
 * Loading animation in place of a spinner: cycles through the Mayan
 * numerals 10–19 at a steady cadence. Used by StatusBar when Kamalu is
 * connecting.
 */
export function MayanLoader({ intervalMs = 150 }: { intervalMs?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % MAYAN_LOADER_CODEPOINTS.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const glyph = String.fromCodePoint(MAYAN_LOADER_CODEPOINTS[index]);
  return (
    <span
      aria-hidden
      className="inline-block leading-none text-[14px] shrink-0"
      style={{ fontFamily: '"Noto Sans Mayan Numerals", "Noto Sans", system-ui, sans-serif' }}
    >
      {glyph}
    </span>
  );
}
