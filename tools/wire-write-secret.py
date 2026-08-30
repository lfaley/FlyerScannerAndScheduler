#!/usr/bin/env python3
"""v9.75 - the Gmail watcher gets a separate secret for the one action that WRITES.

THE PROBLEM, stated exactly

`SECRET` gates everything the web app can do: reading the queue, fetching a
message body, and `setsenders` -- which rewrites which senders the script reads
mail from. It travels as `?token=...` on a GET, so it lands in browser history,
in any proxy or referrer log, and in S.settings.watcherToken, which is written to
localStorage and SHIPPED IN EVERY BACKUP EXPORT.

That is acceptable for reading a queue the user already has. It is not
acceptable for the one action that changes what the script is allowed to read
from their Gmail: anyone holding a backup file can point the watcher at a new
sender and start collecting mail from it.

THE SPLIT

  SECRET        as today -- required for everything.
  WRITE_SECRET  additionally required for `setsenders`.

The write secret is NOT stored. FlyerSnap prompts for it at the moment the
sender list is saved and forgets it immediately, so it is never in localStorage
and never in a backup.

BACKWARDS COMPATIBLE ON PURPOSE (CLAUDE.md rule 1). If WRITE_SECRET is not set
in Script Properties, writes behave exactly as they do today. Nothing breaks on
deploy, and `testSetup()` says loudly that writes are unprotected and how to fix
it. Making it mandatory would remove the sender-management feature from every
install the moment the script is pasted, which is not a change to make on the
user's behalf.

WHAT THIS DOES NOT CLAIM. It does not make the URL secret, it does not encrypt
anything, and it does not defend against someone who can read the app while it
is open. It removes ONE specific capability -- reconfiguring the watcher -- from
the credential that leaks most easily.
"""
import sys

fail = []
buf = {}

def _get(path):
    if path not in buf:
        buf[path] = open(path).read()
    return buf[path]

def rep(path, o, n, c=1):
    src = _get(path)
    got = src.count(o)
    if got != c:
        fail.append(f'{path}: expected {c}x {o[:90]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

# =================================================================== watcher
g = 'gmail-watcher.gs'

rep(g, """ *   1. Script Properties: CLAUDE_KEY, SECRET, SENDERS""",
""" *   1. Script Properties: CLAUDE_KEY, SECRET, SENDERS
 *      ...and optionally WRITE_SECRET, a SECOND value required on top of SECRET
 *      for the one action that changes what this script reads (setsenders).
 *      SECRET travels in the URL and is saved on the phone, so it ends up in
 *      browser history and in every FlyerSnap backup. WRITE_SECRET is typed in
 *      at the moment the sender list is saved and is never stored anywhere.
 *      Leave it unset and setsenders behaves exactly as it always has.""")

rep(g, """  var action = (e.parameter.action || '').toLowerCase();

  // Manage the watched sender list from inside FlyerSnap.
  if (action === 'setsenders') {""",
"""  var action = (e.parameter.action || '').toLowerCase();

  // Manage the watched sender list from inside FlyerSnap.
  if (action === 'setsenders') {
    // The ONE action that changes what this script is allowed to read from the
    // mailbox. SECRET alone is not enough for it when a WRITE_SECRET exists:
    // SECRET is on the phone and in every backup, and someone holding a backup
    // must not be able to point the watcher at a new sender.
    //
    // Unset = behave exactly as before. testSetup() reports it as a warning
    // rather than this refusing writes on an install that never had one.
    var writeSecret = getProp('WRITE_SECRET');
    if (writeSecret && e.parameter.wtoken !== writeSecret) {
      return out({ error: 'write_unauthorized' });
    }""")

rep(g, """  if (!getProp('SECRET')) issues.push('SECRET is missing');""",
"""  if (!getProp('SECRET')) issues.push('SECRET is missing');""")

rep(g, """  if (issues.length) { Logger.log('PROBLEMS:\\n- ' + issues.join('\\n- ')); return; }""",
"""  if (issues.length) { Logger.log('PROBLEMS:\\n- ' + issues.join('\\n- ')); return; }

  // Not an error -- the script works without it -- but the user should know.
  if (!getProp('WRITE_SECRET')) {
    Logger.log('WARNING: WRITE_SECRET is not set.\\n' +
      'SECRET travels in the URL and is saved in FlyerSnap (and in its backups), so\\n' +
      'anyone holding one can change which senders this script reads mail from.\\n' +
      'To fix: Project Settings > Script Properties > Add, name WRITE_SECRET, value\\n' +
      'a different long random string. FlyerSnap will then ask for it when you save\\n' +
      'the sender list, and will not store it.');
  }""")

# ======================================================================= app
p = 'index.html'

rep(p, """async function saveSenders(list){
  const base = watcherBaseUrl();
  if(!base) throw new Error('No watcher URL saved.');
  const url = base + '?token=' + encodeURIComponent((S.settings.watcherToken||'').trim()) +
    '&action=setsenders&senders=' + encodeURIComponent(list.join(','));
  const data = await jsonpRequest(url);
  if(data.error) throw new Error(data.error);
  return data.senders || [];
}""",
"""/**
 * Rewrite the watched sender list.
 *
 * The only call in the app that CHANGES what the watcher may read from Gmail,
 * so as of v9.75 the script can require a second secret for it. That secret is
 * asked for here and forgotten immediately: it is never written to S.settings,
 * so it never reaches localStorage and never ships in a backup -- which is the
 * whole reason it exists, since `watcherToken` does both.
 */
async function saveSenders(list){
  const base = watcherBaseUrl();
  if(!base) throw new Error('No watcher URL saved.');
  let url = base + '?token=' + encodeURIComponent((S.settings.watcherToken||'').trim()) +
    '&action=setsenders&senders=' + encodeURIComponent(list.join(','));
  if(watcherWriteToken) url += '&wtoken=' + encodeURIComponent(watcherWriteToken);
  const data = await jsonpRequest(url);
  if(data.error === 'write_unauthorized'){
    // Ask once, retry once. A wrong answer the second time is a real failure --
    // looping here would be a password prompt that never stops.
    const typed = prompt('Your watcher asks for its WRITE_SECRET before it will '
      + 'change which senders it reads.\\n\\nThis is NOT the token you saved in '
      + 'Settings — it is the second value from Script Properties. FlyerSnap does '
      + 'not store it.');
    if(typed === null) throw new Error('Sender list not changed.');
    watcherWriteToken = String(typed).trim();
    const retryUrl = base + '?token=' + encodeURIComponent((S.settings.watcherToken||'').trim()) +
      '&action=setsenders&senders=' + encodeURIComponent(list.join(',')) +
      '&wtoken=' + encodeURIComponent(watcherWriteToken);
    const again = await jsonpRequest(retryUrl);
    if(again.error === 'write_unauthorized'){
      watcherWriteToken = '';                    // wrong: do not keep it around
      throw new Error('That WRITE_SECRET was not accepted.');
    }
    if(again.error) throw new Error(again.error);
    return again.senders || [];
  }
  if(data.error) throw new Error(data.error);
  return data.senders || [];
}""")

rep(p, """let watchedSenders = null;
let lastEmailProblems = [];""",
"""let watchedSenders = null;
// The watcher's WRITE_SECRET, held in memory for this session only.
//
// Deliberately NOT on S.settings: everything there is written to localStorage
// and shipped in every backup export, which is exactly what is wrong with
// `watcherToken` and the reason this second secret exists at all. Typed once
// per session when the sender list is saved, and gone when the tab closes.
let watcherWriteToken = '';
let lastEmailProblems = [];""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('watcher write-secret split wired ->', ', '.join(sorted(buf)))
