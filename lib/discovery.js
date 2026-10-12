'use strict';
const { normalizeUri } = require('./ipp');

function groupPrinters(found, paired = []) {
  const groups = new Map();
  for (const { item, protocol } of found) {
    const txt = Object.fromEntries(Object.entries(item.txt || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const host = item.address || item.host;
    if (!host) continue;
    try {
      const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      const resource = (txt.rp || 'ipp/print').replace(/^\//, '');
      const uri = normalizeUri(`${protocol}://${address}:${item.port || 631}/${resource}`);
      // Group the two transports of one queue, but keep a NAS queue distinct.
      const key = `${String(host).toLowerCase()}|${resource}`;
      const existing = groups.get(key);
      const name = item.name || txt.ty || host;
      const isPaired = paired.some(p => {
        try { const u = new URL(p.uri); return u.hostname.toLowerCase() === new URL(uri).hostname.toLowerCase() && u.pathname === new URL(uri).pathname; } catch { return false; }
      });
      if (!existing || protocol === 'ipps') groups.set(key, { name, uri, model: txt.ty || '', host,
        secure: protocol === 'ipps', shared: /^printers\//i.test(resource) || /\s@\s/.test(name), paired: isPaired });
    } catch { /* Ignore malformed discovery announcements, keep the other devices. */ }
  }
  return [...groups.values()].sort((a,b) => Number(a.shared) - Number(b.shared) || a.name.localeCompare(b.name));
}
module.exports = { groupPrinters };
