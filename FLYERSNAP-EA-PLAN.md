# FLYERSNAP-EA-PLAN — Gordon as an enrichment assistant over what you ingest

> **Orchestrator context** — this document belongs to Logan's app **universe** (MealWeek · FlyerSnap · Admin Console), coordinated as one system while each app stays its own deployable entity. It is written from the orchestrator's perspective — one authority sequencing the apps forward together — and is governed by **`UNIVERSE-CONTROL.md`** (the control point; it wins on any conflict). **Role here:** the plan to make Gordon a real assistant for the *content FlyerSnap already ingests* — reasoning over each incoming email/upload and its extracted entries to tag, theme, and annotate them — not an inbox-searching agent.

**Written:** August 24, 2026 (v2 — rescoped per Logan) · **Baseline:** FlyerSnap v9.27 · **Method:** Research → Plan → Scaffold → Code → Verify. Companion to `FLYERSNAP-EA-READINESS-REVIEW.md`.

**v2 scope correction (Logan, Aug 24):** the EA works on **what the Gmail watcher and manual uploads already bring in** — the source content the extraction step already holds, plus the draft entries it produces — and helps enrich those entries. It does **not** read or search the wider inbox. That narrower scope is the whole point: it's more useful for the real jobs and it removes the inbox-privacy surface entirely.

---

## 1. What the EA actually does (from Logan's examples)

Every capability operates on **one ingested batch** — an email the watcher pulled, or an upload — and its **extracted draft entries in the review screen**, before anything is saved:

1. **Common-theme across a batch, into the field you choose.** Concert dates arrive, none say "band." The EA either **notices the shared theme** or takes your word ("these are band"), and you tell it **where to put it — the title or the notes** ("add band to the title of all these" / "…to the notes"). It applies that to every entry in the batch.
2. **Apply a stated annotation to all / selected entries.** "Add room 204 to all of these" → written to each entry's `title` or `notes`, whichever you say.

**Decision (Logan, Aug 24):** the theme/annotation goes into an **existing editable field — `title` or `notes` — chosen per instruction.** No new tag/category field, no schema change. Both are already in the event's editable `FIELDS`/`SOFT` set (`index.html:2963`).
3. **Offer to save extra info into the notes box.** An email carries detail beyond the dates → the EA **asks** "want me to save [these parts] in the notes?" and, on yes, writes them into the entry's `notes`.
4. **Same for uploads with no email.** A pasted/attached list of dates gets the same theme/annotation help.

Common shape: **reason over content the app already has → propose enrichments to the draft entries → you confirm.** Nothing new is read; nothing is saved without review.

---

## 2. Why this is a workflow, not an inbox agent (grounded)

Anthropic, *Building Effective Agents*: **"only increase complexity when simpler solutions demonstrably fall short,"** and an agent is for **open-ended** problems where **"the number of steps…is unknown in advance."** Enriching a known batch of entries is **not** that — the inputs are in hand, the steps are bounded, the output is reviewable. So this is best built as an **extension of FlyerSnap's existing extraction→review workflow**, with an optional one-question clarify — **not** a tool-using agent loop and **not** inbox search. ([source](https://www.anthropic.com/engineering/building-effective-agents))

This also keeps FlyerSnap's existing philosophy intact: `AI-INTEGRATION-PLAN.md` §2 — nothing writes without review; `ASSISTANT-PLAN.md` — model classifies/produces, code controls flow; refuse/ask on ambiguity. The recipe app's "ask **one** clarifying question then act" pattern (`GORDON-APP-WIDE-PLAN.md`) is the right amount of interactivity here, not a multi-step agent.

**Deferred (explicitly, not dropped):** on-demand inbox search / "find anything in my email" is a *separate, larger* capability with a real privacy surface. It is **out of scope for this plan** and only revisited if you later want it — as its own decision, with the auth/consent design that would require.

---

## 3. Design

### 3.1 Where it plugs in
The extraction step already hands the model the source content per item (`index.html:6135` `--- EMAIL BODY ---`) and produces draft entries that land in the **review screen**. The EA is a **reasoning pass on that same batch**, between extraction and save:
```
watcher email / upload
        │
        ▼
 extraction (existing)  → draft entries + the source text (already in hand)
        │
        ▼
 EA enrichment pass (NEW):
   • detect a common theme across the batch (or accept the user's)
   • propose note/tag/field enrichments to ALL or selected entries
   • for extra prose, ASK before saving it into notes
        │
        ▼
 review screen (existing) → user edits/confirms → save   (nothing saved before this)
```

### 3.2 Consequence classes (reuse the existing enum)
- **Theme detection / suggestions** = `read`/`derive` (proposes; writes nothing on its own).
- **Applying a note/tag, or saving info to notes** = `propose` → lands as an editable change in the review screen, saved only on the existing confirm. (`AI-INTEGRATION-PLAN.md` §2b; `ASSISTANT-ACTIONS-PLAN.md` draft/confirm flow.)
No new consequence class; the closed set stays closed (a property FlyerSnap tests).

### 3.3 Interactivity (bounded)
When something is ambiguous ("is this batch band, or band + choir?"), the EA **asks one question** and applies the answer — the recipe app's ask-once pattern, and FlyerSnap's refuse-on-ambiguity rule. It does not loop or chain tools.

### 3.4 Model call shape
One (occasionally two, if it asks a clarifier) **structured-output** call over the batch — the same hostile-parsed JSON discipline the router already uses (`ASSISTANT-PLAN.md` §5). Example return:
```
{ "theme": "band", "confidence": 0.9,
  "apply": [{ "entryIds": "all", "field": "title", "value": "band", "mode": "prefix" }],
  "notesOffer": [{ "entryId": 3, "text": "Report to the choir room by 6:15; wear black." }],
  "ask": null }
```
`field` is `"title"` or `"notes"` — chosen from the user's instruction (Logan's decision). `mode` says how (`prefix`/`suffix`/`replace` for title, `append` for notes) so a preview can show the exact result, e.g. title `"Fall Concert"` → `"Band — Fall Concert"`. Code validates it against the real fields, previews every change in the review screen, and writes only on confirm. No native tool-calling required (model-agnostic — works on `qwen3-vl:8b` regardless of its tool-call reliability).

---

## 4. What it needs from the data (no new external access)

- **The source text** the extraction already receives (email body / upload text) — already available at the point of extraction; the EA reuses it, no new fetch.
- **The draft entries** in the review screen — already in memory.
- **The `title` and `notes` fields** — both already exist and are user-editable (`index.html:2963` `FIELDS`, `:2964` `SOFT`). The theme goes into whichever the user names. **No new field required** (confirmed in Phase 0).
- **A batch/theme concept** — the entries from one ingest already form a batch; the EA applies at batch or per-entry granularity.

No Gmail-watcher change. No inbox search. No new network surface.

---

## 5. Model & backend
- Runs through the **Gordon proxy** (live, gated).
- **Model:** `qwen3-vl:8b` (already serves extraction + vision) handles this; it's reasoning over text the app supplies. No model swap needed.
- **Thinking mode:** a short reasoning pass helps theme-inference — leave **on** for the enrichment call; keep it **off** for the raw extraction call. Keep the model warm (`OLLAMA_KEEP_ALIVE`).

---

## 6. Security & privacy (much smaller than v1)
- **No new data access.** The EA sees only what extraction already sees (the ingested item) and the drafts. Removing inbox search removes the biggest surface.
- **Nothing saved without review** — enrichments are previewed in the existing review screen and confirmed there.
- Model calls stay behind the **Gordon proxy** (token/allowlist); logs never carry email/prompt content (keep the `isThirdPartyContent` guard covering any new log site).

---

## 7. Phasing

**Phase 0 — verify (DONE, Aug 24):** confirmed against code — `notes` **and** `title` already exist as user-editable fields (`index.html:2963-2964`); the extraction prompt already draws notes from every source incl. the covering email (`:626`, `:643`), so the "email detail → notes" behavior is largely built already; drafts land in the review screen before save (`:881`, `CONSEQUENCE.DRAFT`). **Decision:** theme/annotation goes into `title` or `notes`, chosen per instruction — no new field. Remaining tiny check at build time: the exact in-memory handle for "the entries from this ingest" to iterate for batch apply.

- **Phase 1 — apply a stated annotation to a batch, into a chosen field:** "add band to the title of all these" / "…to the notes" → applies to all/selected draft entries in the named field (`title`|`notes`), previewed + confirmed. Highest value, lowest risk; no inference yet.
- **Phase 2 — common-theme *detection*:** the EA proposes the theme itself ("these look like band events — add 'band' to the title of all?"), you accept/adjust the theme **and** the target field; ask-one-question when unsure.
- **Phase 3 — offer to save extra info to notes:** the EA surfaces the useful non-date prose and asks before writing it into `notes` (this partly overlaps what extraction already does; here it's interactive/after-the-fact).
- Uploads-with-no-email are covered by the same passes (Phase 1 onward), since the input is just the batch + optional source text.

Each phase reuses FlyerSnap's test discipline: hostile-parse tests on the model output, a **no-write-without-confirm** property test, refuse/ask-on-ambiguity tests, and an **AI-off fallback** (manual title/notes edits still work).

---

## 8. Files (scaffold — small, single-purpose, pure where possible)
- `js/ea-enrich.js` — NEW, pure: build the enrichment prompt from (source text + draft entries), hostile-parse + validate the structured result, and compute the proposed changes. No DOM, no writes.
- `index.html` — wire the enrichment pass after extraction: render proposed tags/notes in the review screen, the one-question clarifier, and apply-on-confirm using the app's existing entry-update + undo functions (never a reimplemented write, per `ASSISTANT-ACTIONS-PLAN.md` non-negotiable #3).
- Event model — **no change needed**; `title` and `notes` already exist and are editable (Phase 0 confirmed).

---

## 9. Acceptance criteria
- Concert-dates email, none marked band → "add band to the title of all these" → on confirm, **every** entry's title carries "band"; nothing saved before confirm; each change previewed and editable.
- "Add band to the notes instead" → same, but into `notes`.
- Upload of dates (no email) → same theme help, same field choice.
- Email with extra detail → EA **asks** before putting it in notes; on yes, it lands in the entry's `notes`, editable.
- Ambiguous theme → EA asks one question rather than guessing.
- AI off → manual title/notes edits still work; extraction unchanged.

---

## 10. Honest caveats
- **Theme inference can be wrong** (a mixed batch). Mitigation: propose + confirm + ask-on-ambiguity; the user always sees and edits before save.
- **This is enrichment, not an inbox assistant.** If you later want true "find anything in my email," that's a separate plan with its own consent/security design (§2, Deferred) — not folded in here.
- A wrong *suggestion* costs a tap to reject; a wrong *save* can't happen without your confirm — the asymmetry FlyerSnap already relies on.

---

## 11. Sources
- **Repo (verified on disk, Aug 24 2026):** `FlyerSnap/index.html` (6135 `--- EMAIL BODY ---`, the extraction→review flow), `ASSISTANT-PLAN.md`, `ASSISTANT-ACTIONS-PLAN.md` (non-negotiables), `AI-INTEGRATION-PLAN.md` (risk classes, review-before-write); `RecipeAndMealPlanner/meal-planner-shoppin/GORDON-APP-WIDE-PLAN.md` (ask-one-question pattern).
- **Research:** Anthropic, [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents) (use the simplest thing that works; agents only for open-ended, unknown-step problems — which this deliberately is not).
