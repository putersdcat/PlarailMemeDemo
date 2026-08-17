import { test, assert, assertEq } from "./assert.mjs";
import {
  t,
  hasKey,
  setLocale,
  getLocale,
  detectBrowserLocale,
  resolveLocaleId,
  localeIds,
  LOCALES,
  DEFAULT_LOCALE,
} from "../js/i18n.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkKeys(node, prefix = "") {
  const keys = [];
  if (!node || typeof node !== "object") return keys;
  for (const [name, value] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") keys.push(key);
    else keys.push(...walkKeys(value, key));
  }
  return keys;
}

test("English is the default locale and Japanese is registered", () => {
  assertEq(DEFAULT_LOCALE, "en");
  assert(localeIds().includes("en"));
  assert(localeIds().includes("ja"));
  assertEq(LOCALES.ja.flag, "🇯🇵");
  assertEq(LOCALES.en.flag, "🇺🇸");
});

test("Japanese catalog covers every English key", () => {
  const en = JSON.parse(readFileSync(join(root, "locales/en.json"), "utf8"));
  const ja = JSON.parse(readFileSync(join(root, "locales/ja.json"), "utf8"));
  const enKeys = walkKeys(en);
  const jaKeys = new Set(walkKeys(ja));
  const missing = enKeys.filter((key) => !jaKeys.has(key));
  assertEq(missing.join(","), "", `JA missing keys: ${missing.join(", ")}`);
});

test("t() interpolates and falls back to English", () => {
  setLocale("en", { persist: false });
  assertEq(t("ui.start"), "Start");
  assertEq(t("hint.midLimit", { max: 3 }), "Mid car limit reached (max 3).");
  setLocale("ja", { persist: false });
  assertEq(t("ui.start"), "スタート");
  assertEq(getLocale(), "ja");
  assert(t("hint.running").includes("走行"));
  setLocale("en", { persist: false });
});

test("missing keys fall back instead of throwing", () => {
  setLocale("en", { persist: false });
  assertEq(hasKey("no.such.key"), false);
  assertEq(t("no.such.key"), "no.such.key");
  assert(hasKey("ui.start"));
});

test("browser ja-* locales resolve to Japanese", () => {
  assertEq(detectBrowserLocale(["ja-JP", "en-US"]), "ja");
  assertEq(detectBrowserLocale(["en-GB"]), "en");
  assertEq(detectBrowserLocale(["de-DE", "fr"]), "en");
  assertEq(resolveLocaleId("ja-JP"), "ja");
  assertEq(resolveLocaleId("de"), null);
});
