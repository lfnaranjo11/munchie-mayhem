/**
 * network.config.js - where the online server lives.
 *
 * Precedence (highest first):
 *   1. ?server=wss://host   URL parameter, for testing against any server
 *   2. SERVER_URL below     your deployed server
 *   3. auto                 same host as the page (useful if you serve
 *                           the client from the game server itself)
 */

/**
 * Set this to your deployed server, e.g.
 *   'wss://munchie-mayhem-abc123-uc.a.run.app'
 *
 * IMPORTANT - it must be `wss://` (not `ws://`) and must NOT include a
 * port. Cloud Run, Fly, Render and friends all terminate TLS for you and
 * serve on 443; the container's internal port is irrelevant from outside.
 * A browser on an https:// page will also flatly refuse to open a
 * ws:// connection (mixed content), which is the single most common
 * reason "it works locally but not deployed".
 *
 * Leave null to fall back to localhost for development.
 */
export const SERVER_URL = 'wss://backend-server-munchie-mayhem-312084582458.us-east4.run.app';

/** Local development default. */
export const DEV_SERVER_URL = 'ws://localhost:8080';

/**
 * Resolves the server URL for the current page.
 * Picks wss:// automatically when the page itself is served over https,
 * so a deployed client can't accidentally try an insecure socket.
 */
export function resolveServerURL() {
  if (SERVER_URL) return SERVER_URL;
  const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
  if (isSecurePage) {
    // Same origin as the page, upgraded to a secure socket. Correct when
    // the client is served by the game server; if you host the client
    // separately (GitHub Pages) you must set SERVER_URL above.
    return `wss://${window.location.host}`;
  }
  return DEV_SERVER_URL;
}
