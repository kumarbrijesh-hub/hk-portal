/**
 * Light / dark preference.
 *
 * Stored per browser rather than per account: it is a property of the screen
 * somebody is looking at, not of who they are, and the same operator on the
 * floor display and on their laptop will want different answers.
 *
 * Every read and write is wrapped. localStorage throws outright in a locked
 * down browser profile, and a thrown exception here would take the whole
 * console down over a colour preference.
 */

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'dms-theme';

/** Applied to <html>, which is what the dark palette in index.css keys on. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
}

export function readStoredTheme(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'dark' || raw === 'light' ? raw : null;
  } catch {
    return null;
  }
}

export function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A browser that refuses site data still gets the theme for this session;
    // it just will not remember it next time.
  }
}

/**
 * What to start on: the stored choice, else whatever the operating system is
 * set to, else light.
 */
export function initialTheme(): ThemeMode {
  const stored = readStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Lets the browser finish a style and layout pass before anything reads it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Runs `fn` with the document forced back to light, then restores.
 *
 * The report export uses this. A downloaded PNG is a document that gets
 * forwarded, pasted into a deck and printed, so it has to look the same however
 * the person who exported it had their console set.
 *
 * Transitions are frozen for the duration, and this is not a nicety. Rows carry
 * `transition-colors`, so flipping the palette starts a 150ms colour animation
 * and `getComputedStyle` - which is how the capture library reads every colour -
 * hands back the half-way value while it runs. The first version of this
 * exported the duplicate-row highlight as near-black: the class came off, the
 * capture read the colours immediately, and it got the dark end of an
 * animation that had not started moving yet. Killing transitions makes the
 * change instant, and the two frames after it make sure the browser has
 * actually recomputed before the capture looks.
 */
export async function withLightTheme<T>(fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');

  // Frozen even when the console is already light. A row mid-hover or a
  // spinner part-way through its turn is the same class of defect, and a
  // report is not the place to find out which animations were in flight.
  const freeze = document.createElement('style');
  freeze.id = 'dms-export-freeze';
  freeze.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
  document.head.appendChild(freeze);

  if (wasDark) root.classList.remove('dark');
  await nextFrame();

  try {
    return await fn();
  } finally {
    if (wasDark) {
      root.classList.add('dark');
      // Same hazard in reverse: leave the freeze in place until the dark
      // palette has been applied, or the console itself animates back in.
      await nextFrame();
    }
    freeze.remove();
  }
}
