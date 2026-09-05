# "The local model did not answer" — research, diagnosis, fixes

Written 4 Sep 2026 against v10.7. Logan reported Anthropic being used while
Ollama was running on his desktop, and the toast wording identified the branch:
**"Read by Anthropic instead — your local model did not answer"** — so not a
sign-in problem, not a PDF, not rate limiting.

Researched from Ollama's docs, its `main`-branch **source**, and its issue
tracker before any code was written. Several behaviours that matter here are
**not documented anywhere** and were read out of the source; those are marked.

---

## 1. What the research established

| Fact | Source |
|---|---|
| Default context is VRAM-dependent (**4k under 24 GiB**), not the flat 4096 the FAQ still claims | [docs.ollama.com/context-length](https://docs.ollama.com/context-length) vs the stale [faq.mdx](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) |
| **`num_ctx` cannot be set per-request on `/v1/chat/completions`** — Modelfile, `OLLAMA_CONTEXT_LENGTH`, or native `/api/chat` only. PR #6137 closed unmerged | [PR #6137](https://github.com/ollama/ollama/pull/6137), `openai/openai.go` |
| Context overflow **truncates silently from the front**; the log line is `slog.Debug` only | [server/prompt.go](https://github.com/ollama/ollama/blob/main/server/prompt.go), [issue #14259](https://github.com/ollama/ollama/issues/14259) |
| **`keep_alive` cannot be set on the OpenAI endpoint either.** Default 5 minutes | `openai/openai.go` (no `keep_alive` anywhere), [faq.mdx](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) |
| Cold loads have **no documented upper bound** — `OLLAMA_LOAD_TIMEOUT=5m` is a *stall* detector, not a total budget | `envconfig/config.go` |
| Image data-URI prefixes are an **exact, case-sensitive allowlist**: `{jpeg,jpg,png,webp}` or bare `data:;base64,`. Anything else is a 400 `invalid image input` | `openai/openai.go` `decodeImageURL` |
| **Images below 32px in either dimension PANIC qwen3-vl** — `SmartResize`, `imageprocessor.go` | [#13044](https://github.com/ollama/ollama/issues/13044), [#13113](https://github.com/ollama/ollama/issues/13113), both closed |
| `/api/ps` returns a per-model **`context_length`** *and* tells you what is resident | [docs.ollama.com/api/ps](https://docs.ollama.com/api/ps) |
| A client/proxy-cancelled request logs **HTTP 499** server-side and looks like a network error client-side | `server/routes.go` |

**Sceptical note, recorded because it is widely repeated and wrong:** blogs claim
context overflow returns an empty response. It does not — the documented
behaviour is silent truncation. No primary source supports the empty-response
claim.

## 2. What the audit found in THIS app

Ranked by how likely each is to be Logan's actual symptom.

1. **Cold load against a 180-second abort.** `index.html:5341` aborts at
   180000 ms. The model is ~9.8 GB and shares one 14.4 GiB card with the recipe
   app, so a switch between apps evicts and reloads ~9 GB. `keep_alive` defaults
   to 5 minutes and the app cannot raise it from this endpoint. No streaming, no
   warmup, no retry — one attempt, cold, against a fixed ceiling.
2. **The `/api/ps` probe is inert exactly when it matters.** A cold model is not
   in `/api/ps`, so the fit check returns `null` and disables itself in the
   scenario it was built for.
3. **HEIC can reach the endpoint.** `readImageDownscaled` re-encodes to JPEG
   through a canvas, but its `catch` falls back to `file.type` — and that catch
   fires precisely when the browser could not decode the file, which on iOS is
   exactly when it is HEIC. **The fallback is self-selecting for the one format
   Ollama refuses.**
4. **The self-test's own vision check sent a 1×1 PNG** (`TINY_PNG`), below the
   32px panic floor. So it reported *"Vision works: false"* on a server whose
   vision was fine.
5. **A client timeout and a proxy cut are indistinguishable** and give opposite
   advice; the elapsed-ms figure that would separate them is already captured
   and unused.

## 3. Fixed in v10.8

- **`TINY_PNG` is now a 64×64 disc**, not a 1×1. Rule 28: the instrument must
  not be the thing that is wrong. A guard reads the PNG's IHDR out of the
  shipped file and asserts both dimensions clear `MIN_IMAGE_PX`.
- **The image media type is checked against Ollama's allowlist** before sending.
  Case and stray media-type parameters are normalised (our job to fix); anything
  genuinely outside the list throws `UNSUPPORTED_BLOCK:<type>`, which the app
  already knows how to explain, instead of a bare 400.
- **A size floor on the re-encode.** `readImageDownscaled` had a ceiling and no
  floor. Scaling a 20px strip up is not useful, but it is far more useful than a
  request that cannot be answered.
- **`modelIsLoaded()`** — the app was already fetching `/api/ps` and reading only
  `context_length`, discarding whether anything was resident. A **missing** list
  and an **empty** list are deliberately different answers: empty means asleep,
  missing means "could not tell", and reporting the second as the first would be
  inventing a fact.
- **A new self-test stage, "Model is loaded right now"**, reporting cold with the
  fix (`OLLAMA_KEEP_ALIVE=-1`). Reported as a pass, not a failure — a red row
  for "the model is asleep" would train people to ignore red rows.
- **The self-test is now reachable from Settings → Gordon and AI.** It lived at
  the bottom of "When something goes wrong", which is where Logan did not look.
  A screen the a11y audit reaches by setting `view` directly is not a screen
  anyone can find.

### Tests: 926 from 922. Browser checks: 27 from 26. Eight mutations.

**L4 came back green** — removing the size floor broke nothing, because
`readImageDownscaled` uses `Image` + `canvas` and the vm harness cannot reach it
at all. A browser check now pushes a real 8×8 PNG through the real function and
asserts what comes back, plus the other direction: an ordinary 800×600 photo
must **not** be resized, so the floor cannot become a resize of everything.

## 4. Still to do, and it needs the desktop

None of the above fixes the leading suspect, because the fix is **server-side**:

- `OLLAMA_KEEP_ALIVE=-1` keeps the model resident and removes the cold load
  entirely. This is the single highest-value change and the app cannot make it.
- `OLLAMA_CONTEXT_LENGTH=16384` if `/api/ps` reports 4096 — the app's own advice
  already names this.
- Check whether the proxy allowlists `/api/ps`; if not, every local call pays a
  5-second dead wait before it starts.

**Run the self-test first** (Settings → Gordon and AI → "Check Gordon is
working"). Stage 2b now says whether the model was asleep, which is the fact
that decides all of this.
