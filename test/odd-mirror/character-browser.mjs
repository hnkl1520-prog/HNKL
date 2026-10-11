import assert from 'node:assert/strict';
import path from 'node:path';
import {launch,ROOT} from './chrome.mjs';
const b=await launch();
try{
  for(const sheet of ['people','mono','expressions','mouth','eyes']){
    const p=await b.open('/test/odd-mirror/character-study.html?sheet='+sheet,{width:1440,height:900});
    await p.waitFor('window.__done');
    await p.send('Emulation.setDeviceMetricsOverride',{width:1440,height:await p.eval('document.body.scrollHeight'),deviceScaleFactor:1,mobile:false});
    await p.screenshot(path.join(ROOT,'test/odd-mirror/results/character-'+sheet+'.png'));
    assert.deepEqual(p.logs.filter(x=>/exception|\[error\]/i.test(x)&&!/favicon/.test(x)),[]);
    if(sheet==='expressions'){
      // 같은 얼굴을 작게 그려도 찡그림과 미소가 서로 다른 그림인지 확인한다.
      const states=await p.eval(`(() => {
        const {C,cast,design,pose}=window.__study,d=design(cast[0]),out={};
        for(const name of ['neutral','smile','frown','half','surprise','press','eww']){
          const c=document.createElement('canvas');c.width=160;c.height=180;
          C.draw(c.getContext('2d'),d,{x:80,y:132,scale:.5,expression:pose(name),colors:cast[0].colors,bust:true});out[name]=c.toDataURL();
        }return out;
      })()`);
      assert.equal(new Set(Object.values(states)).size,7,'작은 그림에서도 각 표정이 구별됨');
      const eyeChecks=await p.eval(`(() => {
        const C=window.__study.C,result=[];
        for(const [eyes]of C.catalog.eyes){
          const d=C.defaults();d.eyes=eyes;d.hair='none';const g=C.geometry(d),counts=[];
          for(const open of [0,.6,1,1.4]){
            const e=C.neutral();e.eyeR.open=e.eyeL.open=open;
            const c=document.createElement('canvas');c.width=360;c.height=450;const ctx=c.getContext('2d');
            C.draw(ctx,d,{x:180,y:g.bottom-42,expression:e});
            const bytes=ctx.getImageData(180-g.gap-g.ew-2,g.eyeY-29,g.ew*2+4,58).data;
            let white=0,pupil=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i]===255&&bytes[i+1]===250&&bytes[i+2]===240)white++;if(bytes[i]===41&&bytes[i+1]===38&&bytes[i+2]===56)pupil++;}
            counts.push({open,white,pupil});
          }result.push({eyes,counts});
        }return result;
      })()`);
      for(const {eyes,counts}of eyeChecks){
        assert.equal(counts[0].white,0,eyes+' 감으면 흰자 없음');
        assert(counts[1].pupil>0,eyes+' 반감김에도 눈동자가 보임');
        assert(counts[3].white>counts[2].white,eyes+' 크게 뜨면 개방부가 커짐');
      }
    }
    await p.close();
  }
  const p=await b.open('/public/works/labs/odd-mirror/odd-mirror.html?inspect',{width:1280,height:850});
  await p.waitFor('window.__omReady');
  await p.screenshot(path.join(ROOT,'test/odd-mirror/results/character-intro.png'));
  assert.deepEqual(p.logs.filter(x=>/exception|\[error\]/i.test(x)&&!/favicon/.test(x)),[]);
  await p.close();
  console.log('PASS: 8명 컬러/단색, 13표정, 입 연속, 눈 6종, 작은 화면 표정 차이, 통합 앱 시작 화면');
}finally{await b.close();}
