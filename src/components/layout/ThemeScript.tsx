/**
 * Inline script that runs before React hydration to set the correct theme
 * on <html>, preventing a flash of wrong theme. This avoids hydration mismatch
 * because it runs synchronously before paint.
 *
 * The script content is a hardcoded string literal with no user input,
 * so there is no XSS risk from dangerouslySetInnerHTML here.
 */
export function ThemeScript() {
  const script = `
    (function() {
      try {
        var t = localStorage.getItem('theme');
        if (t === 'system' || !t) {
          t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', t);
      } catch(e) {}
    })();
  `;
  // Safe: script is a static string literal, no user input involved
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
