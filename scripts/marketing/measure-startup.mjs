import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const url = new URL(option('--url', 'http://localhost:13440/?lang=zh-Hans'));
const runs = Number(option('--runs', '3'));
const output = option('--output');
if (!['http:', 'https:'].includes(url.protocol) || !Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Use an HTTP URL and 1–20 runs');
const throttle = { latency: 562.5, downloadThroughput: 1474.56 * 1024 / 8, uploadThroughput: 675 * 1024 / 8, cpuSlowdown: 4 };
const browser = await chromium.launch();
const samples = [];
try {
  for (let run = 1; run <= runs; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    // Keep ordinary asset scheduling while preventing diagnostic pageviews from reaching collectors.
    await context.route('**/*', route => {
      const request = route.request(), target = new URL(request.url());
      if ((target.pathname.includes('collect') && request.method() === 'POST') || /(?:google-analytics|analytics\.google)\.com$/.test(target.hostname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await context.addInitScript(() => {
      const timing = { firstFrame: 0, loadStart: 0, playing: 0, lcp: 0, pauses: 0 };
      window.__gameplayTiming = timing;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) timing.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      for (const name of ['loadstart', 'playing', 'pause']) document.addEventListener(name, event => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        if (name === 'loadstart' && !timing.loadStart) timing.loadStart = performance.now();
        if (name === 'playing' && !timing.playing) timing.playing = performance.now();
        if (name === 'pause') timing.pauses++;
      }, true);
      const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        if (!video) return;
        observer.disconnect();
        video.requestVideoFrameCallback(now => { timing.firstFrame = now; });
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    try {
      const page = await context.newPage(), cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: throttle.latency, downloadThroughput: throttle.downloadThroughput, uploadThroughput: throttle.uploadThroughput, connectionType: 'cellular4g' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpuSlowdown });
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__gameplayTiming.firstFrame > 0);
      await page.waitForSelector('[role="tab"]:not([disabled])');
      const sample = await page.evaluate(() => ({
        ...window.__gameplayTiming,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        navigation: performance.getEntriesByType('navigation').map(e => ({ responseStart: e.responseStart, responseEnd: e.responseEnd })),
        resources: performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd, bytes: e.encodedBodySize, decoded: e.decodedBodySize })),
      }));
      samples.push(sample);
      console.log(JSON.stringify({ run, firstFrame: Math.round(sample.firstFrame), posterLcp: Math.round(sample.lcp), requestStart: Math.round(sample.loadStart), pauses: sample.pauses }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const median = key => { const sorted = samples.map(s => s[key]).sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const report = { url: url.origin + url.pathname, throttle, viewport: { width: 390, height: 844 }, cache: 'cold', median: { firstFrame: median('firstFrame'), lcp: median('lcp'), requestStart: median('loadStart') }, samples };
if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ median: report.median }));
