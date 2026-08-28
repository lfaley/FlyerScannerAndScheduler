#!/usr/bin/env python3
"""v9.68 - the Gordon sign-in card, three defects in one screen.

Logan, 28 Aug, with screenshots: "this looks bad look at the email field" and
"im getting an alert that the email isnt correct too, but it is correct".

  A. css/components.css:123 styles input[type=text|password|number|date|time]
     and textarea. `email` IS NOT IN THAT LIST, and #gordonEmail is the app's
     only type=email input. It therefore got NO app styling at all -- no width,
     no padding, no border-radius, no background -- and fell back to the
     user-agent default: intrinsically sized (~20 chars) with Safari's yellow
     autofill wash showing through. That is exactly what the screenshot shows,
     with the password field directly beneath it full-width and correct.

  B. P5-08 from the Aug 2026 code review, verified then and never fixed. The
     signed-out branch of gordonAuthCard() opens <div class="card"> and never
     closes it; the signed-in branch closes both of its divs. So with provider
     `local` and signed out, EVERY section below -- Base URL, Model, fallback
     checkbox, Save/Test, the Anthropic key -- renders INSIDE the amber sign-in
     card. Also visible in the screenshots.

  C. The message. Firebase deliberately collapses "no such user" and "wrong
     password" into one code (INVALID_LOGIN_CREDENTIALS) when email-enumeration
     protection is on, and signInErrorMessage() rendered all three codes as
     "That email or password is not right." Leading with "email" when the app
     has NO evidence the email is wrong is what Logan read as being told his
     correct email was incorrect. EMAIL_NOT_FOUND and INVALID_PASSWORD are
     distinguishable when Firebase does send them, so say which one; when it
     sends the collapsed code, say plainly that it cannot tell which.

Also: the two auth inputs gain autocomplete hints. Without them iOS has to
guess which field is which, which is how an email box ends up wearing an
autofill highlight it did not earn.

Nothing is removed (CLAUDE.md rule 1).
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
        fail.append(f'{path}: expected {c}x {o[:80]!r}, found {got}')
        return
    buf[path] = src.replace(o, n)

# ========================================================================== A
# Both copies: css/components.css is the source of truth, index.html carries the
# inlined <style>. A fix to one that is not applied to the other is drift.
OLD_SEL = """  input[type=text],input[type=password],input[type=number],input[type=date],input[type=time],textarea{"""
NEW_SEL = """  /* Every text-entry type the app actually ships. `email` was missing until
     v9.68, so the one type=email input in the app -- Gordon sign-in -- got no
     styling at all and rendered as a narrow UA-default box with Safari's
     autofill wash showing through, directly above a correctly styled password
     field. tests-cases.js pins this: any input type in the shipped markup that
     is not checkbox/file/radio/image must appear in this selector. */
  input[type=text],input[type=email],input[type=password],input[type=number],input[type=date],input[type=time],textarea{"""
rep('css/components.css', OLD_SEL, NEW_SEL)
rep('index.html', OLD_SEL, NEW_SEL)

# ========================================================================== B
rep('index.html', """    <div class="formrow" style="margin-top:8px">
      <button class="btn" onclick="gordonSignInUI()">Sign in</button>
    </div>
    <div id="gordonAuthMsg" class="help" style="margin-top:6px;min-height:1em" role="status" aria-live="polite"></div>`;
}""",
"""    <div class="formrow" style="margin-top:8px">
      <button class="btn" onclick="gordonSignInUI()">Sign in</button>
    </div>
    <div id="gordonAuthMsg" class="help" style="margin-top:6px;min-height:1em" role="status" aria-live="polite"></div>
  </div>`;
}""")

# ...and the inputs say what they are, so iOS fills the right one.
rep('index.html', """    <input type="email" id="gordonEmail" aria-label="Email" placeholder="you@example.com"
      autocapitalize="none" autocorrect="off" spellcheck="false" style="margin-bottom:6px">
    <input type="password" id="gordonPassword" aria-label="Password" placeholder="Password"
      onkeydown="if(event.key==='Enter')gordonSignInUI()">""",
"""    <input type="email" id="gordonEmail" aria-label="Email" placeholder="you@example.com"
      autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username"
      inputmode="email" style="margin-bottom:6px">
    <input type="password" id="gordonPassword" aria-label="Password" placeholder="Password"
      autocomplete="current-password"
      onkeydown="if(event.key==='Enter')gordonSignInUI()">""")

# ========================================================================== C
rep('index.html', """  signInErrorMessage(json){
    const code = (json && json.error && json.error.message) || '';
    if(/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code))
      return 'That email or password is not right.';""",
"""  signInErrorMessage(json){
    const code = (json && json.error && json.error.message) || '';
    // SAY ONLY WHAT IS KNOWN. Firebase sends three different things here and
    // until v9.68 all three printed "That email or password is not right",
    // which reads as an accusation about the email -- Logan hit it on 28 Aug
    // with an email that was correct. EMAIL_NOT_FOUND and INVALID_PASSWORD are
    // definite, so name the one that is actually wrong. INVALID_LOGIN_
    // CREDENTIALS is Firebase collapsing the two on purpose (email-enumeration
    // protection), and the honest answer there is that we cannot tell.
    if(/EMAIL_NOT_FOUND/.test(code))
      return 'No account for that email address.';
    if(/INVALID_PASSWORD/.test(code))
      return 'That password is not right. The email address is fine.';
    if(/INVALID_LOGIN_CREDENTIALS/.test(code))
      return 'Sign-in was refused. Google does not say which is wrong, so check the password first \\u2014 it is the usual one.';""")

if fail:
    print('FAILED - nothing written:')
    [print(' ', f) for f in fail]
    sys.exit(1)
for path, text in buf.items():
    open(path, 'w').write(text)
print('email field fixed ->', ', '.join(sorted(buf)))
