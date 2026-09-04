// Shared logic used by both the frontend (public/app.js) and the serverless
// function (api/ask-ai.js). Kept dependency-free and isomorphic (no `window`,
// no `require`-only syntax) so it can be loaded as a plain <script> in the
// browser AND required from Node.

/**
 * Build the full checklist for one disaster type: core items + that
 * disaster's extras. This single merge point is the whole "overlap engine" -
 * because flood/typhoon/earthquake share the same core-items.json, computing
 * overlap across disasters is just a set intersection on item id.
 */
function buildChecklist(coreItems, extrasByDisaster, disasterId) {
  const extras = extrasByDisaster[disasterId] || [];
  return [...coreItems, ...extras];
}

/**
 * Overlap intelligence (PRD section 7): given 2+ selected disaster types,
 * return the items that appear in ALL of them, ranked by (1) how many of the
 * selected lists they appear in already being 100% since we intersect, so we
 * really rank by (2) priority score - matching "Start Here" spec.
 */
function computeOverlap(coreItems, extrasByDisaster, disasterIds) {
  const lists = disasterIds.map((id) => buildChecklist(coreItems, extrasByDisaster, id));
  const [first, ...rest] = lists;
  const shared = first.filter((item) => rest.every((list) => list.some((i) => i.id === item.id)));
  const priorityRank = { essential: 0, important: 1, "nice-to-have": 2, conditional: 3 };
  const sorted = [...shared].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));
  const totalUnique = new Set(lists.flat().map((i) => i.id)).size;
  const overlapPct = totalUnique === 0 ? 0 : Math.round((shared.length / totalUnique) * 100);
  return { sharedItems: sorted, overlapPct };
}

/**
 * "10 most important items" (PRD / backlog core feature). Falls back to
 * priority + source-count ranking - this never depends on the AI, it's
 * pure deterministic logic per the architecture notes ("not every feature
 * needs an LLM call").
 */
function topTenItems(checklist, profile = {}) {
  const priorityRank = { essential: 0, important: 1, "nice-to-have": 2, conditional: 3 };
  const applies = (item) => {
    if (item.priority !== "conditional") return true;
    if (item.id.startsWith("household-infant") || item.id.includes("baby")) return !!profile.infant;
    if (item.id.startsWith("household-elderly")) return !!profile.elderly;
    if (item.id.startsWith("household-pet")) return !!profile.pet;
    return true;
  };
  return [...checklist]
    .filter(applies)
    .sort((a, b) => {
      const pr = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (pr !== 0) return pr;
      return (b.sources?.length || 0) - (a.sources?.length || 0);
    })
    .slice(0, 10);
}

// Expose for both <script src="buildChecklist.js"> (browser) and require() (Node/api)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildChecklist, computeOverlap, topTenItems };
}
if (typeof window !== "undefined") {
  window.CataPanda = { buildChecklist, computeOverlap, topTenItems };
}
