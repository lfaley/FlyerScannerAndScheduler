# Security plan — getting the key off the phone, then auth, then sync

> **ON HOLD — August 22, 2026.** Logan is building an admin console to manage
> allowed users and a Firebase database, and the login design is evolving with
> it. **Do not start P1–P3 from this document.** The findings in §3 (magic
> link cannot sign in an installed PWA; sessions are NOT per-origin here;
> Tailwind's token layer would invert the theme) stay valid and are worth
> reading before the console is designed. See **ADMIN-CONSOLE-CONTRACT.md**
> for what FlyerSnap exposes to a console.

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
- Stopping strangers using the public URL. ❌ *not a goal*

And two constraints:

- FlyerSnap is used **installed to the home screen**, not in a Safari tab.
- Anthropic must **keep working when the desktop is asleep**. A direct path stays.

The last item on the "protect" list being unticked is the important one. Today
FlyerSnap has no server and no cloud data: a stranger opening the public URL
gets an empty app. **A login gate protects nothing that exists yet**, while the
key exposure is real right now. So the doc's ordering — gate the app first — is
backwards here, and this plan inverts it.

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
