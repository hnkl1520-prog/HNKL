// 그림 확인 시트를 헤드리스 크롬으로 PNG 로 만든다.
// 실행: node test/odd-mirror/sheets.mjs [시트 이름...]   → test/odd-mirror/results/sheet-*.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const sheets = process.argv.slice(2).length ? process.argv.slice(2) : ['people', 'expressions', 'mouth', 'bust', 'eyes', 'hair', 'glasses'];
const browser = await launch();
try {
  for (const name of sheets) {
    const page = await browser.open(`/test/odd-mirror/sheet.html?sheet=${name}`, { width: 1500, height: 900 });
    try {
      await page.waitFor('window.__done === true', 60000);
    } catch (e) {
      console.log(page.logs.join('\n'));
      throw e;
    }
    const height = await page.eval('document.body.scrollHeight');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: Math.ceil(height), deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 200));
    const file = await page.screenshot(path.join(OUT, `sheet-${name}.png`));
    const errors = page.logs.filter((l) => /exception|error/i.test(l));
    console.log(`${name}: ${file}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
}
