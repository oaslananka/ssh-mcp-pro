/* Small, accessible theme shortcut. TypeDoc owns the actual theme setting. */
(() => {
  "use strict";
  const THEME_KEY = "tsd-theme";

  function init() {
    const toolbar = document.querySelector(".tsd-toolbar-contents");
    const existingTheme = document.getElementById("tsd-theme");
    const search = document.getElementById("tsd-search-trigger");
    if (!toolbar || !existingTheme || !search || document.getElementById("docs-theme-switch"))
      return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "docs-theme-switch";
    button.className = "docs-theme-switch";
    button.title = "Toggle light and dark theme";
    button.setAttribute("aria-label", "Switch to dark theme");

    const icon = document.createElement("span");
    icon.className = "docs-theme-icon";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    search.before(button);

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const activeTheme = () => {
      const current = document.documentElement.dataset.theme;
      return current === "dark" || (current !== "light" && prefersDark.matches) ? "dark" : "light";
    };
    const update = () => {
      const dark = activeTheme() === "dark";
      icon.textContent = dark ? "☀" : "☾";
      button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      button.title = dark ? "Use light theme" : "Use dark theme";
      button.setAttribute("aria-pressed", String(dark));
    };
    button.addEventListener("click", () => {
      const next = activeTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* Private browsing. */
      }
      existingTheme.value = next;
      existingTheme.dispatchEvent(new Event("change", { bubbles: true }));
      update();
    });
    existingTheme.addEventListener("change", update);
    prefersDark.addEventListener?.("change", update);
    update();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
