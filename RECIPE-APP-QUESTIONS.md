# Recipe App → FlyerSnap: Information Request

You are building a standalone recipe app. It needs to integrate with **FlyerSnap**, a separate family-organization PWA (flyer scanning, calendar reminders, chores, meal planning, grocery lists). The two apps are both hosted on the same GitHub account and will likely share a browser origin, which makes a few things important to get right.

Please read the companion file **RECIPE-APP-INTEGRATION.md** (the full contract), then answer the questions below and return them. The FlyerSnap side will be built to match your answers. **Do not write integration code yet** — several of these answers change the whole approach.

---

## CRITICAL — read before doing anything

If your app is served from the same origin as FlyerSnap (e.g. both under `https://lfaley.github.io`), then **both apps share one `localStorage` bucket.** They are not isolated by folder or path.

Confirm your app obeys these, and fix it now if it doesn't:

- [ ] It **never** calls `localStorage.clear()`.
- [ ] It **never** writes or deletes any key beginning with `flyersnap`.
- [ ] It confines its own data to its own clearly-prefixed keys (e.g. `recipebox*`).

A single `localStorage.clear()` on startup would erase a child's school/activity schedule, chore history, and safety backups in the other app. This is the highest priority item.

---

## Section A — Hosting & storage (decides everything else)

1. **Exact hosting URL** of the recipe app (e.g. `https://lfaley.github.io/recipes/`). Same origin as FlyerSnap, or different?

2. **Where does the app store its data?** localStorage, IndexedDB, a bundled static JSON file shipped with the app, or something else?

3. **How big is the library, roughly, in megabytes?** (Thousands of recipes almost certainly exceeds the ~5MB localStorage limit, which is why this matters.)

4. If it uses localStorage today: **list every key it reads or writes.** We need to confirm none collide with `flyersnap*`.

---

## Section B — Recipe data shape

5. **Paste one real recipe object** exactly as your app stores it (a representative example, any sensitive bits redacted).

6. Specifically for ingredients: **structured array** (e.g. `[{qty, unit, item}]`) or **free text**? If structured, can you emit a plain-text, one-ingredient-per-line version for exchange? (FlyerSnap's grocery builder splits ingredients on newlines.)

7. Do recipes have a **stable unique id** that never changes across edits? What does it look like?

8. Do recipes carry an **`updatedAt` / last-modified timestamp**? If not, can you add one that bumps on every edit and delete?

9. How are **deletes** handled — row removed, or a soft-delete flag?

---

## Section C — Integration scope (what should actually flow)

10. **Direction of truth:** is the recipe app the sole source of recipes (FlyerSnap just consumes), or will both apps be able to create/edit recipes that need to sync both ways?

11. **How much should cross over?** The whole library of thousands, or only recipes the user explicitly saves/favorites? (Strong recommendation: only a saved subset. Pushing thousands into FlyerSnap's shared storage risks blowing the 5MB origin limit and triggering data eviction for both apps.)

12. Does the recipe app want FlyerSnap's **meal planner and grocery list**, or are those staying solely in FlyerSnap? (If both apps grow a meal planner, they'll conflict and one should intentionally not have it.)

13. FlyerSnap already has its own small Recipe Box plus a **camera recipe scanner** (photo → Claude → structured recipe). Should that keep creating recipes locally, or should new recipes be handed to your app as the library of record?

---

## Section D — Mechanism preference

14. Given hosting (Q1), which exchange fits — and why:
    - **Same origin:** a one-writer-per-key handoff in shared localStorage (each app writes only its own outbox key, reads the other's). Detailed in RECIPE-APP-INTEGRATION.md §5.
    - **Different origin:** file export/import (recipe app downloads a JSON envelope, FlyerSnap imports it), since storage can't be shared across origins.

15. Any framework or build step? (FlyerSnap is a single hand-written `index.html`, no build, no dependencies. Not required to match — just need to know what we're bridging to.)

---

## Return format

Answer A–D inline. For B5, paste real JSON. If anything's undecided, say so — "not sure yet" is a useful answer that tells us where to leave a seam. Once these come back, FlyerSnap's importer/exporter gets built to spec.
