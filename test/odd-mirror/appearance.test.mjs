import assert from 'node:assert/strict';
import fs from 'node:fs';
const text=fs.readFileSync(new URL('../../public/works/labs/odd-mirror/src/appearance.js',import.meta.url),'utf8');
const A=new Function(text+';return OddAppearance')();
const S=128,meta={faceWidth:35,centerX:64,chinY:45};
function shirt(rgb,{neck=10,cut=false,pattern=false}={}){
  const masks={clothes:new Float32Array(S*S)},rgba=new Uint8ClampedArray(S*S*4);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    const i=y*S+x,depth=Math.max(0,neck*(1-((x-64)/18)**2)),w=cut?64:34+Math.min(14,(y-45)*.2);
    const inside=y>50+depth&&Math.abs(x-64)<w;
    masks.clothes[i]=inside?.95:.01;const color=inside?(pattern&&x%8===0?[10,10,10]:rgb):[255,255,255];
    rgba.set([...color,255],i*4);
  }return {masks,rgba};
}
for(const [color,hex]of [[[242,241,237],'#f2f1ed'],[[24,25,30],'#18191e'],[[185,45,55],'#b92d37']]){
  const im=shirt(color,{pattern:true}),out=A.clothing(im.masks,im.rgba,S,meta);
  assert.equal(out.color,hex,'작은 프린트와 흰 배경에 대표 옷 색이 바뀌지 않음');
  assert(out.shoulderRatio>=1.65&&out.shoulderRatio<=2.65);
}
const empty=shirt([255,255,255]);empty.masks.clothes.fill(0);assert.equal(A.clothing(empty.masks,empty.rgba,S,meta),null,'의류 근거가 없으면 색을 만들어내지 않음');
const shallow=shirt([200,100,90],{neck:3}),deep=shirt([200,100,90],{neck:22});
assert(A.clothing(deep.masks,deep.rgba,S,meta).neckDepth>A.clothing(shallow.masks,shallow.rgba,S,meta).neckDepth+10,'관측된 목선 깊이가 반영됨');
const cut=shirt([240,240,240],{cut:true});assert.equal(A.clothing(cut.masks,cut.rgba,S,meta).shoulderRatio,null,'잘린 어깨는 폭을 관측했다고 하지 않음');
const cameraCut=shirt([210,210,210]);for(let y=0;y<S;y++)for(let x=95;x<S;x++)cameraCut.masks.clothes[y*S+x]=0;
assert.equal(A.clothing(cameraCut.masks,cameraCut.rgba,S,{...meta,right:95}).shoulderRatio,null,'카메라 원본 경계에서 잘린 어깨도 추정으로 남김');
const colorState={samples:[],result:null};
A.addClothing(colorState,A.clothing(shallow.masks,shallow.rgba,S,meta));assert(!colorState.result.stable);
A.addClothing(colorState,A.clothing(shallow.masks,shallow.rgba,S,meta));assert(colorState.result.stable);
const p={bornAt:0,scan:{samples:Array(15)},segCount:0,clothesCount:0,clothing:{result:null},glasses:{samples:8,worn:false}};
assert(!A.scanStatus(p,'worker',30000).ready,'모델 준비와 시간 경과만으로 헤어를 확정하지 않음');
assert(A.scanStatus(p,'failed',15000).canContinue,'부분 결과는 사용자가 선택 가능');
assert(A.scanStatus(p,'failed',8100).timedOut,'액세서리 분석 실패가 얼굴 결과를 무한정 막지 않음');
assert(!A.scanStatus({...p,scan:{samples:[]}},'failed',30000).timedOut,'얼굴 관측도 없을 때는 시간만으로 완료하지 않음');
assert(A.scanStatus({...p,scan:{samples:Array(3)}},'worker',4000).canContinue,'최소 관측 뒤 빠르게 직접 진행할 수 있음');
p.segCount=3;p.clothesCount=2;assert(!A.scanStatus(p,'worker',4000).ready,'옷 색을 못 얻은 빈 결과 두 개로 자동 완료하지 않음');
p.clothing.result={stable:true};assert(A.scanStatus(p,'worker',4000).ready,'실제 반환 표본 뒤에 완료');
p.glasses.worn=true;assert(!A.scanStatus(p,'worker',4000).ready,'착용 근거가 있으면 렌즈를 더 기다림');
assert(A.scanStatus(p,'worker',11000).ready,'렌즈 보류는 얼굴 전체를 무한정 막지 않음');
console.log('PASS: 옷 색/프린트/배경, 잘림, 목선 깊이, 색 안정성, 실제 표본 기반 스캔 게이트');
