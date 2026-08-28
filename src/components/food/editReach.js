/**
 * How far an edit to a library item reaches, and whether to ask.
 *
 * A logged entry stores its own macro snapshot precisely so that history
 * survives the library being edited. Backdating deliberately breaks that
 * guarantee, which is right when the figures were simply wrong and wrong when
 * the recipe genuinely changed. Only the person typing knows which, so the
 * question has to be asked - but asking it on every save would be noise, so
 * this decides when it is worth asking at all.
 *
 * Lives beside the sheet rather than inside it because `ItemFormSheet` is
 * template-shaped and cannot be tested here, and the gate is the half that can
 * silently rot: widen it and every typo fix interrogates you, narrow it and
 * days quietly keep figures you have just corrected.
 */

/**
 * The fields a logged day actually copied, as a comparable string.
 *
 * Name, kind, portion and barcode are all deliberately absent. A portion is
 * vocabulary ("one serving is two eggs") and a name is a label; neither moves
 * a single number on a day already recorded, so neither is worth a question.
 */
export function figuresOf(source) {
  return JSON.stringify({
    protein: source.protein ?? null,
    kcal: source.kcal ?? null,
    carbs: source.carbs ?? null,
    fat: source.fat ?? null,
    fibre: source.fibre ?? null,
    baseAmount: source.baseAmount ?? null,
    baseUnit: source.baseUnit ?? null,
    // A composite's macros are the live sum of these, so an ingredient list
    // moving moves every figure with it. Mapped rather than passed through so
    // a reordered-but-identical list still compares equal by position only,
    // which is what the sheet's own editing does.
    ingredients: (source.ingredients ?? []).map((i) => ({
      itemId: i.itemId,
      quantity: i.quantity,
    })),
  });
}

/**
 * Whether to put the forward/backdate choice on screen.
 *
 * Four conditions, and each one removed a version of the panel that was worse:
 * only when editing (a new item has no history), only when no scan panel is
 * already asking the same question, only when a figure actually moved, and
 * only when there is at least one logged day for a backdate to rewrite.
 */
export function needsReachChoice({ isEdit, scanChoiceOpen, opened, current, uses }) {
  if (!isEdit || scanChoiceOpen) return false;
  if (!opened || uses <= 0) return false;
  return figuresOf(current) !== opened;
}

/**
 * The label for the save button.
 *
 * The two modes differ in the one way that matters, so the button names it
 * rather than saying SAVE twice.
 */
export function reachSaveLabel({ asking, reach, uses }) {
  if (!asking || reach !== "backdate" || !uses) return "SAVE";
  return `SAVE AND FIX ${uses} ${uses === 1 ? "DAY" : "DAYS"}`;
}
