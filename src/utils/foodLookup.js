// Looks up a scanned barcode against Open Food Facts and maps its
// nutrient fields onto Atlas's library-item shape. Returns null on any
// failure (not found, offline, timeout, bad response); callers treat
// null as "fall through to manual entry", never as an error to surface
// beyond a generic not-found state.
const TIMEOUT_MS = 6000;

// Open Food Facts occasionally returns numeric-looking strings for legacy
// products; coerce to a real number (or null) so downstream sums never
// silently fall into string concatenation.
function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * A macro at the resolution Atlas actually keeps it at.
 *
 * **The store rounds every macro to a whole number on every read** - see
 * `resolvedMacros` in `stores/food.js`, whose own note says grams and kcal are
 * never usefully fractional. So a scan handing the form `155.40000000000003`
 * shows a number that will not survive being saved, and the user reads a
 * precision the app does not keep. Open Food Facts computes its per-serving
 * fields from a per-100g basis, so those tails are the common case rather than
 * the odd one: a tin of baked beans arrived with five of them.
 *
 * Rounded here, at the boundary, rather than in the form: every route out of a
 * scan (the single-scan form, the batch sheet's preview, the match comparison in
 * `batchMeal.macrosMatch`) reads these same fields, and rounding in one of them
 * is how the three end up disagreeing. Same reasoning `batchMeal.js` gives for
 * rounding its preview where the store will.
 *
 * **This cannot change a stored value.** Everything downstream already rounded;
 * all that changes is that the figure on screen now matches the figure kept.
 */
function toMacro(v) {
  const n = toNumber(v);
  return n == null ? null : Math.round(n);
}

// product_name alone is often generic ("Soft White" for a pack of wraps) -
// OFF usually has the actual brand separately, so prefix it when the name
// doesn't already include it. It also often omits what the product actually
// IS (a wrap, a loaf, a block) - generic_name (or, failing that, OFF's most
// specific category tag) usually names that, so append it when it isn't
// already present.
function buildName(product) {
  const baseName = product.product_name || product.generic_name || "";
  const brand = (product.brands || "").split(",")[0].trim();
  let name = baseName;
  if (brand && !name.toLowerCase().startsWith(brand.toLowerCase())) {
    name = name ? `${brand} ${name}` : brand;
  }

  const category = productCategory(product);
  if (category && !name.toLowerCase().includes(category.toLowerCase())) {
    name = name ? `${name} ${category}` : category;
  }

  return name;
}

// A short, human-readable word for what the product actually is (e.g.
// "Wraps"), pulled from generic_name when it differs from product_name, or
// otherwise the most specific OFF category tag with its "xx:" language
// prefix stripped and hyphens turned into spaces.
function productCategory(product) {
  const generic = (product.generic_name || "").trim();
  const productName = (product.product_name || "").trim();
  if (generic && generic.toLowerCase() !== productName.toLowerCase()) {
    return generic;
  }
  const tags = product.categories_tags || [];
  const lastTag = tags[tags.length - 1];
  if (!lastTag) return "";
  return lastTag
    .replace(/^[a-z]{2}:/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function lookupBarcode(code) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const product = data.product;
    const nutriments = product.nutriments || {};
    // Whole-product basis: if this product has serving-scaled data at
    // all, use it consistently for every field, rather than mixing
    // serving/100g bases within one result.
    const hasServingData =
      nutriments.proteins_serving != null ||
      nutriments["energy-kcal_serving"] != null;
    const suffix = hasServingData ? "_serving" : "_100g";

    return {
      name: buildName(product),
      protein: toMacro(nutriments[`proteins${suffix}`]),
      kcal: toMacro(nutriments[`energy-kcal${suffix}`]),
      carbs: toMacro(nutriments[`carbohydrates${suffix}`]),
      fat: toMacro(nutriments[`fat${suffix}`]),
      // Fibre is commonly omitted from OFF entirely for products that
      // genuinely have ~0g (meat, dairy) rather than encoded as 0 - unlike
      // protein/kcal/carbs/fat, a missing value here is far more often
      // "none" than "unmeasured", so default it to 0 instead of leaving a
      // blank the user has to fill in by hand on every such scan.
      fibre: toMacro(nutriments[`fiber${suffix}`]) ?? 0,
      servingBasis: hasServingData ? "serving" : "100g",
      // Descriptive serving text OFF sometimes provides (e.g. "2 pieces
      // (70g)") - separate field from the _serving-suffixed macro numbers
      // above, and not guaranteed present. When it is, it's what "1 serving"
      // actually means concretely - otherwise that's left as an unexplained
      // generic "serving" unit in the form.
      servingSize: (product.serving_size || "").trim() || null,
      barcode: code,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
