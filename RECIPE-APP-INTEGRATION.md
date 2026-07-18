# FlyerSnap ↔ Recipe App — Integration Contract

**Audience:** whoever is building the recipe app.
**FlyerSnap version this describes:** v2.0 (`index.html`, single file, vanilla JS, no build step).
**Status:** the exchange protocol below is a *proposal*. FlyerSnap does not implement it yet. Everything under "Facts" is true today and can be relied on.

---

## 1. Read this first — the shared-origin hazard

FlyerSnap is a PWA served from GitHub Pages at:

```
https://lfaley.github.io/FlyerScannerAndScheduler/
```

**`localStorage` is scoped to the origin (`https://lfaley.github.io`), not to the path.** If the recipe app is hosted anywhere on that same host — `lfaley.github.io/recipes`, `/recipebox`, anything — then **both apps read and write the same localStorage bucket.** They are not isolated. They only appear to be.

Consequences the recipe app author must design around:

| Action in the recipe app | Effect on FlyerSnap |
|---|---|
| `localStorage.clear()` | **Destroys everything.** Events, chores, star history, recipes, meal plans, snapshots. Unrecoverable without an exported file. |
| `localStorage.setItem('flyersnap', ...)` | Overwrites the live data store. |
| Removing any `flyersnap*` key | Deletes real user data or its safety net. |
| Writing a non-`flyersnap*` key | Safe. |

**Hard rule: the recipe app must never call `localStorage.clear()`, and must never write or delete any key beginning with `flyersnap`.** To clear its own data, it removes its own keys by name.

If the recipe app is hosted on a *different* origin (its own domain, or a different host), none of this applies — but then localStorage cannot be shared at all, and integration must go through export/import files (see §6).

---

## 2. Facts — keys FlyerSnap owns

Do not write or delete these.

| Key | Contents |
|---|---|
| `flyersnap` | The entire live data store, one JSON object. |
| `flyersnap-snap-YYYY-MM-DD` | Daily rolling snapshots. Last 3 kept. |
| `flyersnap-lastsnapshot` | Snapshot throttle timestamp (ms). |
| `flyersnap-quarantine` | Raw bytes preserved when the store failed to parse. |

Reserve the whole `flyersnap*` namespace for FlyerSnap. Pick a distinct prefix for the recipe app (e.g. `recipebox*`).

---

## 3. Facts — FlyerSnap's data shapes

The `flyersnap` key holds one object. Relevant slices:

```js
{
  recipes: [
    {
      id: "m4k2j9x8a1b",     // string, app-generated, unique
      title: "Chicken Tacos",
      category: "Dinner",     // "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Other"
      ingredients: "1 lb ground beef\ntortillas\nshredded cheese",  // plain text, ONE PER LINE
      instructions: "1. Brown the beef...\n2. Warm the tortillas...",
      deleted: false          // soft delete — rows are never removed
    }
  ],

  meals: [
    {
      id: "...",
      date: "2026-07-20",     // YYYY-MM-DD
      slot: "dinner",         // "breakfast" | "lunch" | "dinner"
      title: "Chicken Tacos", // denormalised copy of the recipe title
      recipeId: "m4k2j9x8a1b",// null when the meal was typed in freehand
      deleted: false
    }
  ],

  lists:     [ { id, name, deleted } ],
  listItems: [ { id, listId, text, checked, deleted, ingKey?, forDate? } ]
}
```

Notes that matter:

- **`ingredients` is newline-delimited plain text, not an array.** FlyerSnap's grocery builder splits on `\n`, trims, and drops blanks. If the recipe app uses structured ingredients (`{qty, unit, item}`), it must serialise to one-line-per-ingredient on the way out.
- **Soft deletes everywhere.** `deleted: true` means gone. Never splice rows out; other records reference them by id.
- **`meals.recipeId` is a foreign key into `recipes.id`.** Deleting a recipe does not clean up meals — meals keep the denormalised `title` and simply stop resolving.
- **`listItems.ingKey`** is a normalised ingredient key (lowercased, punctuation stripped, whitespace collapsed) used by the pantry logic; **`forDate`** is the date of the earliest meal that needs it. Both are set only by FlyerSnap's grocery builder. Leave them alone.
- There is **no `updatedAt` on recipes today.** See §5.

---

## 4. What FlyerSnap already does with recipes

- **Recipe Box** (Meals tab → 📖 Recipe Box): manual entry, plus a camera scanner that sends a photo to the Claude API and gets back `{title, category, ingredients, instructions}`.
- **Meal planner**: 7-day breakfast/lunch/dinner grid. Tapping a slot offers saved recipes as chips; picking one sets `meals.recipeId`.
- **Grocery builder** (Meals tab → 🛒 Ingredients): rolls up ingredients from the week's planned meals, dedupes by normalised key, counts repeats, and skips anything already covered. Ingredients become `listItems` on a list named `Groceries`/`Shopping`.

So the meal planner and grocery link **already work end to end** against FlyerSnap's own recipe store. The integration question is only: *where do recipes come from?*

---

## 5. Proposed exchange protocol (not yet built)

Goal: two independently-developed apps share recipes without ever fighting over a key.

**Principle: one writer per key.** Each app writes only its own outbox and only reads the other's. No read-modify-write races, no clobbering, no locking.

| Key | Written by | Read by |
|---|---|---|
| `recipebox-out` | Recipe app | FlyerSnap |
| `flyersnap-recipes-out` | FlyerSnap | Recipe app |

Both use the same envelope:

```json
{
  "schema": "recipe-exchange.v1",
  "updatedAt": "2026-07-17T22:04:00.000Z",
  "recipes": [
    {
      "id": "rb_8812",
      "title": "Chicken Tacos",
      "category": "Dinner",
      "ingredients": "1 lb ground beef\ntortillas\nshredded cheese",
      "instructions": "1. Brown the beef...",
      "updatedAt": "2026-07-17T21:00:00.000Z",
      "deleted": false
    }
  ]
}
```

Rules:

1. **`id` is globally unique and stable.** Prefix it per-app (`rb_…` from the recipe app, `fs_…` from FlyerSnap) so ids can never collide.
2. **`updatedAt` is ISO-8601 UTC, bumped on every change** including deletes. This is the merge key.
3. **Merge is last-writer-wins per recipe id**, compared on `updatedAt`. Never merge field-by-field.
4. **Deletes propagate as `deleted: true` with a fresh `updatedAt`.** Never drop the row from the envelope.
5. **Unknown fields must be preserved**, not stripped, so either app can add fields without breaking the other.
6. **Rewrite the whole envelope on every change.** It is small; do not try to append.
7. **Read the other app's outbox on open**, and on `visibilitychange` when becoming visible.
8. **Never write the other app's outbox.** Not even to mark something merged. Track merge state in your own storage.

If only one direction is needed — the recipe app is the source of truth and FlyerSnap just consumes — implement `recipebox-out` only and skip the rest. Simpler is better.

**FlyerSnap's side is not built.** It needs: `updatedAt` added to `recipes`, an importer that merges `recipebox-out` on open, and an exporter that writes `flyersnap-recipes-out`. Small change, roughly an hour, once the questions in §7 are answered.

---

## 6. If the apps are NOT on the same origin

localStorage cannot be shared. Options, best first:

1. **Host both on `lfaley.github.io`** and use §5. Cheapest path.
2. **File exchange.** Recipe app exports the §5 envelope as a `.json` download; FlyerSnap imports it via a file picker. Manual, no coupling, works across any hosting. Fine for a recipe library that changes weekly, not hourly.
3. **A shared backend.** Do not do this for this use case. It adds accounts, hosting, and a database holding family data, and buys nothing that (1) does not already provide.

---

## 7. Open questions for the recipe app author

Answer these and the FlyerSnap side can be built to match:

1. **Where is it hosted?** Same origin as FlyerSnap, or elsewhere? This decides §5 vs §6 and nothing else can be settled first.
2. **What is its storage key and data shape?** Especially: are ingredients structured or free text?
3. **Who owns a recipe's truth?** If both apps can edit the same recipe, we need `updatedAt` discipline on both sides. If the recipe app is authoritative and FlyerSnap is read-only, say so and we drop half the protocol.
4. **Should FlyerSnap's camera scanner keep writing recipes**, or hand them to the recipe app instead?
5. **Does the recipe app want the meal plan and grocery list too**, or is that staying in FlyerSnap? If both apps grow a meal planner, they will fight and one should lose on purpose.

---

## 8. Non-negotiables

- Never `localStorage.clear()`.
- Never touch a `flyersnap*` key.
- Never remove a row; set `deleted: true`.
- Never write the other app's outbox.
- Preserve unknown fields on merge.
- FlyerSnap treats unreadable data as **fatal**: it locks writes and shows a recovery screen rather than starting empty. If the recipe app corrupts the `flyersnap` key, the user sees a scary screen and has to restore from a snapshot. Do not be the reason that happens.
