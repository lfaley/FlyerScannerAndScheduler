# Public keys vs. real secrets — pointer

**This is a pointer, not a copy.** The canonical ruling lives in the recipe repo:

`C:\Users\Logan\Desktop\Repos\RecipeAndMealPlanner\meal-planner-shoppin\PUBLIC-KEYS-POLICY.md`

It is canonical there because that repo owns `firestore.rules` — the thing that actually
enforces access — and because two "canonical" copies drift. Do not paste the contents
here; update that file instead.

---

## The 30-second version for this repo

This repo publishes the Firebase Web API key for project `meal-planner-f7f2f`:

```
AIzaSyAp87MmFWuWQmHdJKPJ-i1UNOMXg-my5ho
```

at `js/errorReport.js:27` (`ERROR_REPORT_KEY`) and `index.html:962` / `:6941`
(`FB_API_KEY`). That is correct and intentional. Per
[Firebase's documentation](https://firebase.google.com/docs/projects/api-keys), API keys
for Firebase services "are OK to include in code or checked-in config files", and
security "is enforced using Firebase Security Rules … not by keeping your Firebase API
key secret."

**GitHub secret-scanning alert #1 on this repo flags exactly this key and is a false
positive.** Its printed remediation advice — *"rotate the secret" / "revoke this Google
API Key"* — must **not** be followed: it would break sign-in and Firestore in both this
app and the recipe app, and the replacement would be published in the next deploy.

Verified 2026-08-31: the key is restricted to `Websites` with four referrers
(`lfaley.github.io/*`, `localhost/*`, `meal-planner-f7f2f.firebaseapp.com/*`,
`meal-planner-f7f2f.web.app/*`) and to 25 Firebase-only APIs. No billable general Google
API is reachable with it.

A **genuine** leak in this repo would look like a `sk-ant-…` / `sk-…` provider key, a
`"type": "service_account"` blob, a `-----BEGIN PRIVATE KEY-----` block, or a `ghp_` /
`github_pat_` token. A sweep on 2026-08-31 found none — the only `sk-ant-…` matches are
the deliberate fake fixtures in `tests-modules.js` that prove the log redactor works.

Related: `PROXY-TOKEN-RETIRED-NOTE.md` in this repo covers the Gordon proxy's shared
`ACCESS_TOKEN`, which *was* a real secret, was published in `index.html`, and was
therefore **retired rather than rotated** on 2026-08-24.
