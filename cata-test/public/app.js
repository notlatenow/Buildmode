// CataPanda MVP frontend — no build step, no framework, so it's easy to
// deploy as static + one Vercel function today. Talks to /api/ask-ai for
// personalization; everything else (rendering, overlap, top-10 fallback)
// runs client-side against the vetted JSON in ./data/.

const state = {
  disasters: [],
  coreItems: [],
  extrasByDisaster: {},
  selected: new Set(),
  profile: {},          // { infant, elderly, pet, mobilityIssue, medicalDevice }
  checked: loadChecked(),
  aiTopTen: null,       // set when AI personalization succeeds
};

function loadChecked() {
  try {
    return JSON.parse(localStorage.getItem("catapanda-checked") || "{}");
  } catch {
    return {};
  }
}
function saveChecked() {
  try {
    localStorage.setItem("catapanda-checked", JSON.stringify(state.checked));
  } catch {
    /* localStorage unavailable — progress just won't persist, checklist still works */
  }
}

async function init() {
  const [disasters, coreItems] = await Promise.all([
    fetch("./data/disasters.json").then((r) => r.json()),
    fetch("./data/core-items.json").then((r) => r.json()),
  ]);
  state.disasters = disasters;
  state.coreItems = coreItems;

  await Promise.all(
    disasters.map(async (d) => {
      const extras = await fetch(`./data/disaster-extras/${d.extrasFile}`).then((r) => r.json());
      state.extrasByDisaster[d.id] = extras;
    })
  );

  renderDisasterOptions();
  document.getElementById("personalize-btn").addEventListener("click", onPersonalize);
}

function renderDisasterOptions() {
  const el = document.getElementById("disaster-options");
  el.innerHTML = "";
  for (const d of state.disasters) {
    const btn = document.createElement("button");
    btn.className = "disaster-option";
    btn.type = "button";
    btn.innerHTML = `<strong>${d.name}</strong><span>${d.tagline}</span>`;
    btn.addEventListener("click", () => toggleDisaster(d.id, btn));
    el.appendChild(btn);
  }
}

function toggleDisaster(id, btn) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
    btn.classList.remove("selected");
  } else {
    state.selected.add(id);
    btn.classList.add("selected");
  }
  render();
}

function currentChecklist() {
  const ids = [...state.selected];
  const merged = [...state.coreItems];
  const seen = new Set(merged.map((i) => i.id));
  for (const id of ids) {
    for (const item of state.extrasByDisaster[id] || []) {
      if (!seen.has(item.id)) {
        merged.push(item);
        seen.add(item.id);
      }
    }
  }
  return merged;
}

function render() {
  const overlapSection = document.getElementById("step-overlap");
  const personalizeSection = document.getElementById("step-personalize");
  const checklistSection = document.getElementById("step-checklist");

  if (state.selected.size === 0) {
    overlapSection.hidden = true;
    personalizeSection.hidden = true;
    checklistSection.hidden = true;
    return;
  }

  personalizeSection.hidden = false;
  checklistSection.hidden = false;

  if (state.selected.size >= 2) {
    const { sharedItems, overlapPct } = window.CataPanda.computeOverlap(
      state.coreItems,
      state.extrasByDisaster,
      [...state.selected]
    );
    overlapSection.hidden = false;
    document.getElementById("overlap-pct").textContent = `${overlapPct}% overlap`;
    document.getElementById("overlap-list").innerHTML = sharedItems
      .map((i) => renderChecklistRow(i))
      .join("");
  } else {
    overlapSection.hidden = true;
  }

  const checklist = currentChecklist();
  document.getElementById("checklist-title").textContent =
    [...state.selected].map((id) => state.disasters.find((d) => d.id === id).name).join(" + ") +
    " checklist";

  renderTopTen(checklist);
  renderCategories(checklist);
  attachCheckboxHandlers();
}

function renderTopTen(checklist) {
  const list = document.getElementById("top-ten-list");
  const aiBadge = document.getElementById("ai-badge");

  if (state.aiTopTen) {
    aiBadge.hidden = false;
    list.innerHTML = state.aiTopTen
      .map(({ id, reason }) => {
        const item = checklist.find((i) => i.id === id);
        if (!item) return "";
        return renderChecklistRow(item, reason);
      })
      .join("");
  } else {
    aiBadge.hidden = true;
    const top = window.CataPanda.topTenItems(checklist, state.profile);
    list.innerHTML = top.map((i) => renderChecklistRow(i)).join("");
  }
}

function renderCategories(checklist) {
  const byCategory = {};
  for (const item of checklist) {
    if (item.priority === "conditional") {
      const wantsInfant = item.id.includes("infant") || item.id.includes("baby");
      const wantsElderly = item.id.includes("elderly");
      const wantsPet = item.id.includes("pet");
      if (wantsInfant && !state.profile.infant) continue;
      if (wantsElderly && !state.profile.elderly) continue;
      if (wantsPet && !state.profile.pet) continue;
    }
    (byCategory[item.category] ||= []).push(item);
  }

  const el = document.getElementById("categories");
  el.innerHTML = Object.entries(byCategory)
    .map(
      ([category, items]) => `
      <div class="category">
        <h3>${category}</h3>
        <ul class="checklist">${items.map((i) => renderChecklistRow(i)).join("")}</ul>
      </div>`
    )
    .join("");
}

function renderChecklistRow(item, aiReason) {
  const checked = state.checked[item.id] ? "checked" : "";
  const stores = item.purchaseCategories?.length
    ? `<span class="pill">${item.purchaseCategories.join(" / ")}</span>`
    : "";
  const priorityPill = item.priority !== "conditional"
    ? `<span class="pill pill-${item.priority}">${item.priority}</span>`
    : "";
  const reason = aiReason ? `<p class="ai-reason">${escapeHtml(aiReason)}</p>` : "";
  return `
    <li class="checklist-item">
      <label>
        <input type="checkbox" data-id="${item.id}" ${checked} />
        <span class="item-name">${item.item}</span>
        ${priorityPill}${stores}
      </label>
      ${item.notes ? `<p class="item-notes">${escapeHtml(item.notes)}</p>` : ""}
      ${reason}
    </li>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function attachCheckboxHandlers() {
  document.querySelectorAll('input[type="checkbox"][data-id]').forEach((cb) => {
    cb.addEventListener("change", () => {
      state.checked[cb.dataset.id] = cb.checked;
      saveChecked();
    });
  });
}

async function onPersonalize() {
  const status = document.getElementById("personalize-status");
  const text = document.getElementById("household-text").value.trim();
  const checklist = currentChecklist();

  if (!text) {
    status.textContent = "Add a sentence or two about your household, or skip this — the checklist above already works without it.";
    return;
  }

  status.textContent = "Personalizing…";
  try {
    const intakeRes = await fetch("/api/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "parseIntake", freeText: text }),
    }).then((r) => r.json());

    if (!intakeRes.ok) throw new Error(intakeRes.error || "intake failed");
    state.profile = intakeRes.result;

    const prioritizeRes = await fetch("/api/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "prioritize", checklist, profile: state.profile }),
    }).then((r) => r.json());

    if (!prioritizeRes.ok) throw new Error(prioritizeRes.error || "prioritize failed");
    state.aiTopTen = prioritizeRes.result.topTen;
    status.textContent = "Personalized using your description.";
  } catch (err) {
    // Fallback path: AI unavailable or invalid — never show an error, just
    // fall back to the deterministic top-10 + a best-effort keyword parse.
    console.warn("AI personalization failed, falling back:", err.message);
    state.profile = keywordFallbackProfile(text);
    state.aiTopTen = null;
    status.textContent = "Showing the standard prioritized list (personalization service unavailable right now).";
  }
  render();
}

// Deterministic fallback if the AI call fails entirely — a crude keyword
// match beats no personalization at all, per the "never show nothing" rule.
function keywordFallbackProfile(text) {
  const t = text.toLowerCase();
  return {
    infant: /\b(infant|baby|newborn)\b/.test(t),
    elderly: /\b(elderly|grandmother|grandfather|senior)\b/.test(t),
    pet: /\b(cat|dog|pet)\b/.test(t),
    mobilityIssue: /\b(wheelchair|walker|mobility)\b/.test(t),
    medicalDevice: /\b(oxygen|dialysis|cpap|medical device)\b/.test(t),
  };
}

init();
