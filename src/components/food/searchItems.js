// Matching for the library search box. Pure, so the rules are testable rather
// than being whatever `includes` happened to do.

/**
 * Every query term has to appear somewhere in the name, in any order.
 *
 * Not a prefix match. The library is full of names like "Woolworths spinach
 * salad", and an A-Z list already handles the case where you know the first
 * word. What it cannot do is find that item when what you remember is
 * "spinach", which is the case the search box exists for.
 *
 * All terms rather than any, because "chicken rice" should narrow the list
 * rather than widen it to everything containing either word.
 */
export function matchesQuery(name, query) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const haystack = String(name ?? "").toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/**
 * Filtered and ranked.
 *
 * Ranking, in order: a name that starts with the query, then one where a word
 * starts with it, then anything else, and alphabetical within each. Typing
 * "sal" should put "Salad" above "Woolworths spinach salad" without hiding
 * either, because the thing you typed the start of is usually the thing you
 * meant.
 */
export function searchItems(items, query) {
  const q = String(query ?? "").trim().toLowerCase();
  const hits = (items ?? []).filter((i) => matchesQuery(i.name, q));
  if (!q) return hits;

  const rank = (name) => {
    const n = String(name ?? "").toLowerCase();
    if (n.startsWith(q)) return 0;
    // A word boundary, so "spin" ranks "Woolworths spinach salad" above a name
    // that merely contains the letters mid-word.
    if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) return 1;
    return 2;
  };

  return hits.sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
  );
}
