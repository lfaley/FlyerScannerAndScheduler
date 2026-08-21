# Adding a vision model so FlyerSnap can read flyers locally

Written for someone who has never pulled an Ollama model before. Every step has a
check so you know it worked before moving on. Do them in order.

---

## Why you need this at all

Your Ollama server currently runs `qwen2.5:14b-instruct`. That is a **text-only**
model. It has no eyes. Send it a photograph and it cannot see the photograph --
not "sees it badly", but has no mechanism to receive it at all.

FlyerSnap's whole scanner is images: flyer photos, PDF pages, recipe photos. So
without a vision model, switching FlyerSnap to local breaks the scanner
completely. Email extraction still works (that is text), but photographs do not.

A **vision-language model (VLM)** pairs a vision encoder with a language model,
so it can take an image and text in the same request.

---

## Step 0 -- know your task before picking a model

This matters, and it is where most people choose wrong.

There are two very different image jobs, and models are good at different ones:

| Job | Example | What it needs |
|---|---|---|
| **Captioning / labelling** | "there is a dog on a beach" | scene understanding |
| **Document OCR / structured extraction** | reading a dance schedule grid | text and layout accuracy |

**Yours is the second one, entirely.** You are reading dense text, tables and
dates off paper. Choose for OCR and document parsing, not for captioning.

This distinction explains an apparent contradiction you may run into online. One
benchmark rates `qwen2.5vl:7b` as *"the weakest general labeler measured (56%
coverage, 1.4 labels per image) despite being a capable captioner"* -- but that
test was labelling photographs of wildlife and vehicles. On *documents*, the same
family is the leader. Do not let a labelling benchmark talk you out of the right
document model.

---

## Step 1 -- find out how much VRAM you have

The model must fit in your graphics card's memory. This determines everything.

**On the Windows desktop running Ollama:**

1. Press `Ctrl + Shift + Esc` to open Task Manager
2. Click **Performance** in the left sidebar
3. Click **GPU 0** (if you have more than one GPU, check each)
4. Read **Dedicated GPU memory** -- e.g. "8.0 GB"

Write that number down. If you cannot find it, open Command Prompt and run:

```
nvidia-smi
```

The top-right of the table shows total memory like `8192MiB`. (This command only
works on NVIDIA cards. If it is not recognised, you likely have AMD or Intel
graphics -- Ollama will run on CPU instead, which works but is much slower.)

✅ **Check:** you have a number in GB.

---

## Step 2 -- pick your model

Leave 2-3 GB of headroom. A model that *just barely* fits will swap and crawl.

| Your VRAM | Pull this | Why |
|---|---|---|
| **6 GB** | `qwen3-vl:8b` | Best OCR at this size |
| **8-12 GB** | `qwen2.5vl:7b` | ~6 GB, excellent document/table parsing |
| **16 GB+** | `qwen3-vl:8b` or `llama3.2-vision` | More headroom, better quality |
| **Under 4 GB** | `moondream` | Limited, but functional |

**The evidence for Qwen over Llama on your task**, since this is the choice that
matters most: on **DocVQA** -- the benchmark for reading documents -- Qwen2.5-VL
7B scores **95.7** against Llama 3.2 Vision's **86.6**, despite being the smaller
model. One reviewer puts it plainly: *"If document reading is your main use, Qwen
wins."* Another ranks OCR quality as **Qwen3-VL 8B ≈ MiniCPM-V 4.5 > Llama 3.2
Vision 11B > LLaVA 1.6**.

Qwen2.5-VL also explicitly supports *"structured outputs of their contents"* for
*"scans of invoices, forms, tables"* -- which is precisely what FlyerSnap asks
for (JSON out of a schedule grid).

**I recommend `qwen2.5vl:7b`** unless you have 16 GB+, in which case try
`qwen3-vl:8b` first.

---

## Step 3 -- check your Ollama version, and upgrade

This is a real trap. Newer vision models need newer Ollama, and **the vision half
of a model needs explicit runtime support that lands later than text support**.

Open Command Prompt on the desktop:

```
ollama --version
```

- For `qwen3-vl` you need **0.12.7 or newer**.
- For `qwen2.5vl` any recent version is fine.

If you need to upgrade, download the installer from
**https://ollama.com/download** and run it. It upgrades in place; your existing
models stay.

✅ **Check:** `ollama --version` prints a version at or above what your chosen
model needs.

---

## Step 4 -- pull the model

In Command Prompt:

```
ollama pull qwen2.5vl:7b
```

This downloads roughly 6 GB. It will take a while on a normal connection. You
will see a progress bar.

✅ **Check:** run `ollama list` -- your model appears in the table alongside
`qwen2.5:14b-instruct`. Both can coexist; pulling one does not remove the other.

---

## Step 5 -- prove it can actually see

Do not skip this. Test at the command line *before* involving FlyerSnap, so that
if something fails you know which half is broken.

1. Put a photo of a real flyer on the desktop, e.g. `C:\Users\Logan\Desktop\flyer.jpg`
2. Run:

```
ollama run qwen2.5vl:7b "Read every date and time on this image. C:\Users\Logan\Desktop\flyer.jpg"
```

✅ **Check:** it describes actual text from your flyer.

❌ **If it says it cannot see an image**, the vision path is not wired up. Try
`qwen2.5vl:3b-fp16` as a fallback -- that FP16 variant is the documented
workaround when the standard build misbehaves.

---

## Step 6 -- make it reachable over the network

Two settings on the desktop. Both come from your recipe app's setup notes, and
the first is described there as *"the #1 gotcha"*.

**6a. Bind to all interfaces.** If Ollama binds only to `127.0.0.1`, it returns
**403 Forbidden** to every request that does not come from the machine itself --
which is every request through Tailscale.

In Command Prompt:

```
setx OLLAMA_HOST "0.0.0.0"
```

**6b. Allow FlyerSnap's origin** so the browser's CORS check passes:

```
setx OLLAMA_ORIGINS "https://lfaley.github.io"
```

**Then reboot the machine.** `setx` writes the variable permanently but does not
apply it to already-running processes, and Ollama runs as a background service.
A reboot is the reliable way to have both take effect.

✅ **Check after reboot:** from another device on your tailnet, open a browser to
`https://<MACHINE>.<TAILNET>.ts.net/v1/models`. You should see JSON listing your
models. A 403 means 6a did not take.

---

## Step 7 -- point FlyerSnap at it

On your phone, in FlyerSnap:

1. **Settings → AI model**
2. Tap **🏠 Local model**
3. **Base URL:** the `https://<MACHINE>.<TAILNET>.ts.net/v1` address from the
   recipe app's Admin panel. It must be `https://` -- a page served over HTTPS
   cannot call a plain `http://` address (browsers block mixed content), and it
   must be the Tailscale hostname, not an IP.
4. **Model:** `qwen2.5vl:7b`
5. Leave **Fall back to Anthropic if the desktop is offline** ticked
6. **Save**, then **Test**

✅ **Check:** the Test dialog shows the model answering.

---

## Step 8 -- the real test

Scan an actual flyer through FlyerSnap and compare against what Anthropic
produced for the same flyer.

**Be prepared for the first call to take up to a minute** -- the model is loading
into VRAM. Later calls are fast. FlyerSnap allows three minutes before giving up.

Judge it on three things specifically:

1. **Did it find every date**, or did it miss some?
2. **On a schedule grid, did it produce one item per cell**, or collapse the week
   into one entry?
3. **Did it invent anything** -- a date or time not on the page? This is the
   failure that matters most, because a wrong date in your calendar is worse than
   a missing one.

If it fails on #3 in particular, switch back to Anthropic for scanning and keep
local for email text. The provider switch is one tap; nothing is lost.

---

## Prompting tips that measurably help

From the practitioner guidance, and applicable to FlyerSnap's prompts:

- **Be specific about the output.** "List all text in this image, preserving the
  original formatting" beats "describe this image". FlyerSnap already does this.
- **Ask for the format explicitly** -- "return it as a JSON array with column
  names as keys". Already done.
- **Crop when the target is small.** A 500x300 crop of a table is read more
  accurately than the same table occupying 5% of a 3000x2000 photo. So photograph
  the *schedule*, not the whole page.
- **Prefer Qwen2.5-VL or MiniCPM-V over LLaVA for OCR-heavy work** -- they were
  trained for it.

---

## Honest expectations

A 7B local model will not match Claude on the hardest extractions. That dance
schedule -- merged cells, three sessions per day, times inside cells -- is a hard
document, and we needed several rounds to get it right *with* a frontier model.

Where local will do well: simple flyers, one-page notices, clear printed text,
and all email extraction (that is text, so even your existing 14B text model
handles it).

Where it may struggle: dense grids, handwriting, low-contrast photos, and any
case where a subtle misread produces a wrong date rather than an obvious failure.

That is exactly why the fallback toggle exists, and why FlyerSnap's review screen
shows you every extracted item before anything is saved. Keep that habit.

---

## Quick reference

```
ollama --version                    # check version first
ollama pull qwen2.5vl:7b            # ~6 GB download
ollama list                         # confirm it is there
ollama run qwen2.5vl:7b "Read the dates. C:\path\to\flyer.jpg"

setx OLLAMA_HOST "0.0.0.0"          # then REBOOT
setx OLLAMA_ORIGINS "https://lfaley.github.io"
```

**Links**
- Ollama download: https://ollama.com/download
- Vision model list: https://ollama.com/search?c=vision
- Qwen2.5-VL model page: https://ollama.com/library/qwen2.5vl
- Qwen3-VL model page: https://ollama.com/library/qwen3-vl
