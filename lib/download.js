'use strict';
const { t } = require('./i18n');
const http = require('node:http');
const https = require('node:https');
const { collect, MAX_BYTES } = require('./render');

async function downloadImage(value, redirects = 0) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(t('url_invalid'));
  if (redirects > 3) throw new Error(t('too_many_redirects'));
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, { headers: { Accept: 'image/jpeg,image/png' } }, async res => {
      try {
        if ([301,302,303,307,308].includes(res.statusCode)) {
          res.resume();
          if (!res.headers.location) throw new Error(t('redirect_no_location'));
          resolve(await downloadImage(new URL(res.headers.location, url).href, redirects + 1)); return;
        }
        if (res.statusCode !== 200) { res.resume(); throw new Error(t('download_http', { status: res.statusCode })); }
        if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); throw new Error(t('image_too_large')); }
        resolve(await collect(res));
      } catch (err) { reject(err); }
    });
    const timer = setTimeout(() => req.destroy(new Error(t('download_timeout'))), 30000);
    req.once('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
module.exports = { downloadImage };
