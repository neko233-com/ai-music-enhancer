import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../web/dist/', import.meta.url);
async function walk(dir, prefix = '') {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) files.push(...(await walk(new URL(item.name + '/', dir), name + '/')));
    else if (!name.startsWith('_') && name !== 'sw.js') files.push('/' + name);
  }
  return files;
}
const files = (await walk(root)).map((file) => (file === '/index.html' ? '/' : file));
const hash = createHash('sha256');
for (const file of files)
  hash.update(await readFile(new URL(file === '/' ? 'index.html' : file.slice(1), root)));
const cache = 'neko-' + hash.digest('hex').slice(0, 12);
await writeFile(
  new URL('sw.js', root),
  `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('neko-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;e.respondWith(caches.open(CACHE).then(async c=>{const cached=await c.match(e.request,{ignoreVary:true});if(cached)return cached;try{return await fetch(e.request)}catch(err){if(e.request.mode==='navigate')return c.match('/');throw err;}}));});`,
);
console.log(`Offline cache: ${files.length} assets (${cache})`);
