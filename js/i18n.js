/**
 * Tiny locale layer. English is the fallback catalog; other languages are
 * JSON files registered in LOCALES. Adding German/Spanish later is:
 *   1. copy locales/en.json → locales/de.json and translate values
 *   2. add one entry to LOCALES below
 * UI code must use t("dotted.key") / data-i18n, never hard-coded copy.
 */
import en from "../locales/en.json" with { type: "json" };
import ja from "../locales/ja.json" with { type: "json" };

export const DEFAULT_LOCALE = "en";
export const LOCALE_LS_KEY = "plarail-locale";

/**
 * Registry of available languages. `flag` is the toolbar emoji.
 * `catalog` is the JSON dictionary (nested objects, dotted keys).
 */
export const LOCALES = {
  en: { id: "en", name: "English", flag: "🇺🇸", catalog: en },
  ja: { id: "ja", name: "日本語", flag: "🇯🇵", catalog: ja },
};

const listeners = new Set();
let current = DEFAULT_LOCALE;
let hintState = { key: "ui.loading", vars: null };

function lookup(catalog, key) {
  if (!catalog || !key) return undefined;
  const parts = String(key).split(".");
  let node = catalog;
  for (const part of parts) {
    if (node == null || typeof node !== "object" || !(part in node)) {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template, vars) {
  if (!vars || typeof template !== "string") return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] == null ? match : String(vars[name])
  );
}

export function localeIds() {
  return Object.keys(LOCALES);
}

export function getLocale() {
  return current;
}

export function hasKey(key) {
  return (
    lookup(LOCALES[current]?.catalog, key) != null ||
    lookup(LOCALES[DEFAULT_LOCALE]?.catalog, key) != null
  );
}

/** Translate a dotted key. Falls back to English, then the key itself. */
export function t(key, vars) {
  const raw =
    lookup(LOCALES[current]?.catalog, key) ??
    lookup(LOCALES[DEFAULT_LOCALE]?.catalog, key) ??
    key;
  return interpolate(raw, vars);
}

export function detectBrowserLocale(
  languages = globalThis.navigator?.languages || [
    globalThis.navigator?.language,
  ]
) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const lang of list) {
    const base = String(lang || "")
      .trim()
      .toLowerCase()
      .split(/[-_]/)[0];
    if (LOCALES[base]) return base;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocaleId(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return LOCALES[key] ? key : null;
}

export function onLocaleChange(fn) {
  if (typeof fn === "function") listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  const title = lookup(LOCALES[current]?.catalog, "meta.title");
  if (title && root === globalThis.document) {
    document.title = t("meta.title");
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", t("meta.description"));
  }
}

function syncLangButtons(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-locale]").forEach((btn) => {
    const on = btn.getAttribute("data-locale") === current;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

export function setLocale(id, opts = {}) {
  const persist = opts.persist !== false;
  const next = resolveLocaleId(id) || DEFAULT_LOCALE;
  current = next;
  if (persist && globalThis.localStorage) {
    try {
      localStorage.setItem(LOCALE_LS_KEY, next);
    } catch {
      /* ignore */
    }
  }
  if (globalThis.document?.documentElement) {
    document.documentElement.lang = next;
  }
  applyDom();
  syncLangButtons();
  replayHint();
  for (const fn of listeners) {
    try {
      fn(next);
    } catch (err) {
      console.warn("locale listener failed", err);
    }
  }
  return next;
}

export function rememberHint(key, vars) {
  if (hasKey(key)) hintState = { key, vars: vars || null };
}

export function replayHint(setText) {
  if (!hintState?.key) return;
  const text = t(hintState.key, hintState.vars);
  if (typeof setText === "function") setText(text);
  else if (globalThis.document) {
    const el = document.getElementById("hint");
    if (el) el.textContent = text;
  }
}

export function bindLangToggle(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-locale]").forEach((btn) => {
    if (btn.dataset.langBound) return;
    btn.dataset.langBound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setLocale(btn.getAttribute("data-locale"), { persist: true });
    });
  });
  syncLangButtons(root);
}

function localeFromSearch(search = globalThis.location?.search) {
  try {
    const query = new URLSearchParams(
      typeof search === "string" ? search.replace(/^\?/, "") : search || ""
    );
    return resolveLocaleId(query.get("lang") || query.get("locale"));
  } catch {
    return null;
  }
}

export function initI18n(opts = {}) {
  const fromQuery = localeFromSearch(opts.search);
  let stored = null;
  try {
    stored = resolveLocaleId(localStorage.getItem(LOCALE_LS_KEY));
  } catch {
    stored = null;
  }
  const initial =
    fromQuery || stored || detectBrowserLocale(opts.languages) || DEFAULT_LOCALE;
  setLocale(initial, { persist: false });
  bindLangToggle(opts.root);
  return initial;
}
