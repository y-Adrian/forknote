/**
 * Early boot: theme, locale, and UI font preference before React mounts.
 * Kept as an external script so packaged CSP can use script-src 'self'.
 */
(function () {
  try {
    var key = "forknote-theme";
    var pref = localStorage.getItem(key);
    var theme =
      pref === "light" || pref === "dark"
        ? pref
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  try {
    var loc = localStorage.getItem("forknote-locale");
    if (loc !== "en" && loc !== "zh") {
      loc =
        (navigator.language || "").toLowerCase().indexOf("zh") === 0
          ? "zh"
          : "en";
    }
    document.documentElement.lang = loc === "zh" ? "zh-CN" : "en";
  } catch (e) {
    /* keep html lang */
  }
  try {
    var uiFont = localStorage.getItem("forknote-ui-font");
    var root = document.documentElement;
    if (!uiFont || uiFont === "default") {
      root.setAttribute("data-ui-font", "default");
    } else if (uiFont === "system") {
      root.setAttribute("data-ui-font", "system");
    } else {
      var family = uiFont.indexOf("family:") === 0 ? uiFont.slice(7) : uiFont;
      family = String(family || "").trim();
      if (family) {
        root.setAttribute("data-ui-font", "custom");
        root.style.setProperty(
          "--fn-ui-font-family",
          '"' + family.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"',
        );
      } else {
        root.setAttribute("data-ui-font", "default");
      }
    }
  } catch (e) {
    document.documentElement.setAttribute("data-ui-font", "default");
  }
})();
