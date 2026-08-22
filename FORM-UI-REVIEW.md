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
