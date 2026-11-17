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

/**
 * The typefaces a downloaded report is rendered in.
 *
 * These are the stacks index.css declares for `--font-sans` and `--font-mono`
 * with the webfont taken off the front, and they are duplicated here on
 * purpose: a stylesheet cannot be imported from TypeScript, and the export has
 * to be able to pin the document to exactly the faces the capture will use.
 *
 * Why it has to pin anything: the PNG is captured with `skipFonts`, which the
 * capture needs because reading cssRules on the cross-origin Google Fonts sheet
 * throws and aborts the whole export. So the cloned document rendered into the
 * image has no webfont and falls back - while the element was measured on a
 * page that did have it. The widths no longer agree and text lands on top of
 * other text: the headline over its own subtitle, the duration figures over
 * each other. Forcing the live document onto the fallback faces for the length
 * of the capture makes the measurement and the render agree again.
 *
 * The cost is that a downloaded report is set in the system face rather than
 * Plus Jakarta Sans, which is the same trade the light-theme forcing already
 * makes: the document is consistent for everyone who receives it, rather than
 * matching the console of whoever exported it.
 */
const EXPORT_SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const EXPORT_MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Lets the browser finish a style and layout pass before anything reads it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Runs `fn` with the document forced into the appearance a downloaded report
 * has - light palette, fallback typefaces - then restores.
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
export async function withExportAppearance<T>(fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  // Saved and put back rather than simply cleared: an inline value already on
  // the element would otherwise be lost.
  const priorSans = root.style.getPropertyValue('--font-sans');
  const priorMono = root.style.getPropertyValue('--font-mono');

  // Frozen even when the console is already light. A row mid-hover or a
  // spinner part-way through its turn is the same class of defect, and a
  // report is not the place to find out which animations were in flight.
  const freeze = document.createElement('style');
  freeze.id = 'dms-export-freeze';
  freeze.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
  document.head.appendChild(freeze);

  if (wasDark) root.classList.remove('dark');
  root.style.setProperty('--font-sans', EXPORT_SANS);
  root.style.setProperty('--font-mono', EXPORT_MONO);
  await nextFrame();

  try {
    return await fn();
  } finally {
    // Restored before the frame below, so the console is back on its own
    // typeface by the time anything is painted again.
    if (priorSans) root.style.setProperty('--font-sans', priorSans);
    else root.style.removeProperty('--font-sans');
    if (priorMono) root.style.setProperty('--font-mono', priorMono);
    else root.style.removeProperty('--font-mono');

    if (wasDark) root.classList.add('dark');
    // Same hazard in reverse: leave the freeze in place until the palette and
    // the typeface have been put back, or the console animates back in.
    await nextFrame();
    freeze.remove();
  }
}
