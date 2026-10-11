import assert from 'node:assert/strict';
import path from 'node:path';
import {launch,ROOT} from './chrome.mjs';
const b=await launch();
try{
 const page=await b.open('/test/odd-mirror/component-studio.html',{width:1280,height:1200});
 await page.waitFor('window.__done');
 const geometryCheck=await page.eval(`(() => {
  const C=OddComponents,c=document.createElement('canvas');c.width=360;c.height=450;
  const ctx=c.getContext('2d',{willReadFrequently:true}),bad=[];let count=0;
  for(const [face] of C.catalog.face)for(const hair of ['sweep','back','bob','long'])for(const width of [.8,1,1.23])for(const hairVolume of [.7,1.45])for(const fringe of [.12,.85])for(const hairSweep of [-1,1]){
   const d=C.defaults();Object.assign(d,{face,hair});Object.assign(d.values,{width,hairVolume,fringe,hairSweep});
   ctx.clearRect(0,0,360,450);C.draw(ctx,d,{x:180,y:C.geometry(d).bottom-42});
   const px=ctx.getImageData(0,0,360,450).data,n=360*450,seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=1;seen[0]=1;queue[0]=0;
   const add=i=>{if(i>=0&&i<n&&!seen[i]&&px[i*4+3]<128){seen[i]=1;queue[tail++]=i;}};
   while(head<tail){const i=queue[head++];if(i%360)add(i-1);if(i%360<359)add(i+1);add(i-360);add(i+360);}
   let holes=0,spots=[];for(let i=0;i<n;i++)if(px[i*4+3]<128&&!seen[i]){holes++;if(spots.length<4)spots.push([i%360,Math.floor(i/360)]);}
   if(holes>4)bad.push({face,hair,width,hairVolume,fringe,hairSweep,holes,spots});count++;
  }
  const d=C.defaults(),e=C.neutral();e.mouth.open=.4;
  ctx.clearRect(0,0,360,450);C.draw(ctx,d,{x:180,y:C.geometry(d).bottom-42,colors:{face:'#ab9bd7'},expression:e});
  const m=C.mouthMetrics(d,e),mouth=Array.from(ctx.getImageData(180,Math.round(m.cy+m.open*.35),1,1).data);
  return {bad,count,mouth};
 })()`);
 assert.equal(geometryCheck.bad.length,0,'헤어 빈틈: '+JSON.stringify(geometryCheck.bad.slice(0,1)));
 assert(geometryCheck.mouth[0]>geometryCheck.mouth[1]+25&&geometryCheck.mouth[0]<170&&geometryCheck.mouth[1]>50,'입 안은 검정·선명한 빨강이 아닌 차분한 자주색');
 console.log('PASS: 헤어 경계 '+geometryCheck.count+'가지 조합, 입 안 따뜻한 색 유지');
 const snap=()=>page.eval('document.querySelector("#portrait").toDataURL()');
 let old=await snap();
 await page.eval('document.querySelector("#part-face").value="round";document.querySelector("#part-face").dispatchEvent(new Event("change"))');
 assert.notEqual(old,await snap());
 assert.equal(await page.eval('window.__componentPreview.design.eyes'),'almond');
 for(const key of ['eyes','nose','mouth','hair','glasses']){
  const names=await page.eval(`Array.from(document.querySelector('#part-${key}').options).map(o=>o.value)`);
  for(const id of names)await page.eval(`document.querySelector('#part-${key}').value=${JSON.stringify(id)};document.querySelector('#part-${key}').dispatchEvent(new Event('change'))`);
 }
 await page.click('#reset');
 await page.screenshot(path.join(ROOT,'test/odd-mirror/results/components-studio.png'));
 await page.eval('document.querySelector("#value-open").value=.4;document.querySelector("#value-open").dispatchEvent(new Event("input"))');
 assert.equal(await page.eval('window.__componentPreview.motion.open'),.4);
 await page.click('#reset');await page.click('[data-face="angular"]');
 assert.equal(await page.eval('window.__componentPreview.design.face'),'angular');
 await page.click('#shuffle');await page.click('#shared');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 assert(await page.eval('document.documentElement.scrollWidth<=innerWidth'));
 await page.screenshot(path.join(ROOT,'test/odd-mirror/results/components-mobile.png'));
 const errors=page.logs.filter(s=>/exception|\[error\]/i.test(s)&&!/favicon/.test(s));assert.deepEqual(errors,[]);
 await page.close();
 const f=await b.open('file://'+path.join(ROOT,'test/odd-mirror/component-studio.html'));
 await f.waitFor('window.__done');assert.equal(await f.eval('window.__componentPreview.version'),'6.0');await f.close();
 // 렌더러는 카메라와 같은 앱 코드로부터 로드. 실제 영상 대신 합성 얼굴.
 for(const name of ['people','expressions','bust','mouth']){
  const sheet=await b.open('/test/odd-mirror/sheet.html?sheet='+name,{width:1500,height:1000});
  await sheet.waitFor('window.__done');
  const height=await sheet.eval('document.body.scrollHeight');
  await sheet.send('Emulation.setDeviceMetricsOverride',{width:1500,height:Math.ceil(height),deviceScaleFactor:1,mobile:false});
  await sheet.screenshot(path.join(ROOT,'test/odd-mirror/results/components-'+name+'.png'));
  const es=sheet.logs.filter(s=>/exception|\[error\]/i.test(s)&&!/favicon/.test(s));assert.deepEqual(es,[]);await sheet.close();
 }
 console.log('PASS: 부품 조합, 선택 독립성, 비례/표정 조작, 모바일, 파일 직접 열기, 앱 렌더링 4종 시트, 콘솔 오류 없음');
}finally{await b.close();}
