# The API key outlives its own removal — plan

Status: **built as v9.90.** See section 5.
Written 31 Aug 2026 against **v9.89**. Covers review item **D6**, plus one finding
the review missed that is larger than D6.

---

## 1. Measured, not read

The four functions were executed in a sandbox loaded from the shipped
`index.html`, with a known key planted in `S.settings.apiKey`.

**My first probe reported all-clear and was wrong.** It set `box.S = ...`, but `S`
is a lexical `let` inside the script, so that created a different variable and
every check came back "no key found" — a false all-clear on a security question.
The corrected probe leads with a control that must read `true` before any other
line is believed:

```
sanity: the LIVE blob contains the key: true   <- must be true or the probe is lying

--- 1. a DOWNLOADED BACKUP ---
   flyersnap-backup-*.json contains the key: true

--- 2. a ROLLING SNAPSHOT ---
   flyersnap-snap-2026-08-31 contains the key: true

--- 3. after "Remove key from this device" ---
   live blob still has it: false
   flyersnap-snap-2026-08-31 still has it: true
```

### E1 — HIGH · The exported backup file contains the key

**Not in the review.** `exportBackup` writes `JSON.stringify(S, null, 1)`, and `S`
carries `settings.apiKey`. So `flyersnap-backup-2026-08-31.json` — a file whose
whole purpose is to leave the phone, into email, iCloud, a laptop's Downloads
folder, a shared drive — contains an Anthropic API key in plain text.

Nothing in the app says so. The Backup screen offers "Export backup" with no
mention that the file is credential-bearing.

This is a bigger exposure than D6: a snapshot stays in one browser's storage on
one device; a backup file is *designed* to travel.

### E2 — MEDIUM · The rolling snapshots contain the key (D6)

`snapshot()` copies the live blob verbatim into `flyersnap-snap-<date>`, up to
`SNAP_KEEP` (3) of them, and Settings → Backup offers to restore any of them.

### E3 — MEDIUM · "Remove key from this device" does not remove it (D6)

`removeKey` blanks `S.settings.apiKey` and saves. The live blob is clean; **the
snapshots are not**, and each is one tap from being restored. The function's own
docblock says *"the entire point here is that the value stops existing."*

Worse, `snapshot()` runs **inside** `save()`. If the newest snapshot is more than
24 hours old, the act of removing the key snapshots the previous blob — so
tapping "remove" can *create* a fresh archived copy of the key it claims to erase.
That ordering is confirmed by reading `save()`; I have not yet built a fixture
that exercises that specific 24-hour window, and will before claiming it as a
reproduced case.

---

## 2. Grounding

OWASP's Secrets Management Cheat Sheet, on revocation: *"Secrets revoked/rotated
must be removed from the exposed system immediately, including secrets discovered
in code or logs."* The principle is that revocation is not a flag flipped in one
place; it is the removal of every copy.
([OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html))

I looked for a documented precedent for excluding secrets from a settings export
and **did not find one I can honestly cite** — the VS Code Settings Sync docs do
not state whether tokens are included. So the recommendation below rests on the
OWASP principle plus the app's own stated intent, not on an industry example I
could not verify.

---

## 3. The fix, and the one question in it

Prevention beats cleanup: a copy that is never written needs no purge.

1. **`redactedState()`** — the state with `settings.apiKey` blanked. Both
   `exportBackup` and `snapshot()` write *that* instead of `S`. No new snapshot or
   backup ever carries a key again.
2. **A one-time sweep** of snapshots already on the device, written by earlier
   versions. Parse, blank, re-stringify; on **any** throw, leave that snapshot
   exactly as it was — a snapshot that cannot be parsed cannot be restored either,
   and destroying it during a security tidy is the recovery-path failure rule 28
   is about.
3. **`removeKey` runs the sweep too**, so the promise it makes becomes true at the
   moment it is made rather than at the next boot.
4. **The screen says so.** The Backup screen states that backups and snapshots do
   not include the key, and that restoring one will not bring it back.

### The question

Step 1 changes something a user could notice: **restoring a backup or snapshot
will no longer restore the API key.** Today it does. That is a real behaviour
change to a recovery path, so it is yours to make, not mine.

| | Export file | Snapshots | Restoring brings the key back |
|---|---|---|---|
| **A** (recommended) | no key | no key | no — user re-pastes it once |
| **B** | key kept | no key | from a backup file only |
| **C** | key kept | key kept, purged on removeKey | yes |

**A**, because the export is the copy that leaves the device, and re-pasting a key
once after a restore is a small price against a credential sitting in a file in
someone's Downloads folder. **B** is defensible if you restore from file often and
would rather not re-paste. **C** fixes only what the review named and leaves E1,
which I think is the more serious of the two.

---

## 4. Acceptance criteria

Every guard mutation-tested by a real revert.

1. An exported backup contains no `sk-` key, with a fixture whose live blob does.
2. A snapshot written while a key is set contains no key.
3. A snapshot written by an older version **is** cleaned by the sweep.
4. A snapshot that is not valid JSON survives the sweep untouched.
5. After `removeKey`, no snapshot on the device contains the key.
6. Removing the key while the newest snapshot is over 24h old does not archive it.
7. Restoring a redacted snapshot leaves the rest of the state intact — this fix
   must not cost data to protect a secret.


---

## 5. As built (v9.90)

Logan chose **A** (strip from both) and **a line on the Backup screen**.

| # | Change |
|---|---|
| 1 | `redactSaved(raw)` — takes the stored **string**, not `S`, because `snapshot()` archives the *previous* blob on purpose and re-serialising the live `S` would archive the wrong state. Returns `null` when the input will not parse. |
| 2 | `snapshot()` writes the redacted copy. If the blob will not parse it writes **nothing** — such a snapshot could not be restored either (`restoreSnapshot` parses it), so an archived credential is the worse of the two. |
| 3 | `exportBackup()` writes the redacted copy. |
| 4 | `scrubSnapshots()` blanks the key in snapshots older versions already wrote. A snapshot that will not parse is **left exactly as it was**. |
| 5 | `removeKey()` runs the sweep, so its promise is true when it is made. |
| 6 | The Backup screen says backups and snapshots do not include the key, and that restoring will not bring it back. |

### The 24-hour window, now reproduced

§1 listed it as read-but-not-reproduced. `removing the key does not ARCHIVE it on
the way out` sets `flyersnap-lastsnapshot` to 48 hours ago and calls `removeKey()`,
which is the exact window where `save()`'s inner `snapshot()` would file a fresh
copy of the key being erased. It passes now; K2 (snapshots writing raw again)
turns it red.

### Two existing fixtures updated

`a save snapshots the previous good copy` and `an import snapshots what it
replaces` both asserted the snapshot was **byte-identical** to the stored blob.
Redaction re-serialises, so byte equality no longer holds — but the property they
existed for does. Both now compare the **parsed** structures against the fixture
with `apiKey` blanked, which asserts the whole replaced state survived and adds
that the key did not. Not loosened: `deepStrictEqual` over the full object.

### Tests: 841, from 834

| # | Revert | Result |
|---|---|---|
| **K1** | the export writes `S` again | **RED** — `the downloaded backup file carries no API key` |
| **K2** | snapshots write the raw blob again | **RED ×4** — including both updated fixtures, which proves they still guard the content |
| **K3** | `removeKey` no longer sweeps | **RED** — `leaves no restorable copy`, naming the surviving copy |
| **K4** | the sweep DESTROYS an unparseable snapshot | **RED ×2** — the rule-28 test, and the empty-catch guard caught the `catch(e){}` I wrote to do it |
| **K5** | the Backup screen line removed | **RED** — `the Backup screen says the key is not included` |

K4 is worth noting: the mutation needed a silent `catch(e){}` to swallow the
removal error, and an unrelated existing guard — `no catch block in the shipped
app or its modules is silently empty` — caught that too. Two independent guards
on one bad change.

`node tests.js` 841/0 · `inline.js --check` in sync · a11y clean across all 48
screens.

### Not addressed here

`downloadQuarantine` dumps the raw stored blob when the data is too broken to
load. It was not measured in this pass and is not covered by any test above.
Whatever it writes, it writes at the moment the user is already in trouble.
