# FlyerSnap — turning the app into a real personal assistant

**Written:** August 22, 2026 · **Baseline:** v9.7 · **Method:** research → plan → scaffold → code → verify

The brief: make AI a genuine assistant *throughout* the app, not a Q&A box on
one screen. What follows is built from what the platform teams actually ship
and publish, and every load-bearing claim is quoted from a source.

---

## 1. The research, and the single insight that reframes the problem

### Apple App Intents / Google App Actions — how "assistant in your app" is really done

This is the most directly relevant prior art, and the finding is counter to
the obvious approach: **the platform leaders do not put a chatbot in the app.**
They make the app's capabilities *declarable*, and let the assistant invoke
them. The architecture is consistent:

- **Intents** — one per action. An intent "declares a localized title and a
  `perform()` method that executes the action and returns a result or an
  error." The design rule is explicit: **"One intent per action, variants via
  parameters."** Not one intent per phrasing.
- **Entities** — "a lightweight representation of your data objects with a
  unique ID, the relevant properties and a description." Crucially, Apple
  **"explicitly recommends exposing only the data types users see and touch,
  not your entire data model."**
- **Queries / resolution** — how the system turns "the Costco list" into a
  specific entity, with disambiguation when more than one matches.
- **Snippets** — results come back as *views*, so the assistant can "present
  results or follow-up questions visually" rather than only in prose.

### Anthropic — *Building Effective Agents*

The boundary that matters: **"control flow is predefined in code, not produced
by the LLM"** separates a *workflow* from an *agent*. And the tradeoff is
stated plainly: *"Workflows have high predictability and lower cost per
invocation; agents have lower predictability and higher cost due to compounding
error rates per extra LLM call."*

When **not** to reach for an agent, which applies squarely here:
- the task is **high-frequency, low-complexity** — deterministic code wins;
- there is **no reliable evaluation criterion**;
- the **output is not verifiable**.

The **routing** pattern — *classify the input, dispatch to a specialised
handler* — is exactly the shape an in-app assistant needs. Tool guidance:
*"tailoring each capability behind a well-documented interface."*

### Nielsen Norman Group, and the case against chat-first

The usability evidence is blunt. A conversational interface means **"the
burden of discovering an app's capabilities is placed upon the user."** It
trades **recognition for recall** — a GUI shows you the options, a chat box
demands you already know them. NN/g's studies find intelligent assistants work
for *"very limited, simple queries"* with *"simple, short answers"*, and that
users *"will always have unrealistic expectations about a system's
capabilities."* The recommendation is not to abandon conversation but to build
**GUI-first with strategic conversational elements** — chat where dialogue
genuinely adds value, buttons and cards everywhere else.

### Microsoft HAX (18 guidelines) and Google PAIR — already applied in v9.7

G1/G2 capability disclosure · G7 efficient invocation · G8 dismissal ·
G9 correction · G10 scope when in doubt · G11 make clear why · G12 remember
recent interactions · G16 convey consequences · G17 global controls.
PAIR: onboard in stages, always keep a non-AI fallback, make failure *"safe,
boring, and a natural part of the product."*

### Trust research

Label machine-generated output, cite sources, and say so when you do not know
rather than hallucinating. ~70% of consumers are wary of giving personal
information without clear communication about its use.

---

## 2. The design that falls out of the research

> **The assistant is not a chatbot with access to the app. It is a router in
> front of a registry of the app's own capabilities.**

Five decisions, each traceable to a source above.

**(a) Capabilities are declared as typed INTENTS, not improvised.**
Apple's model. One intent per action, variants via parameters. The registry is
the single source of truth for what the assistant can do — the same discipline
`js/ai-actions.js` already applies to disclosure, extended to execution.

**(b) The model's ONLY job is routing and parameter extraction.**
Anthropic's boundary: control flow stays in code. The model never decides
*what happens next*; it classifies an utterance into `{intent, parameters}`
and stops. Everything after that — validation, resolution, confirmation,
execution — is ordinary tested code. This is the **routing workflow**, not an
agent, chosen deliberately because the task is high-frequency, low-complexity,
and the output must be verifiable.

**(c) Every intent declares its own consequence class**, and the registry
enforces it:

| Class | Meaning | What happens |
|---|---|---|
| `answer` | Reads and replies | Runs immediately, answer cites its sources |
| `navigate` | Moves the user somewhere | Runs immediately, trivially reversible |
| `draft` | Produces something to save | **Always** lands in the existing review UI |
| `confirm` | Changes data directly | **Always** a preview + explicit Yes first |

There is no class that mutates data silently. HAX G16, and Apple's
confirmation semantics.

**(d) GUI-first, conversation second.** NN/g's finding is designed around
rather than ignored: the assistant screen leads with **visible capability
chips** generated from the registry, so the user recognises what is possible
instead of having to recall it. Free text is available but never the only way
in. Results render as the app's real cards — Apple's snippets — not prose.

**(e) Ambiguity is resolved by asking, never by guessing.** If "add milk to
the list" matches two lists, the assistant shows both and asks. Apple's
disambiguation; HAX G10 "scope services when in doubt"; and it is the direct
antidote to the failure mode this app most fears.

### Deliberately rejected

- **An autonomous agent loop.** Anthropic's own criteria rule it out: this is
  high-frequency, low-complexity work with verifiable output, and compounding
  per-call error is a real cost against zero benefit.
- **Free-form chat as the primary surface.** NN/g's discoverability evidence.
- **Exposing the whole data model.** Apple's explicit recommendation; only the
  entities a user already sees — events, chores, lists, people.
- **Silent writes, learning, or personalisation.** HAX G14, adapt cautiously.

---

## 3. The intent catalogue (v1)

| Intent | Class | Parameters | Notes |
|---|---|---|---|
| `ask_schedule` | answer | question, timeframe? | Existing scoped+cited Ask |
| `ask_chores` | answer | question, person? | |
| `ask_lists` | answer | question, list? | |
| `add_list_item` | confirm | list, items[] | Resolve list by name; disambiguate |
| `add_event` | draft | title, date, time?, person? | Lands in the review screen |
| `add_chore` | draft | title, person?, frequency?, stars? | |
| `find_events` | answer | query, person?, timeframe? | Returns real cards |
| `open_screen` | navigate | screen | "take me to the shopping list" |
| `what_needs_doing` | answer | timeframe? | Combines clashes + deadlines, no model |

Anything the router cannot map lands on `unknown`, which says plainly what the
assistant *can* do — turning a failure into capability disclosure (G1, and
PAIR's "safe, boring" failure).

---

## 4. Architecture

```
utterance
   │
   ▼
routeUtterance()          ← ONE model call. Returns {intent, params, confidence}
   │                         Nothing else. No tools, no loop.
   ▼
validateRoute()           ← pure code: is this a real intent? are the params
   │                         the right shape? is confidence high enough?
   ▼
resolveEntities()         ← pure code: "costco" → the Costco list.
   │                         0 matches → say so. 2+ → ask which.
   ▼
consequence class
   ├── answer   → run, render cards + citations
   ├── navigate → sub()/nav()
   ├── draft    → existing review screen
   └── confirm  → preview + Yes/No, then act
```

Files:
- `js/intents.js` — the registry: intents, parameter schemas, consequence
  classes, entity resolution. Pure.
- `js/router.js` — the routing contract (the prompt), plus `parseRoute` and
  `validateRoute`, both pure and both hostile to malformed model output.
- Wiring in `index.html` — the assistant screen and the execute step.

---

## 5. Test plan (this is not optional)

The router is the risky part, so it is tested like one.

**Registry** — every intent declares a class, params and a fallback; no
intent has a class outside the four; every `confirm`/`draft` intent has a
handler that does not write directly.

**Parsing (hostile inputs)** — prose around the JSON, markdown fences,
`<think>` blocks, truncated JSON, an array instead of an object, a null,
an unknown intent name, a known intent with missing/extra/wrong-typed params,
and a prompt-injection attempt inside a list item name.

**Validation** — unknown intent rejected; wrong param type rejected; low
confidence downgraded to `unknown` rather than executed; a `confirm` intent
can never be marked auto-executable.

**Resolution** — exact match; case-insensitive; 0 matches asks; 2+ matches
disambiguates rather than picking; a deleted entity is never resolved.

**Consequence safety** — the property that matters most: **for every intent
in the registry, executing it with AI enabled must not mutate state unless
the user confirmed.** Written as a loop over the whole registry so a new
intent is covered the day it is added.

**Fallback** — with AI off, every intent's manual path still exists.

---

## 6. Sources

Apple, *Bring your app's core features to users with App Intents* (WWDC24) and
App Intents documentation · Anthropic, *Building Effective Agents* (workflow vs
agent, routing, when not to use an agent) · Nielsen Norman Group usability
studies on intelligent assistants, via *Why Conversational Interfaces are
taking us back to the Dark Ages of Usability* · Microsoft HAX Toolkit,
*Guidelines for Human-AI Interaction* · Google PAIR, *People + AI Guidebook* ·
trust-and-transparency findings on labelling and sourcing AI output.
