# Gordon can act — plan of attack (v9.14)

**Written:** August 22, 2026 · **Against build:** v9.13 · **Sequence:** Research → Plan → Scaffold → Code → Verify

Logan: *"if i have a conversation with it in the chat box, i should be able to
have it add events, chores, etc."*

---

## 1. What is actually true today

Worth stating plainly, because the problem is not the one it looks like.

**The machinery already exists and works.** `js/intents.js` declares
`add_event`, `add_chore` and `add_list_item`. `js/router.js` classifies a
sentence into one of them. `performRoute()` in index.html acts on all three:
`add_event` fills the review screen, `add_chore` pre-fills the chore form,
`add_list_item` previews and then writes on an explicit yes, with undo.

**So why does it feel like it cannot?** Four separate defects, none of which
is "the feature is missing":

| # | Defect | Where |
|---|---|---|
| A1 | The screen tells the user it cannot act | `renderAsk()` intro: *"It cannot change anything on its own."* |
| A2 | None of the three add capabilities is ever advertised | `assistantCapabilityChips()` takes `.slice(0, 4)` of registry order — which is four *questions* |
| A3 | The person is parsed and then thrown away | `add_event` sets `personIds: []`; `add_chore` sets `kidId: null` — both declare a `person` param |
| A4 | "Form due Friday" becomes an event, not a deadline | `add_event` hardcodes `kind:'event'` and has no `kind` param |

A1 and A2 are why Logan does not believe it can act. A3 and A4 are why it
would disappoint him the first time he tried.

The header still reads `// ---------- Ask (read-only ...) ----------`. That
comment was true two versions ago and has been quietly false since v9.8.

## 2. Research

### Discoverability is the whole problem (NN/g)

NN/g's chatbot research found most in-app bots "do a poor job of communicating
what they can actually help with", and that **"the burden of figuring out what
the bot can and can't do fell on the user"** — wasted time, abandoned use.
Their fix is not more capability, it is *specific* introductory prompts over
generic ones: not "How can I help you?" but a concrete offer.

Their separate study of prompt controls (suggestion chips) gives four uses,
and the first two are exactly A2: **increasing discoverability of features**
so users do not have to ask "can you…", and **educating users** — *"Visible
prompt controls can offer a glimpse into what kinds of tasks genAI can be used
for."* Best practice #2 is to name features descriptively rather than vaguely.

**Applied:** the chips must cover every consequence class the registry has —
at least one ask, one draft, one confirm — not the first four in file order.
The intro and the input placeholder must say it can act.

### Confirming an action (Apple App Intents)

Apple's `requestConfirmation(conditions:actionName:dialog:showDialogAsPrompt:content:)`:
*"Call this method when you want someone to confirm a particular choice. For
example, call this method before someone performs an action that might be
destructive or unsafe. The method displays a prompt with the provided snippet,
and asks the person to confirm or cancel."*

Two details worth copying exactly:

- **`actionName` — "The name to use in the button that confirms the action."**
  Not a generic yes. FlyerSnap currently renders `Yes, do it` for every
  CONFIRM intent. "Delete Recital" and "Add 3 items" are different promises
  and must not share a button label.
- **`content` — a snippet showing what will happen**, not just prose.

### The rest of the evidence base (already in the repo)

Carried forward from ASSISTANT-PLAN.md and unchanged: Microsoft **HAX**
G9 (efficient correction), G10 (scope services when in doubt), G16 (convey
consequences), G17 (global controls); Google **PAIR** (a non-AI path for
everything, failure "safe, boring"); **Anthropic, Building Effective Agents**
("control flow is predefined in code, not produced by the LLM") — the router
stays a router, one model call, and it never loops or calls a tool.

## 3. What is being added

Logan asked for all of it: tick things off, edit and delete, create a list.
Draft flow stays as it is — the review screen, not an in-chat save.

| Intent | Class | Notes |
|---|---|---|
| `add_event` | DRAFT | **+`kind`** (event\|deadline), **+`location`**, **+`notes`**; `person` now used |
| `add_chore` | DRAFT | `person` now used; **+`days`** for weekly |
| `add_list_item` | CONFIRM | unchanged |
| `create_list` | CONFIRM | new — "start a Costco list" |
| `check_list_item` | CONFIRM | new — tick items off |
| `complete_chore` | CONFIRM | new — with the star sheet the manual path uses |
| `mark_event_handled` | CONFIRM | new — the answer to Logan's ice-cream-signup question |
| `edit_event` | CONFIRM | new — date / time / title only |
| `delete_event` | CONFIRM **destructive** | new |
| `delete_chore` | CONFIRM **destructive** | new |

**`destructive` is a new flag on the registry, not a fifth consequence
class.** The closed set of four stays closed — that property is tested. The
flag changes two things: the confirm button is red and named for the act
("Delete Recital"), and the preview names the thing being lost.

### Non-negotiables carried into every new intent

1. **Entity resolution refuses rather than guesses.** `resolveEntity()`
   already returns `ok | none | ambiguous` and never a best guess. Every new
   intent goes through it. Two candidates means the user is asked which —
   HAX G10. Deleting the wrong event because "recital" matched two is the
   failure that must not happen.
2. **Every write is undoable**, through the app's existing `softDelete()` /
   undo-toast, so an assistant-driven delete is exactly as recoverable as a
   manual one.
3. **The assistant calls the app's own functions.** `completeChore`,
   `softDelete`, `markHandled`, `toggleItem` — not reimplemented writes. A
   second implementation is a second set of bugs, and the star sheet on an
   "anyone" chore is behaviour Gordon must not skip.
4. **Nothing new bypasses `validateRoute()`.** `quickRoute()` stays
   conservative: it short-circuits only to read-only intents, and its
   change-verb guard gains the new verbs (`tick`, `check off`, `done`,
   `finish`, `move`, `rename`, `rechedule`, `start a`).

## 4. Files

- **`js/assistant-actions.js`** — NEW, pure. Person resolution for drafts, draft
  shaping for events and chores, confirm-button action names, and chip
  selection that guarantees coverage of every consequence class. No DOM, no
  state, no clock.
- **`js/intents.js`** — the seven new intents, the `destructive` flag, and a
  registry self-check that fails if a destructive intent has no action name.
- **`js/router.js`** — `describeIntent()` cases for the new intents; the
  `quickRoute` verb guard widened.
- **`index.html`** — `performRoute()` branches, `confirmPendingAction()`
  dispatch, honest Ask-screen copy, chips, named confirm buttons.

## 5. Acceptance criteria

- "Dentist for Braelyn next Tuesday at 3" drafts an event **tagged Braelyn**.
- "Permission slip due Friday" drafts a **deadline**, not an event.
- "Olivia makes her bed every morning for a star" pre-fills the chore form
  **with Olivia selected**.
- "Add milk and eggs to the shopping list" still previews and writes on yes.
- "Start a Costco list" creates it; "delete the recital" asks which one if two
  match, and offers Undo after.
- The Ask screen's intro, placeholder and chips all say it can act.
- Every new capability has a non-AI fallback sentence in the registry.
- `node tests.js` green, with a guard per defect above, each mutation-tested.

## 5b. What changed while building it

Recorded because a plan that quietly diverges from the code is worse than no
plan.

- **The module is `js/assistant-actions.js`, not `js/actions.js`.** There is
  already a `js/ai-actions.js` (the capability-disclosure registry Settings
  renders from); two files a letter apart would have been a trap.
- **A fourth RISK class was added to `js/ai-actions.js`: `confirm`.** That
  file's whole purpose is that the promise a user reads cannot drift from what
  the code does — and it had drifted, still telling users the assistant
  "cannot ... change anything". The consequence-class set in `js/intents.js`
  is a different, still-closed set of four; this is the disclosure list, and
  widening it was the honest move rather than leaving the text wrong.
- **The confirm card is now rendered only on the newest turn.** Found in the
  browser, not by a test: an older turn keeps `confirm:true` forever, so a
  later pending action re-showed the finished action's buttons and offered to
  redo it. Guarded now.
- **`quickRoute`'s widened verb guard costs a little latency on some
  questions.** "What did Olivia do today?" contains `did`, so it now takes the
  model round-trip instead of short-circuiting. That is the correct side to
  err on — the guard exists so nothing that could write skips validation — but
  it is a real, if small, regression in answer speed for a few phrasings.

## 6. Honest caveats

- **More capability is more surface for a wrong match.** The mitigation is
  refusal-on-ambiguity plus undo, not better prompting. If this proves noisy
  in use, the right response is to narrow what the router will act on, not to
  raise the model's confidence threshold and hope.
- **Delete is soft-delete.** The row stays with `deleted:true`, which is what
  the manual path does; nothing here makes data harder to recover than it
  already is.
- **The router is still one model call.** Adding ten intents lengthens its
  prompt and makes misclassification somewhat more likely. `MIN_CONFIDENCE`
  stays at 0.6 and a rejection still turns into capability disclosure rather
  than a wrong action — the asymmetry that matters: a wrong answer wastes a
  tap, a wrong action touches Logan's data.

## Sources

Nielsen Norman Group, *What Is Your Site's AI Chatbot for? Users Can't Tell* ·
Nielsen Norman Group, *Prompt Controls in GenAI Chatbots: 4 Main Uses and Best
Practices* · Apple Developer Documentation, *AppIntent.requestConfirmation
(conditions:actionName:dialog:showDialogAsPrompt:content:)* · Microsoft,
*Guidelines for Human-AI Interaction* (CHI 2019) · Google PAIR, *People + AI
Guidebook* · Anthropic, *Building Effective Agents*.
