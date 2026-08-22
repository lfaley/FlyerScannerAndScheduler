/**
 * Swipe navigation between the main tabs.
 *
 * Design constraints, each for a reason:
 *
 * 1. EDGE ZONES ARE NOT OURS. An installed iOS web app keeps Safari's native
 *    edge-swipe back/forward gesture, and there is no reliable way to disable
 *    it from web code. So a gesture starting within EDGE px of either side is
 *    ignored outright and left to the OS -- otherwise both fire and the app
 *    appears to jump two screens.
 *
 * 2. NEVER preventDefault. We cannot win against the OS gesture, and calling
 *    it would only break vertical scrolling. Listeners are passive, which also
 *    keeps scrolling off the main thread.
 *
 * 3. HORIZONTAL DOMINANCE. A gesture must be clearly sideways (|dx| well over
 *    |dy|) or every slightly-slanted scroll flings the user to another tab.
 *
 * 4. NOT THE ONLY WAY. The tab bar still does everything swiping does --
 *    required by WCAG 2.5.1 (Pointer Gestures), which says a path-based
 *    gesture must have a single-pointer alternative.
 *
 * The decision is a pure function (`swipeIntent`) so it can be tested without
 * a browser; the DOM wiring below it is deliberately thin.
 */

// Tuned for a 390-430px phone. MIN_DIST is far enough that a tap-drag or a
// scroll wobble cannot reach it, close enough to feel light.
export const SWIPE = {
  EDGE: 28,        // px from either side that belongs to the OS gesture
  MIN_DIST: 60,    // px of horizontal travel before it counts
  RATIO: 1.7,      // |dx| must exceed |dy| by this much
  MAX_MS: 800,     // slower than this is a drag, not a swipe
  MAX_OFF: 90,     // and it must not wander this far vertically
};

/**
 * Decide what a finished gesture meant.
 * @returns 'next' (swipe left), 'prev' (swipe right), or null.
 */
export function swipeIntent(g){
  const { dx, dy, ms, startX, width } = g;
  // The OS owns the edges. Checked first: an edge gesture is never ours, no
  // matter how clean it looks.
  if(startX <= SWIPE.EDGE || startX >= width - SWIPE.EDGE) return null;
  if(ms > SWIPE.MAX_MS) return null;
  if(Math.abs(dy) > SWIPE.MAX_OFF) return null;
  if(Math.abs(dx) < SWIPE.MIN_DIST) return null;
  if(Math.abs(dx) < Math.abs(dy) * SWIPE.RATIO) return null;
  return dx < 0 ? 'next' : 'prev';
}

/**
 * Should a gesture starting on this element be ignored?
 * Text selection, form fields, and anything the user is scrolling sideways
 * on its own (the person/filter chip bar) all outrank tab switching.
 */
export function startsOnSomethingElse(el){
  for(let n = el; n && n.closest; n = n.parentElement){
    if(n.matches && n.matches('input,textarea,select,[contenteditable="true"]')) return true;
    // A horizontally scrollable strip owns sideways gestures that start on it.
    if(n.scrollWidth && n.clientWidth && n.scrollWidth > n.clientWidth + 4){
      const st = (typeof getComputedStyle === 'function') ? getComputedStyle(n).overflowX : '';
      if(st === 'auto' || st === 'scroll') return true;
    }
  }
  return false;
}
