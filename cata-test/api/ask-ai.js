// Single Vercel serverless function: POST /api/ask-ai
//
// This is the one place in the whole app that talks to an LLM provider -
// per the hack-notes: "never scatter API calls throughout your code, write
// one function that every feature calls through." Swapping providers later
// (Groq, Mistral, Claude, ...) means editing this file only.
//
// Two tasks are supported, both mapping to the pipeline in AIapp-Brainstorm.md:
//   1. "parseIntake"  - free-text household description -> structured profile
//   2. "prioritize"   - vetted item list + profile -> ranked top-10 with reasoning
//
// Both calls are STRICTLY GROUNDED: the model is only allowed to select from
// / reason about the vetted checklist items we already sourced from
// government documents (data/core-items.json + data/disaster-extras/*.json).
// It is never asked to invent new checklist items from its own knowledge -
// that's the "constrained AI" half of the architecture notes. If the AI call
// fails or returns something that doesn't validate, we return
// { ok: false } and the frontend falls back to the deterministic
// lib/buildChecklist.js logic instead of showing an error or nothing.

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

// Reads straight from the same vetted JSON the frontend fetches at
// /public/data/*.json - one source of truth, no duplication or drift.
function loadDisasterCatalog(disasterIds) {
  const dataDir = path.join(__dirname, "..", "public", "data");
  const core = JSON.parse(fs.readFileSync(path.join(dataDir, "core-items.json"), "utf8"));
  const items = [...core];
  const seen = new Set(core.map((i) => i.id));
  for (const id of disasterIds || []) {
    const extrasPath = path.join(dataDir, "disaster-extras", `${id}.json`);
    if (!fs.existsSync(extrasPath)) continue;
    const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
    for (const item of extras) {
      if (!seen.has(item.id)) {
        items.push(item);
        seen.add(item.id);
      }
    }
  }
  return items;
}

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/**
 * The one low-level function everything else calls through. Isolated here so
 * swapping providers later is a change in this function only (see hack-notes
 * screenshot on OpenAI-compatible endpoints for the free-tier providers).
 */
async function askAI({ prompt, responseSchema }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text); // throws on malformed JSON -> caught by caller, triggers fallback
}

const INTAKE_SCHEMA = {
  type: "object",
  properties: {
    householdSize: { type: "integer" },
    infant: { type: "boolean" },
    elderly: { type: "boolean" },
    pet: { type: "boolean" },
    mobilityIssue: { type: "boolean" },
    medicalDevice: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["infant", "elderly", "pet", "mobilityIssue", "medicalDevice"],
};

function validateIntake(obj) {
  return (
    obj &&
    typeof obj.infant === "boolean" &&
    typeof obj.elderly === "boolean" &&
    typeof obj.pet === "boolean" &&
    typeof obj.mobilityIssue === "boolean" &&
    typeof obj.medicalDevice === "boolean"
  );
}

const PRIORITIZE_SCHEMA = {
  type: "object",
  properties: {
    topTen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "reason"],
      },
    },
  },
  required: ["topTen"],
};

function validatePrioritize(obj, validIds) {
  if (!obj || !Array.isArray(obj.topTen)) return false;
  if (obj.topTen.length === 0 || obj.topTen.length > 10) return false;
  // Strict grounding rule: every id the model returns MUST already exist in
  // our vetted catalog. Anything else is rejected -> fallback path.
  return obj.topTen.every((entry) => validIds.has(entry.id) && typeof entry.reason === "string");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const { task, freeText, disasterIds, profile } = req.body || {};
  let { checklist } = req.body || {};
  if (!checklist && Array.isArray(disasterIds)) {
    checklist = loadDisasterCatalog(disasterIds);
  }

  try {
    if (task === "parseIntake") {
      const prompt = `You are helping parse a free-text household description into structured
fields for a disaster-preparedness app. Only extract what is stated or clearly implied -
never guess. Household description: """${freeText || ""}"""`;
      const parsed = await askAI({ prompt, responseSchema: INTAKE_SCHEMA });
      if (!validateIntake(parsed)) throw new Error("intake response failed validation");
      res.status(200).json({ ok: true, result: parsed });
      return;
    }

    if (task === "prioritize") {
      if (!Array.isArray(checklist) || checklist.length === 0) {
        throw new Error("checklist is required");
      }
      const validIds = new Set(checklist.map((i) => i.id));
      const catalogForPrompt = checklist.map(({ id, item, category, priority, sources }) => ({
        id, item, category, priority, sources,
      }));
      const prompt = `You are prioritizing a disaster-preparedness checklist for one specific
household. You MUST choose only from the items in CATALOG below (return their exact "id" -
never invent a new item or id). Household profile: ${JSON.stringify(profile || {})}.
CATALOG: ${JSON.stringify(catalogForPrompt)}
Return the 10 most important item ids for THIS household, each with a one-sentence reason
tied to their specific profile (e.g. an infant or a mobility issue changes what matters most).`;
      const parsed = await askAI({ prompt, responseSchema: PRIORITIZE_SCHEMA });
      if (!validatePrioritize(parsed, validIds)) throw new Error("prioritize response failed validation");
      res.status(200).json({ ok: true, result: parsed });
      return;
    }

    res.status(400).json({ ok: false, error: "unknown task" });
  } catch (err) {
    // Fallback contract: never throw a 500 with no guidance for the frontend.
    // The frontend's job on ok:false is to fall back to lib/buildChecklist.js
    // (deterministic topTenItems / static profile flags) rather than show
    // nothing or an error - see hack-notes on the fallback path.
    console.error("ask-ai error:", err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
};
