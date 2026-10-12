'use strict';
require('../lib/i18n').setLanguage('it');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const jpeg = require('jpeg-js');
const { ImageLibrary, LibraryUploads } = require('../lib/library');
const key = '42'.repeat(32);
function image(colour = 210) { return jpeg.encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, colour) },90).data; }
async function setup(t, quota) { const root = await fs.mkdtemp(path.join(os.tmpdir(),'networkprint-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const library=new ImageLibrary(root,key,quota);await library.init();return library; }

test('library files and names are encrypted, and survive a new app instance',async t=>{
 const lib=await setup(t),data=image(),item=await lib.save({name:'Immagine privata',data,thumbnail:data});
 for(const file of await fs.readdir(lib.root)){const raw=await fs.readFile(path.join(lib.root,file));assert.equal(raw.subarray(0,4).toString(),'NPL1');assert.equal(raw.includes(data),false);assert.equal(raw.includes(Buffer.from('Immagine privata')),false);}
 const restarted=new ImageLibrary(lib.root,key);await restarted.init();assert.equal(restarted.list().items[0].id,item.id);assert.deepEqual(await restarted.read(item.id),data);assert.deepEqual(await restarted.read(item.id,true),data);
});
test('rename and replacement keep Flow IDs and atomically replace the content',async t=>{
 const lib=await setup(t),first=await lib.save({name:'Prima',data:image()});await lib.rename(first.id,'Seconda');
 const replaced=await lib.save({name:'Terza',replaceId:first.id,data:image(120)});assert.equal(replaced.id,first.id);assert.equal(lib.list().items.length,1);assert.equal(replaced.name,'Terza');assert.deepEqual(await lib.read(first.id),image(120));assert.equal((await fs.readdir(lib.root)).length,2);
});
test('invalid input, quota failure and missing replacements do not destroy an existing image',async t=>{
 const lib=await setup(t,1500),item=await lib.save({name:'Conservata',data:image()});
 await assert.rejects(lib.save({name:'Errore',data:Buffer.from('invalid'),replaceId:item.id}));assert.equal(lib.list().items[0].name,'Conservata');
 await assert.rejects(lib.save({name:'Assente',data:image(),replaceId:'not-there'}),/non trovata/);
 await lib.save({name:'Seconda',data:image()});await assert.rejects(lib.save({name:'Troppa',data:image()}),/piena/);assert.deepEqual(await lib.read(item.id),image());
});
test('backup import preserves IDs, deletion removes files and fails clearly in a Flow',async t=>{
 const lib=await setup(t),id=crypto.randomUUID();await lib.save({name:'Importata',data:image(),importId:id});assert.equal(lib.list().items[0].id,id);
 await assert.rejects(lib.save({name:'Duplicata',data:image(),importId:id}),/già presente/);await assert.rejects(lib.save({name:'Unsafe',data:image(),importId:'../../bad'}));
 await lib.remove(id);assert.equal(lib.list().items.length,0);assert.deepEqual(await fs.readdir(lib.root),['index.enc']);await assert.rejects(lib.read(id),/non trovata/);
});
test('concurrent saves serialize their index updates and a wrong key never wipes data',async t=>{
 const lib=await setup(t);await Promise.all(Array.from({length:5},(_,i)=>lib.save({name:'Immagine '+i,data:image()})));assert.equal(lib.list().items.length,5);
 const wrong=new ImageLibrary(lib.root,'13'.repeat(32));await assert.rejects(wrong.init());const right=new ImageLibrary(lib.root,key);await right.init();assert.equal(right.list().items.length,5);
});
test('chunked upload validates order and size, supports cancel, and commits only on finish',async t=>{
 const lib=await setup(t),uploads=new LibraryUploads(lib),data=image(),s=uploads.start({name:'A pezzi',bytes:data.length});
 assert.throws(()=>uploads.chunk(s.id,1,data.toString('base64')),/non valida/);uploads.chunk(s.id,0,data.subarray(0,100).toString('base64'));await assert.rejects(uploads.finish(s.id),/incompleto/);assert.equal(lib.list().items.length,0);
 uploads.chunk(s.id,1,data.subarray(100).toString('base64'));const item=await uploads.finish(s.id);assert.deepEqual(await lib.read(item.id),data);
 const canceled=uploads.start({name:'Annullata',bytes:20});uploads.cancel(canceled.id);assert.throws(()=>uploads.chunk(canceled.id,0,'YQ=='),/scaduto/);
});
test('the Flow listener reads the saved image, including replacements after restart',async t=>{
 const lib=await setup(t),vm=require('node:vm'),{createRequire}=require('node:module'),filename=path.resolve('app.js');
 const localRequire=createRequire(filename),cards=new Map(),settings=new Map();
 const homey={settings:{get:k=>settings.get(k),set:(k,v)=>settings.set(k,v)},i18n:{getLanguage:()=>"it"},flow:{getActionCard:id=>{if(!cards.has(id))cards.set(id,{registerRunListener(fn){this.run=fn;},registerArgumentAutocompleteListener(name,fn){this.autocomplete=fn;}});return cards.get(id);},getConditionCard:()=>({registerRunListener(){}})}};
 async function boot(){const sandbox={module:{exports:{}},require:id=>id==='homey'?{App:class{log(){}}}:id==='./lib/library'?{ImageLibrary:class extends ImageLibrary{constructor(root,key){super(lib.root,key);}},LibraryUploads}:localRequire(id)};vm.runInNewContext(await fs.readFile(filename,'utf8'),sandbox);const app=new sandbox.module.exports();app.homey=homey;await app.onInit();return app;}
 const app=await boot(),item=await app.library.save({name:'Test Flow',data:image()});let received;
 const device={printImage:async source=>{received=await source();}};await cards.get('print_library_image').run({device,image:{id:item.id}});assert.deepEqual(received,image());
 await app.library.save({name:'Test aggiornato',replaceId:item.id,data:image(100)});await boot();await cards.get('print_library_image').run({device,image:{id:item.id}});assert.deepEqual(received,image(100));
 const matches=await cards.get('print_library_image').autocomplete('aggiornato');assert.equal(matches[0].id,item.id);assert.equal((await cards.get('print_library_image').autocomplete('inesistente')).length,0);
});
