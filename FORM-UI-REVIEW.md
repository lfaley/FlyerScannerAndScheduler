# Edit Event — UI review

**Reviewed:** August 22, 2026 · **Build:** v9.11 · **Method:** research → review → fix → verify

Every finding below is measured against published, empirically-grounded
guidance, cited inline. Nothing here is preference.

## The evidence base

**Baymard Institute** — 18 mobile sites, 1,000+ mobile form fields observed.
Labels belong **above** the field in portrait, because with a label beside it
"the narrow screen leaves very little space left for the field itself." The
observed consequence when fields are too narrow to show their own content:
users "struggled spotting typing errors before submission", and many "opted to
delete and retype entire inputs rather than troubleshoot."

**Nielsen Norman Group, *Website Forms Usability: Top 10*** —
(3) single column, because "multiple columns interrupt the vertical momentum
of moving down the form", with a stated exception only for "logically related
**short** fields like City, State, Zip";
(6) "Text fields should be about the same size as the expected input since it's
extremely error prone when users can't see their full entry";
(7) distinguish optional and required;
(8) explain formatting requirements up front rather than only in errors;
(10) errors need multiple visual cues and must sit next to the field.

**NN/g, *4 Principles to Reduce Cognitive Load in Forms*** — error messages
must be "displayed next to the field containing the error", otherwise "the user
will need to commit the message to memory."

**UK Parliament / GOV.UK Design System** — mark the **optional** fields, not
the required ones, and avoid asterisks as they "can be distracting or
confusing." Avoid all-caps, which "makes text difficult to read and is not
accessible."

---

## Findings, worst first

### F1 — The Date / Start / End row is broken (layout defect)

`.formrow` is `display:flex` with three `flex:1` children on a 393px screen:
roughly 116px per column. "Start (optional)" cannot fit on one line, so it
wraps, which pushes its input down while the others stay up — the visible
misalignment. The End field is then clipped at the screen edge.

This is NN/g #3's exception being misapplied: three-up is only sanctioned for
"logically related **short** fields", and these labels are not short. It is
also Baymard's exact documented failure — a field too narrow to show its own
value, with the exact consequence they observed (you cannot see what you typed,
so you cannot check it).

**Fix:** Date on its own full-width row. Start and End share one row — two
columns, not three — as a genuinely short, logically related pair.

### F2 — All-caps labels (accessibility + readability)

`.label` sets `text-transform:uppercase`. Directly contradicts the guidance
that all-caps "makes text difficult to read and is not accessible."
It also inflates every label's length, which is a *contributing cause of F1*.

**Fix:** sentence case, keep the weight and colour for hierarchy.

### F3 — The primary action is cut off

"Save changes" is clipped by the tab bar and "Cancel" is entirely off-screen.
`body` has `padding-bottom: calc(88px + safe-area)` and the nav occupies
54px + safe-area, so the margin is far too thin once a Cancel link sits below
the button. The completion action of the screen is not fully reachable.

**Fix:** enough bottom padding on form screens that the last control clears
the tab bar with room to spare.

### F4 — Type and Who are not real controls (accessibility defect)

Both groups render as `<span class="chip" onclick=...>`. **Type** behaves as a
radio group (one of Event/Deadline) and **Who** as a checkbox group
(multi-select), but neither is reachable by keyboard, neither announces its
state, and their group labels are `<div class="label">` — a styling class, not
a `<label>`, and not associated with anything.

This is the same class of defect the v9.1 audit fixed elsewhere; these two
were missed because the audit only walked the five top-level tabs.

**Fix:** `role="radio"`/`role="checkbox"` with `aria-checked`, wrapped in a
`role="radiogroup"`/`role="group"` with an `aria-label`, and made focusable
and operable by keyboard.

### F5 — No screen heading

Every other screen sets its title through `setHeader()`, which renders an
`<h1 class="htitle">`. This one writes `Edit Event` as a bare text node, so the
screen has no heading at all — a regression against the v9.1 landmark work,
and again missed because the audit only covers top-level tabs.

**Fix:** use the same heading markup; extend the audit to sub-screens.

### F6 — Validation is a modal alert, detached from the field

`saveEventEdit()` calls `alert('The event needs a title and a valid date.')`.
NN/g: the message must sit "next to the field containing the error", or it has
to be memorised. A blocking dialog also has to be dismissed before the user can
even look at the form, and it names two fields without saying which is wrong.

**Fix:** inline error under the offending field, with the field marked, and
focus moved to it.

### F7 — Required fields are not marked

Title and Date are enforced on save, but nothing says so beforehand — the user
only finds out by failing. Two fields *are* marked "(optional)", which by the
GOV.UK convention correctly implies the rest are required; but that convention
only works if it is applied consistently and is legible, and F1/F2 defeat both.

**Fix:** keep marking optional fields, in sentence case, and state the two
requirements in a hint before the user hits Save.

### F8 — Empty time fields offer no affordance or format cue

Both time inputs render as blank boxes. NN/g #8: explain formatting
requirements up front. There is nothing to indicate they are time pickers or
what an entry looks like.

**Fix:** a short hint under the pair, and label them so the pair reads as one
idea ("Start" / "End", with "optional" said once for the pair).

### F9 — "Came from" misuses the form-label style

Provenance is read-only metadata, but it is rendered with `.label`, the same
class used for real field labels. It reads as a field the user could edit.

**Fix:** present it as metadata, visually distinct from labels.

### F10 — The notes textarea carries a duplicated inline style block

It re-declares border, radius, padding and font size inline instead of using
the shared input styling, so it can drift from every other field — the exact
problem the token system exists to prevent.

**Fix:** style it with the shared rule.

---

## Not defects

- **Single column overall** — already correct (NN/g #3).
- **Labels above fields** — already correct (Baymard).
- **Notes field is large** — correct: field size matching expected input
  (NN/g #6) argues *for* a tall box here.
- **Marking optional rather than required** — the right convention
  (GOV.UK); the execution is what needs work, not the choice.

## Sources

Baymard Institute, *Field Label UX: Place Labels Above the Field* ·
Nielsen Norman Group, *Website Forms Usability: Top 10 Recommendations* ·
Nielsen Norman Group, *Few Guesses, More Success: 4 Principles to Reduce
Cognitive Load in Forms* · UK Parliament Design System, *Designing forms*
(GOV.UK Design System lineage).

---

## The nav sat on top of every sheet in the app (v10.1)

**Found by `tools/browser-check.js`, by accident, while closing an unrelated
gap** — the `#linkUrl` draft box was the one input the v9.94 sweep never
exercised in a browser. Playwright refused to click the sheet's Cancel button:
*"`<svg class="ico">` from `<nav id="nav">` subtree intercepts pointer events."*

### Measured

`elementFromPoint` at each button's own centre — which is what a finger hits —
at three viewport sizes:

```
iPhone 15 Pro 393x852   Cancel  y 785-828   nav starts at 798   tap lands on: nav
small          390x664  Cancel  y 597-640   nav starts at 610   tap lands on: nav
small Android  360x640  Cancel  y 573-616   nav starts at 586   tap lands on: nav
```

And across three different sheets:

| sheet | buttons | unreachable | nav clickable through the modal |
|---|---|---|---|
| the link sheet | 2 | **1** (`Cancel`) | **yes** |
| an event's actions | 4 | **1** (`Remove event`) | **yes** |
| bulk tag / delete | 4 | **1** (`Delete N events`) | **yes** |

Two defects, and the second is the worse one:

1. **The last button of every sheet was unreachable.** In two of the three that
   button is the destructive one.
2. **The nav was still clickable through the "modal".** The tap did not do
   nothing — it switched tabs, leaving the sheet floating over a different
   screen, because a sheet is appended to `<body>` and `render()` only replaces
   `#main`.

### Cause

```css
nav      { z-index:30 }
.sheet   { z-index:20 }
.overlay { z-index:15 }
```

The nav outranked both. The overlay never dimmed it, so it did not even *look*
disabled.

### Fix

`.sheet` → 40, `.overlay` → 35. The toast stays at 99, which is right: an Undo
has to be reachable over a sheet. The composer stays at 20 — it is offset 54px
above the nav on purpose and never overlaps it.

### Why nothing caught this

- **Source reading cannot see it.** Three separate rules, in three places, and
  the bug is the relationship between them.
- **The a11y audit does not cover it.** It renders the 48 *screens*; a sheet is
  not a screen. Its tap-target check would not have found this either — the
  buttons are the right size, they are simply covered.
- **The vm test harness cannot see it.** There is no layout in a Node sandbox.

A browser check now asserts, for every sheet: no button is unreachable at its
own centre, and the nav is not tappable through the overlay. Mutation-proved by
putting the z-indexes back — two checks went red, one naming `Cancel`.

### While in there: Cancel now means cancel

`overlay.onclick` and the Cancel button were the same function, so a deliberate
"no" and a fat-fingered tap beside the sheet did the same thing. Tapping beside
the sheet still keeps the typed URL — that is the classic phone misfire, and a
long pasted URL is the last thing you want to fetch again. Cancel now discards
it. Also measured while checking: this sheet lives outside `#main`, so it
already survived a `render()` on its own — the draft mirror's only real job was
this reopen.

### And a second one, found by sweeping the same class

A sheet was `position:fixed; bottom:0` with `max-height:none` and
`overflow-y:visible`, so a long one grew **upward past the top of the screen**
with nothing to scroll. Measured with 16 people in the bulk-tag sheet
(19 buttons):

| viewport | sheet top | options lost |
|---|---|---|
| 393×852 | **y −242** | 3 |
| 360×640 | **y −454** | 7 |

Ten people already put the top edge at y 67, so this was not far off in
ordinary use, and `showSheet` is generic — eight sheets share it.

Fixed with `max-height:calc(100vh - 32px); overflow-y:auto;
overscroll-behavior:contain`. `100vh` rather than `100dvh` on purpose: the app
already relies on `100vh`, and the iOS 26 bug documented in the same file makes
the layout viewport come up **short** of the screen, which errs toward a smaller
cap and never a taller sheet.

**A mutation caught the test measuring the wrong thing.** Setting
`overflow-y:hidden` — capped, but unscrollable by a finger — left the check
GREEN, because a hidden-overflow container still reports
`scrollHeight > clientHeight` and still responds to `scrollIntoView`. Both of
those are programmatic; neither is a thumb. The check now asserts the computed
`overflow-y` is `auto` or `scroll`, and the mutation goes red.

The check also pins the other direction: a three-button sheet must **not**
become a scroller, so the fix cannot damage the common case to serve the rare
one.

### The audit gained the missing check

`tools/a11y-audit.js` measured size and horizontal position but never asked
what was ON TOP. It now runs `elementFromPoint` at each control's own centre
across all 48 screens and reports anything covering it. **No findings** — and
proved live rather than assumed: with `nav{height:320px}` injected it named five
real coverings across three screens, then went quiet when reverted.

Between the two harnesses the class is now covered: the audit walks the 48
screens, the browser check walks the sheets (which are not screens and never
were in the audit's scope).
