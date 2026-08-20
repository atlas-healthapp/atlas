// What BODY decides to show, kept out of the component so the judgement is
// testable. Same split as home/homeModel.js.
//
// The difference from Home is the whole point of the tab: Home shows only
// exceptions, BODY shows everything, including the readings that are perfectly
// normal and therefore say nothing.
//
// The row maths itself now lives in utils/metricRow.js, shared with ACTIVITY.

/**
 * Ordered as they appear on the tab, and grouped by family on purpose.
 *
 * The first version ran VITALS, ACTIVITY, COMPOSITION, which put a violet card
 * between two others and then went back to violet: five cards in three colours
 * with none of them adjacent, which reads as scattered rather than as a system.
 * Same-family cards now sit together.
 *
 * Steps, PAI and the session list left for the ACTIVITY tab on 2026-07-29, and
 * grouping by family is what made that a clean cut off the end rather than an
 * extraction from the middle. What remains is one family, so BODY is now one
 * colour under the gold TODAY card, and the tab bar can be its own legend.
 */
export const BODY_CARDS = [
  // Sleep sits with the vitals, not up in TODAY beside Recovery. It is a BODY
  // metric, and putting it in a card coloured for Recovery meant a gold row
  // label above a violet detail: a card showing two families, which is the one
  // rule the colour system exists to hold. TODAY is left holding Recovery
  // alone, which is honest, because Recovery is the only thing on this tab that
  // belongs to no family.
  // `hr` sits directly under `restingHr` on purpose: they are two questions
  // about the same samples, and the one you want after reading a resting rate
  // is where it sat for the rest of the day.
  // **Stress sits directly under sleep** (2026-08-19, user's call), on both this
  // tab and Home. It is the one vital with a row every single day, and it used
  // to sit fifth, so on Home its position moved down the card whenever another
  // vital flagged. Moved here as well because `homeModel.test.js` holds the two
  // orders together: a reader who learns where to look on one screen should not
  // have to learn again on the other.
  { key: "vitals", label: "VITALS", family: "body", metrics: ["sleep", "stress", "hrv", "restingHr", "hr", "respRate", "spo2", "skinTemp"] },
  { key: "composition", label: "COMPOSITION", family: "body", metrics: ["weight"] },
];
