'use strict';
// Backend messages share locales/*.json with the settings and pairing pages.
const fallback = require('../locales/en.json').errors;
let strings = fallback;

function setLanguage(lang) {
  try { strings = require(`../locales/${lang}.json`).errors || fallback; } catch { strings = fallback; }
}
function t(key, vars = {}) {
  return (strings[key] || fallback[key] || key).replace(/__(\w+)__/g, (_, name) => vars[name] ?? '');
}
module.exports = { setLanguage, t };
