'use strict';
const { t } = require('../../lib/i18n');
const Homey = require('homey');
const { inspect, normalizeUri } = require('../../lib/ipp');
const crypto = require('node:crypto');
const { groupPrinters } = require('../../lib/discovery');

class PrinterDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('discover', async () => {
      const found = ['ipp', 'ipps'].flatMap(protocol => Object.values(this.homey.discovery.getStrategy(protocol).getDiscoveryResults()).map(item => ({ item, protocol })));
      return groupPrinters(found, this.getDevices().map(d => ({ uri: d.getSetting('uri') })));
    });
    session.setHandler('verify', async input => {
      const info = await inspect(input.uri, { allowSelfSigned: input.allowSelfSigned === true });
      const id = info.uuid || crypto.createHash('sha256').update(info.uri).digest('hex');
      if (this.getDevices().some(device => device.getData().id === id)) throw new Error(t('already_added'));
      return { name: input.name?.trim() || info.name, data: { id }, settings: { uri: info.uri, allow_self_signed: input.allowSelfSigned === true,
        paper: 'iso_a4_210x297mm', color: 'auto', scaling: 'auto', font_size: 12 }, store: { model: info.model } };
    });
  }
}
module.exports = PrinterDriver;
