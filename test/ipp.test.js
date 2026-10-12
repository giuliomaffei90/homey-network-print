'use strict';
require('../lib/i18n').setLanguage('it');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { TAG, normalizeUri, attribute, encode, decode, request, inspect, printJpeg, jobOptions } = require('../lib/ipp');

async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); }));
  return `ipp://127.0.0.1:${s.address().port}/custom/queue`;
}
function response(id, attributes = [], status = 0) {
  const header = Buffer.alloc(8); header.writeUInt16BE(0x0200);header.writeUInt16BE(status,2);header.writeUInt32BE(id,4);
  return Buffer.concat([header,Buffer.from([4]),...attributes.map(a=>attribute(...a)),Buffer.from([3])]);
}
test('address normalization keeps advertised paths, ports and IPv6', () => {
  assert.equal(normalizeUri('192.168.1.20'),'ipp://192.168.1.20:631/ipp/print');
  assert.equal(normalizeUri('ipps://printer.local/printers/colour'),'ipps://printer.local:631/printers/colour');
  assert.equal(normalizeUri('http://printer.local:8631/a'),'ipp://printer.local:8631/a');
  assert.equal(normalizeUri('ipp://[::1]:1631/ipp/print'),'ipp://[::1]:1631/ipp/print');
  for(const bad of ['file:///tmp/a','http://u:p@host/a','http://host/a?q=1','']) assert.throws(()=>normalizeUri(bad));
});
test('decoder preserves lists, booleans, Unicode and rejects truncated responses', () => {
  const data=response(7,[['printer-info','Caffè',TAG.text],['document-format-supported','image/jpeg',TAG.mime],['','image/png',TAG.mime],['printer-is-accepting-jobs',true,TAG.boolean]]);
  const parsed=decode(data);assert.equal(parsed.requestId,7);assert.equal(parsed.attributes['printer-info'][0],'Caffè');
  assert.deepEqual(parsed.attributes['document-format-supported'],['image/jpeg','image/png']);
  for(let i=0;i<data.length;i++) assert.throws(()=>decode(data.subarray(0,i)));
});
test('real HTTP request contains IPP operation and uses supplied path',async t=>{
  const uri=await server(t,async(req,res)=>{
    assert.equal(req.url,'/custom/queue');assert.equal(req.headers['content-type'],'application/ipp');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
    assert.equal(body.readUInt16BE(2),11);assert.equal(decode(body).attributes['printer-uri'][0],uri);
    res.end(response(body.readUInt32BE(4),[['document-format-supported','image/jpeg',TAG.mime],['printer-make-and-model','Test Epson',TAG.text],['printer-state',3,TAG.enum]]));
  });
  const info=await inspect(uri);assert.equal(info.model,'Test Epson');assert.equal(info.accepting,true);
});
test('Print-Job sends JPEG bytes, paper and UTF-8 job name once',async t=>{
  let calls=0;const data=Buffer.from([255,216,1,2,255,217]);
  const uri=await server(t,async(req,res)=>{calls++;const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
    assert.equal(body.readUInt16BE(2),2);assert.deepEqual(body.subarray(-data.length),data);
    const a=decode(body).attributes;assert.deepEqual(a['document-format'],['image/jpeg']);assert.deepEqual(a.media,['iso_a4_210x297mm']);assert.deepEqual(a['job-name'],['Caffè']);
    res.end(response(body.readUInt32BE(4),[['job-id',42,TAG.integer]]));
  });
  const info={uri,accepting:true,state:3,attributes:{'media-supported':['iso_a4_210x297mm']}};
  const result=await printJpeg(info,data,{paper:'iso_a4_210x297mm'},'Caffè');assert.equal(result.jobId,42);assert.equal(calls,1);
});
test('printer errors, mismatched IDs and lost responses are failures, with no resubmission',async t=>{
  let calls=0;const uri=await server(t,async(req,res)=>{calls++;req.resume();req.on('end',()=>res.destroy());});
  await assert.rejects(request(uri,2,[],[],Buffer.from('page')));assert.equal(calls,1);
  const wrong=await server(t,(req,res)=>{req.resume();res.end(response(0));});
  await assert.rejects(request(wrong,11),/identificativo/);
  const denied=await server(t,async(req,res)=>{let chunks=[];for await(const c of req)chunks.push(c);res.end(response(Buffer.concat(chunks).readUInt32BE(4),[],0x0400));});
  await assert.rejects(request(denied,11),/IPP 0x400/);
});
test('Epson HTTP 426 Upgrade does not hang or retry a Print-Job',async t=>{
  let calls=0;const uri=await server(t,(req,res)=>{calls++;req.resume();res.writeHead(426,{Upgrade:'TLS/1.0, HTTP/1.1',Connection:'Upgrade','Content-Length':0});res.end();});
  await assert.rejects(request(uri,2,[],[],Buffer.from('page'),{timeout:1000}),/HTTP 426/);assert.equal(calls,1);
});
test('reject unsupported settings and paused printers before printing',()=>{
  const info={accepting:true,state:3,attributes:{'media-supported':['iso_a4_210x297mm']}};
  assert.throws(()=>jobOptions(info,{paper:'iso_a3_297x420mm'}),/non supportata/);
  assert.throws(()=>jobOptions({...info,accepting:false},{}),/non accetta/);
  assert.throws(()=>jobOptions({...info,attributes:{'printer-state-reasons':['media-jam']}},{}),/media-jam/);
});
