'use strict';
const { t } = require('./i18n');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageToJpeg, imageInfo, MAX_BYTES } = require('./render');
const QUOTA = 50 * 1024 * 1024;
const MAX_ITEMS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ImageLibrary {
  constructor(root, key, quota = QUOTA) {
    this.root = root; this.key = Buffer.from(key, 'hex'); this.quota = quota;
    if (this.key.length !== 32) throw new Error(t('library_key'));
    this.items = []; this.queue = Promise.resolve();
  }
  seal(data) {
    const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([Buffer.from('NPL1'), nonce, cipher.getAuthTag(), body]);
  }
  open(data) {
    if (data.length < 32 || data.subarray(0,4).toString() !== 'NPL1') throw new Error(t('library_archive'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, data.subarray(4,16));
    decipher.setAuthTag(data.subarray(16,32));
    return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
  }
  async atomic(name, data) {
    const tmp = path.join(this.root, `${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(tmp, this.seal(data), { mode: 0o600 }); await fs.rename(tmp, path.join(this.root, name)); }
    finally { await fs.unlink(tmp).catch(() => {}); }
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      const saved = JSON.parse(this.open(await fs.readFile(path.join(this.root, 'index.enc'))));
      if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error(t('library_version'));
      this.items = saved.items;
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    // Interrupted writes leave only encrypted, unreferenced blobs; clean them up.
    const referenced = new Set(this.items.flatMap(x => [x.file, x.thumb].filter(Boolean)));
    for (const file of await fs.readdir(this.root)) {
      if ((file.endsWith('.bin') || file.endsWith('.tmp')) && !referenced.has(file)) await fs.unlink(path.join(this.root,file)).catch(() => {});
    }
  }
  locked(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async commit(items) { await this.atomic('index.enc', Buffer.from(JSON.stringify({ version: 1, items }))); this.items = items; }
  name(value) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error(t('name_length')); return value.trim(); }
  find(id) { const entry = this.items.find(x => x.id === id); if (!entry) throw new Error(t('image_not_found')); return entry; }
  list() { return { items: this.items.map(({ file, thumb, ...item }) => ({ ...item, hasThumbnail: !!thumb })).sort((a,b) => a.name.localeCompare(b.name)),
    usedBytes: this.items.reduce((n,x) => n + x.bytes + (x.thumbnailBytes || 0), 0), maxBytes: this.quota, maxItems: MAX_ITEMS }; }
  async read(id, thumbnail = false) {
    return this.locked(async () => { const entry = this.find(id), filename = thumbnail ? entry.thumb : entry.file;
      if (!filename) return null; return this.open(await fs.readFile(path.join(this.root, filename))); });
  }
  async save({ name, data, thumbnail, replaceId, importId }) {
    return this.locked(async () => {
      name = this.name(name);
      const old = replaceId ? this.find(replaceId) : null;
      if (!old && this.items.length >= MAX_ITEMS) throw new Error(t('library_max_items'));
      if (importId && (!UUID.test(importId) || this.items.some(x => x.id === importId))) throw new Error(t('backup_id'));
      const jpeg = imageToJpeg(data), info = imageInfo(jpeg);
      if (jpeg.length > MAX_BYTES) throw new Error(t('converted_too_large'));
      if (thumbnail) {
        const ti = imageInfo(thumbnail);
        if (ti.type !== 'jpeg' || ti.width > 400 || ti.height > 400 || thumbnail.length > 200000) throw new Error(t('thumbnail_invalid'));
      }
      const used = this.list().usedBytes - (old ? old.bytes + (old.thumbnailBytes || 0) : 0);
      if (used + jpeg.length + (thumbnail?.length || 0) > this.quota) throw new Error(t('library_full'));
      const entry = { id: old?.id || importId || crypto.randomUUID(), name, bytes: jpeg.length, width: info.width, height: info.height,
        file: `${crypto.randomUUID()}.bin`, thumb: thumbnail ? `${crypto.randomUUID()}.bin` : null,
        thumbnailBytes: thumbnail?.length || 0, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      try {
        await this.atomic(entry.file, jpeg);
        if (thumbnail) await this.atomic(entry.thumb, thumbnail);
        await this.commit(old ? this.items.map(x => x.id === old.id ? entry : x) : [...this.items, entry]);
      } catch (err) { await this.cleanup(entry); throw err; }
      if (old) await this.cleanup(old);
      return this.list().items.find(x => x.id === entry.id);
    });
  }
  async cleanup(entry) { for (const file of [entry.file, entry.thumb].filter(Boolean)) await fs.unlink(path.join(this.root,file)).catch(() => {}); }
  async rename(id, name) { return this.locked(async () => { this.find(id); name = this.name(name); await this.commit(this.items.map(x => x.id === id ? { ...x, name, updatedAt: new Date().toISOString() } : x)); return this.list(); }); }
  async remove(id) { return this.locked(async () => { const old = this.find(id); await this.commit(this.items.filter(x => x.id !== id)); await this.cleanup(old); return this.list(); }); }
}

// Chunked uploads stay in memory and never become public temporary files.
class LibraryUploads {
  constructor(library) { this.library = library; this.pending = new Map(); }
  prune() { for (const [id,s] of this.pending) if (Date.now() - s.touched > 120000 && !s.finishing) this.pending.delete(id); }
  start(input) {
    this.prune();
    if (this.pending.size >= 2) throw new Error(t('upload_busy'));
    const name = this.library.name(input.name), bytes = Number(input.bytes);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw new Error(t('file_too_large'));
    const id = crypto.randomUUID();
    this.pending.set(id, { name, bytes, replaceId: input.replaceId, importId: input.importId, chunks: [], size: 0, touched: Date.now() });
    return { id, chunkBytes: 192 * 1024 };
  }
  get(id) { this.prune(); const s = this.pending.get(id); if (!s) throw new Error(t('upload_expired')); return s; }
  chunk(id, index, base64) {
    const s = this.get(id);
    if (s.finishing || index !== s.chunks.length || typeof base64 !== 'string' || base64.length > 262144 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error(t('chunk_invalid'));
    const buffer = Buffer.from(base64, 'base64');
    if (s.size + buffer.length > s.bytes) throw new Error(t('size_invalid'));
    s.chunks.push(buffer); s.size += buffer.length; s.touched = Date.now(); return { receivedBytes: s.size };
  }
  async finish(id, thumbnailBase64) {
    const s = this.get(id);
    if (s.finishing) return s.finishing;
    if (s.size !== s.bytes) throw new Error(t('upload_incomplete'));
    if (thumbnailBase64 && (typeof thumbnailBase64 !== 'string' || thumbnailBase64.length > 270000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(thumbnailBase64))) throw new Error(t('thumbnail_invalid'));
    s.finishing = this.library.save({ ...s, data: Buffer.concat(s.chunks), thumbnail: thumbnailBase64 ? Buffer.from(thumbnailBase64,'base64') : null });
    try { return await s.finishing; } finally { this.pending.delete(id); }
  }
  cancel(id) { const s = this.pending.get(id); if (!s?.finishing) this.pending.delete(id); return true; }
}
module.exports = { ImageLibrary, LibraryUploads, QUOTA };
