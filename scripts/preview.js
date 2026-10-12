'use strict';
// Local UI QA only: persistent test library in /tmp, no connection to a printer.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ImageLibrary,LibraryUploads}=require('../lib/library');
const handlers=require('../api');
const {groupPrinters}=require('../lib/discovery');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'networkprint-preview-')),library=new ImageLibrary(dir,'71'.repeat(32));await library.init();
 const homey={app:{library,uploads:new LibraryUploads(library),devices:()=>[{getData:()=>({id:'preview-printer'}),getName:()=> 'Epson ET-8550',getSetting:()=> 'ipps://192.168.86.46:631/ipp/print',getAvailable:()=>true,getCapabilityValue:()=> 'ready',busy:false}],device:()=>{throw new Error('La stampa è disattivata nell’anteprima.');}}};
 const manifest=JSON.parse(await fs.readFile(path.join(root,'app.json')));
 const found=groupPrinters(['ipp','ipps'].map(protocol=>({protocol,item:{name:'EPSON ET-8550 Series',address:'192.168.86.46',port:631,txt:{rp:'ipp/print'}}})).concat([{protocol:'ipp',item:{name:'Epson @ Synology',address:'192.168.86.242',port:631,txt:{rp:'printers/Epson'}}}]));
 const locales={};for(const f of await fs.readdir(path.join(root,'locales')))locales[f.slice(0,-5)]=JSON.parse(await fs.readFile(path.join(root,'locales',f)));
 const bridge=`const L=${JSON.stringify(locales)},lang=new URLSearchParams(location.search).get('lang')||'it',dict=L[lang]||L.en;const Homey={__(key){return key.split('.').reduce((o,k)=>o?.[k],dict)??key;},ready(){},api(method,path,body,callback){fetch('/test-api'+path,{method,headers:{'Content-Type':'application/json'},body:body==null?undefined:JSON.stringify(body)}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}).then(data=>callback(null,data),err=>callback(err));},setTitle(){},emit(event,data,callback){if(event==='discover')callback(null,${JSON.stringify(found)});else callback(new Error('Anteprima: nessun dispositivo viene aggiunto.'));},createDevice(device,callback){callback(null,device);},done(){}};window.addEventListener('DOMContentLoaded',()=>{if(typeof onHomeyReady==='function')onHomeyReady(Homey);});`;
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
   if(pathname==='/homey.js'){res.setHeader('Content-Type','application/javascript');return res.end(bridge);}
   if(pathname.startsWith('/test-api')){
    const route=pathname.slice(9);let handler,params={};
    for(const [name,entry] of Object.entries(manifest.api)){const keys=[];const expression=entry.path.replace(/:([a-z]+)/g,(_,key)=>{keys.push(key);return '([^/]+)';});const match=route.match(new RegExp('^'+expression+'$'));if(entry.method===req.method&&match){handler=name;keys.forEach((k,i)=>params[k]=match[i+1]);break;}}
    if(!handler)throw new Error('Unknown preview route');let chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();const data=await handlers[handler]({homey,params,body:raw?JSON.parse(raw):{}});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));
   }
   const files={'/':'settings/index.html','/style.css':'settings/style.css','/settings.js':'settings/settings.js','/assets/brand.svg':'assets/brand.svg','/pair':'drivers/printer/pair/connect.html'};
   if(!files[pathname]){res.writeHead(404);return res.end();}
   let data=await fs.readFile(path.join(root,files[pathname]));
   if(pathname==='/pair')data=Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/homey.js"></script><style>body{margin:0;background:#fff!important;color:#000!important}input{background:#222!important;color:#000!important;-webkit-text-fill-color:#000!important}button{background:#ddd!important;color:#555!important}p,h1{color:#e9eeee!important}</style></head><body>'+data+'</body></html>');
   res.setHeader('Content-Type',pathname.endsWith('.js')?'application/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data);
  }catch(err){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
 });
 server.listen(8768,'127.0.0.1',()=>console.log('Network Print UI QA on 127.0.0.1:8768 (printing disabled)'));
 process.on('SIGINT',async()=>{server.close();await fs.rm(dir,{recursive:true,force:true});process.exit(0);});
})();
