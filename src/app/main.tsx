import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../shared/styles/app.css';
import '../shared/lib/i18n';

/*
 * The original implementation here attached a global scroll listener that
 * toggled a `scrollbars-active` class on the root element. When active, the
 * CSS defined a visible scrollbar thumb; when inactive, the thumb was
 * transparent. This produced a neat auto‑hide effect for scrollbars.
 *
 * Unfortunately, WebView2 on Windows treats changes to the scrollbars as a
 * focus change. Each time the class was toggled, the host window lost and
 * regained focus, causing the title bar to flicker between its active
 * (black) and inactive (grey) states. Users reported seeing a grey/black
 * flash in the header whenever they scrolled or navigated between views.
 *
 * To prevent this flicker, we've removed the event listener entirely and
 * rely on standard scrollbars. If you reintroduce a custom scrollbar
 * implementation, avoid toggling classes that could cause focus loss.
 */

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
