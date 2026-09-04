# CataPanda

Turn uncertainty into clear next steps. A personalized disaster-prep checklist app — grounded in
real government civil-defense guidance, personalized and prioritized by AI.

This is the hackathon MVP scaffold: Taiwan-relevant disaster types (earthquake, flood, typhoon),
a vetted checklist catalog sourced from `Checklists/DisasterDocs/` and `GovtRef.txt`, and a single
`askAI()`-style serverless function that personalizes and prioritizes — never invents — checklist
items.

## Why it's built this way (the "is AI load-bearing" answer)

1. **Free-text household intake** (`task: "parseIntake"` in `api/ask-ai.js`) — turns something like
   "I live with my elderly mother who uses a walker, we have a cat, and we're on the 4th floor"
   into structured profile flags. The combinations here are unbounded, which is why this can't be
   a checkbox form alone.
2. **Personalized prioritization** (`task: "prioritize"`) — reasons about *which 10 items* matter
   most for *this specific household* against *this specific disaster*, and explains why. It is
   constrained to only select `id`s that already exist in the vetted catalog (see `validatePrioritize`
   in `api/ask-ai.js`) — it cannot invent a new item. If the model returns anything that doesn't
   validate, or the API call fails outright, the frontend silently falls back to the deterministic
   `topTenItems()` ranking in `public/lib/buildChecklist.js` (source-count + priority). You never see
   an error or a blank screen — that fallback path is itself part of the architecture story.

The overlap engine (`computeOverlap`) is deliberately **not** AI — it's plain set intersection on
item IDs, because the underlying lists are already personalized. Not every feature needs an LLM call.

## What's here vs. what's next

**Built in this scaffold:**
- Vetted, sourced checklist data for all 3 disaster types (24 shared core items + per-disaster
  extras), pulled directly from your `Checklists/*.docx` files — see `public/data/schema.md`.
- Client-side overlap engine + "Start Here" view.
- Deterministic top-10 (works with zero AI, zero personalization).
- `/api/ask-ai` serverless function: intake parsing + prioritization, both grounded/validated, both
  with a fallback path.
- Basic accessible-ish UI (checkbox list, localStorage progress, no account needed) — not yet
  audited against the WCAG AA bar your `ProjectPlan.pdf` calls for.

**Not yet done — natural next steps, roughly in order:**
1. **Wire up live Google Search grounding** in `askAI()` (the "no fixed JSON catalog" idea from
   your hack-notes) — right now the AI only reasons over the static catalog, it doesn't yet pull
   live search results into the prompt. Worth deciding if that's in-scope for the demo or a "next"
   slide.
2. **Region/country picker** — this scaffold assumes Taiwan and skips search-by-region entirely.
3. **Educational guide per disaster type** — the behaviour notes are in `public/data/disasters.json`
   but there's no dedicated guide screen yet.
4. **Brand pass** — the CSS uses a placeholder palette loosely inspired by your mood boards, not
   your actual `Brand/BrandGuidelines.docx` values or mascot art. Swapping in real brand colors/
   mascot illustrations would go a long way visually for a demo.
5. **Share/export** — "share list via file export" from the backlog isn't built.
6. **Deploy** — this has never been pushed to Vercel; see below.

## Running it

```bash
npm install
cp .env.example .env     # then paste in your Gemini key
npx vercel dev            # serves the static frontend + the /api function together
```

Or deploy straight to Vercel:

```bash
npx vercel --prod
# then set GEMINI_API_KEY in the Vercel project's Environment Variables —
# do NOT rely on .env being uploaded, it's gitignored on purpose.
```

## Project layout

```
api/ask-ai.js              the one function every AI call goes through
public/index.html/app.js   frontend — no build step, no framework
public/lib/buildChecklist.js  shared logic (overlap, top-10) used by both frontend and API
public/data/                the vetted, sourced checklist catalog (source of truth)
```
