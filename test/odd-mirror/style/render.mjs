// 스타일 시트를 PNG 로: node test/odd-mirror/style/render.mjs [cast|expr|blue ...]  → test/odd-mirror/results/style-*.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../chrome.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../results');
const sheets = process.argv.slice(2).length ? process.argv.slice(2) : ['cast', 'expr'];
const browser = await launch();
try {
  for (const name of sheets) {
    const url = name === 'blue' ? '/test/odd-mirror/style/blue-sheet.html'
      : name === 'examples' || name === 'examples-expr' ? `/test/odd-mirror/style/examples-sheet.html?sheet=${name === 'examples' ? 'examples' : 'expr'}`
      : `/test/odd-mirror/style/style-sheet.html?sheet=${name}`;
    const page = await browser.open(url, { width: 1500, height: 900, scale: 1 });
    await page.waitFor('window.__done === true', 30000);
    const height = await page.eval('document.body.scrollHeight');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: Math.ceil(height), deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 150));
    const file = await page.screenshot(path.join(OUT, `style-${name}.png`));
    const errors = page.logs.filter((l) => /exception|error/i.test(l) && !/favicon/.test(l));
    console.log(`${name}: ${file}${errors.length ? '\n  ' + errors.join('\n  ') : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
}
