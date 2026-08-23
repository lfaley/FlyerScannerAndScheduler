# FLYERSNAP-FIXES-PLAN — remediating the review findings

**Written:** August 23, 2026 · **Source:** `AppReviews\REVIEW-FlyerSnap.md` (review of SHA `f60f09a`, v9.27)
**Status:** PLAN — nothing implemented until Logan approves. Then the repo's own mandated sequence applies verbatim: **Research → Plan → Scaffold → Code → Verify** (CLAUDE.md), `node tests.js` green before any deploy, and the standard one-paste PowerShell handoff (Logan pushes; agents never do).
**Architecture guardrails this plan obeys (non-negotiable, from CLAUDE.md):** the shipped `index.html` is a single self-contained build artifact — **no `import`/`export`/`<script src>`/`<link stylesheet>` may be introduced** (the v8.1–v8.5 blank-screen incident); `js/` is the source of truth and its copies are hand-inlined into `index.html` with drift-guard tests; every settings control must stay reachable (a test lists 24 that can't silently vanish); adding a Settings field touches the settings-hub tests; a new guard must be mutation-tested.

**Scope:** every FlyerSnap finding that wasn't a PASS, plus the improvements the review surfaced. Two items (FS-BE-01, FS-BE-02) are **already planned in the repo** (SECURITY-PLAN.md) or belong to the **cross-app integration phase** — this plan defers to those explicitly rather than duplicating them.

---

## 0. Research this plan stands on

- **Secrets in URLs leak** — OWASP is explicit that a token in a query string is exposed via browser history, server logs, the Referer header, and caches, *even under HTTPS*, and the mitigation is to move secrets into the request body or a custom header. This grounds FS-BE-03. **But** — the Gmail watcher reaches Apps Script by **JSONP** precisely because a browser `fetch()` to an Apps Script `/exec` URL redirects to `script.googleusercontent.com` without usable CORS headers (documented in the file itself, line 543-547). JSONP loads via a `<script>` tag, which is **GET-only and cannot set headers or a body** — so on *this* delivery mechanism the token has nowhere to live except the URL. That constraint is real and shapes the fix: the honest remedy is **rotation + treating the URL as a bearer secret**, not "move it to a header" (which isn't reachable without changing hosts). Documented so the fix isn't a fantasy.
- **Anthropic supports per-workspace spend limits, and API keys are workspace-scoped** — this upgrades SECURITY-PLAN.md's *unverified* "separate low-limit key" idea (its Open Question 2) into a **confirmed, buildable control**: create a dedicated low-cap Workspace, generate a key scoped to it, and that's the key that lives on the phone. A stolen phone then caps at that workspace's monthly limit, revocable without touching anything else. This is the cheapest real risk-reduction available today and is independent of the (larger) proxy work.
- **First-run/empty-state onboarding** — NN/g's guidance on empty states is that the first-use empty state should teach the primary action and remove friction to it; the app already does this beautifully everywhere **except** the hidden API-key prerequisite (FS-UI-05). The fix applies the app's own existing pattern (`emptyState`, amber "wants attention" rows) to that one gap.
- **Secure deletion of a stored secret** — removing a key means deleting `S.settings.apiKey` from the persisted blob, not just clearing the input; grounds FS-UI-02.

Repo facts verified on disk today (exact sites for the code steps): the key UI lives in `renderSetAI` at `index.html:7975-7985` (the "Anthropic API key" `.sect`, help text, and `saveKey()` button); the opt-out flag is read at `index.html:5907` and `:5924` with no UI; the Trouble screen is `renderSetTrouble` (`index.html:4686`, `diagnosticsSection` at `:7651`); the direct Anthropic call is `index.html:4182-4184`.

---

## 1. Order of attack, and why

```
Phase 1  Anthropic low-cap workspace key        ← biggest risk-per-effort; pure ops, zero code, do first
Phase 2  Key management + AI-key onboarding      ← FS-UI-02 (remove key) + FS-UI-05 (first-run nudge)
Phase 3  Error-reporting opt-out UI              ← FS-UI-03
Phase 4  Gmail-watcher token hardening (docs+rotate) ← FS-BE-03, within the JSONP constraint
Phase 5  Small UI polish                          ← FS-UI-01 toast (SHIPPED v9.28)
Deferred/handed-off: FS-BE-01 (SECURITY-PLAN P1), FS-BE-02 (integration phase), FS-BE-04/FS-BE-05 (accepted)
```

**AMENDED 2026-08-23, after verification.** FS-UI-04 was not polish and its
decision gate is closed — see §2a, which now runs BEFORE Phase 2. FS-UI-01 was
measured, fixed and shipped in v9.28 along with it.

Phase 1 first because it's the only item that meaningfully shrinks the standing key-exposure risk (FS-BE-01) **today**, costs nothing to build, and needs no code review — it's account configuration. Everything else is independent and reorderable.

---

## 2a. Phase 0 — Manual event entry (FS-UI-04) — **DECIDED AND SHIPPED (v9.28)**

The plan deferred this pending "verify manual-create exists." It was verified on
disk at `f60f09a`, and the answer was that it did not exist **at all**:

- `S.events.push` occurred at **exactly one site** — `index.html:6996`, inside
  the save flow for AI-extracted `pendingEvents`. Every event in the app came
  from the model.
- `openEventEdit(id)` does `S.events.find(x=>x.id===id)` and then dereferences
  `e.title`; its single caller is an "Edit event" action on an existing row
  (`:6686`). The form could only ever **edit**.
- Chores have `saveChoreForm()` (`:7272`) and lists have their own add box
  (`:7426`). **Events were the only one of the three with no hand-entry path.**

**And it compounds with FS-UI-05, which is why it moved to the front.** A fresh
install defaults to `aiProvider:'anthropic'` with an empty `localBaseUrl`
(`:711`), so with no API key a new user could not create an event by scanning
(needs AI), by asking Gordon (`add_event` routes through the model), or by
typing (no form). **The app's primary object was unreachable.** That makes the
Phase 2 onboarding nudge load-bearing rather than helpful — a nudge is a poor
substitute for a path that works.

Logan's decision, 23 Aug: **build it.** Shipped in v9.28:

- `openNewEvent()` — a blank form, date defaulting to today, reusing the
  existing edit screen and its validator unchanged.
- `isNew` is its **own** flag, not a third value for `saved` — `saved` is a
  boolean the save and cancel handlers branch on, and a string would be truthy
  in `if(f.saved)`, sending a new event into `S.events.find(x=>x.id===null)`.
  The create branch is tested **before** the saved branch, with a test pinning
  that order.
- The saved record carries the same shape the review flow writes, so reminders,
  conflict detection, calendar export and duplicate matching treat it
  identically. `source:'Typed in'`, `aiSource:null`.
- Two entry points, both existing patterns: a **"Type it in myself"** row at the
  end of Add Paperwork, and the Events empty state's `cta` slot, which was
  unused. With no key, that button is the only action on the screen that works.
- Seven tests, mutation-tested (disabling the create branch kills three), and
  `eventEdit-new` added to the a11y audit table — **37 screens, no problems**.

**Phase 2's nudge is still worth building**, but it is now a signpost to a
faster path rather than the only way out of a dead end.

---

## 2. Phase 1 — Put a low-cap Anthropic workspace key on the phone (addresses FS-BE-01 interim, sev 3 → reduced)

No code. This is the confirmed version of SECURITY-PLAN.md's separate-key idea. Logan-driven, ~10 minutes:

1. Open the Anthropic Console workspaces page: `https://console.anthropic.com/settings/workspaces`
2. **Create workspace** (top-right) → name it e.g. `flyersnap-phone`. ✅ It appears in the workspace list.
3. Open the new workspace → **Spend limits** tab → set a low **monthly** cap (e.g. \$10–20 — enough for a family's flyer reads, small enough that a lost phone can't run up a bill). Optionally set an alert threshold. ✅ The cap shows on the workspace.
4. Still in that workspace → **API keys** → **Create key** → name it `flyersnap-phone-key`, copy it once. ✅ Key created, scoped to this workspace only (it cannot spend against any other workspace).
5. In FlyerSnap → Settings → **Gordon and AI** → paste this key over the existing one → Save. ✅ "A key is saved on this device."
6. Delete/retire whatever broader key was on the phone before, from the Console.

**Acceptance:** flyer scanning still works; the key on the phone can only ever spend up to the workspace cap; a lost phone is a capped, independently-revocable loss. **Honest caveat (unchanged from the review):** the key is still *on the phone* — this caps the blast radius, it does not remove the exposure. The full fix remains SECURITY-PLAN.md P1 (proxy), which is larger and deferred to its own effort.

---

## 3. Phase 2 — Key management + AI-key onboarding (FS-UI-02 sev 2, FS-UI-05 sev 2)

Both live in `renderSetAI` (`index.html:7974`). Small, contained, no new files.

### 3.1 Remove-key control (FS-UI-02)

- In the "Anthropic API key" block, when `S.settings.apiKey` is set, render a second button beside Save: **Remove key** (use the existing `.btn` styling; give it the destructive treatment the app already uses for deletes — an undo toast via `softDelete`-style confirm, or a simple confirm since a key isn't recoverable by undo).
- Wire it to a new `removeKey()` handler (add near `saveKey()`): sets `S.settings.apiKey = ''`, `save()`, re-renders the section, and `toast('API key removed')`. Deleting the value from the persisted blob is the actual security action — clearing the input alone wouldn't do it.
- Because AI features already degrade gracefully with no key (verified: `index.html:4170` guards `if(!S.settings.apiKey)`), nothing else needs touching.

### 3.2 First-run key onboarding (FS-UI-05)

The gap: a brand-new user taps Add paperwork, but extraction needs a key that isn't set, and nothing points them there. Apply the app's own patterns, not a new mechanism:

- **On the Add-paperwork screen, when `!S.settings.apiKey` and provider is Anthropic**, show a one-time inline notice using the existing `emptyState`/help styling: *"To read flyers, Gordon needs an AI key — about 2 minutes to set up."* with a button that `nav()`s to Settings → Gordon and AI. Keep it dismissible; don't block the manual paths.
- The **Gordon and AI hub row already turns amber** when a key is missing (`index.html:7917`, `aiEnabled() && aiProvider()==='anthropic' && !S.settings.apiKey ? 'amber-accent'`) — so the Settings signpost exists; this finding is only about surfacing it from where the user actually hits the wall (Events/Add-paperwork).
- Keep the existing help text at the key field (it already names console.anthropic.com) — and update it to mention the **low-cap workspace** approach from Phase 1 as the recommended setup, so the security posture is the *default* a new user lands on.

**Acceptance:** with no key, Add-paperwork shows the nudge and one tap reaches the key field; with a key set, the nudge is gone and Remove key works and actually clears the stored value (verify the blob no longer contains it). `node tests.js` green (watch the settings-hub reachability test — the key controls stay in `setAI`, so no hub field is added).

**AMENDED — register the new control.** The plan's reasoning about the hub tests
is right: `mustSurvive` is an allowlist and "the hub is a menu" only forbids
`<input>` in `renderSettings`, so adding to a spoke keeps both green. But that
also means **`removeKey()` gets no protection from the one test that exists to
stop controls vanishing in a reorganisation.** Add `'removeKey()'` to the
`mustSurvive` array in `tests-modules.js` (24 entries today), and mutation-test
that registration per CLAUDE.md rule 21 — delete the button, confirm the test
fails.

---

## 4. Phase 3 — Error-reporting opt-out UI (FS-UI-03, sev 1)

The flag `S.settings.errorReportsOff` is honored in code (`index.html:5907`, `:5924`) but has no control. Add one to **When something goes wrong** (`renderSetTrouble`):

- A labeled toggle: *"Send anonymized error reports"* (on by default, i.e. checked = `!errorReportsOff`), with one line of help stating exactly what leaves the device — matching the review's and the repo's own framing: *"Diagnostics only — model names, versions and error types. Never your events, notes, email contents, or API key."* (That claim is true and verified in `js/errorReport.js`; keep the wording honest.)
- `onchange` sets `S.settings.errorReportsOff = !this.checked; save()`.
- **CLAUDE.md flags this touches the settings-hub tests** — expected and known-scope: the Trouble screen already hosts controls, so add the toggle there and update the reachability list if required. Mutation-nothing (no new guard), but re-run the hub tests.

**Acceptance:** toggling off stops the queue (confirm no new `errorReports` POST fires — the two guard sites already short-circuit on the flag); toggling on resumes it; `node tests.js` green including the settings-hub suite.

**AMENDED — two corrections.**
1. **Register the toggle in `mustSurvive`** for the same reason as §3.1. The
   plan says "Mutation-nothing (no new guard)" — true as written, but the
   `mustSurvive` entry IS a new guard and must be mutation-tested.
2. **The help-text wording is a standard, not a preference.** "Never your
   events, notes, email contents, or API key" is true *as of v9.27*, and only
   because of the ruling in `ERROR-LOGGING-RULINGS-REPLY.md`: every field of an
   automatic report is diagnostics-only. Cite that document beside the string so
   nobody softens it later without knowing what it is.

---

## 5. Phase 4 — Gmail-watcher token hardening (FS-BE-03, sev 2)

Grounded honestly in the JSONP constraint (§0): the token can't leave the URL without changing the delivery mechanism, so the fix is **operational + a small privilege split**, not "move it to a header."

1. **Document it as a bearer secret** (DEPLOY.md / GMAIL-WATCHER-SETUP.md): the web-app URL **and** its `token` together are a credential; anyone with both can read the watched senders' matching emails. If the phone is lost, **rotate**: change `SECRET` in the Apps Script's Script Properties, redeploy the web app if needed, and re-save the new URL+token in FlyerSnap. Write the exact click-path (script.google.com → Project Settings → Script Properties → edit `SECRET`).
2. **Split the mutating action from the read token (optional, Logan's call).** `action=setsenders` rewrites which senders are watched using the *same* read token (`gmail-watcher.gs:569`). Consider a separate `WRITE_SECRET` required only for `setsenders`, so a leaked read token can't repoint the watcher. Small change, isolated to `doGet`; add a matching field in FlyerSnap's Reminders settings if adopted.
3. **Confirm the good guards stay** (no change, just re-verified in review): the `callback` JSONP param is regex-validated before reflection (line 549 — this is the important XSS guard and it's correct); sender list is capped/de-duped; cost guards are thorough.

**Note:** any change to `gmail-watcher.gs` must be **re-pasted at script.google.com** (Deploy → Manage deployments → new version) — it does not ship with the app. Call this out explicitly in the handoff, per CLAUDE.md rule 18.

**Acceptance:** setup docs state the rotation procedure; if the privilege split is adopted, a read token alone can no longer call `setsenders` (test by hand against the deployment).

---

## 6. Phase 5 — Small UI polish (FS-UI-01 sev 1, FS-UI-04 sev 2)

- **FS-UI-01 — toast/FAB overlap. MEASURED AND SHIPPED (v9.28).** Not a
  near-miss and not specific to theme changes: `.fab` is
  `bottom:calc(76px + safe-area)` and `.toast` was `calc(80px + safe-area)`,
  both `left:50%` with `translateX(-50%)`, at z-index **9 and 99**. Measured in
  a 390×844 browser: FAB at y 720–768, toast at 719–764, **65% of the FAB
  covered** — on every screen with a FAB, for every toast. Suppressing the
  theme toast would have hidden one symptom of a general collision. Fixed by
  moving the toast to **`calc(136px + env(safe-area-inset-bottom))`** = the
  FAB's 76px offset + its 48px height + a 12px gap. Re-measured: **0px overlap,
  12px gap.** A test now asserts `toast.bottom >= fab.bottom + 48`, and reverting
  the offset kills it.
- ~~**FS-UI-04 — manual event entry (needs a decision first).**~~ **Resolved —
  moved to §2a and shipped.** Kept below as written, for the record.

  ~~**FS-UI-04 — manual event entry (needs a decision first).**~~ The review couldn't reach a plain "new event" form from Events with no data. **Before any code:** confirm whether manual entry exists (grep for an event-edit entry point; `renderEventEdit` exists per CLAUDE.md, so the *form* does — the question is whether there's a discoverable **create** affordance vs. only edit-existing). If it exists → surface it (an "Add manually" secondary action on the Events empty state / Add-paperwork). If it doesn't → that's a genuine feature gap and a **Logan decision**, not an automatic fix (CLAUDE.md rule 1: never add/remove a feature without asking). This plan flags it; it does not presume the answer.

**Acceptance:** preview screenshots show no toast/FAB collision; the manual-entry question is answered with evidence before any UI is added.

---

## 7. Deferred / accepted / handed off — with reasons

| Item | Disposition | Reason |
|---|---|---|
| **FS-BE-01** (key sent from browser) — full fix | **Deferred to SECURITY-PLAN.md P1** | The AI-proxy work is already researched and planned in-repo; it's a larger effort with its own new attack surface (the proxy) needing its own review. Phase 1 here does the cheap interim mitigation (capped workspace key) that plan also recommends. |
| **FS-BE-02** (shared-origin localStorage across all three apps) | **Handed to the integration review (Phase 4 of the programme)** | It's a *cross-app* property — the fix/audit is "do the other two apps respect FlyerSnap's key prefixes and never call `localStorage.clear()`?", which can only be judged with all three in view. FlyerSnap already namespaces correctly and documents the hazard. |
| **FS-BE-04** (no minification / unused JS) | **Accepted** | Deliberate no-build single-file architecture; minification reintroduces the build step that caused the blank-screen incident. Service-worker cache-first already makes payload a one-time cost. |
| **FS-BE-05** (privacy guard keyed on string prefix) | **Accepted as a process guard** | Correctly implemented today with a pinning test; the residual is that a *future* new content source must update `isThirdPartyContent`. Added to the integration review's checklist so any new `logProblem('<prefix>:',detail)` site updates it in the same PR. |

---

## 8. Holes in this plan, poked and answered

- **"Phase 1 doesn't fix FS-BE-01."** Correct, and said so twice: it caps the blast radius; the elimination is SECURITY-PLAN P1. The value is that it's buildable *today* with zero code and confirmed console support, versus the proxy which is a project.
- **"Just move the Gmail token to a header."** Can't, without abandoning JSONP — and JSONP exists because Apps Script gives browsers no usable CORS. Pretending otherwise would be the kind of unverified assumption CLAUDE.md's rule 2 exists to prevent. The plan does what the constraint allows (rotate, split privileges) and says why it can't do more.
- **"Adding Settings controls could slide the hub back into a long scroll."** The key controls stay inside `setAI`, the toggle inside `setTrouble` — both spokes, not the hub; the hub-field test stays green by construction. Called out because the repo has a test specifically guarding this.
- **"The onboarding nudge could annoy returning users."** It's gated on `!S.settings.apiKey`, so it vanishes the moment a key is set and never shows again.
- **"FS-UI-04 might be inventing a feature gap."** Which is why it's the one item with a **decision gate before code** — verify manual-create exists before either surfacing it or asking Logan to scope a new one.

## 9. Estimates & sequencing

Phase 1: 10 min ops, Logan-driven — **S**. Phase 2: one session (two related changes in one file + handlers) — **M**. Phase 3: one small change + hub-test check — **S**. Phase 4: docs + optional small `doGet` change (+ re-paste at script.google.com) — **S–M**. Phase 5: toast fix **S**; manual-entry gated on a decision. Every code phase ends with `node tests.js`, then `node tools/preview.js` for anything visual, then the one-paste PowerShell block (`cd` → `node tests.js` → `git add -A` → commit → push), with the version stamp + `sw.js` CACHE bump the deploy guard requires, and an explicit "gmail-watcher.gs changed — re-paste it" note whenever Phase 4 ships.

## 10. Sources

- OWASP — [Information exposure through query strings in URL](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url) (grounds FS-BE-03; secrets in URLs leak via history/logs/Referer even under HTTPS)
- Anthropic — [Workspaces (per-workspace spend limits; keys scoped to a workspace)](https://platform.claude.com/docs/en/manage-claude/workspaces) (grounds Phase 1; confirms SECURITY-PLAN's open question)
- Nielsen Norman Group — empty-state/first-use onboarding guidance (grounds FS-UI-05)
- Repo evidence (on-disk, SHA f60f09a): `js/errorReport.js` (`isThirdPartyContent`, redaction); `gmail-watcher.gs:543-549,569` (JSONP/CORS constraint, callback validation, setsenders); `index.html:4182` (direct call), `:7974-7984` (key UI), `:5907/:5924` (opt-out flag), `:7917` (amber hub row); `CLAUDE.md` (no-build architecture, settings-hub tests, deploy rules); `SECURITY-PLAN.md` (P1 proxy plan, low-limit-key open question)
