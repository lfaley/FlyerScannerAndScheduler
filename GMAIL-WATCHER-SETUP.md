# Gmail Watcher — Complete Setup

Written assuming no prior experience with Google Apps Script. Every step ends with a **✅ Checkpoint** telling you exactly what you should see. If one fails, jump to [Troubleshooting](#troubleshooting).

**Total time:** about 20 minutes, once.

---

## What this actually does

A small script lives in *your own* Google account. Every 15 minutes it:

1. Searches Gmail for mail from senders you list (and nothing else)
2. Reads the body text and any PDF attachments of anything new
3. Sends that to the Claude API and asks for dates, times, and deadlines
4. Holds the results in a small queue

FlyerSnap fetches that queue when you open it and drops anything new into the same review checklist you already use.

**Why this is worth the setup:** ParentSquare's emails contain the post text in the body. Reading the email means never touching their login wall — the thing that made "copy the link" a dead end.

**What it never does:** send, reply, delete, or modify anything. Read-only.

**Why no OAuth circus:** you're authorising your own script inside your own account. No Google verification, no security assessment, no domain, no server, no cost beyond a penny or two of Claude credit per email.

---

## Before you start

You need:

- A Gmail account receiving the flyers
- Your Anthropic API key (`sk-ant-…`) from console.anthropic.com
- `gmail-watcher.gs` — it's in your repo folder at `C:\Users\Logan\Desktop\Repos\FlyerAndScheduler\flyersnap-pwa\`
- FlyerSnap v1.8 or later installed (Settings shows the version at the bottom)

---

## Step 1 — Create the script

1. Go to **script.google.com**
2. Click **New project**
3. Click the project name at the top left (it says "Untitled project") and rename it to **FlyerSnap Watcher**
4. In the editor, select the sample `function myFunction() {}` and delete it
5. Open `gmail-watcher.gs` in Notepad, select all (Ctrl+A), copy (Ctrl+C)
6. Paste into the editor
7. Click the 💾 save icon

**✅ Checkpoint:** roughly 250 lines, starting with a comment block that says `FlyerSnap Gmail Watcher`.

---

## Step 2 — Generate a secret token

This stops anyone who stumbles on your endpoint URL from reading your data. In PowerShell:

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

Copy what it prints somewhere temporary. You'll paste it twice — once here, once into FlyerSnap.

**✅ Checkpoint:** a 32-character string of random letters and numbers.

---

## Step 3 — Add your three settings

In the Apps Script editor:

1. Click **⚙️ Project Settings** in the left sidebar
2. Scroll to **Script Properties**
3. Click **Add script property**, then add these three (click "Add script property" again between each):

| Property | Value |
|---|---|
| `CLAUDE_KEY` | your `sk-ant-…` key |
| `SECRET` | the random string from Step 2 |
| `SENDERS` | `parentsquare.com, j31.com` |

4. Click **Save script properties**

`SENDERS` is a comma-separated list of domains or full addresses. Add or change them here any time — no code editing. Use the sender address you see on a real email, not the school's website domain.

**✅ Checkpoint:** three rows listed under Script Properties.

---

## Step 4 — Test the setup

1. Go back to the **Editor** (the `< >` icon in the left sidebar)
2. In the function dropdown at the top (it probably says `checkMail`), choose **testSetup**
3. Click **▶ Run**
4. Google will ask for permission:
   - **Review permissions** → choose your Google account
   - You'll see **"Google hasn't verified this app"** → click **Advanced** → **Go to FlyerSnap Watcher (unsafe)** → **Allow**

That warning is expected and correct. It's your own script; you are authorising yourself. Google shows this for any personal script that reads Gmail.

**✅ Checkpoint:** the Execution log (bottom panel) says `Setup looks good`, prints the search query, and shows how many matching threads it found in the last 7 days.

> **If it says 0 matching threads:** your `SENDERS` domains don't match reality. Open a real flyer email, look at the actual sender address (e.g. `notifications@parentsquare.com`), and use that domain.

---

## Step 5 — Do a real run

1. Function dropdown → **checkMail**
2. Click **▶ Run**

This is the first run that spends money — a penny or two per email.

**✅ Checkpoint:** the log reads something like:

```
Scanned 4 threads, sent 4 to Claude, added 6 events. Queue: 6. Calls today: 4/80
```

That's the moment of truth. If it added events, Claude is successfully reading your flyers out of email bodies.

> **If it added 0 events from real flyer emails**, the emails may be image-only or link-only with no readable text. Check the log for `Skipped` or `GIVING UP` lines.

---

## Step 6 — Deploy the endpoint

This gives FlyerSnap a URL to fetch from.

1. Click **Deploy** (top right) → **New deployment**
2. Click the ⚙️ gear next to "Select type" → choose **Web app**
3. Fill in:
   - **Description:** anything, e.g. "v1"
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy**
5. Authorise again if prompted
6. **Copy the Web app URL** — it ends in `/exec`

**"Anyone" sounds alarming.** It means anyone *with the URL*. The URL is a long unguessable string, and the script returns `{"error":"unauthorized"}` to anything without your secret token. Apps Script has no other way to let a browser fetch from it without a full Google sign-in flow.

**✅ Checkpoint:** you have a URL like `https://script.google.com/macros/s/AKfycb…/exec`

---

## Step 7 — Set the 15-minute trigger

This is what makes it a watcher rather than a button.

1. Click **⏰ Triggers** in the left sidebar
2. Click **Add Trigger** (bottom right)
3. Set:
   - **Choose which function to run:** `checkMail`
   - **Select event source:** `Time-driven`
   - **Select type of time based trigger:** `Minutes timer`
   - **Select minute interval:** `Every 15 minutes`
4. **Save**

It now runs on Google's servers whether your phone is on, off, or in a lake.

**✅ Checkpoint:** one trigger listed, function `checkMail`, type Time-driven.

---

## Step 8 — Connect FlyerSnap

1. Open FlyerSnap on your phone → **Settings** tab
2. Scroll to **Gmail watcher**
3. Paste the **Web app URL** from Step 6
4. Paste the **Secret token** from Step 2
5. Tap **Save**, then tap **Test**

**✅ Checkpoint:** a popup saying **Connected!** with the last run time and how many events are waiting.

Now go to the **Events** tab. If the queue has anything, a green banner reads **📧 N new events from your email**. Tap **Review** and they land in the normal checklist — tick what you want, tag a kid, Track.

---

## Living with it

- It checks every 15 minutes. FlyerSnap quietly picks up new results when you open it, at most once every 20 minutes, so it's never chatty.
- **Add Paperwork → 📧 Check my email now** forces a check on demand.
- **Emails are only marked handled once you've actually reviewed them.** Abandon the review screen and they'll be waiting next time.
- Already-tracked events show a `TRACKED` tag and come pre-unticked, so a flyer arriving twice doesn't create duplicates.
- To watch a new sender, add it to `SENDERS` in Script Properties. No redeploy needed.

### Cost controls

The script has three hard caps so it can't quietly run up a bill:

| Guard | Value | Why |
|---|---|---|
| `MAX_PER_RUN` | 12 messages | One run can't chew through a backlog at full speed |
| `MAX_TRIES` | 3 attempts | A message that can't be parsed is abandoned instead of retried forever |
| `DAILY_CALL_CAP` | 80 calls/day | Absolute ceiling; stops until tomorrow |

Change them at the top of the script if you want.

**To check spend:** function dropdown → **watcherStatus** → Run. It logs calls used today, queue size, last run, and anything currently retrying.

---

## Troubleshooting

**"Google hasn't verified this app"** — expected. Advanced → Go to … (unsafe) → Allow. It's your script.

**testSetup logs `PROBLEMS: CLAUDE_KEY is missing`** — the script properties didn't save. Redo Step 3 and confirm three rows are listed.

**0 matching threads** — `SENDERS` doesn't match the real sender address. Open a flyer email and check the actual `From:` domain.

**`Claude API 401`** — bad or revoked key. Make a new one at console.anthropic.com and update `CLAUDE_KEY`.

**`Claude API 400` mentioning credit** — your Anthropic account is out of credit.

**FlyerSnap's Test says "Token rejected"** — the secret in FlyerSnap doesn't match `SECRET` in Script Properties. Watch for a trailing space.

**FlyerSnap's Test says a network error, not a token error** — this is the known rough edge. Apps Script redirects `/exec` to a different Google host, and browsers occasionally refuse the cross-origin hop. If this happens, tell me and I'll switch the app to a JSONP-style call that sidesteps CORS entirely.

**Test says "Last script run: never"** — the trigger isn't set. Redo Step 7.

**Log shows `GIVING UP on … after 3 tries`** — that message will never parse (usually a huge or malformed attachment). It's been abandoned on purpose so it stops costing money. Everything else keeps working.

**Log shows `Hit DAILY_CALL_CAP`** — 80 calls today. It resumes tomorrow. If you hit this regularly, something's looping — run `watcherStatus` and check what's retrying.

**Want to start over** — function dropdown → **resetWatcher** → Run. Clears the queue, the seen-history, failures, and the daily counter. The next run re-scans the last 7 days (and re-spends on them).
