'use strict';
const { t } = require('./i18n');

const PImage = require('pureimage');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const path = require('node:path');

const MAX_BYTES = 10 * 1024 * 1024;
const PAPER = { iso_a4_210x297mm: [210, 297], iso_a3_297x420mm: [297, 420], iso_a5_148x210mm: [148, 210],
  'na_letter_8.5x11in': [215.9, 279.4], 'na_index-4x6_4x6in': [101.6, 152.4] };
let font;
function loadFont() { return font ||= PImage.registerFont(path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf'), 'Noto Sans').load(); }

async function collect(stream, limit = MAX_BYTES, timeout = 30000) {
  let size = 0; const chunks = [];
  const timer = setTimeout(() => stream.destroy(new Error(t('image_timeout'))), timeout);
  try {
    for await (const chunk of stream) {
      const b = Buffer.from(chunk); size += b.length;
      if (size > limit) throw new Error(t('image_too_large'));
      chunks.push(b);
    }
    if (!size) throw new Error(t('image_empty'));
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); stream.destroy(); }
}

function imageInfo(data) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_BYTES) throw new Error(t('image_format_size'));
  if (data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height || width * height > 8e6) throw new Error(t('png_megapixels'));
    return { type: 'png', width, height };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= data.length) {
      if (data[i++] !== 0xff) throw new Error(t('jpeg_invalid'));
      while (data[i] === 0xff) i++;
      const marker = data[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > data.length) break;
      const length = data.readUInt16BE(i);
      if (length < 2 || i + length > data.length) throw new Error(t('jpeg_truncated'));
      if ([0xc0,0xc1,0xc2].includes(marker) && length >= 8) {
        const height = data.readUInt16BE(i + 3), width = data.readUInt16BE(i + 5);
        if (!width || !height || width * height > 50e6 || data.lastIndexOf(Buffer.from([255,217])) < i) throw new Error(t('jpeg_invalid_or_large'));
        return { type: 'jpeg', width, height };
      }
      i += length;
    }
  }
  throw new Error(t('format_unsupported'));
}

function imageToJpeg(data) {
  const info = imageInfo(data);
  if (info.type === 'jpeg') return data;
  const image = PNG.sync.read(data, { checkCRC: true });
  // Flatten transparency onto white before encoding for paper.
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c] * a + 255 * (1 - a));
    image.data[i + 3] = 255;
  }
  return jpeg.encode(image, 90).data;
}

async function textLayout(text, settings = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(t('text_empty'));
  if (text.length > 30000) throw new Error(t('text_too_long'));
  await loadFont();
  const paper = PAPER[settings.paper || 'iso_a4_210x297mm'];
  if (!paper) throw new Error(t('paper_unavailable'));
  const size = Number(settings.font_size || 12);
  if (!Number.isFinite(size) || size < 8 || size > 36) throw new Error(t('font_size'));
  const dpi = 150, width = Math.round(paper[0] / 25.4 * dpi), height = Math.round(paper[1] / 25.4 * dpi);
  const margin = Math.round(12 / 25.4 * dpi), fontSize = size / 72 * dpi, lineHeight = Math.ceil(fontSize * 1.45);
  const context = PImage.make(1, 1).getContext('2d'); context.font = `${fontSize}pt 'Noto Sans'`;
  const maxWidth = width - 2 * margin, perPage = Math.floor((height - 2 * margin) / lineHeight);
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (context.measureText(line + word).width <= maxWidth) { line += word; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      if (context.measureText(line).width > maxWidth) {
        let fragment = '';
        for (const char of line) {
          if (context.measureText(fragment + char).width > maxWidth) { lines.push(fragment); fragment = ''; }
          fragment += char;
        }
        line = fragment;
      }
    }
    lines.push(line.trimEnd());
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (pages.length > 10) throw new Error(t('text_pages'));
  return { width, height, margin, fontSize, lineHeight, pages };
}

async function renderPage(layout, pageIndex) {
  const bitmap = PImage.make(layout.width, layout.height), ctx = bitmap.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = '#202020'; ctx.font = `${layout.fontSize}pt 'Noto Sans'`;
  layout.pages[pageIndex].forEach((line, i) => { if (line) ctx.fillText(line, layout.margin, layout.margin + layout.fontSize + i * layout.lineHeight); });
  return jpeg.encode(bitmap, 90).data;
}

module.exports = { MAX_BYTES, PAPER, collect, imageInfo, imageToJpeg, textLayout, renderPage };
