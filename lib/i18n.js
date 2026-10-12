'use strict';
// Backend messages share locales/*.json with the settings and pairing pages.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../locales');
const locales = Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), require(path.join(dir, f))]));
let language = 'en';

const lookup = (lang, section, key) => locales[lang]?.[section]?.[key] ?? locales.en[section]?.[key];
function setLanguage(lang) { language = locales[lang] ? lang : 'en'; }
function t(key, vars = {}) {
  return (lookup(language, 'errors', key) ?? key).replace(/__(\w+)__/g, (_, name) => vars[name] ?? '');
}
function inkName(ink, lang = language) { return (ink.code && lookup(lang, 'inks', ink.code)) || ink.name; }
function inkTitles(ink) { return Object.fromEntries(Object.keys(locales).map(lang => [lang, inkName(ink, lang)])); }
module.exports = { setLanguage, t, inkName, inkTitles };
