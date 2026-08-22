/**
 * Icon helper.
 *
 * Emoji were used as UI chrome until v8.9. They render differently on every
 * platform, cannot inherit color or state, and read as unfinished to anyone
 * who evaluates interfaces for a living. The replacement is a stroke-based
 * inline SVG sprite (<symbol> defs in index.html's body, referenced by <use>),
 * which costs no network request -- important, since the app ships as one
 * self-contained file and must work offline.
 *
 * Emoji that carry MEANING rather than chrome stay: the reward stars, the
 * celebration, and the example inside the chore-title placeholder. Those are
 * content, not controls.
 *
 * Accessibility: icons are decorative here -- every one sits beside a real
 * text label -- so they are aria-hidden and the label does the announcing.
 * The one exception is an icon-only control, which must pass a `title`.
 */

// Names must match a <symbol id="i-NAME"> in index.html's sprite. A test
// ("every icon referenced exists in the sprite") fails the build otherwise,
// because a typo would otherwise render a silent blank box.
export function ico(name, opts){
  const o = opts || {};
  const cls = 'ico' + (o.cls ? ' ' + o.cls : '');
  const style = o.size ? ` style="width:${o.size}px;height:${o.size}px"` : '';
  // An icon-only button needs an accessible name; a labelled one must stay
  // silent so screen readers do not announce the same thing twice.
  const a11y = o.title
    ? ` role="img" aria-label="${String(o.title).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}"`
    : ' aria-hidden="true"';
  return `<svg class="${cls}"${style}${a11y}><use href="#i-${name}"/></svg>`;
}
