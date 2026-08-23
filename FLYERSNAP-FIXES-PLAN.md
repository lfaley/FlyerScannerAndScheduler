# FLYERSNAP-FIXES-PLAN (v2) — remediating the review + shakedown, reframed for Gordon

**Written:** August 23, 2026 (v2 supersedes the Aug 23 v1). **Sources:** `AppReviews\REVIEW-FlyerSnap.md`, `AppReviews\FLYERSNAP-SHAKEDOWN.md`, plus fresh source-verification and cited research.
**Major change since v1:** Logan is switching the apps' AI from Claude/Anthropic to **Gordon = the self-hosted Ollama LLM on his computer, reached over Tailscale** (the existing "local model" path; documented in the recipe app's `GORDON-APP-WIDE-PLAN.md` / `LOCAL-MODEL-*.md` / `AI-BACKEND-PLAN.md`). Every Anthropic-key recommendation from v1 is reframed accordingly below.
**Status:** PLAN — nothing implemented until approved. Then FlyerSnap's mandated order: Research → Plan → Scaffold → Code → Verify (`node tests.js` green) → one-paste PowerShell handoff; **no `import`/`export`/`<script src>` may enter the shipped `index.html`** (v8.1–v8.5 blank-screen rule), `js/` stays source-of-truth with hand-inlined copies, and any Settings-hub change touches the hub tests.

---

## 0. Research this plan stands on

- **OWASP — information exposure through query strings:** a token in a URL leaks via history, logs, and Referer even under HTTPS; the mitigation is body/header, not the URL. *But* the Gmail watcher reaches Apps Script by **JSONP** (documented in `gmail-watcher.gs:543-547`) precisely because a browser `fetch()` to Apps Script has no usable CORS — and JSONP `<script>` requests are **GET-only, no headers/body** — so on this delivery path the token has nowhere to live but the URL. The honest fix is **rotation + treat-as-bearer**, plus an optional write/read privilege split, not "move it to a header." (Grounds FS-BE-03.)
- **Error logging should record failures, not expected states** — OpenTelemetry/Sentry conventions and FlyerSnap's own ERROR-LOGGING-STANDARD treat automatic reports as *diagnostics for defects*. A "no AI configured yet" user state is not a defect. (Grounds FS-SHAKE-01.)
- **NN/g empty-state onboarding** — first-use should teach the primary action and remove friction to it. (Grounds FS-UI-05, now "set up Gordon".)
- **Ollama over Tailscale** — Gordon is a private endpoint on a `*.ts.net` tailnet; the app already recognizes local/Tailscale base URLs. The endpoint, not an Anthropic key, is the thing to configure and secure. (Grounds the Gordon reframing; see FlyerSnap `LOCAL-MODEL-PLAN.md` and rule 14 in CLAUDE.md about Ollama `num_ctx`/`OLLAMA_CONTEXT_LENGTH`.)

Source-verified today: assistant keyless catch logs a remote problem at `index.html:5261-5266`; the direct-Anthropic call remains at `index.html:4182-4184`; the error-report opt-out flag is honored at `:5907/:5924` with no UI; recipe app still defaults to Anthropic at `src/lib/aiConfig.ts:28`.

---

## 1. Order of attack

```
Phase 1  FS-SHAKE-01  stop logging keyless-assistant as a remote error report (backlog noise)
Phase 2  Gordon migration hygiene   copy/labels API-key → Gordon; make Gordon the default path
Phase 3  FS-UI-03     error-reporting opt-out toggle (no UI today)
Phase 4  FS-BE-03     Gmail-watcher token hardening (rotate/document; optional privilege split)
Phase 5  small UI      FS-UI-01 toast/FAB; FS-UI-04 manual-entry (decision gate)
Retired by the Gordon switch: v1 Phase 1 (low-cap Anthropic workspace key), most of FS-BE-01
Deferred / cross-app: FS-BE-02 (shared-origin localStorage), FS-BE-05 (privacy-guard prefix) → integration review
```

---

## 2. Phase 1 — Keyless assistant shouldn't spam the error backlog (FS-SHAKE-01, sev 2)

**Where:** `index.html` assistant catch (`:5261-5266`).

Found in the shakedown: with no AI configured, tapping an assistant chip shows the right graceful message *and* queues a remote `errorReports` document (via the unconditional `logProblem`). "No AI configured" is a normal state; on a live network every keyless tap pollutes the Admin Console backlog. This matters *more* during the Gordon rollout, since every device is "not configured" until pointed at the Tailscale endpoint.

Fix — skip the remote report for the expected no-AI case (and update the wording toward Gordon):
```js
}catch(err){
  askState.busy = false;
  const noKey = err && err.message === 'NO_API_KEY';
  askState.error = noKey
    ? 'No AI configured yet — set Gordon up in Settings.'
    : (err && err.message) || 'Something went wrong.';
  if (!noKey) logProblem('Assistant', 'Could not handle a request', (err && err.message) || '');
}
```
Add a regression test (FlyerSnap style: mutation-tested guard) asserting the `NO_API_KEY` path does **not** enqueue an error report, while a real failure does. **Acceptance:** keyless assistant tap → friendly message, zero `errorReports` writes; genuine failure still logs.

---

## 3. Phase 2 — Gordon migration hygiene (the switch, made real in code + copy)

The switch is a direction; these are the concrete, grounded changes it implies. Nothing here removes the Anthropic path outright (CLAUDE.md rule 1: add/adjust, don't rip out) — it makes **Gordon the default and the language**, and leaves Anthropic as an explicit fallback only if Logan wants one.

1. **Make Gordon the default provider (recipe app code).** `src/lib/aiConfig.ts:28` still sets `DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'`. If Gordon is the new default, change the default base URL to the Ollama/Tailscale endpoint (the app already routes local/`*.ts.net` URLs via `isLocalBaseUrl`). **Decision gate for Logan:** provide the exact Tailscale base URL + model name to bake in as defaults, or confirm it should stay user-entered with Gordon shown as the recommended setup. *(This is a recipe-app change; cross-referenced from MEALWEEK-FIXES-PLAN.)*
2. **Copy & labels: "API key" → "Gordon".** FlyerSnap's Gordon-and-AI settings help text and the assistant error string speak Anthropic-key language. Reword to the Ollama/Tailscale-endpoint model so a Gordon-configured user is never told to "paste an API key." Keep the key field only where an Anthropic fallback is still offered.
3. **Documentation is already in the recipe app** (`GORDON-APP-WIDE-PLAN.md`, `LOCAL-MODEL-PLAN.md`, `LOCAL-MODEL-SETUP.md`, `AI-BACKEND-PLAN.md`, `FLYERSNAP-AI-MODEL-HANDOFF.md`). Action: add a one-line pointer from FlyerSnap's `CLAUDE.md`/settings help to that canonical Gordon documentation, and update any FlyerSnap doc line that still calls the provider "Anthropic/Claude by default" so the two repos agree.

**Acceptance:** with Gordon reachable over Tailscale and no Anthropic key, the assistant and scanning work; no UI tells the user to add an Anthropic key on the Gordon path.

4. **Gordon ships with both apps; the login gate is the intended outside-world lockout — verify the endpoint enforces it, not just the screen.**
Logan's intent: Gordon ships with FlyerSnap *and* the recipe app, and the **login screen** (allowlist + auth, managed by the Admin Console) keeps the public from using Gordon/the local model. A client-side login screen hides the UI but does **not** stop a direct call to Gordon's URL, so the endpoint itself must enforce identity.
   **DECISION (Logan, Aug 23): auth-checking proxy.** FlyerSnap will call a proxy (not Ollama directly) with the signed-in user's **Firebase ID token**; the proxy verifies the token + allowlist membership before forwarding to Gordon — exactly SECURITY-PLAN.md's P2 (`server/verifyFirebaseToken.mjs`). FlyerSnap today calls the model endpoint directly from `index.html`, so this means: the Gordon base URL becomes the proxy URL, and requests carry `Authorization: Bearer <token>`. The proxy is **designed in the integration review** (contract, verification, where it runs, its own security review), and the login rollout ships with it so the lockout is real — not the client gate alone. Note: loading Firebase Auth to obtain the token must stay **lazy** (CLAUDE.md rule 4 — nothing fetched at boot), so an offline launch still works.

---

## 4. Phase 3 — Error-reporting opt-out UI (FS-UI-03, sev 1)

`S.settings.errorReportsOff` is honored (`index.html:5907/:5924`) but has no control. Add a labeled toggle to **When something goes wrong**: *"Send anonymized error reports"* (on by default = `!errorReportsOff`), one line of help stating exactly what leaves the device (diagnostics only — model/version/error type; never events, notes, email contents, or the Gordon endpoint/keys — true per `js/errorReport.js`). `onchange` sets the flag + `save()`. Touches the settings-hub tests (known scope). **Acceptance:** toggling off stops the queue; on resumes it; `node tests.js` green incl. hub tests.

---

## 5. Phase 4 — Gmail-watcher token hardening (FS-BE-03, sev 2)

Grounded in the JSONP constraint (§0): the token can't leave the URL without changing hosts, so:
1. **Document it as a bearer secret + rotation procedure** (GMAIL-WATCHER-SETUP.md): the web-app URL + `token` together are a credential; if the phone is lost, rotate `SECRET` in Script Properties and re-save in FlyerSnap. Give the exact script.google.com click-path.
2. **Optional privilege split:** `action=setsenders` mutates the watched list with the same read token (`gmail-watcher.gs:569`) — consider a separate `WRITE_SECRET` for mutating actions so a leaked read token can't repoint the watcher.
3. Keep the good guards (regex-validated JSONP `callback`, sender caps, cost caps) — verified correct.
Any change here must be **re-pasted at script.google.com** (Deploy → Manage deployments → new version) — call this out in the handoff (CLAUDE.md rule 18).

---

## 6. Phase 5 — Small UI polish

- **FS-UI-01 — toast overlaps the FAB.** The theme-change toast renders over "Add paperwork." Offset the toast above the FAB or suppress the confirmation for a change the user just watched. Verify via `node tools/preview.js` (light+dark).
- **FS-UI-04 — manual event entry (decision gate before code).** Confirm whether a discoverable "create event by hand" path exists (grep `renderEventEdit` entry points). If yes → surface it on the Events empty state; if no → it's a feature request, Logan's call (rule 1: never add a feature without asking).

---

## 7. Retired / deferred — with reasons

| Item | Disposition | Reason |
|---|---|---|
| v1 Phase 1 — low-cap **Anthropic** workspace key on the phone | **Retired by the Gordon switch** | Moving off Anthropic means no phone-resident Anthropic key to cap. Only revisit if Anthropic is kept as a fallback. |
| **FS-BE-01** — Anthropic key sent from the browser | **Largely retired for the Gordon path** | With Gordon, the browser calls the Tailscale endpoint, not `api.anthropic.com`. New surface = securing the Ollama/Tailscale endpoint (SECURITY-PLAN.md local-model section). Keep the browser-key concern only for any retained Anthropic fallback. |
| **FS-UI-02** — remove-saved-key control | **Folded into Phase 2** | Becomes "manage the Gordon endpoint / clear any stored fallback key." |
| **FS-BE-02** — shared-origin localStorage across all three apps | **Integration review** | Cross-app property; audit whether all three namespace keys and never `localStorage.clear()`. |
| **FS-BE-05** — privacy guard keyed on `where` prefix | **Integration review (process guard)** | Correct today; ensure any new `logProblem('<prefix>:',detail)` updates `isThirdPartyContent` in the same PR. |
| **FS-BE-04** — no minification (single-file arch) | **Accepted** | Deliberate; service-worker cache-first makes payload a one-time cost. |

## 8. Holes, answered

- **"Just move the Gmail token to a header."** Impossible without abandoning JSONP (Apps Script CORS). Plan does what the constraint allows.
- **"The Gordon default might point at an endpoint that isn't always up."** Exactly why Phase 2 is a decision gate: Logan supplies the real Tailscale URL/model, and we decide fallback behavior (Anthropic fallback vs. graceful "Gordon offline — works by hand"). The app already has offline-safe messaging (recipe app `aiHelper.ts:237` "make sure the machine is awake and Tailscale is connected").
- **"Copy changes could drift from behavior."** Reword in the same PR that changes the default, and let the AI-capability disclosure list (`js/ai-actions.js`) — which a test pins to the code — stay the source of truth.

## 9. Handoff shape

Each code phase ends with `node tests.js`, then `node tools/preview.js` for anything visual, then the one-paste PowerShell block (`Set-Location` + guard → `node tests.js` gated on `$LASTEXITCODE` → `git add -A` → commit → push), with the `index.html` version stamp + `sw.js` CACHE bump the deploy guard requires, and an explicit "gmail-watcher.gs changed — re-paste it" note whenever Phase 4 ships. The recipe-app default-provider change (Phase 2.1) ships from the recipe repo with its own `npm run verify`.

## 10. Sources

- OWASP — [Information exposure through query strings in URL](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url)
- NN/g — empty-state / first-use onboarding guidance
- OpenTelemetry GenAI / Sentry data-model conventions (diagnostics = failures, not expected states) — as cited in FlyerSnap's own ERROR-LOGGING-STANDARD.md
- Ollama / Tailscale: FlyerSnap `LOCAL-MODEL-PLAN.md`, `CLAUDE.md` rule 14; recipe app `GORDON-APP-WIDE-PLAN.md`, `AI-BACKEND-PLAN.md`, `src/lib/aiConfig.ts`, `src/lib/aiHelper.ts:237`
- Repo evidence (on-disk, Aug 23 2026): `index.html:4182-4184,5261-5266,5907,5924`; `gmail-watcher.gs:543-549,569`; `js/errorReport.js`; recipe app `src/lib/aiConfig.ts:28`
