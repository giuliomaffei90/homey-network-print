'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {groupPrinters}=require('../lib/discovery');
const result=(protocol,host,path,name='EPSON ET-8550')=>({protocol,item:{name,address:host,port:631,txt:{rp:path}}});
test('IPP and IPPS become one printer, prefer encryption and mark paired devices',()=>{
 const found=groupPrinters([result('ipp','192.168.86.46','ipp/print'),result('ipps','192.168.86.46','ipp/print'),result('ipp','192.168.86.242','printers/Epson','Epson @ Synology')],[{uri:'ipps://192.168.86.46:631/ipp/print'}]);
 assert.equal(found.length,2);assert.equal(found[0].uri,'ipps://192.168.86.46:631/ipp/print');assert.equal(found[0].paired,true);assert.equal(found[0].shared,false);assert.equal(found[1].shared,true);
});
test('distinct queues and addresses remain separate; malformed advertisements are ignored',()=>{
 const found=groupPrinters([result('ipp','one.local','queue/a'),result('ipps','one.local','queue/b'),result('ipp','two.local','queue/a'),result('ipp','a broken address','ipp/print')]);assert.equal(found.length,3);
});
