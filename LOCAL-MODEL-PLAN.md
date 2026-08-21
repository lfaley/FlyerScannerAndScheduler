# Plan of attack — local model feature to A+

Ordered by risk. Each item states the defect, the fix, and how we prove it.

---

## P0 — Correctness defects found in review (must fix, block everything else)

### P0.1 Queue exceeds Apps Script property limits
**Defect.** RAW_MODE stores up to 60,000 characters of email body in
`props().setProperty('QUEUE', ...)`. Apps Script Properties cap at **9KB per
value**. Any real email overflows and the write fails.

**Fix.** The queue holds only lightweight references
(`msgId`, `subject`, `from`, `received`, `hasAttachments`). The app then requests
each message's prepared content on demand via a new `action=message&msgId=...`
endpoint, which builds the text fresh from Gmail at request time. Nothing large
is ever stored.

**Proof.** Queue 20 messages; assert the stored property stays under 9KB.

### P0.2 Attachments are lost in RAW_MODE
**Defect.** The script builds a `blocks` array containing PDF attachments, then
RAW_MODE returns before using it. Additionally only `application/pdf` was ever
inspected — **an attached JPG or PNG flyer was never captured in either mode**.

**Fix.** The per-message endpoint returns text *and* a list of attachments
(images and PDFs) as base64, fetched on demand so the queue stays small.

**Proof.** A message with a JPG attachment yields an attachment entry.

### P0.3 Mixed content is not routed to the right model
**Defect.** An email with both body text and a flyer image needs both read.
Text-only models cannot see the image; the image alone loses the body.

**Fix.** `extractFromEmail()` runs up to two passes and merges:
- **text pass** — body text, any model
- **image pass** — each image attachment, vision model only
Results are merged and de-duplicated with the existing `looksDuplicate`, so a
date appearing in both body and flyer produces one event, not two.

**Proof.** A message with text-only dates and image-only dates yields the union,
and a date in both yields one event.

---

## P1 — The five gaps from the design review

### P1.1 Failures must reach the user
Per-item errors are caught and `console.log`ged — invisible on a phone. Collect
them and show "3 of 15 emails could not be read", with the reasons.

### P1.2 Provider provenance on every event
Stamp each extracted event with the model that produced it (`aiSource`), so a
bad extraction can be traced without guessing.

### P1.3 Verify `think:false` actually takes effect
Currently assumed. The Test button should report whether a reasoning trace came
back, so we know rather than hope.

### P1.4 Integration test against a live endpoint
Not achievable in the Node harness (no network, no GPU). Instead: an in-app
**self-test** that exercises the real path — auth, image encoding, response
parsing — and reports pass/fail per stage.

### P1.5 Accuracy comparison
An in-app A/B: run the same input through both providers and show the two event
lists side by side. Turns "is local good enough" from opinion into evidence.

---

## P2 — Test suite quality (see the teaching notes below)

Current: 163 tests, strong on pure functions, **zero on the network path**, and
one test that certified a bug. Goals:
- test from the caller's perspective, not the function's
- cover the seams between components, not just their interiors
- every bug fixed gets a regression test named after the bug

---

## Order of work
1. P0.1 + P0.2 + P0.3 together (one architectural change)
2. P1.1, P1.2 (small, high value)
3. P1.3, P1.4 (self-test screen)
4. P1.5 (comparison screen)
5. P2 throughout
