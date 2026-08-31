# Notes for the agent working on FlyerSnap — 2026-08-31

From the session working in `RecipeAndMealPlanner/meal-planner-shoppin`. Logan asked me to
pass these on. Line numbers are from FlyerSnap **v9.78** as it sits in this working tree
today; re-grep before editing if the file has moved on.

Everything below was read in the actual source or measured from live production data.
Where a cause is not proven, it says so.

---

## 1. ⚠️ BREAKING-IF-IGNORED: the `errorReports` contract is now enforced by rule

**Read this before adding any field to a report document.**

`firestore.rules` in the recipe repo was tightened today (finding C6). `isValidErrorReport`
now begins with a `hasOnly` allow-list. **Any key not on this list makes the write fail.**

Allowed keys — exactly these 21, nothing else:

```
reportId, createdAt, type, message,
app, severity, fingerprint, standalone, occurrenceCount,
stack, description, url, platform, userAgent, appVersion,
sessionId, actionsCount,
actionTrail, recentErrors,
resolved,
serverAt
```

Plus these caps (each sized above the producer's own truncation, so nothing legitimate is
rejected today): `reportId` ≤ 64 · `type` ≤ 100 · `message` ≤ 4000 · `stack` ≤ 8000 ·
`description` ≤ 4000 · `actionTrail` ≤ 8000 · `recentErrors` ≤ 8000 · `userAgent` ≤ 500 ·
`url` ≤ 500 · `platform` ≤ 100 · `appVersion` ≤ 100 · `sessionId` ≤ 100 · `app` ≤ 32 ·
`severity` ≤ 16 · `fingerprint` ≤ 64. `standalone` must be bool; `createdAt`,
`actionsCount`, `occurrenceCount` must be numbers.

**Why this matters more for FlyerSnap than for the recipe app.** FlyerSnap treats a 403 as
final and **deletes the report from the outbox** rather than retrying —
`index.html:7264-7267`:

```js
if(res && (res.ok || res.status === 409 || res.status === 403)){
  // 403 = rules rejected the shape -- retrying forever would not help.
  errorOutboxWrite(errorOutboxRead().filter(d => d.reportId !== docOut.reportId));
```

So a rejected shape is not a retry — it is **silent, permanent data loss**. If you add a
field to `toReportDoc` (`js/errorReport.js:99-140`), the rule in the recipe repo must be
updated in the same change, or every FlyerSnap report stops arriving and nothing tells you.

**Also note: the rule deliberately does NOT require authentication.** That was considered
and rejected precisely because FlyerSnap posts unauthenticated over the REST API
(`js/errorReport.js:155-159` — API key in the query string, no `Authorization` header).
Do not "harden" it by adding an auth requirement.

Verified in production today: two FlyerSnap documents (an 11-key and a 12-key one) were
written unauthenticated and accepted after the rule went live. The contract works — it is
just now strict.

Rationale and the full field inventory:
`RecipeAndMealPlanner/meal-planner-shoppin/SECURITY-RULES-C6-PLAN.md`.

---

## 2. BUG — unhandled promise rejection in `withTransition`

**Evidence:** a live error report from v9.78 carrying
`message: "App: Background task did not finish"` and
`description: "Transition was aborted because of invalid state"`.

`'App' + 'Background task did not finish'` is emitted from exactly one place — the
`unhandledrejection` handler at `index.html:11884`, which passes `r.message` as the detail.
So this reached the log as an **uncaught promise rejection**.

The cause is visible in `index.html:5373-5374`:

```js
if(typeof document !== 'undefined' && document.startViewTransition && !reduce){
  try{ document.startViewTransition(fn); return; }catch(e){ /* fall through */ }
}
```

`startViewTransition()` returns a `ViewTransition` whose `ready` / `finished` /
`updateCallbackDone` promises can reject. A **synchronous** `try/catch` cannot catch a
promise rejection — it only guards the call itself. So when the transition aborts, the
rejection escapes to `window.onunhandledrejection` and is logged as an app fault.

**Suggested fix** (attach a handler; the transition itself needs no other change):

```js
try{
  const t = document.startViewTransition(fn);
  // A skipped/aborted transition is not an app fault -- the DOM update still ran.
  if(t && t.finished && t.finished.catch) t.finished.catch(() => {});
  if(t && t.ready && t.ready.catch) t.ready.catch(() => {});
  return;
}catch(e){ /* fall through */ }
```

**NOT PROVEN: why the transition aborted.** "Transition was aborted because of invalid
state" typically means the transition was superseded or the document changed state
mid-transition, but I did not reproduce it and I am not going to name a cause. The missing
`.catch()` is a defect on its own merits and fixing it stops the false "app fault" reports
either way. If the underlying abort matters, reproduce it first — do not fix it blind.

---

## 3. BUG — a failed local-model call is never recorded when the Anthropic fallback throws

`index.html:4647-4648`:

```js
const answer = await callClaude(contentBlocks, maxTokens, system);
recordAiCall(Object.assign({}, localFail, { fellBackTo:'anthropic' }));
```

`recordAiCall` for the local failure runs **only after `callClaude` resolves**. If
`callClaude` throws — and it throws immediately with `NO_API_KEY` when no Anthropic key is
saved (`index.html:4913-4917`) — that line is never reached, so **`localFail` is silently
discarded.**

Consequence, seen today: Logan was signed in to Gordon, the local call failed, the fallback
threw `NO_API_KEY`, and the AI call log recorded only `no_api_key`. There is **no record of
what Gordon actually did** — which is the one thing needed to diagnose it. The user is told
"NO_API_KEY", which points at the wrong subsystem entirely.

**Suggested fix:** record `localFail` *before* attempting the fallback, then record the
`fellBackTo` outcome separately — or wrap the `callClaude` call in try/finally so the local
failure is logged regardless. Note the existing comment at `:4638-4646` explains that the
order was deliberately changed once before (v9.67) so the outcome is announced only after
there IS one; keep that property while fixing this.

---

## 4. UX — raw error code shown to the user on recipe scan

`index.html:10698`:

```js
alert('Scan failed: '+err.message);
```

With no Anthropic key this renders literally: **"Scan failed: NO_API_KEY"**. That is an
internal identifier, not a message.

The app already knows how to do this properly — `index.html:8659`:

```js
if(err.message === 'NO_API_KEY'){ alert('Add your Anthropic API key in Settings first.'); }
```

The scan path just never got the same treatment. Worth aligning; and given the app is
usually pointed at Gordon, the more accurate message when signed in would name the local
model failing and the fallback having no key, rather than implying only Anthropic.

(Separately: these are native `alert()` calls. The recipe-repo review flagged native
`confirm`/`alert` as inconsistent with the app's own dialog system. Not urgent, just noted.)

---

## 5. The published Firebase Web API key is NOT a secret — do not rotate it

`js/errorReport.js:27` and `index.html:962` / `:6941` carry
`AIzaSyAp87MmFWuWQmHdJKPJ-i1UNOMXg-my5ho`. GitHub secret scanning flags it (alert #1 on
this repo) and GitGuardian emails about it. **It is a false positive.**

GitHub's own remediation text on that alert says "rotate the secret" / "revoke this Google
API Key". **Do not follow it** — it would break sign-in and Firestore in both this app and
the recipe app, and the replacement would be published in the next deploy anyway.

Verified 2026-08-31 in the Google Cloud console: the key is restricted to `Websites` with
four referrers and to 25 Firebase-only APIs; no billable general Google API is reachable
with it. Full ruling: `PUBLIC-KEYS-POLICY.md` in this repo (a pointer) and the canonical
copy in the recipe repo.

A **genuine** leak here would look like `sk-ant-…`, a `"type": "service_account"` blob, a
`-----BEGIN PRIVATE KEY-----` block, or a `ghp_`/`github_pat_` token. A sweep on
2026-08-31 found none — the only `sk-ant-…` matches are the deliberate fixtures in
`tests-modules.js` that prove the log redactor works.

---

## 6. Context you may want

- **Versions:** this tree is v9.78. Logan's desktop browser was serving a cached **v9.37**
  until today — 40 versions stale, which made a fixed CSS bug and an old model tag look
  like live defects. If a bug report disagrees with the source, **check the reported
  `appVersion` first.** Every report document carries it.
- **The cache-first service worker** (`sw.js:16`, `CACHE = 'flyersnap-v160'`) means one
  launch of staleness by design, with a "A new version is ready / Reload" toast
  (`index.html:11799-11802`). That worked once he reloaded; nothing appears to be broken
  in the update path, but 40 versions of drift is worth keeping an eye on.
- **The Gordon proxy's shared `ACCESS_TOKEN` is retired** (24 Aug) — auth is a per-user
  Firebase ID token plus the `allowedUsers` allowlist. Do not reintroduce a shared token;
  see `PROXY-TOKEN-RETIRED-NOTE.md` in this repo.
- **Canonical model tag** is `qwen3-vl:8b-instruct-q4_K_M` (`AI-STATE.md`). The recipe repo
  had two `scripts/` files still defaulting to the banned `qwen2.5:14b-instruct`; both were
  fixed today, and `AI-STATE.md`'s change-list now includes `scripts/` so the same drift
  cannot recur.

---

## What I did NOT touch

No FlyerSnap code was changed in this session. The only files written here are this note
and `PUBLIC-KEYS-POLICY.md`. Items 2, 3 and 4 above are reported, not fixed — they are
yours to make.
