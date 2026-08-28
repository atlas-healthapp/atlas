// How wide a mono label is, in the user units its chart's viewBox is drawn in.
//
// **Every collision rule in Atlas's charts is really this one sum, and each one
// used to hardcode its own answer.** `dayMarkers.js` had `CHAR_W = 5.9` and
// `hypnogram.js` had `MIN_TICK_GAP_PX = 44`, both measured against the type
// scale of the day they were written. The type scale moved on 2026-08-27 and
// neither followed, so the Recovery markers began printing session times on top
// of the bedtime and the hypnogram's hourly axis went unreadable. Nothing
// failed, because a label drawn over another label is not an error to anything
// that can be tested: it is two `<text>` nodes with valid coordinates.
//
// So the sum lives here once, derived from the type it describes rather than
// remembered, and each chart's test pins it against the stylesheet the label is
// actually set in.
//
// **The font scale is the half that gets forgotten.** The WebView applies the
// device's own scale to explicit px sizes, SVG text included: a rule saying 13px
// is 11.05 units on a phone set to 0.85 and 13 units on one set to 1.0. That was
// measured rather than assumed, with `getComputedTextLength` over the rendered
// chart - `.mk` at 13px and 0.8px letter-spacing came back at 7.43 units per
// character, and 13 x 0.85 x 0.6 + 0.8 is 7.43 exactly.

/**
 * One character of IBM Plex Mono, as a share of its font size.
 *
 * True of any monospaced face by definition of the word, and 0.6 is Plex Mono's
 * own advance. Confirmed against the measurement above rather than taken from
 * the foundry.
 */
export const MONO_ADVANCE = 0.6;

/**
 * The device font scale these figures assume.
 *
 * **One, not the 0.85 this phone is set to, and the asymmetry is the reason.**
 * Android's scale runs above 1.0 as well as below it, and the two ways of being
 * wrong here do not cost the same: under-estimate and two labels overlap, which
 * is unreadable and cannot be recovered from by the reader; over-estimate and
 * one label is dropped, which is quieter but still honest. `placeLabels` already
 * makes that trade deliberately - it drops rather than shrinks or nudges - so
 * the width it is given should lean the same way.
 *
 * Assuming 1.0 therefore over-estimates by about 15% on the author's phone and
 * is correct or conservative on everybody else's, up to a reader who has raised
 * their scale past 1.0, where it under-estimates again. That last case is
 * accepted: sizing for 1.3 would drop most labels for everyone.
 */
export const ASSUMED_FONT_SCALE = 1;

/**
 * Width of one character, in viewBox user units.
 *
 * @param fontPx the size as written in the stylesheet, before any device scale.
 * @param letterSpacing the rule's own `letter-spacing`, which is NOT scaled by
 *   the device the way font-size is, so it is added after the multiplication.
 */
export function charWidth(fontPx, letterSpacing = 0, scale = ASSUMED_FONT_SCALE) {
  return fontPx * scale * MONO_ADVANCE + letterSpacing;
}

/**
 * Width of a whole string, in viewBox user units.
 *
 * Trailing letter-spacing is included, because that is what the browser advances
 * by and what `getComputedTextLength` reports. It is a fraction of a character
 * and only matters at the point two labels are deciding whether they touch,
 * which is exactly where this is asked.
 */
export function labelWidth(text, fontPx, letterSpacing = 0, scale = ASSUMED_FONT_SCALE) {
  return (text?.length ?? 0) * charWidth(fontPx, letterSpacing, scale);
}
