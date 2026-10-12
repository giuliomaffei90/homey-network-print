'use strict';
const { t } = require('./lib/i18n');
const { downloadImage } = require('./lib/download');
const { MAX_BYTES } = require('./lib/render');
module.exports = {
  async getLibrary({ homey }) { return homey.app.library.list(); },
  async getLibraryImage({ homey, params }) {
    const data = await homey.app.library.read(params.id); return { base64: data.toString('base64'), mime: 'image/jpeg' };
  },
  async getLibraryThumbnail({ homey, params }) {
    const data = await homey.app.library.read(params.id, true); return { base64: data?.toString('base64') || null };
  },
  async renameLibraryImage({ homey, params, body }) { return homey.app.library.rename(params.id, body.name); },
  async removeLibraryImage({ homey, params }) { return homey.app.library.remove(params.id); },
  async startLibraryUpload({ homey, body }) { return homey.app.uploads.start(body); },
  async appendLibraryUpload({ homey, params, body }) { return homey.app.uploads.chunk(params.id, body.index, body.base64); },
  async finishLibraryUpload({ homey, params, body }) { return homey.app.uploads.finish(params.id, body.thumbnail); },
  async cancelLibraryUpload({ homey, params }) { return homey.app.uploads.cancel(params.id); },
  async getPrinters({ homey }) {
    return homey.app.devices().map(d => ({ id: d.getData().id, name: d.getName(), uri: d.getSetting('uri'),
      status: d.getAvailable() ? d.getCapabilityValue('printer_status') : 'offline', busy: d.busy, lastResult: d.lastResult || null }));
  },
  async probe({ homey, body }) {
    const info = await homey.app.probe(body);
    return { uri: info.uri, name: info.name, model: info.model, accepting: info.accepting, state: info.state, formats: info.formats,
      paper: info.attributes['media-supported'], scaling: info.attributes['print-scaling-supported'] };
  },
  async printText({ homey, body }) { return homey.app.device(body.deviceId).printText(body.text); },
  async printImage({ homey, body }) {
    const device = homey.app.device(body.deviceId);
    if (body.url) return device.printImage(() => downloadImage(body.url));
    if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new Error(t('image_invalid_or_large'));
    return device.printImage(() => Buffer.from(body.base64, 'base64'));
  }
};
