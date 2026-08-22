#!/usr/bin/env python3
"""Phase 2 step 1: insert the SVG icon sprite, the .ico styles, and the
inlined copy of js/icons.js. Asserts every insertion point is found exactly
once and writes nothing if any check fails."""
import sys

SYMBOLS = {
 # ---- navigation -------------------------------------------------------
 'calendar':      '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
 'check-circle':  '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.9 2.9L16.2 9"/>',
 'cart':          '<circle cx="9.5" cy="19.5" r="1.7"/><circle cx="17.5" cy="19.5" r="1.7"/><path d="M2.5 4h2.4l2.7 11.5h10.6l2.3-8.2H6.2"/>',
 'utensils':      '<path d="M6.5 3v5.5a2.6 2.6 0 0 0 5.2 0V3M9.1 9v12M18.5 3c-1.6 2-2.4 4.2-2.4 6.6 0 1.7.8 2.8 2.4 3.2V21"/>',
 'gear':          '<circle cx="12" cy="12" r="3.3"/><path d="M21.1 10.1L21.1 13.9L18.5 14.4L18.3 14.9L19.8 17.1L17.1 19.8L14.9 18.3L14.4 18.5L13.9 21.1L10.1 21.1L9.6 18.5L9.1 18.3L6.9 19.8L4.2 17.1L5.7 14.9L5.5 14.4L2.9 13.9L2.9 10.1L5.5 9.6L5.7 9.1L4.2 6.9L6.9 4.2L9.1 5.7L9.6 5.5L10.1 2.9L13.9 2.9L14.4 5.5L14.9 5.7L17.1 4.2L19.8 6.9L18.3 9.1L18.5 9.6Z"/>',
 # ---- capture ----------------------------------------------------------
 'camera':        '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.4-2.2h6.6L16.7 7h2.8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
 'image':         '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><circle cx="8.6" cy="10" r="1.7"/><path d="M3.4 17.2l5-4.6 4 3.4 3.2-2.6 5 4.2"/>',
 'clipboard':     '<path d="M9 4.2H7.4A1.9 1.9 0 0 0 5.5 6.1v13A1.9 1.9 0 0 0 7.4 21h9.2a1.9 1.9 0 0 0 1.9-1.9v-13A1.9 1.9 0 0 0 16.6 4.2H15"/><rect x="9" y="2.6" width="6" height="3.4" rx="1.1"/>',
 'file':          '<path d="M14 3H7.6A1.9 1.9 0 0 0 5.7 4.9v14.2A1.9 1.9 0 0 0 7.6 21h8.8a1.9 1.9 0 0 0 1.9-1.9V7.2z"/><path d="M14 3v4.2h4.3M9 12.5h6M9 16h4.5"/>',
 'link':          '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.2 0l3-3a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.2 0l-3 3a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4"/>',
 'mail':          '<rect x="2.8" y="5" width="18.4" height="14" rx="2.2"/><path d="M3.4 6.6L12 13l8.6-6.4"/>',
 # ---- actions ----------------------------------------------------------
 'calendar-plus': '<path d="M21 11.5V7.5A2.5 2.5 0 0 0 18.5 5h-13A2.5 2.5 0 0 0 3 7.5v11A2.5 2.5 0 0 0 5.5 21h6"/><path d="M8 3v4M16 3v4M3 10h18M17.5 14.5v6M14.5 17.5h6"/>',
 'share':         '<path d="M12 15.5V3.8M8.2 7.4L12 3.6l3.8 3.8"/><path d="M5.5 13v6.2A1.8 1.8 0 0 0 7.3 21h9.4a1.8 1.8 0 0 0 1.8-1.8V13"/>',
 'edit':          '<path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L9.2 17.2l-4 1 1-4z"/><path d="M14.8 5.6l3 3"/>',
 'trash':         '<path d="M4 6.5h16M9.5 6.5V4.4A1.4 1.4 0 0 1 10.9 3h2.2a1.4 1.4 0 0 1 1.4 1.4v2.1"/><path d="M6.2 6.5l.9 13.1A1.5 1.5 0 0 0 8.6 21h6.8a1.5 1.5 0 0 0 1.5-1.4l.9-13.1M10.2 10.5v6M13.8 10.5v6"/>',
 'search':        '<circle cx="10.8" cy="10.8" r="6.8"/><path d="M15.7 15.7L21 21"/>',
 'x':             '<path d="M6 6l12 12M18 6L6 18"/>',
 'plus':          '<path d="M12 5v14M5 12h14"/>',
 'bell':          '<path d="M18 9.2a6 6 0 1 0-12 0c0 5-2.2 6.5-2.2 6.5h16.4S18 14.2 18 9.2"/><path d="M13.7 19.4a2 2 0 0 1-3.4 0"/>',
 'download':      '<path d="M12 3.5v11.4M7.8 10.9L12 15.1l4.2-4.2"/><path d="M4.5 16.5v2.8A1.7 1.7 0 0 0 6.2 21h11.6a1.7 1.7 0 0 0 1.7-1.7v-2.8"/>',
 'upload':        '<path d="M12 15.1V3.7M7.8 7.9L12 3.7l4.2 4.2"/><path d="M4.5 16.5v2.8A1.7 1.7 0 0 0 6.2 21h11.6a1.7 1.7 0 0 0 1.7-1.7v-2.8"/>',
 'refresh':       '<path d="M20.3 12a8.3 8.3 0 1 1-2.6-6"/><path d="M20.6 4.2v5.2h-5.2"/>',
 'sparkles':      '<path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.4 15.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
 'flask':         '<path d="M9.5 3v6.2L4.6 17.9A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3.1L14.5 9.2V3"/><path d="M8.2 3h7.6M7.5 14.5h9"/>',
 'scale':         '<path d="M12 4v17M6.5 21h11M4.5 6.8l15-1.6"/><path d="M7.2 6.5L4 13.2a3.4 3.4 0 0 0 6.5 0zM16.8 5.5L13.6 12.2a3.4 3.4 0 0 0 6.5 0z"/>',
 'alert':         '<path d="M10.6 4.1L2.9 17.4A1.6 1.6 0 0 0 4.3 20h15.4a1.6 1.6 0 0 0 1.4-2.6L13.4 4.1a1.6 1.6 0 0 0-2.8 0z"/><path d="M12 9.5v4.2M12 17.2h.01"/>',
 'cloud':         '<path d="M17.6 19H7a4.6 4.6 0 0 1-.5-9.2 6.3 6.3 0 0 1 12.1 1.6A4.1 4.1 0 0 1 17.6 19z"/>',
 'home':          '<path d="M3.5 10.4L12 3.4l8.5 7v9A1.6 1.6 0 0 1 18.9 21H5.1a1.6 1.6 0 0 1-1.6-1.6z"/><path d="M9.4 21v-7.2h5.2V21"/>',
 'tag':           '<path d="M20.4 12.7l-7.7 7.7a1.8 1.8 0 0 1-2.5 0l-6.6-6.6a1.8 1.8 0 0 1-.5-1.3V4.9A1.6 1.6 0 0 1 4.7 3.3h7.6a1.8 1.8 0 0 1 1.3.5l6.8 6.8a1.7 1.7 0 0 1 0 2.1z"/><circle cx="8.2" cy="8.2" r="1.5"/>',
 'check-square':  '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.2l2.9 2.9L16.4 9.4"/>',
 'message':       '<path d="M20.5 13.4a2.6 2.6 0 0 1-2.6 2.6H8.4L4 20V6.2a2.6 2.6 0 0 1 2.6-2.6h11.3a2.6 2.6 0 0 1 2.6 2.6z"/>',
 'history':       '<path d="M3.6 9.4A8.7 8.7 0 1 1 3.4 13"/><path d="M3.3 4.3v5.2h5.2M12 7.6V12l3.2 1.9"/>',
 'note':          '<rect x="4" y="3.4" width="16" height="17.2" rx="2.4"/><path d="M8.2 8.6h7.6M8.2 12.4h7.6M8.2 16.2h4.6"/>',
 'book':          '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H17a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.6A1.6 1.6 0 0 1 4 15.4z"/><path d="M19 19v2H6.2A2.2 2.2 0 0 1 4 18.8"/>',
 'pen':           '<path d="M4 20.2l1.2-4.2L16.6 4.6a2.3 2.3 0 0 1 3.2 3.2L8.2 19z"/><path d="M4 20.2l4.2-1.2M14.6 6.6l3.2 3.2"/>',
 'pan':           '<path d="M3.8 9.2h16.4v6.4a4.2 4.2 0 0 1-4.2 4.2H8a4.2 4.2 0 0 1-4.2-4.2z"/><path d="M2 11.8h1.8M20.2 11.8H22M8.6 4.6v2.4M12 3.8v3.2M15.4 4.6v2.4"/>',
 'gift':          '<path d="M3.6 11.4h16.8v8.2a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z"/><rect x="2.6" y="7.6" width="18.8" height="3.8" rx="1.3"/><path d="M12 7.6V21"/><path d="M12 7.6H7.9a2.3 2.3 0 1 1 0-4.6C10.6 3 12 7.6 12 7.6zM12 7.6h4.1a2.3 2.3 0 1 0 0-4.6C13.4 3 12 7.6 12 7.6z"/>',
 'layers':        '<path d="M12 2.9l8.6 4.4L12 11.7 3.4 7.3z"/><path d="M3.4 12.2L12 16.6l8.6-4.4M3.4 16.6L12 21l8.6-4.4"/>',
 'chevron-left':  '<path d="M15 4.5L7.5 12l7.5 7.5"/>',
 'chevron-right': '<path d="M9 4.5L16.5 12 9 19.5"/>',
}

SPRITE = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>\n'
 + '\n'.join(f'<symbol id="i-{k}" viewBox="0 0 24 24">{v}</symbol>' for k, v in SYMBOLS.items())
 + '\n</defs></svg>')

# The .ico styles now live in css/components.css, which is the source of
# truth (synced by tools/inline.js). They were seeded from here in v8.9;
# do not re-add a copy, or the two will drift.
ICO_CSS = None

p = 'index.html'
src = open(p).read()
fail = []
def rep(old, new, n=1):
    global src
    if src.count(old) != n:
        fail.append(f'expected {n}x {old[:70]!r}, found {src.count(old)}')
        return
    src = src.replace(old, new)

# 1. sprite into the body, before the header
rep('<body>\n<header id="header">', '<body>\n' + SPRITE + '\n<header id="header">')

# 2. .ico styles at the end of components.css (source), then inline separately
# (CSS step retired -- css/components.css owns the .ico rules now.)

# 3. inline js/icons.js into the script, next to the other modules
anchor = "// ---------- State & storage ----------"
icons_src = open('js/icons.js').read()
body = icons_src.split('*/', 1)[1].replace('export function', 'function').strip()
rep(anchor, body + '\n\n' + anchor)

if fail:
    print('BUILD FAILED — nothing written:'); [print(' ', f) for f in fail]; sys.exit(1)
open(p, 'w').write(src)
print(f'sprite inserted ({len(SYMBOLS)} symbols, {len(SPRITE)} bytes); icons.js inlined; .ico css appended')
