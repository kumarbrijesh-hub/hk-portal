/**
 * Session transport.
 *
 * The platform edge in front of this app strips the Cookie header before a
 * request reaches the container, so an HttpOnly session cookie is set and
 * stored by the browser but never arrives here — every authenticated call then
 * reads as signed out. The same signed token is therefore mirrored into a
 * request header, which the edge forwards untouched. The cookie is still set
 * and still accepted by the server, so an environment that does forward
 * cookies keeps working with no change.
 */

const STORAGE_KEY = 'dms.session';

/** Header the server reads the session token from. */
export const SESSION_HEADER = 'X-DMS-Session';

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked by policy; the cookie path is then the only one left.
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignored for the same reason as above.
  }
}

function urlOf(input: RequestInfo | URL): URL | null {
  try {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, window.location.href);
  } catch {
    return null;
  }
}

let installed = false;

/**
 * Attaches the stored token to this app's own API calls. Patching fetch once
 * keeps the ~24 call sites unchanged and makes it impossible for a new one to
 * forget the header. The token is only ever attached to same-origin /api
 * requests, so it cannot leak to a third party.
 */
export function installSessionHeader(): void {
  if (installed) return;
  installed = true;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getSessionToken();
    if (!token) return original(input, init);

    const url = urlOf(input);
    if (!url || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return original(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    headers.set(SESSION_HEADER, token);
    return original(input, { ...init, headers });
  };
}
