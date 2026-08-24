// Firebase Auth REST helpers for "sign in to use Gordon" (SECURITY-PLAN.md P2).
// PURE: request builders + response parsers only -- no fetch, no DOM, no SDK.
// That is deliberate. The Firebase JS SDK cannot be inlined without a build
// step, and making it a boot dependency is the v8.1-v8.5 blank-screen incident
// in a new costume. Email+password sign-in is two plain HTTPS calls, so the app
// never imports Firebase and still boots with zero network. index.html holds the
// impure half (the actual fetch + localStorage); this half is unit-tested offline.
export const GORDON_AUTH = {
  signInUrl: (key) => 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + key,
  refreshUrl: (key) => 'https://securetoken.googleapis.com/v1/token?key=' + key,

  // Email + password is the ONLY method that works in an installed iOS PWA
  // (magic link, popup, and redirect all fail there -- SECURITY-PLAN.md 3.2).
  signInRequest(email, password, apiKey){
    return { url: this.signInUrl(apiKey), options: {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
    } };
  },

  refreshRequest(refreshToken, apiKey){
    return { url: this.refreshUrl(apiKey), options: {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
    } };
  },

  // Sign-in response -> the session we persist. Throws on a malformed body so a
  // junk 200 can never masquerade as a signed-in state (hostile-parse discipline).
  parseSignIn(json, nowMs){
    if(!json || !json.idToken || !json.refreshToken) throw new Error('sign-in response missing tokens');
    const ttl = (Number(json.expiresIn) || 3600) * 1000;
    return { idToken: json.idToken, refreshToken: json.refreshToken,
      email: String(json.email || '').toLowerCase(), idTokenExpiresAt: nowMs + ttl };
  },

  // Refresh response -> a fresh session, carrying the email forward. The refresh
  // endpoint returns snake_case; accept either just in case.
  parseRefresh(json, prev, nowMs){
    const idToken = json && (json.id_token || json.idToken);
    const refreshToken = json && (json.refresh_token || json.refreshToken);
    if(!idToken || !refreshToken) throw new Error('refresh response missing tokens');
    const ttl = (Number(json.expires_in || json.expiresIn) || 3600) * 1000;
    return { idToken: idToken, refreshToken: refreshToken,
      email: (prev && prev.email) || '', idTokenExpiresAt: nowMs + ttl };
  },

  isSession(s){
    return !!(s && typeof s.idToken === 'string' && typeof s.refreshToken === 'string'
      && typeof s.idTokenExpiresAt === 'number');
  },

  // Refresh a little before the ~1h ID token actually expires, so a call never
  // races the boundary. skewMs default = 5 minutes.
  needsRefresh(s, nowMs, skewMs){
    if(skewMs === undefined) skewMs = 300000;
    return !this.isSession(s) || nowMs >= (s.idTokenExpiresAt - skewMs);
  },

  // Turn Identity Toolkit's error codes into something a parent can read.
  signInErrorMessage(json){
    const code = (json && json.error && json.error.message) || '';
    if(/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/.test(code))
      return 'That email or password is not right.';
    if(/USER_DISABLED/.test(code)) return 'This account has been disabled.';
    if(/TOO_MANY_ATTEMPTS/.test(code)) return 'Too many attempts — wait a moment and try again.';
    if(/MISSING_PASSWORD|MISSING_EMAIL/.test(code)) return 'Enter both your email and password.';
    return 'Sign-in failed' + (code ? ' (' + code + ')' : '') + '.';
  }
};
