# Note for the agent working in `RecipeAndMealPlanner/meal-planner-shoppin`

**From the FlyerSnap session · 24 Aug 2026 · Logan asked me to pass this on.**

The Gordon proxy's shared `ACCESS_TOKEN` was **retired today**. Two docs in your
repo are now wrong in ways that will mislead the next person, and one of them
would walk them into re-creating the hole.

---

## What happened

`server/ollama-proxy.mjs` accepts EITHER the legacy shared `ACCESS_TOKEN` **or**
a Firebase ID token whose email is on the `allowedUsers` allowlist (`:106-121`).
Its own comment says the right thing: *"Once all clients send Firebase ID
tokens, unset it."*

Both clients had already stopped sending it:

- **FlyerSnap** — the constant was declared and never read.
- **The recipe app** — `getGordonAuthToken()` (`src/lib/aiConfig.ts:136`) prefers
  the signed-in user's ID token and only falls back to `VITE_HOSTED_AI_TOKEN`
  *if configured*. There is no `.env`, `.env.local` or `.env.production` in the
  repo — only `.env.example`, which does not mention it — and the token string
  does not appear anywhere in `dist/`. **It was not baked into the build.**

But the proxy was still accepting it, and FlyerSnap had the value hardcoded in
`index.html`, which **ships to GitHub Pages as a public file**. Verified live on
24 Aug: a request carrying that token returned **HTTP 200**.

**It was retired, not rotated.** Rotating publishes a different secret in the
next build. The token now opens nothing.

## What was actually changed (server side)

The proxy does not run from a PowerShell window. It runs as a **Windows service
called `GordonAI`, managed by NSSM** (`C:\nssm\nssm.exe`), as `SYSTEM`, with
`Start-Up: Auto`. The token lived in that service's registry-backed environment
— which is why closing shells never affected it.

```powershell
# what was run, in an ADMINISTRATOR terminal
C:\nssm\nssm.exe set GordonAI AppEnvironmentExtra FIREBASE_PROJECT_ID=meal-planner-f7f2f ALLOWED_ORIGIN=https://lfaley.github.io
C:\nssm\nssm.exe restart GordonAI
```

The service log (`C:\nssm\gordon-out.log`) now ends with:

```
CORS origin: https://lfaley.github.io | rate: 20/min | auth: firebase-login
```

`auth: firebase-login` with **no** `+ legacy-token` is the thing to check. A
request with the old token now returns **401**.

---

## Please fix: `server/README.md`

**1. Step 1 ("Make a random access token") and Step 2 describe the security
model as a shared bearer token.** That is no longer how the proxy is secured.
The only way in is a Firebase ID token whose email is in `allowedUsers`.
`ACCESS_TOKEN` should be documented as **removed**, and if it is mentioned at
all, only as "do not set this — see below".

**2. Line 63 is the dangerous one.** It currently reads:

> Rotate the token anytime: stop the proxy, pick a new token (step 1), restart,
> and update `VITE_HOSTED_AI_TOKEN`.

Three problems: rotation is no longer the right operation (retirement is);
"stop the proxy" does not work, because NSSM restarts it and `Stop-Process`
returns *Access is denied* to a non-elevated shell; and it says nothing about
the service that actually holds the config. Anyone following that line today
either fails or, worse, succeeds in putting a fresh shared secret back.

**3. Line 62 says services/scheduled tasks are something "we can later
install".** They are installed — `GordonAI` exists and is the live deployment.
The README describes a `$env:`-in-two-PowerShell-windows setup that no longer
matches reality.

**Suggested replacement for the operations section** (verified commands):

```powershell
# read the service's environment
C:\nssm\nssm.exe get GordonAI AppEnvironmentExtra

# write it back (this REPLACES the whole block - list every variable you keep)
C:\nssm\nssm.exe set GordonAI AppEnvironmentExtra FIREBASE_PROJECT_ID=meal-planner-f7f2f ALLOWED_ORIGIN=https://lfaley.github.io

# apply
C:\nssm\nssm.exe restart GordonAI

# verify - want "auth: firebase-login" with no "+ legacy-token"
Get-Content C:\nssm\gordon-out.log -Tail 6
```

Note `nssm set AppEnvironmentExtra` **replaces the entire block**, so read
first. All of this requires an elevated terminal.

## Please also check: `.env.example` and `src/lib/aiConfig.ts`

- `.env.example` does not mention `VITE_HOSTED_AI_TOKEN`, but `aiConfig.ts:30`
  and `:130` document it as a supported path. If the shared-token fallback is
  now dead everywhere, **consider deleting that fallback branch** so nobody
  re-enables it by setting the variable. If you keep it, say in the comment that
  the proxy no longer accepts such a token, so setting it does nothing.
- Worth a guard test on your side: **no credential literal in anything that
  ships.** FlyerSnap added one today — it fails if a `const *_TOKEN/_SECRET/
  _PASSWORD` carries a long string literal in the shipped file. The Firebase web
  API keys are deliberately exempt: they are public by design, security comes
  from Firestore rules, and they are named `*_KEY`.

## The general lesson, for the standard

**"Not sent" is not the same as "not exposed."** FlyerSnap's app genuinely never
transmitted that token — a test proved it — and it was still a working
credential published beside the URL it opened. Anything in a file served to
browsers is public, and a secret kept "as an emergency fallback" in such a file
has already been handed to everyone.

If it is useful, this belongs in `ERROR-LOGGING-STANDARD.md` §6 alongside the
23 Aug rulings, since it is the same class of finding: the boundary that matters
is where data **lands**, not where the code intends to send it.

## Nothing is required of you urgently

The hole is closed at the server. These are documentation fixes so the next
person does not reopen it. No client change is needed in the recipe app — it was
already sending ID tokens.
