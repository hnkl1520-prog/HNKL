import assert from 'node:assert/strict';
import {launch,ROOT} from './chrome.mjs';
const b=await launch();
try{
  const p=await b.open('/public/works/labs/odd-mirror/odd-mirror.html?inspect',{width:390,height:844});
  await p.waitFor('window.__omReady');
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>new Promise(resolve=>{
    window.__grant=()=>{const c=document.createElement('canvas');c.width=c.height=32;const stream=c.captureStream(1);window.__lateTracks=stream.getTracks();resolve(stream);};
  })});`});
  await p.send('Page.reload',{ignoreCache:true});await p.waitFor('window.__omReady');
  await p.click('#start');await p.waitFor('window.__grant');
  await p.click('#stopLoading');await p.eval('window.__grant()');
  await p.waitFor(`window.__lateTracks.every(t=>t.readyState==='ended')`);
  assert(await p.eval(`window.__oddMirror.phase==='idle'&&!document.getElementById('intro').hidden&&document.getElementById('cam').srcObject===null`),'권한 대기에서 돌아온 뒤 늦은 스트림을 해제');
  assert.equal(await p.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
  await p.close();
  const f=await b.open('file://'+ROOT+'/test/odd-mirror/pupil-study.html');
  await f.waitFor(`document.querySelector('img').complete&&document.querySelector('img').naturalWidth>0`);
  assert(await f.eval(`document.querySelector('a').href.endsWith('/public/works/labs/odd-mirror/odd-mirror.html')`));
  await f.close();
  console.log('PASS: 늦은 카메라 권한 응답 정리, 모바일 시작 화면, 비교 시안 파일 직접 열기');
}finally{await b.close();}
