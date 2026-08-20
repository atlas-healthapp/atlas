/**
 * Reading Open Food Facts' free-text serving size into a real amount.
 *
 * **The bug this exists for is in the data.** `serving_size` is whatever the
 * contributor typed - `1 portion (13 g)`, `11 chips (27 g)`, `60.0g`, `375ml`,
 * `1 Cup (200 g)` - and the scan flow assigned that whole string to `baseUnit`.
 * A real library ended up with 23 distinct "units", most of them sentences, which
 * `formatAmount` then had to print inside phrases like "1.5 × 11 chips (27 g)".
 *
 * It was also the wrong field. `baseUnit` is the noun a quantity counts ("serving",
 * "g", "egg"), while `portion` already means "what one base unit actually is" and
 * is what renders `1.5 SERVING (3 EGGS)`. So the description belongs in `portion`
 * and the unit stays a word.
 *
 * Returns `{ amount, unit }` or null. **Null is the honest answer for anything it
 * cannot read**, because a wrong portion silently multiplies every macro shown
 * for that item, where a missing one just shows less.
 */

/** Units worth trusting from a stranger's free text. */
const KNOWN_UNITS = ["g", "kg", "mg", "ml", "l", "cl", "oz", "fl oz"];

const UNIT_ALIASES = { gr: "g", grams: "g", gram: "g", litre: "l", liter: "l", millilitre: "ml", milliliter: "ml" };

function normaliseUnit(raw) {
  const u = raw.trim().toLowerCase().replace(/\.$/, "");
  const mapped = UNIT_ALIASES[u] ?? u;
  return KNOWN_UNITS.includes(mapped) ? mapped : null;
}

function read(numberText, unitText) {
  const amount = Number(numberText.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = normaliseUnit(unitText);
  if (!unit) return null;
  // Rounded, because these end up multiplied against macros that are themselves
  // whole numbers, and "60.0g" and "60g" are the same portion written twice.
  return { amount: Math.round(amount * 100) / 100, unit };
}

export function parseServingSize(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s) return null;

  // **The bracket wins when there is one.** "2 pieces (66 g)" states the count in
  // a unit nobody can convert and the weight in one everybody can, and the weight
  // is the half that lets a macro be scaled.
  const bracketed = s.match(/\(\s*([\d.,]+)\s*([a-zA-Z ]+?)\s*\)/);
  if (bracketed) {
    const got = read(bracketed[1], bracketed[2]);
    if (got) return got;
  }

  // Otherwise a plain "60.0g" or "375 ml", anchored to the start so a stray
  // number later in the string cannot be mistaken for the amount.
  const plain = s.match(/^([\d.,]+)\s*([a-zA-Z ]+?)\s*$/);
  if (plain) {
    const got = read(plain[1], plain[2]);
    if (got) return got;
  }

  return null;
}

/**
 * What a scanned product's base unit should be, given how its macros are stated.
 *
 * A per-100g product counts grams; a per-serving one counts servings. Neither is
 * ever the contributor's prose.
 */
export function baseUnitForScan(servingBasis) {
  return servingBasis === "100g" ? "g" : "serving";
}
