import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
const dist=path.resolve('apps/web/.next');
const roots=JSON.parse(fs.readFileSync(path.join(dist,'build-manifest.json'),'utf8')).rootMainFiles;
const result={};
for(const page of ['tanks','chat','inbox']){
 const file=path.join(dist,'server/app/[workspaceSlug]/(dashboard)',page,'page_client-reference-manifest.js');
 const context={};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 const manifest=Object.values(context.__RSC_MANIFEST)[0];
 const chunks=new Set(roots);
 for(const module of Object.values(manifest.clientModules))for(const chunk of module.chunks)if(typeof chunk==='string'&&chunk.endsWith('.js'))chunks.add(chunk);
 let bytes=0,gzip=0;
 for(const chunk of chunks){const data=fs.readFileSync(path.join(dist,decodeURIComponent(chunk)));bytes+=data.length;gzip+=zlib.gzipSync(data).length;}
 result[page]={chunks:chunks.size,bytes,gzip};
}
fs.writeFileSync('tasks/verification/issue-project-removal-2026-10-25/bundle-after.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
