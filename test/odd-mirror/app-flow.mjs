// 앱 흐름 확인: 헤드리스 크롬 + 가짜 카메라(사진 한 장을 영상처럼 반복)로 실제 앱 파일을 연다.
// 실행: node test/odd-mirror/app-flow.mjs <카메라로 쓸 32bit BMP 1280×720>
// 확인: 시작 화면 → 카메라 켜기 → 모델 로드 → 스캔 → 캐릭터, D 키 화면, 다시 스캔 후 색 유지, 권한 거부 안내, 파일 직접 열기.
// 사진 한 장이 계속 들어오는 것이라 실제 카메라의 움직임·조명·속도는 검증하지 못한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, ROOT } from './chrome.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const bmpPath = process.argv[2];
if (!bmpPath) { console.log('사용법: node test/odd-mirror/app-flow.mjs <1280x720 32bit BMP>'); process.exit(1); }

// BMP(BGRA, 위에서 아래) → Y4M(4:2:0) 두 프레임
function bmpToY4m(file) {
  const b = fs.readFileSync(file), off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  const h = Math.abs(hRaw), topDown = hRaw < 0, step = bpp / 8, rowLen = Math.ceil((w * step) / 4) * 4;
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * rowLen;
    for (let x = 0; x < w; x++) {
      const i = row + x * step, B = b[i], G = b[i + 1], R = b[i + 2];
      Y[y * w + x] = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
      if (y % 2 === 0 && x % 2 === 0) {
        U[(y / 2) * (w / 2) + x / 2] = Math.round(128 - 0.168736 * R - 0.331264 * G + 0.5 * B);
        V[(y / 2) * (w / 2) + x / 2] = Math.round(128 + 0.5 * R - 0.418688 * G - 0.081312 * B);
      }
    }
  }
  const out = path.join(os.tmpdir(), `om-cam-${process.pid}.y4m`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  fs.writeFileSync(out, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return out;
}

const y4m = bmpToY4m(bmpPath);
const CAM = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`];
const APP = '/public/works/labs/odd-mirror/odd-mirror.html';
const results = [];
const check = (ok, name, info = '') => { results.push({ ok, name, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bgPixel = (page) => page.eval(`Array.from(document.getElementById('stage').getContext('2d').getImageData(3, 3, 1, 1).data.slice(0, 3)).join(',')`);
const snapshot = (page) => page.eval(`(() => { const s = window.__oddMirror, p = s && s.person; return s && {
  phase: s.phase, seg: s.seg.mode, labels: s.seg.labels, fps: Math.round(s.fps), tracker:s.landmarker?.mode, delegate:s.landmarker?.delegate, trackingMs:s.trackingMs,
  diagnostics:{pose:s.pose&&{yaw:s.pose.yaw,pitch:s.pose.pitch,rms:s.pose.rms},busy:s.seg.busy,pending:s.seg.pending&&{id:s.seg.pending.id,kind:s.seg.pending.kind},pendingMs:s.seg.busy?Math.round(performance.now()-s.seg.sentAt):0},
  person: p && { id: p.id, epoch: p.epoch, phase: p.phase, samples: p.scan.samples.length, segCount: p.segCount,
    parts: p.shape && Object.fromEntries(Object.entries(p.shape.parts).map(([k, v]) => [k, +v.c.toFixed(2) + ' ' + v.prov])),
    factors:p.shape&&Object.fromEntries(Object.entries(p.shape.parts).map(([k,v])=>[k,{why:v.why,...v.f}])),
    estimated: p.shape && Math.round(p.shape.estimatedShare * 100), hairTone: p.hair.tone, hairSamples: p.hair.n,
    hairline:p.hair.target&&Array.from(p.hair.target.hairline).filter(Number.isFinite),
    hairUp: p.hair.target && Math.round(p.hair.target.upObserved * 100), glasses: p.glasses.status, glassesScore: +p.glasses.ema.toFixed(2),
    clothesCount:p.clothesCount,clothing:p.clothing.result,acceptedPartial:p.acceptedPartial,
    components: p.components && Object.fromEntries(['face','eyes','brows','nose','mouth','hair','glasses'].map(k => [k,p.components[k]])) },
  status: document.getElementById('status').textContent, rescanVisible: !document.getElementById('rescan').hidden }; })()`);

async function runLive(url, label) {
  const browser = await launch({ flags: CAM });
  let page;
  try {
    page = await browser.open(url, { width: 1280, height: 800 });
    const disabledAtLoad = await page.waitFor(`document.getElementById('start') ? String(document.getElementById('start').disabled) : ''`, 20000);
    await page.waitFor(`window.__omReady === true && !document.getElementById('start').disabled`, 60000);
    check(true, `[${label}] 불러오기 전에는 버튼이 꺼져 있다가 준비되면 켜짐`, `처음 disabled=${disabledAtLoad}`);
    if (label === 'http') {
      await page.screenshot(path.join(OUT, 'app-1-intro.png'));
      await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
      check(await page.eval('document.querySelector(".intro").scrollWidth<=innerWidth && document.getElementById("start").getBoundingClientRect().bottom<innerHeight'),'모바일 시작 화면: 가로 넘침 없이 시작 버튼 표시');
      await page.screenshot(path.join(OUT,'app-intro-mobile.png'));
      await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    }
    const t0 = Date.now();
    await page.click('#start');
    await page.waitFor(`window.__oddMirror && window.__oddMirror.phase === 'running'`, 120000, 500);
    const tRun = Date.now() - t0;
    if(label==='http') await page.screenshot(path.join(OUT,'app-loading.png'));
    const trace=setInterval(async()=>{try{const s=await snapshot(page);console.log('스캔 진단',JSON.stringify({phase:s.person?.phase,hair:s.person?.segCount,clothes:s.person?.clothesCount,...s.diagnostics}));}catch{}},10000);
    try{await page.waitFor(`(() => {const p=window.__oddMirror.person;return p&&(p.phase==='live');})()`,60000,500);}finally{clearInterval(trace);}
    if(await page.eval(`window.__oddMirror.person.phase==='scan'`)){
      check(true,'낮은 신뢰도에서 자동으로 캐릭터를 확정하지 않음');
      await page.screenshot(path.join(OUT,'app-scan-partial.png'));await page.click('#continueScan');
    }
    await page.waitFor(`window.__oddMirror.person.phase==='live'`);
    const tLive = Date.now() - t0;
    if(label==='http')check(await page.eval("window.__oddMirror.landmarker.mode==='worker'"),'얼굴 추론이 UI 밖에서 실행');
    check(true, `[${label}] 카메라 켜기 → 추적 시작 → 캐릭터 고정`, `추적 준비 ${(tRun / 1000).toFixed(1)}초, 캐릭터 ${(tLive / 1000).toFixed(1)}초`);
    // 분할 모델까지 기다렸다가 헤어가 들어오게
    await page.waitFor(`(() => { const s = window.__oddMirror; return s.seg.mode === 'worker' || s.seg.mode === 'main' || s.seg.mode === 'failed'; })()`, 90000, 500).catch(() => {});
    await page.waitFor(`window.__oddMirror.person.hair.n >= 2`, 30000, 500).catch(() => {});
    await sleep(1500);
    const snap = await snapshot(page);
    const frames=await page.eval(`new Promise(resolve=>{let last=performance.now(),gaps=[];const step=t=>{gaps.push(t-last);last=t;if(gaps.length>=90)resolve(gaps.slice(2).sort((a,b)=>a-b));else requestAnimationFrame(step);};requestAnimationFrame(step);})`);
    const timing={trackingReadyMs:tRun,characterReadyMs:tLive,scanMs:tLive-tRun,renderMedianMs:frames[frames.length>>1],renderP95Ms:frames[Math.floor(frames.length*.95)]};
    check(timing.renderP95Ms<65,'렌더링 지연 p95가 65ms 미만',JSON.stringify(timing));
    fs.writeFileSync(path.join(OUT,'v6-flow-'+label+(process.argv.includes('--gpu')?'-gpu':'')+'.json'),JSON.stringify({fixture:'반복 사진 가상 카메라, '+(process.argv.includes('--gpu')?'GPU 우선':'CPU 강제'),timing,...snap},null,2));
    console.log(JSON.stringify(snap, null, 1));
    check(snap.seg === 'worker' || snap.seg === 'main', `[${label}] 분할 모델 준비`, `방식: ${snap.seg}`);
    if(snap.person.hairSamples>=2&&snap.person.clothesCount>=2)check(true,`[${label}] 헤어·옷 실제 표본 수 확인`);
    else check(snap.person.acceptedPartial&&snap.person.samples>=8&&(snap.person.clothing?.stable!==true),`[${label}] 늦은 분석은 관측 수를 꾸미지 않고 부분 결과로 표시`);
    check(timing.scanMs<12500,`[${label}] 얼굴 추적 이후 스캔 대기 제한`,timing.scanMs+'ms');
    if(snap.person.hairSamples===0)console.log('미검증: 초기 스캔에서 헤어 표본을 얻지 못함. 헤어 추정 성공으로 해석하지 않음.');
    check(snap.rescanVisible, `[${label}] '다시 스캔' 버튼 보임`);
    check(!!snap.person.components, `[${label}] 측정값으로 부품 조합 확정`);
    const frozen = await page.eval('JSON.stringify(window.__oddMirror.person.components)');
    const hairCount = snap.person.hairSamples;
    await sleep(1800);
    check(frozen === await page.eval('JSON.stringify(window.__oddMirror.person.components)') && hairCount === await page.eval('window.__oddMirror.person.hair.n'), `[${label}] 라이브 중 부품·헤어 표본 고정`);
    await page.screenshot(path.join(OUT, `app-2-live-${label}.png`));
    if (label === 'http') {
      await page.click('#adjust');check(await page.eval('!document.getElementById("adjustments").hidden'),'외형 보정 패널 열기');
      await page.eval(`document.getElementById('hairChoice').value='back';document.getElementById('hairChoice').dispatchEvent(new Event('change'));document.getElementById('shirtColor').value='#f4f1e9';document.getElementById('shirtColor').dispatchEvent(new Event('input'))`);
      check(await page.eval(`window.__oddMirror.person.components.hair==='back'&&window.__oddMirror.person.shirt==='#f4f1e9'`),'헤어·옷 색 보정 반영');
      await page.eval(`document.getElementById('glassesChoice').value='round';document.getElementById('glassesChoice').dispatchEvent(new Event('change'))`);
      check(await page.eval(`window.__oddMirror.person.components.glasses==='round' && window.__oddMirror.person.components.provenance.glasses==='user'`),'안경 직접 보정 즉시 반영, 관측과 구분');
      await sleep(300);
      await page.screenshot(path.join(OUT,'app-corrected-glasses.png'));
      await page.click('#closeAdjust');await page.click('#compare');
      check(await page.eval(`!document.getElementById('cameraPreview').hidden`),'원본 카메라 비교');
      await page.key('d');
      await sleep(400);
      await page.screenshot(path.join(OUT, 'app-3-debug.png'));
      await page.key('d');
      await sleep(600);
      const before = await bgPixel(page), idBefore = snap.person.id;
      await page.click('#rescan');
      await sleep(300);
      const mid = await snapshot(page);
      check(mid.person.phase === 'scan' && mid.person.epoch === snap.person.epoch + 1, '다시 스캔: 스캔 단계로 돌아감', `단계 ${mid.person.phase}`);
      await page.waitFor(`window.__oddMirror.person.phase==='live'`,40000,300);
      if(await page.eval(`window.__oddMirror.person.phase==='scan'`))await page.click('#continueScan');
      await sleep(2500);
      const after = await bgPixel(page), snap2 = await snapshot(page);
      check(snap2.person.id === idBefore && before === after, '다시 스캔 후 같은 캐릭터 색 유지', `id ${idBefore}→${snap2.person.id}, 배경 ${before} → ${after}`);
      check(snap2.person.components.glasses==='round','재스캔 후 직접 보정한 안경 유지');
      check(await page.eval(`window.__oddMirror.person.components.hair==='back'&&window.__oddMirror.person.shirt==='#f4f1e9'`),'재스캔 후 헤어·옷 보정 유지');
      await page.eval(`document.getElementById('glassesChoice').value='auto';document.getElementById('glassesChoice').dispatchEvent(new Event('change'))`);
      check(await page.eval(`window.__oddMirror.person.components.glasses===window.__oddMirror.person.autoGlasses.kind && window.__oddMirror.person.components.provenance.glasses!=='user'`),'안경 자동 선택으로 돌아가면 관측 결과 복원');
      await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
      check(await page.eval('document.querySelector(".controls").scrollWidth<=innerWidth-32'),'모바일 라이브 조작부 가로 넘침 없음');
      await page.screenshot(path.join(OUT,'app-live-mobile.png'));
      await page.eval('window.__cameraTracks=document.getElementById("cam").srcObject.getTracks()');
      await page.click('#stop');
      check(await page.eval(`window.__oddMirror.phase==='idle'&&window.__cameraTracks.every(t=>t.readyState==='ended')&&!document.getElementById('intro').hidden`),'마치기: 카메라와 모델 해제, 시작 화면 복귀');
    }
    const errs = page.logs.filter((l) => /exception|\[error\]/i.test(l) && !/favicon|XNNPACK|INFO:/.test(l));
    check(errs.length === 0, `[${label}] 콘솔 오류 없음`, errs.slice(0, 5).join(' | '));
    console.log(page.logs.filter((l) => /warn|분할|worker/i.test(l)).slice(0, 8).join('\n'));
  } catch (e) {
    check(false, `[${label}] 흐름`, e.message);
    if (page) {
      console.log(JSON.stringify(await snapshot(page)));
      console.log(page.logs.slice(-8).join('\n'));
      await page.screenshot(path.join(OUT, `app-failed-${label}.png`));
    }
  } finally {
    await browser.close();
  }
}

// 1) http 로 열기
await runLive(`${APP}?inspect${process.argv.includes('--gpu')?'':'&cpu'}`, 'http');

// 2) 권한 거부
if(!process.argv.includes('--http-only')) {
  const browser = await launch({ flags: ['--use-fake-device-for-media-stream'] });
  try {
    // 사용자가 카메라 권한을 '차단'한 상태를 브라우저 설정으로 만든다
    await browser.send('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied', origin: browser.origin });
    const page = await browser.open(`${APP}?inspect`, { width: 1280, height: 800 });
    await page.waitFor(`window.__omReady === true && !document.getElementById('start').disabled`, 60000);
    await page.click('#start');
    const msg = await page.waitFor(`(() => { const n = document.querySelector('.intro .note'); return n && n.getAttribute('role') === 'alert' && n.textContent; })()`, 20000);
    const btn = await page.eval(`document.getElementById('start').textContent + '/' + document.getElementById('start').disabled`);
    check(/권한/.test(msg), '권한 거부 시 안내', `"${msg}" · 버튼 ${btn}`);
    await page.screenshot(path.join(OUT, 'app-4-denied.png'));
  } catch (e) { check(false, '권한 거부 흐름', e.message); } finally { await browser.close(); }
}

// 3) 파일 직접 열기 (file://)
if(!process.argv.includes('--http-only')) await runLive(pathToFileURL(path.join(ROOT, APP)).href + '?inspect&cpu', 'file');

fs.rmSync(y4m, { force: true });
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${fails ? `실패 ${fails}개` : '모두 통과'} (가짜 카메라: 사진 한 장 반복 — 실제 카메라 정확도·속도는 검증 아님)`);
process.exitCode = fails ? 1 : 0;
