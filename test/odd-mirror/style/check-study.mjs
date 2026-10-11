// 독립된 크롬에서 정적 시안/색상 전환/레퍼런스/모바일/파일 열기를 확인한다.
import path from 'node:path';
import { launch, ROOT } from '../chrome.mjs';
const url='/public/works/labs/odd-mirror/style-study/index.html';
const browser=await launch();
const assert=(value,message)=>{if(!value)throw new Error(message)};
const results=[];
try {
  const page=await browser.open(url,{width:1440,height:1150});
  await page.waitFor('window.__done && [...document.querySelectorAll(".ref img")].every(i=>i.complete && i.naturalWidth>0)');
  assert(await page.eval('document.querySelectorAll(".portrait").length===3'),'시안 3개');
  assert(await page.eval('[...document.images].filter(i=>i.closest(".refs")).length===6'),'원본 6개');
  await page.screenshot(path.join(ROOT,'test/odd-mirror/results/study-01-shared.png'));
  const before=await page.eval('getComputedStyle(document.querySelectorAll(".study")[1]).getPropertyValue("--skin")');
  await page.click('.controls [data-color="individual"]');
  assert(await page.eval('document.querySelector(".controls [data-color=individual]").getAttribute("aria-pressed")==="true"'),'색 버튼 상태');
  assert(before!==await page.eval('getComputedStyle(document.querySelectorAll(".study")[1]).getPropertyValue("--skin")'),'색상 적용');
  await page.screenshot(path.join(ROOT,'test/odd-mirror/results/study-01-colors.png'));
  for(let i=1;i<=6;i++){
    await page.click(`.ref:nth-child(${i}) button`);
    await page.waitFor('document.querySelector("dialog").open && document.querySelector("dialog img").complete && document.querySelector("dialog img").naturalWidth>0');
    await page.click('dialog button');
    assert(await page.eval('!document.querySelector("dialog").open'),'닫기');
  }
  await page.click('.ref button');
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert(await page.eval('!document.querySelector("dialog").open'),'Esc 닫기');
  results.push('데스크톱: 시안 3개, 원본 6개, 색 전환, 모든 원본 확대/닫기, Esc 통과');
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert(await page.eval('document.documentElement.scrollWidth<=innerWidth'),'모바일 가로 넘침');
  await page.screenshot(path.join(ROOT,'test/odd-mirror/results/study-01-mobile.png'));
  results.push('390px 모바일: 가로 넘침 없음');
  assert(!page.logs.some(l=>/exception|error/i.test(l)&&!/favicon/.test(l)),page.logs.join('\n'));
  await page.close();
  const file=await browser.open('file://'+path.join(ROOT,url.slice(1)),{width:1280,height:900});
  await file.waitFor('window.__done && [...document.querySelectorAll(".ref img")].every(i=>i.complete && i.naturalWidth>0)');
  await file.click('.controls [data-color="individual"]');
  assert(await file.eval('document.body.dataset.color==="individual"'),'파일에서 색상 전환');
  assert(!file.logs.some(l=>/exception|error/i.test(l)&&!/favicon/.test(l)),file.logs.join('\n'));
  results.push('파일 직접 열기: 원본 이미지와 색상 전환 통과, 콘솔 오류 없음');
  await file.close();
  console.log(results.join('\n'));
}finally{await browser.close()}
