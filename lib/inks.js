'use strict';
// Common supply codes (Epson and others); unknown names are shown as the printer reports them.
const CODES = { BK: 'black', K: 'black', MB: 'matte_black', PB: 'photo_black', C: 'cyan', M: 'magenta', Y: 'yellow',
  GY: 'grey', LC: 'light_cyan', LM: 'light_magenta', R: 'red' };

// IPP marker-* attributes (RFC 3805 units); negative levels mean "unknown", waste boxes fill up instead of emptying.
function inkLevels(a) {
  const names = a['marker-names'] || [], levels = a['marker-levels'] || [], highs = a['marker-high-levels'] || [],
    lows = a['marker-low-levels'] || [], types = a['marker-types'] || [], seen = new Set();
  return names.flatMap((raw, i) => {
    const name = String(raw).trim(), level = levels[i], high = highs[i] > 0 ? highs[i] : 100;
    if (typeof level !== 'number' || level < 0 || /waste/i.test(types[i] || '')) return [];
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `ink${i}`;
    while (seen.has(id)) id += `_${i}`;
    seen.add(id);
    const percent = value => Math.round(Math.min(100, value / high * 100));
    return [{ id, name, code: CODES[name.toUpperCase()] || null, level: percent(level), low: lows[i] >= 0 ? percent(lows[i]) : 15 }];
  });
}
module.exports = { inkLevels };
