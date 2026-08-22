# FlyerSnap — integrating AI throughout the app

**Written:** August 22, 2026 · **Baseline:** v9.6 · **Method:** research → plan → scaffold → code

Today AI lives in exactly one place: extraction. Point it at a flyer, PDF or
email and it produces events. Everything else in the app — chores, lists,
search, the weekly view — is untouched by it.

This plan extends AI across the app **without** turning it into a chatbot
bolted onto a to-do list. What follows is grounded in published guidance from
teams who have shipped this at scale, not in intuition.

---

## 1. What the research actually says

### Microsoft — Guidelines for Human-AI Interaction (CHI 2019), 18 guidelines

The most directly applicable framework, validated across products and grouped
by *when* each applies. Verbatim:

**Initially** — G1 Make clear what the system can do · G2 Make clear how well
the system can do what it can do.

**During interaction** — G3 Time services based on context · G4 Show
contextually relevant information · G5 Match relevant social norms ·
G6 Mitigate social biases.

**When wrong** — G7 Support efficient invocation · G8 Support efficient
dismissal · G9 Support efficient correction ("make it easy to edit, refine, or
recover when the AI system is wrong") · G10 Scope services when in doubt ·
G11 Make clear why the system did what it did.

**Over time** — G12 Remember recent interactions · G13 Learn from user
behaviour · G14 Update and adapt cautiously · G15 Encourage granular feedback ·
G16 Convey the consequences of user actions · G17 Provide global controls ·
G18 Notify users about changes.

The related idea worth naming on stage is **appropriate reliance**: the goal is
to calibrate trust *accurately*, not to maximise it. An interface that makes
people trust a fallible system more than it deserves has failed, even if
engagement goes up.

### Google PAIR — People + AI Guidebook

- **Onboard in stages**, and state limits in the same breath as benefits. Their
  template: *"This is {your product}, and it'll help you by {core benefits}.
  Right now, it's not able to {primary limitations}."*
- **Introduce a feature when the user needs it**, not during setup.
- **Always provide a non-AI fallback.**
- **Don't present the AI as more human-like than it is** — that manufactures
  expectations the system cannot meet.
- On failure: weigh **situational stakes and error risk**; *"often the easiest
  path forward is to let the user take over"*; failure should be *"safe,
  boring, and a natural part of the product."*
- On feedback: distinguish **implicit** (behaviour) from **explicit** (ratings);
  make the benefit of giving feedback clear, or people won't.

### Stanford HAI — human-in-the-loop system design

- **Value human agency**; design around preference, taste and judgement.
- **Granularity matters** — avoid all-or-nothing; break a task into points
  where a human can intervene.
- **"Build tools — things we can learn to use — instead of oracles, which give
  us the right answers but withhold."** This is the single most useful
  sentence for this app.
- The fully-automated "Big Red Button" is a trap: to improve the output you
  must restart the whole thing.

### IBM — generative AI design principles

Responsible design, mental models, appropriate trust, generative variability,
co-creation, and **designing for imperfection**.

---

## 2. What that implies for FlyerSnap specifically

Five decisions fall directly out of the research. Each is a design constraint,
not a preference.

**(a) Nothing writes without review.** Extraction already works this way and it
is the app's best existing property. Every new AI surface reuses that pipeline
rather than inventing a shortcut. This is G9 + G16 + human agency at once.

**(b) Three risk classes, and the class is declared in code.** An AI feature
in this app is exactly one of:

| Class | Can it change data? | Review required | Example |
|---|---|---|---|
| `read` | No | n/a | Ask a question about your own schedule |
| `propose` | Only after the user accepts | **Yes, always** | "dentist Tuesday 3pm" → a draft event |
| `derive` | No — **no model involved at all** | n/a | Two events clash |

Making this an enum in the registry rather than a convention means a future
contributor cannot quietly add a fourth, silent-write class.

**(c) Use AI only where a model is actually the right tool.** This is the
decision most teams get wrong, and it's worth stating plainly: *detecting that
two events overlap is arithmetic.* Routing it through a language model would
add latency, cost, network dependence and non-determinism to a problem with an
exact answer. So the clash detector is `derive` — plain code, fully tested,
works offline, cannot hallucinate. **Knowing where not to put the AI is part
of integrating it well.**

**(d) Every AI surface states its limits where it is used** (G1, G2), not
buried in Settings. And each carries a one-tap dismissal (G8) and an obvious
correction path (G9).

**(e) One global off switch** (G17). If AI is off, every AI surface disappears
and every non-AI path still works — the app remains fully usable as a manual
organiser. That is the PAIR "non-AI fallback" rule taken literally.

---

## 3. The surfaces

Ordered by value ÷ risk. Phase A is this session.

### Phase A1 — the framework (`js/ai-actions.js`)

A declarative registry. Every AI capability in the app registers here with its
id, user-facing label, **what it can do**, **what it cannot do**, and its risk
class. The Settings screen and the in-context disclosures both render from this
registry, so the promise the user reads can never drift from the code — the
same discipline the CSS and icon systems already use.

### Phase A2 — clash detection (`js/conflicts.js`, class `derive`, no model)

Surfaces on the Events screen: two events overlapping in time, a deadline
falling on a day already crowded, or a deadline whose date has passed unnoticed.
Deterministic, offline, instant, testable. Demonstrates (c).

### Phase A3 — Ask (class `read`)

A question box over the user's own data: *"what does Olivia have this week?"*,
*"when is the next form due?"*. Sends only the events in scope, never the whole
database. Answers cite the events used, so the user can verify rather than
trust — G11, and the "tools not oracles" principle.

### Phase B — natural-language capture (class `propose`)

*"dentist for Braelyn next Tuesday at 3"* → a **draft** event in the existing
review screen. Same for a list (*"milk, eggs, bread"*) and a chore. Value is
highest on lists, where typing items one at a time is the current friction.

### Phase C — the week ahead (class `read`, opt-in)

A short brief of what is coming and what needs preparing. Deliberately last:
it is the surface most likely to become noise, and G3 (time services based on
context) says an untimely service is worse than none.

### Explicitly rejected

- **Auto-adding events without review.** Fails (a). The BRB trap.
- **A general chat assistant.** Fails PAIR's "don't present the AI as more
  human-like than it is", and invites questions the app cannot answer.
- **AI-written notes to children.** Family-voice content is not the app's to
  generate.
- **Learning/personalisation from behaviour (G13).** Deliberately deferred:
  G14 says adapt cautiously, and silent adaptation in an app people trust with
  their calendar is a bad trade before the basics are solid.

---

## 4. How each surface satisfies the guidelines

| Guideline | How it is met |
|---|---|
| G1 can-do | Every action declares `can` in the registry; rendered in Settings and in context |
| G2 how-well | Each action states its known limits verbatim, including that it can be wrong |
| G3 timing | Ask is user-invoked; clashes appear only when one exists; the brief is opt-in |
| G4 relevant info | Answers cite the specific events used |
| G7 invocation | One obvious entry point per surface |
| G8 dismissal | Every AI surface can be dismissed in one tap and stays dismissed |
| G9 correction | Proposals land in the existing review screen, editable field by field |
| G10 scope in doubt | Ask answers only from supplied events, and says so when it cannot |
| G11 why | Citations, plus the existing `aiSource` provenance per event |
| G16 consequences | Nothing is written until the user accepts it |
| G17 global controls | One switch disables every AI surface; the app stays fully usable |

---

## 5. Verification

- Pure logic (clash detection, scoping, prompt building) is unit-tested.
- The registry gets a test that **every action declares a risk class, a can and
  a cannot** — so a new capability cannot ship undocumented.
- A test that **no `propose` action writes directly to state**, enforcing (a).
- A test that **turning AI off leaves every non-AI path intact**.
- The extraction benchmark (`tools/eval-extraction.js`) extends to new prompts.
- On-device verification before each release, as always.

---

## 6. Method note

This plan was produced by **research first, then plan, then scaffold, then
code** — the sequence is now a standing rule in CLAUDE.md. The guidelines above
are quoted from primary sources rather than recalled, because a plan built on
half-remembered best practice is exactly the kind of guessing that has cost
this project production incidents before.

**Sources:** Microsoft HAX Toolkit, *Guidelines for Human-AI Interaction*
(CHI 2019) · Google PAIR, *People + AI Guidebook* (Mental Models; Errors +
Graceful Failure; Feedback + Controls) · Stanford HAI, *Humans in the Loop: The
Design of Interactive AI Systems* · IBM generative AI design principles.
