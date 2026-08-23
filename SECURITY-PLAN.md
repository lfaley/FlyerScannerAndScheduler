# Security plan — getting the key off the phone, then auth, then sync

> **ON HOLD — August 22, 2026.** Logan is building an admin console to manage
> allowed users and a Firebase database, and the login design is evolving with
> it. **Do not start P1–P3 from this document.** The findings in §3 (magic
> link cannot sign in an installed PWA; sessions are NOT per-origin here;
> Tailwind's token layer would invert the theme) stay valid and are worth
> reading before the console is designed. See **ADMIN-CONSOLE-CONTRACT.md**
> for what FlyerSnap exposes to a console.
>
> **Updated 23 Aug (v9.30): §1 IS NOW WRONG — read §1a first.** Gordon is to
> ship with the app, which makes "stopping strangers" a goal, and Logan has
> chosen a login that gates the WHOLE app. §1a records the decision, the
> `Bearer local` finding, and the boot-rule collision it creates.
>
> **Updated 23 Aug (v9.26).** Part of this is no longer hypothetical. FlyerSnap
> has been writing to the shared Firestore project `meal-planner-f7f2f` since
> v9.24 (`errorReports`), and per `ERROR-LOGGING-HANDOFF.md` that same database
> is expected to carry **sign-in**. So §4's P2 is no longer "adopt Firebase" —
> the project, the anonymous-create posture and the three-app arrangement are
> already in production. What is still true and still unbuilt: the SDK must load
> **lazily** (§3.5), email+password is the only sign-in that works in an
> installed iOS PWA (§3.2), and both apps share an origin so one sign-in covers
> both (§3.3). Open question 3 is now partly answered — the two apps already
> share a Firestore project, so their security is already coupled.

**Written:** August 22, 2026 · **Against build:** v9.17 · **Sequence:** Research → Plan → Scaffold → Code → Verify

Prompted by **SHAREDSERVICESGUIDE.md** (the recipe app's Firebase / Tailwind /
auth reference). This is FlyerSnap's response to it: what transfers, what
cannot, and in what order.

Everything about FlyerSnap below is cited to a file and line. Everything about
the recipe app comes from that document — **its repository is not connected to
this session, so none of it has been verified against code.**

---

## 1. What Logan said he is protecting

Asked directly, and the answers change the doc's ordering:

- **The Anthropic key on the phone.** ✅
- **Preparing for cloud sync.** ✅
- **The local model endpoint.** ✅
- ~~Stopping strangers using the public URL. ❌ *not a goal*~~
  **→ ✅ A GOAL AS OF 23 AUG 2026. See §1a.**

And two constraints:

- FlyerSnap is used **installed to the home screen**, not in a Safari tab.
- Anthropic must **keep working when the desktop is asleep**. A direct path stays.

The last item on the "protect" list being unticked is the important one. Today
FlyerSnap has no server and no cloud data: a stranger opening the public URL
gets an empty app. **A login gate protects nothing that exists yet**, while the
key exposure is real right now. So the doc's ordering — gate the app first — is
backwards here, and this plan inverts it.

## 1a. The premise that changed: Gordon ships WITH the app (23 Aug 2026)

Logan's direction: **the local model stops being something each user points at,
and becomes something the app comes with.** The login screen exists so that "not
just anyone can use it."

That inverts this document's own §1. The reason "stopping strangers" was not a
goal is stated there: a stranger opening the public URL got an **empty app** —
nothing to steal. Once Gordon ships with the app, a stranger gets **Logan's GPU,
electricity and bandwidth**, on a machine in his house. The gate stops being
about data and starts being about compute.

### The endpoint has no real auth today — verified

Three call sites send a hardcoded constant:

```js
headers: { 'Authorization': 'Bearer local' }   // index.html:4064, :4112, :8334
```

It is identical in every copy of the app. That is safe **only** because
`localBaseUrl` is a private Tailscale address nobody else knows — the secrecy of
the URL is the whole security model. Publish the URL with the app and
`Bearer local` protects nothing. **Anything built here replaces that constant.**

### The decision, and why it changed within the hour

Asked directly on 23 Aug and given both options with their costs, Logan first
chose a **hard gate** — nothing before sign-in. Then he asked the question that
reversed it: *"how would that work if I want to share this with my kids so they
can see their events?"*

**Recommended design, recorded 23 Aug: gate GORDON, not the app.**

- The app opens for anyone who has it. Events, chores, lists, meal plan, and
  typing an event in by hand (v9.28) all work with no network and no account.
- **Sign-in gates the two things that spend Logan's GPU: scanning and Ask.**
  Signed out, they show the "needs setting up" state that already exists.

Three reasons, in the order they matter:

1. **Kids need to SEE, not to SCAN.** Under a hard gate, a child's session
   expires, they open the app before school, and they get a login form instead
   of their schedule. Under a Gordon gate their app always opens and shows what
   it has. The thing being protected is compute; the thing they need is
   read-only.
2. **If accounts unlock Gordon, every kid can spend the GPU.** Kids almost
   certainly want to be read-only, which is "gate Gordon, not the app" with
   roles on top — the same design arrived at from a different direction.
3. **It keeps the boot rule free rather than merely survivable** (below).

The hard gate is not wrong, and the shape that would have survived is kept
below because it is the right design for the sign-in flow either way.

### Why the gate must be on a SESSION, not on Firebase being reachable

This matters under EITHER design, and it is the whole of §3.5 applied.

The Firebase SDK cannot be inlined without a build step. Gating on "is Firebase
reachable" makes it a **boot dependency**, and the installed app goes blank when
the CDN is not — the v8.1–v8.5 incident in a new costume. The resolution:

1. **Boot is unchanged.** `index.html` still fetches nothing. It renders its own
   sign-in screen from its own inlined code — drawing a form needs no SDK.
2. **The gate is answered offline.** On launch the app asks one local question:
   *do I hold a session that has not expired?* That is a `localStorage` read.
   Yes → the app opens, with no network call at all. No → the sign-in screen.
3. **The SDK is fetched only to SIGN IN**, which is the one moment the user
   necessarily has network anyway. It stays a *feature* dependency, never a
   *boot* dependency — exactly the distinction §3.5 draws.
4. **Sessions are long.** 30 days or more. An expiring session must not mean a
   parent standing in a school car park unable to see today's pickup time.

**The cost a hard gate cannot design away** — and the reason the recommendation
moved: *expired session + no network = locked out of your own calendar.* A
parent in a school car park who cannot see today's pickup time. **A Gordon-only
gate cannot do that**, because the app opens regardless; the worst case is that
scanning is unavailable until you sign in again, which is exactly when you have
signal anyway.

If the hard gate is ever revisited, the mitigations are a long expiry, a visible
"signs out in N days" warning, and degrading an expired session to READ-ONLY
rather than to nothing.

### What still holds from this document

- **Email + password only** (§3.2). Magic link, `signInWithPopup` and
  `signInWithRedirect` all fail in an installed iOS PWA. A hard gate makes this
  more critical, not less: it is now the only door.
- **Same origin as the recipe app** (§3.3), so one sign-in covers both — and a
  compromise of either reaches the other. With a hard gate that is a bigger
  consequence than when it was written.
- **The allowlist** decides who, and it is already shared with the console.

### Sharing with the kids — three different projects, and only one exists

Asked on 23 Aug: *"how would that work if I want to share this with my kids so
they can see their events?"* The honest answer starts with a constraint that has
nothing to do with login: **there is no sync.** Every install is an island of
`localStorage`. A kid who installs FlyerSnap today gets an empty app, and no
amount of signing in changes that — there is nothing to sign in *to* yet.

What exists today is **Share Events** (`renderShareEvents`, `index.html:6374`):
tick events, send them as a calendar file or a text list. Its own help text says
*"no access to anything in this app."* One-way export, not shared access.

| Option | Cost | What the kid gets |
|---|---|---|
| **a. Calendar export** — works today | Nothing to build | Their events in the phone calendar they already use. No account, no sync, no login. **Probably the right permanent answer for younger kids.** |
| **b. Read-only sync** | The real build — P3 below | The app, their events, live. Needs accounts, the allowlist, and Firestore. |
| **c. Shared family device** | Small | A per-kid view on one household device. No accounts at all. |

The per-person machinery for (b) already exists and is not the hard part: events
carry `personIds`, and `eventFilter` already filters the list by person
(`index.html:3560-3562`). The missing piece is sync, not filtering.

**Roles, if (b) is ever built:** kids read-only, adults able to scan. Otherwise
every child on the allowlist can spend the GPU the login exists to protect.

### Ordering this changes

**The first step does not depend on any of this.** `Authorization: 'Bearer local'`
is a hardcoded constant at three sites. Replacing it with a per-device token —
entered once, stored on the phone, revocable server-side — is small, useful on
its own, and needs no login design to land first. It is also exactly the interim
control P1 already describes.

P1 (get the Anthropic key off the phone) was the priority because the key was
the live exposure. Logan has since capped it with a workspace key, and Anthropic
is now the **fallback** rather than the primary path (v9.30). Meanwhile shipping
Gordon creates a NEW exposure that does not exist yet. **When that work starts,
auth stops being P2 and becomes the gate on the whole thing.**

---

## 2. The exposure, exactly

`index.html:3453-3455`:

```js
'x-api-key': S.settings.apiKey,
'anthropic-version': '2023-06-01',
'anthropic-dangerous-direct-browser-access': 'true'
```

The Anthropic key is stored in `localStorage` and sent from the browser to
`api.anthropic.com`. Anyone with the unlocked phone can read it; so could any
script injection. The header name is Anthropic's own opinion of the practice.

Two smaller ones:

- **The local model URL** (`S.settings.localBaseUrl`) is in the app and, when
  asked for, in the diagnostics export (`js/ailog.js`, `includeLocalUrl`). With
  Tailscale that is a topology hint rather than an entry point, but it is in a
  file designed to be emailed.
- **No caller verification on the AI proxy.** SHAREDSERVICESGUIDE §3.1 says the
  recipe app replaced a shared bundled token with Firebase ID token
  verification. FlyerSnap has not had that conversation at all.

## 3. What does not transfer from the doc

### 3.1 Email magic link cannot sign in an installed iOS PWA — blocker

`CLAUDE.md:135` records both halves of the collision: an installed iOS PWA has
**storage separate from Safari** and **cannot open new tabs**. A magic link
arrives in Mail, opens in Safari, and signs in *Safari's* storage. The
installed app stays signed out, with no in-app way to finish.

The recipe app does not hit this because it is a browser app. FlyerSnap is not.

### 3.2 And the obvious substitutes are also out

| Method | Verdict on an installed iOS PWA at `lfaley.github.io` |
|---|---|
| Email magic link | **No** — opens Safari, separate storage jar |
| `signInWithPopup` | **No** — installed PWAs cannot open new tabs (`CLAUDE.md:135`) |
| `signInWithRedirect` | **No, as-is** — Firebase's own docs list **Safari 16.1+** among browsers that break it, because the SDK "relies on a cross-origin iframe that connects to your app's Firebase Hosting domain" |
| **Email + password** | **Yes** — a plain API call. No popup, no redirect, no link, no iframe |
| Device-code flow | Yes, but it is a thing to design and build |

Firebase's documented workarounds for the redirect problem are a custom
`authDomain`, a reverse proxy, or self-hosting the auth helper files. GitHub
Pages is a static host, so the reverse proxy is impossible; the others are
fragile enough that they should not be the only way into the app.

**So: email + password, with the `allowedUsers` allowlist still deciding who.**
Less fashionable than a magic link, and the only one that reliably works where
this app actually runs.

### 3.3 "Auth sessions are per-origin" is wrong for this deployment

§1.4 and §3.3 both say a user signs in separately on each site's domain. Both
apps are GitHub Pages **project sites under `lfaley.github.io`**, and
`index.html:6494` says so outright: *"Same origin as
https://lfaley.github.io/meal-planner-shoppin/"* — which is why the localStorage
recipe exchange works at all.

Same origin means **one sign-in covers both apps**. Better than the doc
promises. It also means they share an auth namespace, so a compromise of either
page reaches the other's session. Both halves belong in the doc.

### 3.4 Tailwind cannot be adopted, and the token layer would invert the theme

FlyerSnap has no build step; Tailwind 4 needs one. Beyond that the two systems
are inverted:

| | Recipe app (per the doc) | FlyerSnap (`css/tokens.css`) |
|---|---|---|
| Colour space | oklch | hex (line 22) |
| Default | light on `:root` | **dark** on bare `:root` |
| Other theme | `.dark` class | `:root[data-theme="light"]` |

Copying the token layer would flip the shipped default and break two tests: the
raw-colour guard and the AA contrast check on every used pair. **The achievable
goal is matching token _values_ so the apps look like siblings — not sharing
token _code_.** Out of scope for this plan; recorded so nobody tries it.

### 3.5 The boot rule survives — but only because there is no login gate

`CLAUDE.md:98` forbids shipping a file that must FETCH anything to boot; three
tests enforce it (`tests-modules.js:932`, `:942`). That rule exists because ES
modules blanked the installed PWA in v8.1–v8.5.

The Firebase SDK cannot be inlined without a build step. **If login gated the
app, that SDK would become a boot dependency by definition** — Pages reachable,
Firebase CDN not, blank screen. §3.2 of the doc argues sign-in is
cloud-independent; for FlyerSnap the new single point of failure would not be
the home server, it would be the SDK fetch.

Because Logan does **not** want a gate, this resolves cleanly: the SDK loads
**lazily**, at the moment someone signs in or syncs. The app boots, and works,
with no network at all. That is the difference between a boot dependency and a
feature dependency, and it is the whole reason the ordering in §1 matters.

> Noted while reading: the guard regex `^\s*(?:import\s|export\s|export\{|import\()`
> catches a dynamic `import()` only at the start of a line, so
> `const m = await import(...)` would slip past it. Not a problem today — there
> are none — but it should be tightened before P2 relies on the distinction.

## 4. The plan

### P0 — small, immediate, no dependencies

1. Reconsider `includeLocalUrl` in the diagnostics export. The URL is useful
   when debugging "the desktop is asleep" and it is a topology hint in a file
   meant to be emailed. Proposal: keep it, but redact to host-only
   (`desktop.tailnet.ts.net` → `desktop.…`) unless a "full detail" box is
   ticked at export time.
2. Tighten the dynamic-import guard noted above, before P2 depends on it.

### P1 — get the key off the phone *(the main event, no login required)*

Extend the existing self-hosted Ollama proxy into an **AI proxy** that also
fronts Anthropic and holds that key server-side. FlyerSnap calls the proxy;
`api.anthropic.com` is never called from the browser.

- **Caller verification, interim:** a per-device token, entered once, stored on
  the phone, revocable server-side. This is *not* the "shared token baked into
  the bundle" the doc rightly criticises — it is per-device and revocable — but
  it is weaker than an ID token and is **explicitly throwaway**: P2 replaces it.
- **The fallback Logan asked for.** The on-device key stays as the path used
  when the proxy is unreachable. **Be honest about what this means: the key is
  still on the phone, so P1 reduces the exposure rather than removing it.** It
  is only *used* when the desktop is asleep.
- **Shrink the blast radius of the copy that remains.** If the Anthropic
  console supports per-key spend limits *(unverified — check before relying on
  it)*, the phone should hold a **separate, low-limit key**, revocable without
  touching the proxy's. Then a stolen phone costs a capped amount, not the
  account.
- **Settings switch, default off: "Never use the on-device key."** For when the
  stronger posture is wanted. With it on, no AI while the desktop sleeps — and
  the app still works fully by hand.
- **Say which path was used.** `js/ailog.js` already records provider and
  operation; add `route: 'proxy' | 'direct'`. "Why did it fall back?" then has
  an answer in the diagnostics file.

**Acceptance:** with the proxy reachable, no request from the browser carries
`x-api-key`, and a network capture proves it. With the proxy unreachable and
the switch off, Anthropic still answers. With the switch on, it refuses and
says why.

### P2 — auth that works where the app runs

Same Firebase project (doc §1.4 Option A), same `allowedUsers` allowlist, so
adding a person once covers both apps.

- **Email + password**, per §3.2 above. Not magic link.
- SDK loaded **lazily**; the app boots and works offline without it.
- The proxy verifies a **Firebase ID token** instead of the P1 device token —
  this is the reusable piece the doc names (`server/verifyFirebaseToken.mjs`).
- No app gate. Signing in unlocks *the proxy and sync*, not the app.

### P3 — cloud sync

Only after P2. Firestore, lazily loaded, following the share-code pattern and
the shape/size validation in the doc's §1.2. **The local save file stays the
source of truth**; sync is a mirror, so an offline boot is unaffected and the
existing data-safety tests keep meaning what they mean.

## 5. Honest caveats

- **P1 does not eliminate the key exposure**, because Logan chose availability
  over elimination — a defensible trade, but it must not be reported as "the
  key is off the phone". It is off the phone *for the path normally used*.
- **The proxy becomes a new attack surface.** It holds a real Anthropic key and
  is reachable from the internet or the tailnet. It needs its own review; this
  plan does not contain one.
- **Everything about the recipe app here is from its document, not its code.**
  Before P2, that repo should be connected so `verifyFirebaseToken.mjs`,
  `firestore.rules` and `src/lib/auth/*` can be read rather than trusted.
- **A shared Firebase project couples the two apps' security.** Same origin,
  same allowlist, same rules file: a mistake in one app's rules is a mistake in
  both. Option B (separate projects) trades that for duplicated admin.
- **Sample size on the claim that nobody else uses the URL.** "Stop strangers"
  was not a goal *today*. After P3 there is cloud data, and that answer changes.

## 6. Open questions

1. **Where does the proxy run?** The existing Ollama proxy is on the desktop.
   Anthropic through it means Anthropic dies when the desktop does — which is
   exactly what the fallback exists to prevent. An always-on host removes the
   trade entirely and adds a deployment to maintain.
2. **Does the Anthropic console support per-key spend limits?** The
   separate-low-limit-key idea in P1 depends on it. Unverified.
3. **Is the recipe app's proxy the same process?** If FlyerSnap and the recipe
   app share one AI proxy, the allowlist and rate limits are shared too.
4. **Who else will ever sign in?** The allowlist is only worth its complexity if
   the answer is more than one person.

## Sources

Firebase, *Best practices for using signInWithRedirect on browsers that block
third-party storage access* · SHAREDSERVICESGUIDE.md (unverified against the
recipe app's code) · FlyerSnap: `CLAUDE.md:98`, `CLAUDE.md:135`,
`index.html:3453-3455`, `index.html:6494`, `css/tokens.css:22`,
`tests-modules.js:932,942`, `js/ailog.js`.
