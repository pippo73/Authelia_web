"use strict";

// Minimal i18n: loads a flat key->string JSON per language from /locales/<code>.json.
// Available languages come from /api/locales (the backend scans the folder), so
// adding a language means just dropping a new JSON file there.
const I18n = (() => {
  let dict = {};
  let currentCode = "en";
  let languages = [];

  // Translate a key; {name} placeholders are filled from params. Missing key -> key.
  function t(key, params) {
    let str = dict[key] != null ? dict[key] : key;
    if (params) {
      for (const name in params) {
        str = str.split("{" + name + "}").join(params[name]);
      }
    }
    return str;
  }

  async function loadLanguages() {
    const res = await fetch("/api/locales");
    languages = await res.json(); // [{code, name}]
    return languages;
  }

  async function setLanguage(code) {
    const res = await fetch("/locales/" + code + ".json");
    if (!res.ok) throw new Error("locale not found: " + code);
    dict = await res.json();
    currentCode = code;
    localStorage.setItem("lang", code);
    document.documentElement.lang = code;
    applyDom();
  }

  // Apply translations to any element carrying a data-i18n* attribute.
  function applyDom(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((e) => {
      e.textContent = t(e.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((e) => {
      e.placeholder = t(e.getAttribute("data-i18n-placeholder"));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((e) => {
      e.title = t(e.getAttribute("data-i18n-title"));
    });
    root.querySelectorAll("[data-i18n-tip]").forEach((e) => {
      e.setAttribute("data-tip", t(e.getAttribute("data-i18n-tip")));
    });
  }

  // Pick the initial language: saved choice, else browser language, else en/first.
  function pick() {
    const codes = languages.map((l) => l.code);
    const saved = localStorage.getItem("lang");
    if (saved && codes.includes(saved)) return saved;
    const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    if (codes.includes(nav)) return nav;
    return codes.includes("en") ? "en" : codes[0];
  }

  return {
    t,
    loadLanguages,
    setLanguage,
    applyDom,
    pick,
    get code() { return currentCode; },
    get languages() { return languages; },
  };
})();
