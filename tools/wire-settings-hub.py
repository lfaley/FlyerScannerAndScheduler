#!/usr/bin/env python3
"""v9.22 — Settings becomes a hub of six pages instead of one 6.8-screen scroll.

Measured before touching anything: 5,794px tall, 11 sections, 27 controls, one
flat scroll. "What Gordon can and cannot do" alone was 1,731px of it.

Hub-and-spoke rather than accordions, on evidence: NN/g find accordions on
mobile "conserve space but can also cause disorientation and too much
scrolling". A drill-down list is also the pattern every iPhone owner already
knows from iOS Settings, and this app already has a proven sub-screen system
with 28 audited screens.

Every hub row carries its CURRENT STATE as a subtitle. A menu that only says
"Appearance" makes you open it to find out what it is set to; one that says
"Dark" answers the question on the hub. That is the main thing a hub buys over
a scroll, and it is easy to leave out.
"""
import sys, re
p='index.html'; src=open(p).read(); fail=[]
def rep(o,n,c=1):
    global src
    got=src.count(o)
    if got!=c: fail.append(f'expected {c}x {o[:90]!r}, found {got}'); return
    src=src.replace(o,n)

body = src.split('function renderSettings(')[1].split('\nfunction ')[0]
def chunk(start, end=None):
    i = body.index(start)
    j = body.index(end) if end else len(body)
    return body[i:j].rstrip().rstrip('+').rstrip()

people   = chunk('<div class="sect">People</div>', '<div class="sect">Anthropic API key</div>')
apikey   = chunk('<div class="sect">Anthropic API key</div>', '${diagnosticsSection()}')
gordon   = chunk('<div class="sect">Gordon</div>', '<div class="sect">How well does ${aiName()} understand you?</div>')
routeb   = chunk('<div class="sect">How well does ${aiName()} understand you?</div>', '<div class="sect">How well does it read paperwork?</div>')
extractb = chunk('<div class="sect">How well does it read paperwork?</div>', '<div class="sect">Gmail watcher</div>')
watcher  = chunk('<div class="sect">Gmail watcher</div>', '<div class="sect">Backup</div>')
backup   = chunk('<div class="sect">Backup</div>', '<div class="sect">Alerts</div>')
alerts   = chunk('<div class="sect">Alerts</div>', '<div style="text-align:center;color:var(--faint)')

# The self-test and provider comparison are nested inside Gordon's local-model
# branch. They belong on the troubleshooting page, but only make sense when the
# local model is selected -- so they move with that condition intact.
selftest_block = """      <button class="btn alt" style="margin-top:8px" onclick="runLocalSelfTest()">${ico('flask')}Run full self-test</button>
      <button class="btn alt" style="margin-top:8px" onclick="startCompare()">${ico('scale')}Compare against Anthropic</button>
"""
if selftest_block not in gordon:
    fail.append('could not find the self-test/compare buttons inside the Gordon section')
gordon_trimmed = gordon.replace(selftest_block, '')

NEW = '''function settingsRow(icon, title, subtitle, target, tone){
  // State on the row itself. A menu that only says "Appearance" makes you open
  // it to find out what it is set to; one that says "Dark" answers on the hub.
  return `<div class="card row" role="button" tabindex="0"
      aria-label="${esc(title)} — ${esc(subtitle)}"
      onclick="sub('${esc(target)}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sub('${esc(target)}')}">
    ${ico(icon, {cls:'rowicon'})}
    <div class="grow">
      <div class="title" style="font-size:15px">${esc(title)}</div>
      <div class="meta" style="font-size:12px${tone ? ';color:var(--' + tone + ')' : ''}">${esc(subtitle)}</div>
    </div>
    ${ico('chevron-right', {cls:'rowicon'})}
  </div>`;
}

function renderSettings(m){
  setHeader('Settings', false);
  const people = allPeople().length;
  const openProblems = activeProblems().length;
  const badCalls = summarize(S.aiLog || []).failed;
  const trouble = openProblems
    ? openProblems + ' problem' + (openProblems === 1 ? '' : 's') + ' to look at'
    : (badCalls ? badCalls + ' failed AI call' + (badCalls === 1 ? '' : 's') : 'Nothing reported');
  const alerts = (S.settings.alerts.deadline || []).length + (S.settings.alerts.event || []).length;

  m.innerHTML =
    settingsRow('tag', 'People', people
      ? people + ' ' + (people === 1 ? 'person' : 'people') + ' to tag events to'
      : 'Nobody added yet', 'setPeople', people ? null : 'amber-accent') +
    settingsRow('sparkles', aiName() + ' and AI', !aiEnabled() ? 'AI is switched off'
      : (aiProvider() === 'local'
          ? 'Local model · ' + (S.settings.localModel || 'not set')
          : 'Anthropic · ' + (S.settings.apiKey ? 'key saved' : 'no key saved')),
      'setAI', aiEnabled() && aiProvider() === 'anthropic' && !S.settings.apiKey ? 'amber-accent' : null) +
    settingsRow('bell', 'Reminders and email',
      alerts + ' alert' + (alerts === 1 ? '' : 's') + ' · ' +
      (watcherConfigured() ? 'watcher connected' : 'no email watcher'), 'setReminders') +
    settingsRow('image', 'Appearance', themeLabel(themePref(S.settings)), 'setAppearance') +
    settingsRow('cloud', 'Backup', S.settings.lastBackup
      ? 'Last export ' + friendly(S.settings.lastBackup)
      : 'Never exported', 'setBackup', S.settings.lastBackup ? null : 'amber-accent') +
    settingsRow('flask', 'When something goes wrong', trouble, 'setTrouble',
      (openProblems || badCalls) ? 'amber-accent' : null) +
    `<div style="text-align:center;color:var(--faint);font-size:11px;margin-top:24px">FlyerSnap ${APP_VERSION} · ${APP_TAGLINE}</div>`;
}

function renderSetPeople(m){
  setHeader('People', true);
  m.innerHTML = `PEOPLE_BLOCK`;
}

function renderSetAI(m){
  setHeader(aiName() + ' and AI', true);
  m.innerHTML = `GORDON_BLOCK

    APIKEY_BLOCK

    <div class="card row" role="button" tabindex="0"
        aria-label="What ${esc(aiName())} can and cannot do"
        onclick="sub('setCapabilities')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sub('setCapabilities')}">
      ${ico('book', {cls:'rowicon'})}
      <div class="grow"><div class="title" style="font-size:15px">What ${esc(aiName())} can and cannot do</div>
        <div class="meta" style="font-size:12px">Every AI feature, and where each one falls down</div></div>
      ${ico('chevron-right', {cls:'rowicon'})}
    </div>`;
}

function renderSetCapabilities(m){
  setHeader('What ' + aiName() + ' can do', true);
  // Deliberately kept in FULL. This is the honest disclosure of what the AI can
  // and cannot do, rendered from the same list the code uses so it cannot drift
  // from what actually happens (HAX G1/G2). It was two screens tall inside a
  // seven-screen page, which is why it now has a page of its own -- not a
  // reason to shorten it.
  m.innerHTML = aiCapabilitySection();
}

function renderSetReminders(m){
  setHeader('Reminders and email', true);
  m.innerHTML = `ALERTS_BLOCK

    WATCHER_BLOCK`;
}

function renderSetAppearance(m){
  setHeader('Appearance', true);
  m.innerHTML = appearanceSection();
}

function renderSetBackup(m){
  setHeader('Backup', true);
  m.innerHTML = `BACKUP_BLOCK`;
}

function renderSetTrouble(m){
  setHeader('When something goes wrong', true);
  m.innerHTML = diagnosticsSection() + `

    ROUTEB_BLOCK

    EXTRACTB_BLOCK` +
    // Only meaningful with the local model selected: they test that setup.
    (aiProvider() === 'local' ? `
    <div class="sect">Local model checks</div>
    <div class="help">These test the desktop running your own model — whether it
      is reachable, whether it can read a photo, and how its answers compare with
      Anthropic's on the same flyer.</div>
SELFTEST_BLOCK` : '');
}
'''

NEW = (NEW.replace('PEOPLE_BLOCK', people)
          .replace('GORDON_BLOCK', gordon_trimmed.rstrip())
          .replace('APIKEY_BLOCK', apikey)
          .replace('ALERTS_BLOCK', alerts)
          .replace('WATCHER_BLOCK', watcher)
          .replace('BACKUP_BLOCK', backup)
          .replace('ROUTEB_BLOCK', routeb)
          .replace('EXTRACTB_BLOCK', extractb)
          .replace('SELFTEST_BLOCK', selftest_block.rstrip()))

old_fn = 'function renderSettings(' + body
if src.count(old_fn) != 1:
    fail.append('could not isolate renderSettings')
else:
    src = src.replace(old_fn, NEW.rstrip() + '\n')

rep("    problems:renderProblems,     selfTest:renderSelfTest, compare:renderCompare, bench:renderBench,",
"""    problems:renderProblems,     selfTest:renderSelfTest, compare:renderCompare, bench:renderBench,
    setPeople:renderSetPeople, setAI:renderSetAI, setCapabilities:renderSetCapabilities,
    setReminders:renderSetReminders, setAppearance:renderSetAppearance,
    setBackup:renderSetBackup, setTrouble:renderSetTrouble,""")

if fail:
    print('FAILED — nothing written:'); [print(' ',f) for f in fail]; sys.exit(1)
open(p,'w').write(src); print('settings hub wired')
