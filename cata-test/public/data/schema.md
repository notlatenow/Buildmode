# Checklist data schema

## Checklist item

```jsonc
{
  "id": "water-drinking",              // stable slug, used for overlap detection across disaster lists
  "category": "Water & Food",          // one of the 8 fixed categories (see below)
  "item": "Drinking water",            // short label
  "notes": "Taiwan: at least 15 mL...",// sourcing / dosage detail, optional
  "sources": ["TW", "HK", "BN"],       // country codes that recommend this item (see Source Index below)
  "priority": "essential",             // "essential" | "important" | "nice-to-have" | "conditional"
  "purchaseCategories": ["Grocery store"] // where to source it (empty array = not a purchase, e.g. documents)
}
```

`priority` is derived from how many independent government/civil-defense sources name the item —
this is the "vetted source-of-truth layer" the architecture notes call for. `conditional` items
(infant supplies, elderly-care items, pet supplies) are only surfaced when the matching household
profile field is set — they aren't ranked essential/important because they don't apply to everyone.

## The 8 categories (fixed, shown consistently across every disaster type)

Water & Food · First Aid & Medication · Hygiene & Sanitation · Light, Power & Communication ·
Documents & Money · Clothing & Protection · Tools · Household & Special Needs

## File layout

- `data/core-items.json` — the 24 items common to all three disaster types (this is what makes the
  overlap engine trivial: flood and typhoon share 100% of their items with the core list; earthquake
  adds 5 extras). Client-side overlap = set intersection on `id`, exactly as the PRD specifies.
- `data/disaster-extras/{earthquake,flood,typhoon}.json` — items unique to that disaster type.
- `data/disasters.json` — metadata per disaster type (name, tagline, behaviour notes, which extras
  file to merge in).

A disaster's full checklist = `core-items.json` + `disaster-extras/<id>.json`.

## Source Index

| Code | Country | Agency |
|---|---|---|
| BN | Brunei | National Disaster Management Centre |
| HK | Hong Kong | Security Bureau |
| ID | Indonesia | BPBD DIY (regional, under national BNPB) |
| KR | South Korea | Ministry of the Interior and Safety — Safe Korea |
| PH | Philippines | Senate Committee on Climate Change w/ PHIVOLCS, NDRRMC, DOH et al. |
| SG | Singapore | Civil Defence Force (SCDF) |
| TW | Taiwan | National Fire Agency & Taipei Fire Department |

This content was hand-curated from the PDFs in `Checklists/DisasterDocs/` and the live agency sites
in `GovtRef.txt` — it's the grounding layer the AI is instructed to never contradict or add
unsourced items on top of.
