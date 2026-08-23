# FlyerSnap — a walkthrough for whoever builds the admin console

**Written:** August 22, 2026 · **Against build:** v9.18 · **Revised:** v9.27 · **Purpose:** so the
admin console can be designed against what FlyerSnap actually does, not against
an assumption about it.

Every claim here is cited to a file and line in this repo. Nothing about the
recipe app is asserted — that repository is not connected to this session.

---

## 1. What this app is, in one paragraph

A family-paperwork organiser: photograph a school flyer, forward an email, or
paste a link, and it extracts the dates, deadlines and details, then hands you
calendar reminders. It also does chores with stars, shared lists, and the
week's meal plan. It ships as **one self-contained `index.html`** deployed to
GitHub Pages at `https://lfaley.github.io/FlyerScannerAndScheduler/`, installed
to an iPhone home screen as a PWA.

**There is no FlyerSnap server.** None. That single fact drives most of what
follows.

## 2. Where the data lives

All of it is in the browser's `localStorage`, on the one device. Four keys:

| Key | What |
|---|---|
| `flyersnap` | the entire app state (below) |
| `flyersnap-lastsnapshot` | rolling backup copies, one a day |
| `flyersnap-quarantine` | a save file that failed to parse, kept rather than discarded |
| `mealplan-out` | **read-only**, written by the recipe app (`index.html:6494`) |

The state shape (`index.html`, `blank()`), `SCHEMA_VERSION = 4`:

```
{ events[], kids[], chores[], completions[], rewards[], redemptions[],
  lists[], listItems[], problems[], aiLog[], ask:{turns[]},
  settings:{ apiKey, alerts, watcherUrl, watcherToken, seenMsgs, starCarry,
             senderTags, aiProvider, localBaseUrl, localModel, aiFallback,
             aiEnabled, dismissedConflicts, theme },
  schemaVersion }
```

Deletes are **soft** (`deleted:true`), so nothing is truly gone until pruning.

**Implication for the console:** there is currently nothing server-side to
administer. An admin console has to either (a) manage things *outside* the app
— allowlists, proxy access, keys — or (b) wait until sync exists and administer
that. It cannot reach into a phone's localStorage.

## 3. Everything that leaves the device

Exactly three outbound destinations, plus one that deserves its own note.

| # | Destination | Where | Carries |
|---|---|---|---|
| 1 | `https://api.anthropic.com/v1/messages` | `index.html:3029, 3460` | flyer text/images, event context, **and the API key** |
| 2 | `<localBaseUrl>/chat/completions` | `index.html:3403` | the same content, to the self-hosted model |
| 3 | `<localBaseUrl>/models` | `index.html:7162` | nothing; a capability check |
| 4 | `<localBaseUrl>/../api/ps` | v9.25, `probeLocalContext()` | nothing; asks the local server how big a context window it allocated. Best-effort — any failure reads as "unknown" and changes nothing |
| 5 | `firestore.googleapis.com/v1/projects/meal-planner-f7f2f/.../errorReports` | v9.24, `flushErrorReports()` | one problem-log entry per NEW problem: `where`/`message`/`detail` through `redact()`, app version, URL, user agent. **No SDK, nothing at boot**, localStorage outbox, offline-safe |

**Plus the Gmail watcher, which is JSONP, not `fetch`** (`index.html:4949-4955`).
It injects a `<script>` pointing at the Apps Script URL with the token in the
query string. JSONP means the response is **executed as JavaScript**. That is
worth the console's attention: whoever controls that endpoint controls the page.

## 4. The credentials that exist today, and where they sit

| Credential | Lives | Exposure |
|---|---|---|
| Anthropic API key | `S.settings.apiKey`, localStorage | **Sent from the browser** with `anthropic-dangerous-direct-browser-access: true` (`index.html:3453-3455`). Readable by anyone with the unlocked phone. |
| Local model base URL | `S.settings.localBaseUrl` | Network topology hint; also in the diagnostics export unless suppressed |
| Watcher token | `S.settings.watcherToken` | Sent in a JSONP query string |
| Local model auth | hardcoded `Bearer local` (`index.html:7162`) | Not a secret; the proxy currently does not verify callers |

**This is the list an admin console exists to shrink.** The first row is the
one that matters.

## 5. The AI surface an admin console would gate

Two things happen through a model, and they are not equally risky.

**Extraction** — reading a flyer, email or PDF into draft events. Always
reviewed by a human before anything is saved.

**The assistant ("Gordon")** — a chat box. Since v9.14 it has **sixteen
intents, ten of which change data** (`js/intents.js`). The safety design is
worth the console understanding, because a console that gates the wrong layer
adds friction without adding safety:

- `performRoute()` **never writes**. It resolves and proposes.
- `confirmPendingAction()` is the **only** path in the app that turns a
  sentence into a change, and it needs an explicit yes.
- Every write is undoable.
- Entity resolution **refuses on ambiguity** rather than guessing.
- Two intents are flagged `destructive` and get a red, named confirm button.

Each of those is enforced by a test. **So the safety boundary is already
inside the app.** An admin console's job is not to re-litigate it — it is to
control *who may spend tokens* and *whose key is spent*.

## 6. What the app already observes — and the two files it exports

This is the part the console can consume today, unchanged.

### 6.1 The AI call log (`js/ailog.js`)

Every model call is recorded, rolling 200 entries, both providers, success and
failure. Field names follow the **OpenTelemetry GenAI semantic conventions**:

```
at, op, provider, reqModel, resModel, ms, ok,
inTokens, outTokens, finish, status, errorType, detail, fellBackTo
```

`errorType` is a closed set: `auth`, `rate_limit`, `provider_error`, `timeout`,
`network`, `no_api_key`, `bad_response`, `unsupported_input`,
`request_rejected`, `unknown`.

`op` names the task — `extract.image`, `ask.route`, `ask.answer`,
`email.attachment`, `compare.local`, `bench.route`, and so on.

**Prompt text, answer text and the API key are NEVER logged.** The conventions
exclude prompt bodies because they "routinely contain names, emails, account
numbers" — and here the prompts *are* children's names, schools and schedules.
`redact()` scrubs error strings. **If the admin console ever wants prompt
content, that is a new decision, not an extension of this one.**

### 6.1b The shared `errorReports` collection — THIS REPO IS NOT THE AUTHORITY

FlyerSnap is one of three writers to `errorReports` in the recipe app's project
`meal-planner-f7f2f`. The console reads it; FlyerSnap only creates.

- **Contract:** `ERROR-LOGGING-STANDARD.md` in the AdminConsole repo.
- **Rules:** in the RECIPE APP's repo — anyone may CREATE a shape-valid report
  (**≤24 keys, message ≤4000**), only the admin may read or manage. Read from
  `firestore.rules` and confirmed 23 Aug: `isValidErrorReport` requires
  reportId/type/message strings and `data.keys().size() <= 24`; anonymous
  `create` only; admin-only read/list/update/delete; deny-by-default elsewhere.
- **What FlyerSnap actually sends:** 13 keys at most — `reportId`, `createdAt`,
  `type`, `message`, `app`, `appVersion`, `severity`, `fingerprint`,
  `standalone`, `url`, `userAgent`, plus `description` when a detail exists and
  `occurrenceCount` when the count exceeds 1. Both caps have wide margin;
  `redact()` holds `message` to 400 characters.
- **`description` is withheld for email problems** (v9.27, ruling 2026-08-23).
  An automatic report is diagnostics-only, so a problem whose `where` starts
  `Email:` sends no `description` at all. The console should expect that field
  to be absent, not empty. The subject line stays in the phone's Problem Log and
  in the diagnostics file, both of which Logan shares deliberately.
- **`occurrenceCount` never arrives in practice** — reports are queued only for
  a NEW problem, when the count is 1. A console that groups by it will see
  every report as a single occurrence. Group by `fingerprint` instead.
- **`reportId` is deterministic per problem**, so a redelivery 409s and dedups
  server-side. The console should expect 409 to mean "already have it", not an
  error.
- **A shape change made in this repo alone fails as a 403 on a phone**, and the
  outbox treats 403 as permanent and drops the report. Additive only,
  coordinated through the standard.

### 6.2 `flyersnap-diagnostics-<date>.json`

Exported from Settings → *When something goes wrong*. Contains:

```
kind: 'flyersnap-diagnostics', version, generatedAt,
app:{ version, provider, model, hasApiKey, aiEnabled, localBaseUrl?,
      localContext,                     // v9.25: the local window, or null
      userAgent },
counts:{ events, chores, lists },      // counts, never contents
aiSummary:{ calls, ok, failed, failureRate, medianMs, slowestMs,
            byErrorType, fellBack, inTokens, outTokens },
aiLog:[ …the entries above… ],
problems:[ { where, message, detail, first, last, count, resolved } ]
```

**No events, chores, lists, notes, or API key.** `hasApiKey` says *whether*,
never *what*. Read on a desktop with `node tools/diagnostics.js <file>`.

**v9.25 additions to be aware of when parsing this file.** `app.localContext`
is the context window the local server reported, or `null` — and `null` covers
both "not a local setup" and "asked and could not find out", which are
different problems. Local entries in `aiLog` now carry `inTokens` / `outTokens`
/ `finish` like the Anthropic ones (they never did before), and `errorType` has
two new values: `thinking_only` and `context_too_small`. A console that
switches on `errorType` should treat unknown values as `unknown` rather than
failing.

**Shared as `.txt` / `text/plain`, not `.json`** (v9.24). The contents are
byte-identical JSON; iOS filters the share sheet by file type and many mail
apps do not declare `application/json`. Parse by content, never by extension.

### 6.3 `flyersnap-router-benchmark-<date>.json`

Exported from Settings → *How well does Gordon understand you?* — 34 labelled
sentences run through whichever model is configured, scored, with four safety
counts reported separately (`destructiveEscalations`, `writeEscalations`,
`missedRefusals`, `inventedParams`). Sentences come from the repo, not from the
family's data. Read with `node tools/eval-router.js --read <file>`.

**These two files are the natural feed for a console's "how is it doing?"
view** — and they already contain no personal data, so shipping them to a
server is a much smaller decision than syncing the app state.

## 7. What an admin console would actually need to do

Ranked by how much of a real problem each one solves:

1. **Hold the Anthropic key and issue access to it.** Today the key is on the
   phone. A console that manages a proxy's key, and who may call it, is the
   single largest improvement available. See `SECURITY-PLAN.md`.
2. **Manage the allowlist.** Who may use the proxy / sync at all.
3. **Show spend and failures per user and per `op`.** The `aiLog` fields above
   are already the right shape for this; today they only reach a desktop by
   hand.
4. **Revoke.** A lost phone should be one click, and today it is "rotate the
   Anthropic key and re-enter it everywhere".
5. **Manage sync**, once sync exists — not before.

## 8. Constraints the console must not break

These have each cost something already:

1. **`index.html` must boot with no fetched subresources** (`CLAUDE.md:98`,
   three tests at `tests-modules.js:932,942`). ES modules blanked the installed
   PWA in v8.1–v8.5. **A console that requires the app to load an SDK before it
   can start reintroduces that.** Loading lazily, after boot, is fine.
2. **The installed iOS PWA has storage separate from Safari and cannot open
   new tabs** (`CLAUDE.md:135`). This kills email magic links, OAuth popups,
   and `signInWithRedirect` as sign-in methods. Email + password works.
3. **Both apps share one origin.** `lfaley.github.io` is a single origin for
   all GitHub Pages project sites — `index.html:6494` says so, and it is why
   the recipe exchange works through localStorage. One sign-in would cover
   both apps; so would one compromise.
4. **The app must keep working with no network.** Everything except AI is
   local today. A console must not become a dependency for opening the app.
5. **Anthropic exists as the fallback for when the desktop is asleep.** Routing
   it through a home-server proxy removes exactly that.

## 9. What I would want answered before building it

1. **Where does the console run, and where does the proxy run?** If both are on
   the desktop, they are unavailable precisely when they are needed.
2. **Is the console per-app or shared with the recipe app?** Shared origin and
   shared Firebase project push toward shared; shared blast radius pushes back.
3. **How many people will ever be in the allowlist?** If the answer is one, most
   of §7 is ceremony and only items 1 and 4 are worth building.
4. **Does the console need to see prompt content?** Today nothing logs it, on
   purpose. Changing that is a privacy decision about children's data, not a
   logging change.

## Sources

`index.html` lines cited inline · `js/ailog.js` · `js/intents.js` ·
`js/matching.js` · `CLAUDE.md:98,135` · `tests-modules.js:932,942` ·
`SECURITY-PLAN.md` · OpenTelemetry GenAI semantic conventions.
