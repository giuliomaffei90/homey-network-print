'use strict';
require('../lib/i18n').setLanguage('it');
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { PNG }=require('pngjs');
const jpeg=require('jpeg-js');
const { Readable }=require('node:stream');
const { imageToJpeg,imageInfo,textLayout,renderPage,collect }=require('../lib/render');
test('transparent PNG is converted to a JPEG with a white background',()=>{
  const input=new PNG({width:2,height:1});input.data.set([0,0,0,0,255,0,0,255]);
  const result=imageToJpeg(PNG.sync.write(input));const decoded=jpeg.decode(result);
  assert.equal(decoded.width,2);assert.ok(decoded.data[0]>240&&decoded.data[1]>240&&decoded.data[2]>240);
  assert.equal(imageInfo(result).type,'jpeg');assert.equal(imageToJpeg(result),result);
});
test('invalid, truncated and oversized image headers fail before decoding',()=>{
  assert.throws(()=>imageToJpeg(Buffer.from('not an image')));
  const input=new PNG({width:2,height:2});const png=PNG.sync.write(input);png.writeUInt32BE(5000000,16);assert.throws(()=>imageToJpeg(png),/megapixel/);
  const jpg=jpeg.encode({width:2,height:2,data:Buffer.alloc(16,255)},90).data;
  assert.throws(()=>imageToJpeg(jpg.subarray(0,jpg.length-5)),/non valido/);
});
test('Italian text, wrapping and multiple pages are preserved',async()=>{
  const text='Caffè, perché, città, più, già.\n'+'Una parola lunga '.repeat(500);
  const layout=await textLayout(text);assert.ok(layout.pages.length>1);assert.match(layout.pages[0][0],/Caffè/);
  const output=await renderPage(layout,0);const info=imageInfo(output);assert.equal(info.width,1240);assert.equal(info.height,1754);
  const flattened=layout.pages.flat().join(' ').replace(/\s+/g,' ').trim();assert.equal(flattened,text.replace(/\s+/g,' ').trim());
});
test('empty text and excessive page counts fail instead of truncating',async()=>{
  await assert.rejects(textLayout('  '),/Scrivi/);
  await assert.rejects(textLayout('a\n'.repeat(1000)),/10 pagine/);
  await assert.rejects(textLayout('Test',{font_size:-2}),/dimensione/);
});
test('image streams enforce byte limits',async()=>{
  assert.deepEqual(await collect(Readable.from([Buffer.from('abc')])),Buffer.from('abc'));
  await assert.rejects(collect(Readable.from([Buffer.alloc(20)]),10),/10 MB/);
});
