/* Minimal welcome transition. No network, speech, microphone, or route writes. */
(function (root) {
  'use strict';
  let timer = null;
  let finished = false;
  let started = false;
  const read = (store, key) => { try { return root[store].getItem(key); } catch (_) { return null; } };
  const write = (store, key, value) => { try { root[store].setItem(key, value); } catch (_) {} };
  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    const button = document.getElementById('jamesThemeToggle');
    if (button) {
      button.textContent = selected === 'dark' ? 'Light' : 'Dark';
      button.setAttribute('aria-label', selected === 'dark' ? 'Use light theme' : 'Use dark theme');
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'dark' ? '#071225' : '#f6f2e9');
    return selected;
  }
  function finish() {
    if (finished) return;
    finished = true;
    root.clearTimeout(timer);
    timer = null;
    write('sessionStorage', 'jamesIntroDate', new Date().toDateString());
    const intro = document.getElementById('intro');
    const app = document.getElementById('app');
    if (intro) { intro.classList.add('hide'); intro.inert = true; intro.setAttribute('aria-hidden', 'true'); }
    if (app) { app.inert = false; app.classList.remove('frosted'); app.classList.add('clear'); }
    // The same Perspective remains available in the Briefing for unhurried reading.
  }
  function start(options = {}) {
    if (started) return;
    started = true;
    applyTheme(read('localStorage', 'jamesTheme'));
    document.getElementById('jamesThemeToggle')?.addEventListener('click', () => {
      const theme = applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      write('localStorage', 'jamesTheme', theme);
    });
    const seen = read('sessionStorage', 'jamesIntroDate') === new Date().toDateString();
    const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (seen || reduced) {
      finish();
      if (seen && typeof options.onResume === 'function') options.onResume();
      return;
    }
    const app = document.getElementById('app');
    if (app) app.inert = true;
    timer = root.setTimeout(finish, 5000);
    // Do not leave a stale transition attached to a page restored from history.
    root.addEventListener('pagehide', finish, { once: true });
  }
  root.JamesWelcome = Object.freeze({ start, finish, applyTheme });
})(window);
