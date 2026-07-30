# Recipe app <-> FlyerSnap: how sharing actually works

Two findings from live use, plus one request for the recipe app side.

---

## 1. IMPORTANT: the two apps only share data when opened the same way

**The meal plan only reaches FlyerSnap when the recipe app is opened from within
FlyerSnap** (via the "Open Recipe app" button on the Meals tab). Opening the
standalone recipe app -- its own home-screen icon, or a separate Safari tab --
writes to a different storage bucket that FlyerSnap cannot read.

**Why:** the exchange is two `localStorage` keys on the shared `lfaley.github.io`
origin. On iOS, an installed (home-screen) PWA gets its own storage container that
is separate from Safari's, and separate from other installed PWAs -- even for the
same origin. So "same origin" is not sufficient; the two apps must be running in
the same storage context.

**Practical rule for using it:**
- Plan meals in the recipe app **opened from FlyerSnap's Meals tab**, and they
  appear on FlyerSnap's calendar.
- Meals planned in the standalone recipe app sync to Firestore (their cloud) but
  will **not** appear in FlyerSnap.

**If cross-install sync is wanted later**, the only reliable route is for the
recipe app to publish to somewhere both containers can reach (its Firestore doc)
and for FlyerSnap to read from there -- which would mean FlyerSnap talking to the
cloud. That was deliberately ruled out (FlyerSnap stays local, no dependencies),
so the current behaviour is a known, accepted limitation rather than a bug.

---

## 2. FlyerSnap now displays all five meal slots

FlyerSnap previously showed only `breakfast`, `lunch`, `dinner` and silently
dropped anything else. It now accepts and displays **five** slots, ordered through
the day:

```
breakfast -> lunch -> snack -> dinner -> dessert
```

Badges on the Meals tab: `B`, `L`, `Sn`, `D`, `Ds`.

### Request for the recipe app

Your earlier handoff stated that **dessert and snack are intentionally local-only
and never published** to `mealplan-out`. That is the remaining blocker:

> **Please include `dessert` and `snack` assignments in the published
> `mealplan-exchange.v1` envelope.** The mapping in `buildMealPlanEnvelope()`
> should stop filtering them out. Everything else about the contract is unchanged
> -- same schema string, same `{ date, slot, recipeId, title }` shape, same
> denormalised `title`, same `recipeUrlTemplate` / `shoppingListUrl`.

FlyerSnap's read side is already updated and will display them as soon as they
appear in the envelope. Unrecognised slot values are still ignored safely, so
publishing them early cannot break anything.

---

## Unchanged

- Envelope: `mealplan-out`, schema `mealplan-exchange.v1`, recipe app is the only
  writer.
- Reverse direction: FlyerSnap writes a scanned recipe once to
  `flyersnap-scanned-out` (`recipe-exchange.v1`, `fs_` prefixed ids) and then
  forgets it.
- FlyerSnap does not and will not talk to Firestore.
- Only meals dated today or later are shown.
