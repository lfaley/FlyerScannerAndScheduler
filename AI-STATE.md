# AI-STATE — the one true picture of the AI stack

**Last updated:** 2026-09-03 · **Status:** current, shipped to all three apps.

This is the single source of truth for how AI runs across the universe
(MealWeek / recipe app, FlyerSnap, Admin Console). If any other doc disagrees
with this file, **this file wins** — the other doc is stale. Every app repo
carries an identical copy so there is nowhere for the picture to drift.

---

## 1. The one model: `qwen3-vl:8b-instruct-q4_K_M`

Both apps request **exactly** this Ollama tag:

```
qwen3-vl:8b-instruct-q4_K_M
```

It is the 8-billion-parameter **Qwen3-VL** model — **vision-capable**,
**Instruct**-tuned, quantized at **q4_K_M (≈6.1 GB)**.

### Why both apps must share one tag

Gordon is one Ollama on one GPU (RTX 5060 Ti, ~14.4 GiB usable) behind one
auth-checking proxy. Two different tags cannot both stay resident — the moment
one app asks for a different tag, Ollama evicts the loaded model and reloads
several GB from disk. If the two apps disagree, **every switch between them
triggers a multi-GB reload** ("Gordon is really slow"). So the rule is
absolute: **one tag, requested by both apps.** Change it in one place and you
must change it in the other in the same breath.

---

## 2. How we got here — the journey, not a jump

We did not start on `q4_K_M`. Each step was a real fix that exposed the next
problem, and this is the trail so nobody re-walks it:

| Step | Tag | What it gave us | Why we moved on |
|------|-----|-----------------|-----------------|
| 1 | `qwen2.5:14b-instruct` (8.1 GB) | First local model. | **Text-only.** It literally cannot read FlyerSnap's flyer photos. Vision is non-negotiable. |
| 2 | `qwen3-vl:8b` (bare tag) | Vision, and small. | **It is the "Thinking" edition** (the manifest inherits `from: qwen3-vl:8b-thinking-bf16`). It reasons until it runs out of token budget and **never returns an answer.** This was the "recipe AI is confused" root cause once the GitHub build var was set to it. |
| 3 | `qwen3-vl:8b-instruct-q8_0` (9.8 GB) | Vision **and** Instruct — correct behavior at last. | **It is the LARGEST tag of all** (despite being "8B"). Inference speed is memory-bandwidth-bound — roughly bytes-read-per-token — so the 9.8 GB q8_0 is *slower per token* than everything above it. Correct, but the slow choice. |
| 4 | **`qwen3-vl:8b-instruct-q4_K_M` (6.1 GB)** | Vision + Instruct at **half the q8_0 footprint** → fastest, and q4_K_M keeps 8B quality (the standard sweet spot). | **This is where we landed.** ✅ |

**Do NOT use** any of steps 1–3. They are kept in the migration/rewrite sets
precisely so that any device or build still stuck on one gets pulled forward to
q4_K_M automatically.

---

## 3. How each app ships the tag

### MealWeek / recipe app (React + Vite → GitHub Pages)
- **Build-time env var `VITE_HOSTED_AI_MODEL`** (a GitHub Actions **Variable**)
  is the real source of what ships. It must be set to
  `qwen3-vl:8b-instruct-q4_K_M`. This is the value that actually reaches users —
  not the in-code constant.
- `src/lib/aiConfig.ts` defines `GORDON_MODEL = 'qwen3-vl:8b-instruct-q4_K_M'`
  (the canonical constant) and `migrateModelTag()`, which rewrites a stale saved
  `mealplanner-ai-model` in a user's browser (14b / bare `qwen3-vl:8b` / q8_0)
  onto the good tag. It runs at startup (`src/main.tsx:42`).
- Shipped: commit `993ccf8` ("ai: standardize on qwen3-vl:8b-instruct-q4_K_M +
  startup migration for stale tags"), `npm run verify` green (1269 tests).

### FlyerSnap (single-file no-build PWA)
- `GORDON_MODEL` constant in `index.html` = `qwen3-vl:8b-instruct-q4_K_M`; the
  blank-state default and the Settings help text point at the same tag.
- `js/migrate.js` (`from < 5` block) rewrites a saved `localModel` of
  `qwen2.5:14b-instruct`, bare `qwen3-vl:8b`, or `qwen3-vl:8b-instruct-q8_0`
  onto q4_K_M. The inlined copy inside `index.html` matches `js/migrate.js`
  exactly (guarded by the inline-copy test).
- Shipped: `APP_VERSION = 'v10.0'`, `sw.js` CACHE `flyersnap-v184` (3 Sep 2026).

### Admin Console
- No model of its own. It manages the allowlist (`allowedUsers/{email}`) that
  gates both apps' data and AI, and it mirrors the Firestore rules. See §4.

---

## 4. AI is gated by login — the current security state

AI is no longer open. Both the database and the AI features sit behind the same
identity gate.

- **Firestore rules (v4)** define `isAllowlisted()` =
  **Firebase Auth signed in** `&&` **`email_verified === true`** `&&` a doc
  exists at **`allowedUsers/{lowercased-email}`**. Every data collection
  (plans, libraries, pantries, techniques) requires `isAllowlisted()`.
  `errorReports.create` stays open so unauthenticated error capture still works.
- **Gordon proxy** (`server/verifyFirebaseToken.mjs`) hard-requires
  `email_verified === true` (rejects otherwise: "email not verified"). The
  recipe app sends the signed-in user's Firebase **ID token**; before per-user
  login is fully flipped on, it falls back to the proxy's shared token
  (`VITE_HOSTED_AI_TOKEN`) and auto-upgrades to ID tokens once signed in.
- **Recipe app = full app login.** **FlyerSnap = login to unlock AI** (the rest
  of the app works signed-out).
- **Anthropic stays as the fallback**, on by default — when Gordon is
  unreachable (PC asleep / Tailscale down) the call path retries Anthropic so AI
  never just breaks. Gordon is primary; Anthropic is the safety net, not removed.

---

## 5. FlyerSnap EA assistant (current)

FlyerSnap has a conversational **Executive Assistant** (the analog of the recipe
app's chef assistant, recast as an EA). It uses a **model-agnostic** JSON-turn
contract (one turn = `{message}` | `{intent/tool}` | `{clarify}`,
propose-then-confirm), so it needs **no native tool-calling** and runs fine on
`qwen3-vl:8b-instruct-q4_K_M`. A **tone setting** in the Settings menu controls
how it addresses the user — **Professional** (default) or **Casual**. Batch
enrichment (`enrich_batch`) previews every change on a review screen and writes
only on confirm.

---

## 6. Operational reminders

- After both apps are on q4_K_M, the stale models are dead weight on the GPU and
  can be removed: `ollama rm qwen3-vl:8b`,
  `ollama rm qwen3-vl:8b-instruct-q8_0`, `ollama rm qwen2.5:14b-instruct`.
- If you ever change the model tag: change it in **all** of
  `VITE_HOSTED_AI_MODEL` (GitHub Variable), recipe `GORDON_MODEL`, FlyerSnap
  `GORDON_MODEL`, both migration sets, **every default in `scripts/`**, and this
  file — together.
  - `scripts/` was missing from this list until 2026-08-31, and that is exactly why it
    drifted: `scripts/corpus/generateDescriptions.mjs` and `scripts/regenerateCorpus.ts`
    were still defaulting to `qwen2.5:14b-instruct` — a tag this very file says never to
    use and that `src/lib/aiConfig.ts:150` lists in `BAD_MODEL_TAGS`. Both were corrected
    the same day. `scripts/classifyCorpus.mjs:32` had it right and shows the intended
    shape: `process.env.GORDON_MODEL || 'qwen3-vl:8b-instruct-q4_K_M'`.
  - Check with: `grep -rn "qwen" scripts src .github` before calling a tag change done.
- FlyerSnap deploy always bumps `APP_VERSION` **and** `sw.js` CACHE, keeps the
  inlined `js/` copies identical to source, and requires "N passed, 0 failed".
