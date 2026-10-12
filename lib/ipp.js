'use strict';
const { t } = require('./i18n');

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const TAG = { integer: 0x21, boolean: 0x22, enum: 0x23, text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, charset: 0x47, language: 0x48, mime: 0x49 };

function normalizeUri(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(t('uri_missing'));
  const input = value.trim();
  const url = new URL(input.includes('://') ? input : `ipp://${input}`);
  if (!['ipp:', 'ipps:', 'http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(t('uri_invalid'));
  }
  const secure = ['ipps:', 'https:'].includes(url.protocol);
  const port = url.port || (url.protocol === 'http:' ? '80' : url.protocol === 'https:' ? '443' : '631');
  const path = url.pathname && url.pathname !== '/' ? url.pathname : '/ipp/print';
  return `${secure ? 'ipps' : 'ipp'}://${url.hostname}:${port}${path}`;
}

function attribute(name, value, tag) {
  const key = Buffer.from(name);
  let data;
  if ([TAG.integer, TAG.enum].includes(tag)) { data = Buffer.alloc(4); data.writeInt32BE(value); }
  else if (tag === TAG.boolean) data = Buffer.from([value ? 1 : 0]);
  else data = Buffer.from(String(value));
  const a = Buffer.alloc(3); a[0] = tag; a.writeUInt16BE(key.length, 1);
  const b = Buffer.alloc(2); b.writeUInt16BE(data.length);
  return Buffer.concat([a, key, b, data]);
}

function encode(operation, uri, attributes = [], job = [], requestId = 1) {
  const header = Buffer.alloc(8); header.writeUInt16BE(0x0200); header.writeUInt16BE(operation, 2); header.writeUInt32BE(requestId, 4);
  const chunks = [header, Buffer.from([1]), attribute('attributes-charset', 'utf-8', TAG.charset),
    attribute('attributes-natural-language', 'it', TAG.language), attribute('printer-uri', uri, TAG.uri)];
  for (const [name, value, tag] of attributes) chunks.push(attribute(name, value, tag));
  if (job.length) { chunks.push(Buffer.from([2])); for (const [name, value, tag] of job) chunks.push(attribute(name, value, tag)); }
  chunks.push(Buffer.from([3]));
  return Buffer.concat(chunks);
}

function decode(buffer) {
  if (buffer.length < 9 || ![1, 2].includes(buffer[0])) throw new Error(t('ipp_invalid'));
  const status = buffer.readUInt16BE(2), requestId = buffer.readUInt32BE(4), attributes = {};
  let offset = 8, last = '', depth = 0, ended = false;
  while (offset < buffer.length) {
    const tag = buffer[offset++];
    if (tag === 3) { ended = true; break; }
    if (tag < 0x10) { last = ''; continue; }
    if (offset + 2 > buffer.length) throw new Error(t('ipp_truncated'));
    const keySize = buffer.readUInt16BE(offset); offset += 2;
    if (offset + keySize + 2 > buffer.length) throw new Error(t('ipp_truncated'));
    const key = buffer.subarray(offset, offset + keySize).toString(); offset += keySize;
    const valueSize = buffer.readUInt16BE(offset); offset += 2;
    if (offset + valueSize > buffer.length) throw new Error(t('ipp_truncated'));
    const raw = buffer.subarray(offset, offset + valueSize); offset += valueSize;
    if (tag === 0x34) { depth++; continue; }
    if (tag === 0x37) { depth--; continue; }
    if (depth) continue;
    if (key) last = key;
    if (!last) continue;
    let value = raw.toString();
    if ([TAG.integer, TAG.enum].includes(tag) && raw.length === 4) value = raw.readInt32BE();
    else if (tag === TAG.boolean) value = !!raw[0];
    else if (tag === 0x33 && raw.length === 8) value = [raw.readInt32BE(), raw.readInt32BE(4)];
    (attributes[last] ||= []).push(value);
  }
  if (!ended) throw new Error(t('ipp_truncated'));
  return { status, requestId, attributes };
}

function transport(uri, body, { timeout = 10000, allowSelfSigned = false } = {}) {
  const url = new URL(uri), secure = url.protocol === 'ipps:';
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request({ hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || 631,
      path: url.pathname, method: 'POST', rejectUnauthorized: !allowSelfSigned,
      headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) res.destroy(new Error(t('ipp_too_large'))); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => req.destroy(new Error(t('printer_timeout'))), timeout);
    req.once('close', () => clearTimeout(timer));
    // Epson responds with Connection: Upgrade on 426; Node emits 'upgrade'
    // instead of invoking the normal response callback in that case.
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, body: Buffer.alloc(0) }); });
    req.on('error', reject);
    req.end(body);
  });
}

async function request(uri, operation, attributes = [], job = [], data = Buffer.alloc(0), options = {}) {
  uri = normalizeUri(uri);
  const requestId = crypto.randomInt(1, 0x7fffffff);
  const body = Buffer.concat([encode(operation, uri, attributes, job, requestId), data]);
  const response = await transport(uri, body, options);
  // Only discovery is retried over TLS. Never retry a Print-Job after an ambiguous response.
  if (response.status === 426 && operation === 0x0b && uri.startsWith('ipp:')) {
    return request(uri.replace(/^ipp:/, 'ipps:'), operation, attributes, job, data, options);
  }
  if (response.status !== 200) throw new Error(t('printer_http', { status: response.status, path: new URL(uri).pathname }));
  const result = decode(response.body);
  if (result.requestId !== requestId) throw new Error(t('ipp_unexpected_id'));
  if (result.status >= 0x0100) throw new Error(t('ipp_status', { code: result.status.toString(16), message: result.attributes['status-message']?.[0] || t('ipp_rejected') }));
  return { ...result, uri };
}

async function inspect(uri, options) {
  const result = await request(uri, 0x0b, [['requested-attributes', 'all', TAG.keyword]], [], undefined, options);
  const a = result.attributes;
  if (!a['document-format-supported']?.includes('image/jpeg')) throw new Error(t('no_jpeg'));
  return { uri: result.uri, attributes: a, name: a['printer-info']?.[0] || a['printer-make-and-model']?.[0] || a['printer-name']?.[0] || 'Stampante',
    uuid: a['printer-uuid']?.[0], model: a['printer-make-and-model']?.[0] || 'IPP', state: a['printer-state']?.[0],
    accepting: a['printer-is-accepting-jobs']?.[0] !== false, formats: a['document-format-supported'] || [] };
}

function jobOptions(info, settings) {
  const a = info.attributes;
  if (!info.accepting || info.state === 5) throw new Error(t('printer_paused'));
  const blocking = (a['printer-state-reasons'] || []).filter(x => /-error$|^media-empty$|^media-jam$|^door-open$/.test(x));
  if (blocking.length) throw new Error(t('check_printer', { reasons: blocking.join(', ') }));
  const attrs = [['copies', 1, TAG.integer]];
  const choices = { media: settings.paper, 'print-color-mode': settings.color, 'print-scaling': settings.scaling, sides: 'one-sided' };
  for (const [key, value] of Object.entries(choices)) {
    const supported = a[`${key}-supported`];
    if (!value || value === 'auto') continue;
    if (!supported) { if (key === 'sides') continue; throw new Error(t('option_undeclared', { option: key })); }
    if (!supported.includes(value)) throw new Error(t('option_unsupported', { option: key, value }));
    attrs.push([key, value, TAG.keyword]);
  }
  return attrs;
}

async function printJpeg(info, jpeg, settings, name, options) {
  const attrs = jobOptions(info, settings);
  const result = await request(info.uri, 2, [['requesting-user-name', 'Homey', TAG.name], ['job-name', name, TAG.name],
    ['document-format', 'image/jpeg', TAG.mime]], attrs, jpeg, { ...options, timeout: 60000 });
  return { jobId: result.attributes['job-id']?.[0] ?? null, status: result.status };
}

module.exports = { TAG, normalizeUri, attribute, encode, decode, request, inspect, jobOptions, printJpeg };
