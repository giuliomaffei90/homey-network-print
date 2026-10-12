'use strict';
const { t, inkName, inkTitles } = require('../../lib/i18n');
const { inkLevels } = require('../../lib/inks');
const Homey = require('homey');
const { inspect, jobOptions, printJpeg } = require('../../lib/ipp');
const { imageToJpeg, textLayout, renderPage } = require('../../lib/render');

class PrinterDevice extends Homey.Device {
  async onInit() {
    this.busy = false;
    await this.refresh().catch(err => this.setUnavailable(err.message));
    this.timer = this.homey.setInterval(() => { if (!this.busy) this.refresh().catch(err => this.setUnavailable(err.message)).catch(err => this.error(err)); }, 60000);
  }
  connection(settings = this.getSettings()) { return { allowSelfSigned: settings.allow_self_signed === true }; }
  async refresh() {
    const info = await inspect(this.getSetting('uri'), this.connection());
    this.info = info;
    await this.setAvailable();
    const status = info.state === 4 ? 'printing' : info.state === 5 || !info.accepting ? 'stopped' : 'ready';
    await this.setCapabilityValue('printer_status', status);
    await this.updateInks(info.attributes).catch(err => this.error('Ink levels:', err));
    return info;
  }
  async updateInks(attributes) {
    this.inks = inkLevels(attributes);
    const wasLow = this.getStoreValue('inksLow') || {}, isLow = {};
    for (const ink of this.inks) {
      const id = `ink_level.${ink.id}`;
      if (!this.hasCapability(id)) { await this.addCapability(id); await this.setCapabilityOptions(id, { title: inkTitles(ink) }); }
      const previous = this.getCapabilityValue(id), tokens = { ink: inkName(ink), level: ink.level };
      await this.setCapabilityValue(id, ink.level);
      if (previous !== null && previous !== ink.level) await this.homey.flow.getDeviceTriggerCard('ink_changed').trigger(this, tokens);
      // Fire once per crossing; the state survives restarts so a low tank is not reported every minute.
      isLow[ink.id] = ink.level <= ink.low;
      if (isLow[ink.id] && !wasLow[ink.id]) await this.homey.flow.getDeviceTriggerCard('ink_low').trigger(this, tokens);
    }
    if (JSON.stringify(isLow) !== JSON.stringify(wasLow)) await this.setStoreValue('inksLow', isLow);
  }
  async onSettings({ newSettings }) { await inspect(newSettings.uri, this.connection(newSettings)); }
  async onDeleted() { if (this.timer) this.homey.clearInterval(this.timer); }
  async onUninit() { if (this.timer) this.homey.clearInterval(this.timer); }
  async exclusively(fn) {
    if (this.busy) throw new Error(t('printer_busy'));
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  async send(info, image, settings, name) {
    // Fail before submission for unsupported choices. A transport error after submission
    // is ambiguous, so it is reported and never automatically retried.
    jobOptions(info, settings);
    try { return await printJpeg(info, image, settings, name, this.connection(settings)); }
    catch (err) { throw new Error(t('no_retry', { error: err.message })); }
  }
  async printText(text) {
    return this.exclusively(async () => {
      const settings = this.getSettings(), info = await this.refresh();
      // Rendered text must fit intact even when the image preference is crop/fill.
      const textSettings = { ...settings, scaling: info.attributes['print-scaling-supported']?.includes('fit') ? 'fit' : 'auto' };
      jobOptions(info, textSettings);
      const layout = await textLayout(text, settings), jobs = [];
      try {
        for (let i = 0; i < layout.pages.length; i++) {
          const page = await renderPage(layout, i);
          jobs.push(await this.send(info, page, textSettings, t('job_text', { page: i + 1, total: layout.pages.length })));
        }
      } catch (err) { throw new Error(t('partial_pages', { done: jobs.length, total: layout.pages.length, error: err.message })); }
      this.lastResult = { pages: jobs.length, jobs, submittedAt: new Date().toISOString() };
      return this.lastResult;
    });
  }
  async printImage(source) {
    return this.exclusively(async () => {
      const settings = this.getSettings(), info = await this.refresh();
      jobOptions(info, settings);
      const input = typeof source === 'function' ? await source() : source;
      const image = imageToJpeg(input);
      const job = await this.send(info, image, settings, t('job_image'));
      this.lastResult = { pages: 1, jobs: [job], submittedAt: new Date().toISOString() };
      return this.lastResult;
    });
  }
}
module.exports = PrinterDevice;
