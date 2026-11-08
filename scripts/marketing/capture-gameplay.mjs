import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, copyFile, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const kinds = process.argv.slice(2);
if (kinds.some(kind => !['tank', 'fish', 'resident'].includes(kind))) throw new Error('Choose tank, fish or resident');
const manifest = kinds.length ? JSON.parse(await readFile(resolve(root, 'apps/web/features/play/media.json'), 'utf8')) : {};
const temp = await mkdtemp(resolve(tmpdir(), 'createx-gameplay-'));
const output = resolve(root, 'apps/web/public/media/gameplay');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'packages/views/agent-life/scene/assets'), resolve(temp, 'assets'), { recursive: true });
await build({ entryPoints: [resolve(root, 'packages/views/marketing/capture.ts')], outfile: resolve(temp, 'scene.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', nodePaths: [resolve(root, 'packages/views/node_modules')], define: { 'process.env.NODE_ENV': '"production"' } });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/capture') {
      const kind = url.searchParams.get('kind'); if (!['tank', 'fish', 'resident'].includes(kind)) throw new Error('Unknown scene');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      await writeFile(resolve(temp, `${kind}.webm`), Buffer.concat(chunks)); res.end('ok'); return;
    }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<style>html,body{margin:0;background:#111915}#scene{width:960px;height:600px}canvas{display:block;width:100%;height:100%}</style><div id="scene"></div><script type="module" src="/scene.js"></script>'); return; }
    const path = resolve(temp, '.' + url.pathname); if (!path.startsWith(temp + '/')) throw new Error('Invalid path');
    const types = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp' }; res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path));
  } catch (error) { res.statusCode = 404; res.end(String(error)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  for (const kind of kinds.length ? kinds : ['tank', 'fish', 'resident']) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error(kind, e));
    await page.goto(`${origin}/?kind=${kind}`); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async kind => {
      const canvas = document.querySelector('canvas'); const stream = canvas.captureStream(24);
      const chunks = []; const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2400000 });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const done = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
      await new Promise(resolve => setTimeout(resolve, 10000)); recorder.stop(); await done;
      await fetch(`/capture?kind=${kind}`, { method: 'POST', body: new Blob(chunks, { type: recorder.mimeType }) }); stream.getTracks().forEach(track => track.stop());
    }, kind);
    await page.close();
    const mp4 = resolve(temp, `${kind}.mp4`), mobile = resolve(temp, `${kind}.mobile.mp4`), still = resolve(temp, `${kind}.png`), poster = resolve(temp, `${kind}.webp`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(temp, `${kind}.webm`), '-an', '-vf', 'fps=24', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(temp, `${kind}.webm`), '-an', '-vf', 'fps=24,scale=640:400', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mobile]);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-ss', kind === 'resident' ? '2.5' : '0.5', '-frames:v', '1', still]);
    execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', still, '-o', poster]);
    const asset = async (path, extension, suffix = '') => { const data = await readFile(path); const hash = createHash('sha256').update(data).digest('hex').slice(0, 10); const name = `${kind}${suffix}.${hash}.${extension}`; await copyFile(path, resolve(output, name)); return `/media/gameplay/${name}`; };
    manifest[kind] = { video: await asset(mp4, 'mp4'), mobileVideo: await asset(mobile, 'mp4', '.mobile'), poster: await asset(poster, 'webp'), width: 960, height: 600 };
    console.log(kind, JSON.stringify(manifest[kind]));
  }
  await writeFile(resolve(root, 'apps/web/features/play/media.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally { await browser.close(); await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
