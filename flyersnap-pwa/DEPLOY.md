# FlyerSnap PWA — Deploy to GitHub Pages (Zero Experience Required)

This gets FlyerSnap onto your iPhone home screen as a real app icon — no Apple fee, no Expo Go, no computer needed after setup. Every step ends with a **✅ Checkpoint**.

You already have GitHub Pages set up, so this is short.

## Step 1: Put the files in a repo

You need these 5 files in a GitHub repository (all in the same folder):

```
index.html
manifest.json
sw.js
icon-192.png
icon-512.png
```

Two ways to do it:

**Easy way (browser only, no git commands):**
1. Go to github.com → your repositories → **New** (or use an existing Pages repo)
2. Name it `flyersnap` → Create
3. On the repo page, click **Add file → Upload files**
4. Drag all 5 files in → **Commit changes**

**Git way (if the repo is cloned on your computer):** copy the 5 files in, then `git add . && git commit -m "FlyerSnap PWA" && git push`

**✅ Checkpoint:** The repo page on github.com shows all 5 files.

## Step 2: Turn on Pages for this repo (skip if using an existing Pages repo)

1. In the repo: **Settings → Pages**
2. Under "Build and deployment", Source: **Deploy from a branch**
3. Branch: **main**, folder: **/ (root)** → Save

**✅ Checkpoint:** After 1–2 minutes, the Pages settings screen shows "Your site is live at `https://<username>.github.io/flyersnap/`". Refresh the settings page if you don't see it yet.

## Step 3: Open it on your iPhone

1. Open **Safari** (must be Safari — Chrome on iOS can't install PWAs)
2. Go to `https://<username>.github.io/flyersnap/`

**✅ Checkpoint:** You see the FlyerSnap home screen — green header, bottom tabs (Events, Chores, Lists, Meals, Settings).

## Step 4: Add it to your home screen

1. Tap the **Share** button (square with up arrow)
2. Scroll down → **Add to Home Screen** → **Add**

**✅ Checkpoint:** A FlyerSnap icon (green camera) is on your home screen. Open it — it launches full screen with no Safari address bar, like a real app.

> **Important:** always use the home-screen icon from now on, not the Safari tab. The home-screen version has its own separate storage, and iOS protects it better.

## Step 5: Set it up

1. Open the app → **Settings** tab
2. Paste your Anthropic API key (from console.anthropic.com) → Save
3. Add your kids
4. Go to **Events** → **＋ Add paperwork** → snap a flyer

**✅ Checkpoint:** Claude extracts the events, you pick which to track, and they appear on the Events tab.

## Step 6: Understand reminders (important!)

A web app can't schedule its own notifications, so FlyerSnap uses your iPhone's Calendar instead:

1. Tap any tracked event → choose **Add to calendar**
2. A small `.ics` file downloads — Safari shows it in Downloads (tap the ⬇ icon near the address bar, or find it in the Files app)
3. Tap the file → iPhone opens it in Calendar → tap **Add All**

The event lands in your calendar **with alerts already attached**: deadlines get alerts 7, 3, and 1 days before plus day-of; events get 2 days before plus day-of. The Calendar app delivers these — 100% reliable.

**✅ Checkpoint:** The event shows in your iPhone Calendar, and opening it shows multiple alerts configured.

## Updating the app later

Push a new `index.html` to the repo (or upload it via the browser). Next time you open the app, it picks up the new version automatically. That's the whole update process.

## Backups (do this monthly)

Settings → **Export backup** downloads a JSON file with everything (events, kids, chores, stars, lists, meals, recipes). Keep a couple in iCloud Drive. If the phone ever clears browser data, **Restore** puts it all back. Note: clearing Safari website data in iPhone Settings will wipe the app's storage — the backup is your safety net.

## Troubleshooting

**"Add to Home Screen" is missing** — you're in Chrome or a private tab. Use regular Safari.

**Extraction fails with "API error 401"** — bad/revoked key. Make a new one at console.anthropic.com.

**Extraction fails with a CORS or network error** — check the key was saved (Settings should say "A key is saved on this device").

**The .ics file won't open** — find it in the Files app → Downloads, and tap it from there.

**App shows old version after an update** — close the app fully (swipe up) and reopen; the service worker fetches fresh files on each launch.

**Everything vanished** — Safari data was cleared. Settings → Restore → pick your latest backup file.


---

## What's new in v1.1

**Calendar export got better.** On your iPhone, "Add to calendar" now opens the **share sheet** — pick Calendar (or Files) directly instead of hunting in Downloads. And the Events tab has an **"Export all to calendar"** button that puts every upcoming event into one file: one download, one "Add All", done.

**Editing.** Tap any event → Edit to fix a title, date, time, location, kid, or type — useful when Claude misreads a blurry flyer. There's also a ✏️ on each item on the review screen before you save. If you change an event's date or time after exporting it, the 📆 mark clears so you know to re-add it to the calendar.

**Smarter capture.** Scanning the same flyer twice no longer creates duplicates — already-tracked items show a TRACKED tag and come unchecked. Multi-page flyers: use "＋ Scan another page" on the review screen, or select several photos at once from your library.

**Chores & stars.** "Anyone" chores now ask *who did it* so the stars go to the right kid. The Rewards screen has a 📜 History button showing every star earned and spent — the referee for "I definitely had 12 stars."

**Housekeeping.** Past events collapse into a "Past events" section instead of vanishing. The app asks iOS for protected storage, and nudges you if you haven't backed up in 30 days.
