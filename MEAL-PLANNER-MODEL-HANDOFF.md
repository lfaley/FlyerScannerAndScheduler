# Handoff to the meal-planner agent — the shared Gordon model is wrong

**From the FlyerSnap session · 24 Aug 2026 · Logan asked me to bring this over.**

Symptom Logan reported: **"Gordon is really slow now."** It is not the auth change
we made today. The wrong model is loaded on the shared Ollama, and the request
for it is coming from the meal planner.

---

## The evidence

Logan's Ollama server log (`%LOCALAPPDATA%\Ollama\server.log`) shows this
session has loaded **exactly one model**, with no swapping:

```
time=2026-08-24T16:05:11 msg="template selection"
  model=registry.ollama.ai/library/qwen2.5:14b-instruct
llama_context: n_ctx = 16384
CUDA0 model buffer size = 8148.38 MiB
```

`qwen2.5:14b-instruct` is **text-only and 14B**. Two consequences:

1. It is slower per token than the 8B — 8.1 GB resident vs ~6.1 GB.
2. **It cannot read images at all.** FlyerSnap's entire purpose is reading
   photos of flyers, so any request that lands while this model is loaded fails
   or falls back to Anthropic.

Three models are pulled on that machine:

| Tag | What it is |
|---|---|
| `qwen2.5:14b-instruct` | text-only 14B — **currently loaded, the problem** |
| `qwen3-vl:8b` | vision, but the **Thinking** variant — see the warning below |
| `qwen3-vl:8b-instruct-q8_0` | vision, Instruct, 9.8 GB — **the one to use** |

## Where the request comes from — your side, but not your code

`src/lib/aiConfig.ts`:

- `:37` — `export const DEFAULT_MODEL = import.meta.env.VITE_HOSTED_AI_MODEL || 'claude-sonnet-4-6'`
- `:68` — `model: safeGet(KEY_MODEL) || DEFAULT_MODEL`
- `:21` — `const KEY_MODEL = 'mealplanner-ai-model'`

There is **no `.env`/`.env.local`/`.env.production`** in the repo, and no `qwen`
string appears anywhere in `dist/`. So `VITE_HOSTED_AI_MODEL` is unset and
`DEFAULT_MODEL` is `'claude-sonnet-4-6'`.

**Therefore the `qwen2.5:14b-instruct` request is coming from
`localStorage['mealplanner-ai-model']` in Logan's browser** — a saved setting,
not a build artifact. **This is a configuration fix, not a code fix.**

## What Logan needs to do (please walk him through it in your UI)

Change the saved model in the meal planner's AI settings to exactly:

```
qwen3-vl:8b-instruct-q8_0
```

He is on a Windows desktop and uses the app in a browser. If your settings
screen has a model field, that is the place. If it does not expose one, the
value can be set directly — F12 → Console:

```js
localStorage.setItem('mealplanner-ai-model', 'qwen3-vl:8b-instruct-q8_0')
```

✅ Verify: the next AI call should load `qwen3-vl:8b-instruct-q8_0` in
`server.log`, and responses should be noticeably faster.

---

## THE RULE THAT MATTERS: both apps must request the SAME tag

FlyerSnap and the meal planner share **one Ollama behind one proxy**, on a GPU
with **14.4 GiB usable** (RTX 5060 Ti, from `inference compute` in the same log).

- `qwen2.5:14b-instruct` ≈ 8.1 GB
- `qwen3-vl:8b-instruct-q8_0` ≈ 9.8 GB

**They cannot both be resident.** If the two apps request different tags, every
switch between them forces Ollama to evict one model and load the other — an
8–10 GB reload, which is exactly the "really slow" Logan is describing, and it
would get worse, not better, once both apps are in use in the same session.

**The agreed tag should be the VISION one**, because the asymmetry is one-way:
FlyerSnap cannot work without vision, and the meal planner loses nothing by
using a vision-capable model for text. `qwen3-vl:8b-instruct-q8_0` it is.

## ⚠️ Do NOT use the bare `qwen3-vl:8b` tag

On Ollama that tag is the **Thinking** edition. Verified from Logan's own log on
22 Aug:

```
template selection model=registry.ollama.ai/library/qwen3-vl:8b
  renderer=qwen3-vl-thinking parser=qwen3-vl-thinking
```

and the manifest inherits `from: qwen3-vl:8b-thinking-bf16`.

It spends its whole token budget reasoning and emits no answer — it cost Logan
two failures of 48s and 27s. FlyerSnap has a dedicated `thinking_only` error
class because of it. **Always the `-instruct` tag.**

Related: on `/v1/chat/completions`, `think: false` is **ignored** — it is a
native `/api/chat` field and is not in Ollama's supported-field list for the
OpenAI-compatible endpoint. The field that works there is
`reasoning_effort: 'none'`. Worth checking whichever your client sends.

## Two code-level things worth fixing on your side

1. **`aiConfig.ts:29` uses the wrong model as its documented example:**

   > `VITE_HOSTED_AI_MODEL` — the Ollama model tag the proxy serves, e.g. `qwen2.5:14b-instruct`

   Anyone following that comment reproduces this exact problem. Suggest
   `qwen3-vl:8b-instruct-q8_0`.

2. **`DEFAULT_MODEL` falls back to `'claude-sonnet-4-6'`** — an Anthropic model.
   So if the saved value is ever cleared, the app silently switches provider and
   starts spending Logan's Anthropic budget rather than using the free local
   model. That may be intentional as a safety net; if so it is worth a comment
   saying so, because it currently reads like an oversight.

## What FlyerSnap is doing on its side

Shipped in **v9.37** — the tag now agrees in all four places it appears:

- **`GORDON_MODEL` is now `qwen3-vl:8b-instruct-q8_0`** (was `qwen3-vl:8b`, the
  Thinking variant). If you bake a model tag on your side, **use this exact
  string** — see the shared-model rule above.
- **The save/read asymmetry is fixed.** `saveLocalModel()` fell back to
  `'qwen2.5:14b-instruct'` while both read paths fell back to `GORDON_MODEL`, so
  saving with an empty field silently wrote the text-only model into settings.
  **Worth checking whether your settings save path has the same asymmetry** —
  it is the kind of bug that only shows up as "why is it slow".
- **The migration was making it worse**: it rewrote `qwen2.5:14b-instruct` onto
  `qwen3-vl:8b` — rescuing people from a text-only model by handing them the
  thinking one. It now targets the instruct tag and also catches anyone already
  on the bare tag.
- **The Model field's placeholder** suggested `qwen2.5:14b-instruct`. A
  placeholder is a suggestion; that one suggested the broken model.
- A guard test now pins all four together and fails if any drifts, mutation-
  tested three ways. **A similar guard on your side would be cheap insurance.**

## Not related, but same day — the proxy token

The shared `ACCESS_TOKEN` was retired today (removed from the `GordonAI` NSSM
service environment). The proxy now accepts only a Firebase ID token whose email
is on the `allowedUsers` allowlist. Your app was already sending ID tokens, so
nothing is required of you. Details in `PROXY-TOKEN-RETIRED-NOTE.md`, which also
flags that `server/README.md` still documents the retired token as the security
model.
