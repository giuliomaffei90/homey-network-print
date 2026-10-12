'use strict';
const { t, setLanguage, inkName } = require('./lib/i18n');
const Homey = require('homey');
const { inspect } = require('./lib/ipp');
const { downloadImage } = require('./lib/download');
const { collect } = require('./lib/render');
const crypto = require('node:crypto');
const { ImageLibrary, LibraryUploads } = require('./lib/library');

class NetworkPrintApp extends Homey.App {
  async onInit() {
    setLanguage(this.homey.i18n.getLanguage());
    let key = this.homey.settings.get('libraryEncryptionKey');
    if (!key) { key = crypto.randomBytes(32).toString('hex'); this.homey.settings.set('libraryEncryptionKey', key); }
    this.library = new ImageLibrary('/userdata/print-library', key);
    await this.library.init();
    this.uploads = new LibraryUploads(this.library);
    const libraryCard = this.homey.flow.getActionCard('print_library_image');
    libraryCard.registerArgumentAutocompleteListener('image', async query => this.library.list().items
      .filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map(item => ({ id: item.id, name: item.name, description: `${item.width} × ${item.height} px` })));
    libraryCard.registerRunListener(async ({ device, image }) => {
      if (!image?.id) throw new Error(t('choose_library_image'));
      await device.printImage(() => this.library.read(image.id)); return true;
    });
    this.homey.flow.getActionCard('print_text').registerRunListener(async ({ device, text }) => { await device.printText(text); return true; });
    this.homey.flow.getActionCard('print_image_url').registerRunListener(async ({ device, url }) => { await device.printImage(() => downloadImage(url)); return true; });
    this.homey.flow.getActionCard('print_image_token').registerRunListener(async ({ device, droptoken }) => {
      if (!droptoken || typeof droptoken.getStream !== 'function') throw new Error(t('invalid_image_tag'));
      await device.printImage(async () => collect(await droptoken.getStream())); return true;
    });
    this.homey.flow.getConditionCard('printer_ready').registerRunListener(async ({ device }) => { const info = await device.refresh(); return info.accepting && info.state !== 5; });
    const inkBelow = this.homey.flow.getConditionCard('ink_below');
    inkBelow.registerArgumentAutocompleteListener('ink', async (query, { device }) => [{ id: '*', name: inkName({ code: 'any' }) },
      ...(device?.inks || []).map(ink => ({ id: ink.id, name: inkName(ink), description: `${ink.level}%` }))]
      .filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    inkBelow.registerRunListener(async ({ device, ink, level }) => {
      if (!device.inks) await device.refresh(); // Levels are refreshed every minute.
      const inks = device.inks || [];
      if (ink.id === '*') return inks.some(x => x.level < level);
      const found = inks.find(x => x.id === ink.id);
      if (!found) throw new Error(t('ink_unknown'));
      return found.level < level;
    });
    this.log('Network Print pronto.');
  }
  devices() { return this.homey.drivers.getDriver('printer').getDevices(); }
  device(id) { const device = this.devices().find(d => d.getData().id === id); if (!device) throw new Error(t('printer_not_found')); return device; }
  async probe(body) { return inspect(body.uri, { allowSelfSigned: body.allowSelfSigned === true }); }
}
module.exports = NetworkPrintApp;
