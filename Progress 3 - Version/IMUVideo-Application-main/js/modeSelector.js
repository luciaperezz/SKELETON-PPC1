/**
 * modeSelector.js
 *
 * Initial landing screen that lets the user choose a mode.
 *
 * Today: 1 button ("Video upload mode").
 * Future: add more buttons inside #modeSelector with data-mode set.
 *
 * How it works:
 * - #modeSelector is a fullscreen overlay.
 * - #appRoot starts hidden (opacity 0, pointer-events none).
 * - When a mode is selected, we:
 *     1) fade out #modeSelector
 *     2) fade in #appRoot
 *
 * This intentionally does NOT change any of the app's existing logic.
 * It only controls what the user sees first.
 */

(function () {
  "use strict";

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(() => {
    const selector = document.getElementById("modeSelector");
    const appRoot = document.getElementById("appRoot");

    if (!selector || !appRoot) return;

    // Ensure initial state is correct even if CSS changes later.
    selector.classList.remove("is-hidden");
    appRoot.classList.remove("is-visible");
    appRoot.setAttribute("aria-hidden", "true");

    // Make the first button keyboard-focusable immediately.
    const firstButton = selector.querySelector("button[data-mode]");
    if (firstButton) firstButton.focus();

    // Handle clicks for current and future buttons.
    selector.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;

      const mode = btn.getAttribute("data-mode");
      enterMode(mode);
    });

    // Also allow Enter/Space activation when focused.
    selector.addEventListener("keydown", (e) => {
      const active = document.activeElement;
      if (!active || !active.matches("button[data-mode]")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const mode = active.getAttribute("data-mode");
        enterMode(mode);
      }
    });

    function enterMode(mode) {
      // If you add more modes in the future, this is where you can
      // persist the choice or toggle different panels.
      // For now, we only have one mode.
      window.SELECTED_MODE = mode || "upload";

      // Fade overlay out, fade app in.
      selector.classList.add("is-hidden");

      // Trigger transition on next frame so the browser doesn't
      // merge the class toggles into one paint.
      requestAnimationFrame(() => {
        appRoot.classList.add("is-visible");
        appRoot.setAttribute("aria-hidden", "false");
      });

      // Optional: after the fade completes, remove selector from tab order.
      const afterFadeMs = 400;
      window.setTimeout(() => {
        selector.setAttribute("aria-hidden", "true");
      }, afterFadeMs);
    }
  });
})();
