'use strict';
const el = id => document.getElementById(id);
let bridge, devices = [], busy = false, preview, editingId, library = { items: [] }, generation = 0;
const thumbnails = new Map();
const api = (method,path,body=null) => new Promise((resolve,reject) => bridge.api(method,path,body,(err,data)=>err?reject(new Error(err.message||String(err))):resolve(data)));
const t = (key,vars={}) => String(bridge.__(key,vars)).replace(/__(\w+)__/g,(_,name)=>vars[name]??'');
function localize(){
 document.documentElement.dir=t('meta.dir');
 for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=t(node.dataset.i18n);
 for(const node of document.querySelectorAll('[data-i18n-html]'))node.innerHTML=t(node.dataset.i18nHtml); // Trusted: our own locale files.
 for(const attr of ['placeholder','alt','aria-label'])for(const node of document.querySelectorAll(`[data-i18n-${attr}]`))node.setAttribute(attr,t(node.getAttribute(`data-i18n-${attr}`)));
}
const size = bytes => bytes < 1024*1024 ? `${Math.round(bytes/1024)} KB` : `${(bytes/1024/1024).toFixed(1)} MB`;
function message(text,error=false){const target=el('image-dialog').open?el('dialog-message'):el('message');target.textContent=text;target.dataset.error=String(error);}
function lock(value){busy=value;for(const id of ['add-images','export-library','import-library','save-name','replace-image','delete-image','download-image'])el(id).disabled=value;status();}
function status(){const d=devices.find(d=>d.id===el('printer').value),known=['ready','printing','stopped','offline'];el('printer-status').textContent=d?`${t('settings.status_'+(known.includes(d.status)?d.status:'updating'))} · ${d.name}`:t('settings.no_printer');el('print-text').disabled=busy||!d;el('print-image').disabled=busy||!d;}
async function refreshPrinters(){const previous=el('printer').value;devices=await api('GET','/printers');el('printer').replaceChildren();const seen=new Set();for(const d of devices){if(seen.has(d.id))continue;seen.add(d.id);const option=document.createElement('option');option.value=d.id;option.textContent=d.name;el('printer').append(option);}if(devices.some(d=>d.id===previous))el('printer').value=previous;status();}
async function refreshLibrary(){
 const current=++generation;library=await api('GET','/library');if(current!==generation)return;
 el('usage').textContent=t('settings.usage',{count:library.items.length,maxItems:library.maxItems,used:size(library.usedBytes),max:size(library.maxBytes)});
 el('storage-bar').style.width=`${Math.min(100,library.usedBytes/library.maxBytes*100)}%`;el('library-empty').hidden=library.items.length>0;el('library-grid').replaceChildren();
 const pending=[];
 for(const item of library.items){
  const card=document.createElement('article');card.className='np-image-card';const thumb=document.createElement('div');thumb.className='np-thumb';const img=document.createElement('img');img.alt=item.name;img.loading='lazy';thumb.append(img);
  const info=document.createElement('div');info.className='np-image-info';const name=document.createElement('span');name.className='np-image-name';name.textContent=item.name;const meta=document.createElement('span');meta.className='np-image-size';meta.textContent=`${item.width} × ${item.height} · ${size(item.bytes)}`;
  const manage=document.createElement('button');manage.type='button';manage.textContent=t('settings.manage');manage.setAttribute('aria-label',t('settings.manage_aria',{name:item.name}));manage.onclick=()=>openEditor(item.id);info.append(name,meta,manage);card.append(thumb,info);el('library-grid').append(card);
  const cache=thumbnails.get(item.id);if(cache?.version===item.updatedAt)img.src=cache.url;
  else if(item.hasThumbnail)pending.push(async()=>{const result=await api('GET',`/library/${item.id}/thumbnail`);if(result.base64){const url='data:image/jpeg;base64,'+result.base64;thumbnails.set(item.id,{url,version:item.updatedAt});if(current===generation)img.src=url;}});
  else{img.hidden=true;thumb.textContent=t('settings.image');}
 }
 async function worker(){while(pending.length){const task=pending.shift();try{await task();}catch{ /* A preview failure does not block printing. */ }}}
 await Promise.all([worker(),worker(),worker()]);
}
function base64(buffer){let value='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
function fromBase64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function thumbnail(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,360/image.naturalWidth,360/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.82).split(',')[1];}finally{URL.revokeObjectURL(url);}}
async function upload(file,{name,replaceId,importId,thumb}={}){
 if(!file.size||file.size>10*1024*1024)throw new Error(t('settings.file_limit'));
 name=(name||file.name.replace(/\.[^.]+$/,'')).slice(0,80);const imageThumbnail=thumb||await thumbnail(file);const session=await api('POST','/library-upload',{name,bytes:file.size,replaceId,importId});
 try{let index=0;for(let offset=0;offset<file.size;offset+=session.chunkBytes){const chunk=await file.slice(offset,offset+session.chunkBytes).arrayBuffer();await api('POST',`/library-upload/${session.id}/chunk`,{index:index++,base64:base64(chunk)});message(t('settings.saving',{name,percent:Math.round(Math.min(file.size,offset+session.chunkBytes)/file.size*100)}));}return await api('POST',`/library-upload/${session.id}/finish`,{thumbnail:imageThumbnail});}
 catch(err){await api('DELETE',`/library-upload/${session.id}`).catch(()=>{});throw err;}
}
async function addFiles(files){if(busy)return;lock(true);let added=0;try{for(const file of files){await upload(file);added++;}message(t('settings.added',{count:added}));}catch(err){message(`${added?t('settings.added_partial',{count:added})+' ':''}${err.message}`,true);}finally{await refreshLibrary().catch(()=>{});lock(false);el('library-files').value='';}}
function openEditor(id){if(busy)return;editingId=id;el('edit-name').value=library.items.find(x=>x.id===id).name;el('dialog-message').textContent='';const thumb=thumbnails.get(id);el('edit-preview').hidden=!thumb;if(thumb)el('edit-preview').src=thumb.url;el('image-dialog').showModal();}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function exportBackup(){if(busy)return;lock(true);try{const snapshot=await api('GET','/library'),items=[];for(const item of snapshot.items){message(t('settings.exporting',{current:items.length+1,total:snapshot.items.length}));const file=await api('GET',`/library/${item.id}/image`);items.push({id:item.id,name:item.name,base64:file.base64});}download(new Blob([JSON.stringify({format:'network-print-library',version:1,items})],{type:'application/json'}),'Network-Print-library.json');message(t('settings.backup_ready'));}catch(err){message(err.message,true);}finally{lock(false);}}
async function importBackup(file){if(!file||busy)return;lock(true);let restored=0;try{if(file.size>75*1024*1024)throw new Error(t('settings.backup_too_large'));const backup=JSON.parse(await file.text());if(backup.format!=='network-print-library'||backup.version!==1||!Array.isArray(backup.items)||backup.items.length>100)throw new Error(t('settings.backup_invalid'));const ids=new Set();for(const x of backup.items){if(!x.id||ids.has(x.id)||typeof x.base64!=='string'||x.base64.length>14*1024*1024)throw new Error(t('settings.backup_bad_data'));ids.add(x.id);}if(backup.items.some(x=>library.items.some(y=>y.id===x.id))&&!confirm(t('settings.backup_replace_confirm')))return;
 for(const item of backup.items){const exists=library.items.some(x=>x.id===item.id),blob=new File([fromBase64(item.base64)],'image.jpg',{type:'image/jpeg'});await upload(blob,{name:item.name,replaceId:exists?item.id:undefined,importId:exists?undefined:item.id});restored++;}message(t('settings.imported',{count:restored}));
 }catch(err){message(`${restored?t('settings.imported_partial',{count:restored})+' ':''}${err.message}`,true);}finally{await refreshLibrary().catch(()=>{});lock(false);el('backup-file').value='';}}
async function submit(path,body){if(busy)return;lock(true);message(t('settings.sending'));try{const result=await api('POST',path,{deviceId:el('printer').value,...body});message(t('settings.sent',{count:result.pages}));}catch(err){message(err.message,true);}finally{lock(false);}}
function onHomeyReady(Homey){
 bridge=Homey;localize();Homey.ready();Promise.all([refreshLibrary(),refreshPrinters()]).catch(err=>message(err.message,true));
 for(const tab of ['library','print'])el('tab-'+tab).onclick=()=>{for(const name of ['library','print']){el(name+'-panel').hidden=name!==tab;el('tab-'+name).setAttribute('aria-selected',String(name===tab));}el('message').textContent='';};
 el('add-images').onclick=()=>el('library-files').click();el('library-files').onchange=()=>addFiles([...el('library-files').files]);el('export-library').onclick=exportBackup;el('import-library').onclick=()=>el('backup-file').click();el('backup-file').onchange=()=>importBackup(el('backup-file').files[0]);
 el('close-dialog').onclick=()=>{if(!busy)el('image-dialog').close();};el('image-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 el('save-name').onclick=async()=>{if(busy)return;lock(true);try{await api('PUT',`/library/${editingId}`,{name:el('edit-name').value});await refreshLibrary();message(t('settings.name_saved'));}catch(err){message(err.message,true);}finally{lock(false);}};
 el('replace-image').onclick=()=>el('replacement-file').click();el('replacement-file').onchange=async()=>{const file=el('replacement-file').files[0];if(!file||busy)return;lock(true);try{await upload(file,{name:el('edit-name').value,replaceId:editingId});thumbnails.delete(editingId);await refreshLibrary();el('edit-preview').src=thumbnails.get(editingId)?.url||'';el('edit-preview').hidden=!thumbnails.has(editingId);message(t('settings.replaced'));}catch(err){message(err.message,true);}finally{lock(false);el('replacement-file').value='';}};
 el('download-image').onclick=async()=>{if(busy)return;lock(true);try{const file=await api('GET',`/library/${editingId}/image`);download(new Blob([fromBase64(file.base64)],{type:'image/jpeg'}),el('edit-name').value.replace(/[\\/:*?"<>|]/g,'_')+'.jpg');}catch(err){message(err.message,true);}finally{lock(false);}};
 el('delete-image').onclick=async()=>{if(busy||!confirm(t('settings.delete_confirm')))return;lock(true);try{await api('DELETE',`/library/${editingId}`);thumbnails.delete(editingId);el('image-dialog').close();await refreshLibrary();message(t('settings.deleted'));}catch(err){message(err.message,true);}finally{lock(false);}};
 el('refresh').onclick=()=>refreshPrinters().catch(err=>message(err.message,true));el('printer').onchange=status;el('print-text').onclick=()=>submit('/print/text',{text:el('text').value});
 el('file').onchange=()=>{if(preview)URL.revokeObjectURL(preview);const file=el('file').files[0];el('preview').hidden=!file;el('file-name').textContent=file?.name||'';if(file){preview=URL.createObjectURL(file);el('preview').src=preview;el('url').value='';}};
 el('url').oninput=()=>{if(el('url').value){el('file').value='';el('preview').hidden=true;el('file-name').textContent='';}};
 el('print-image').onclick=async()=>{if(el('url').value.trim())return submit('/print/image',{url:el('url').value.trim()});const file=el('file').files[0];if(!file)return message(t('settings.choose_image'),true);if(file.size>10*1024*1024)return message(t('settings.image_too_large'),true);try{await submit('/print/image',{base64:base64(await file.arrayBuffer())});}catch(err){message(err.message,true);}};
}
