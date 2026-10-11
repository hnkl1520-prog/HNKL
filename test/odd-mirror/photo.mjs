// 실제 MediaPipe 모델로 사진 한 장을 처리해 캐릭터와 수치를 확인한다 (인터넷 필요: 모델을 받음).
// 실행: node test/odd-mirror/photo.mjs [사진 경로(저장소 기준)] [크롭 x,y,w,h]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const [src = '/public/assets/Profile_Photo.png', crop = '230,300,720,720'] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await browser.open(`/test/odd-mirror/photo.html?src=${encodeURIComponent(src)}&crop=${crop}`, { width: 1440, height: 900 });
  await page.waitFor('window.__done === true', 180000, 500);
  console.log(await page.eval('document.getElementById("out").textContent'));
  const result=await page.eval('window.__result');
  if(!result?.ok) throw new Error(result?.error||'모델 처리 실패');
  await page.screenshot(path.join(OUT, 'photo-real-model.png'), { x: 0, y: 0, width: 1440, height: 900 });
  const errs = page.logs.filter((l) => /exception|error/i.test(l) && !/favicon/.test(l));
  if (errs.length) console.log('콘솔:\n' + errs.join('\n'));
} finally {
  await browser.close();
}
