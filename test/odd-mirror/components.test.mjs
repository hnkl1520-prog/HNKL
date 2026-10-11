import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load,APP} from './extract.mjs';
import {PEOPLE,scanPerson,synthHairMasks} from './synth.mjs';
const source=fs.readFileSync(new URL('../../public/works/labs/odd-mirror/src/components.js',import.meta.url),'utf8');
const G=load(['STYLE','GEOM','SHAPE','EXPR','HAIR','GLASSES','DRAW'],['OddComponents','TEMPLATE','CANON_IMG','U','EYE_MID','LM','fitPose','frontalize','referenceFace','createShapeScan','shapeAddSample','shapeFinalize','headOutline','HAIR','createHairModel','hairAddSample','hairProfile','hairCommit']);
const C=G.OddComponents;
assert(fs.readFileSync(APP,'utf8').includes(source),'편집 원본과 통합 코드 일치');
const designs=[];
for(const [name,person]of Object.entries(PEOPLE)){
  const sh=scanPerson(G,person),d=C.fromMeasurements({geo:sh.geo,base:G.TEMPLATE,parts:sh.parts});
  C.validate(d);assert.equal(d.hair,'none');assert.equal(d.glasses,'none');assert.equal(d.provenance.hair,'unobserved');
  designs.push(d);console.log(name,d.face,d.eyes,d.nose,d.mouth);
}
assert(new Set(designs.map(d=>d.face)).size>=3,'실제 합성 비율이 서로 다른 얼굴 부품을 선택');
assert(new Set(designs.map(d=>d.eyes)).size>=2,'눈 비율에 따른 선택');
const changed={...G.TEMPLATE,noseY:G.TEMPLATE.noseY*1.2};
const a=C.fromMeasurements({geo:G.TEMPLATE,base:G.TEMPLATE}),b=C.fromMeasurements({geo:changed,base:G.TEMPLATE});
assert.notEqual(a.nose,b.nose);for(const k of ['face','eyes','brows','hair'])assert.equal(a[k],b[k],'코 특징 변경은 다른 부품 종류를 바꾸지 않는다');
const weak=C.fromMeasurements({geo:{...G.TEMPLATE,jawW:100},base:G.TEMPLATE,parts:{face:{c:.1,prov:'estimated'}}});
assert.equal(weak.face,'round');assert.equal(weak.provenance.face,'estimated');
const hm=G.createHairModel(),mask=synthHairMasks(G,G.TEMPLATE,'long');
for(let i=0;i<3;i++)G.hairAddSample(hm,mask.masks,mask.valid,null,i*400);
G.hairCommit(hm,G.hairProfile(hm,G.TEMPLATE));
assert(['bob','long'].includes(C.chooseHair(hm,G.TEMPLATE).id),'긴 마스크는 뒤로 내려오는 헤어 선택');
const shortHair=line=>({target:{radii:Float32Array.from({length:72},()=>1.1),headR:Float32Array.from({length:72},()=>.8),prov:new Uint8Array(72).fill(1),edge:Float32Array.from({length:72},(_,k)=>Math.cos(k/72*Math.PI*2)>.4?1:0),hairline:Float32Array.from(line),estimatedShare:0}});
assert.equal(C.chooseHair(shortHair(Array(27).fill(-.78)),{chinY:1.8,topY:-.94}).id,'back','이마가 드러난 머리는 두꺼운 앞머리로 바꾸지 않음');
assert.equal(C.chooseHair(shortHair(Array(27).fill(-.2)),{chinY:1.8,topY:-.94}).id,'cap','실제로 이마를 덮는 앞머리는 유지');
assert.equal(C.chooseHair(shortHair(Array(27).fill(NaN)),{chinY:1.8,topY:-.94}).id,'crop','읽지 못한 헤어라인에 바가지 형태를 발명하지 않음');
let prev=null,maxStep=0;
for(let open=0;open<=.5;open+=.005){const e=C.neutral();e.mouth.open=open;const m=C.mouthMetrics(a,e);if(prev!==null)maxStep=Math.max(maxStep,m.open-prev);prev=m.open;}
assert(maxStep<.5,'입 벌림 연속');
for(const [key,choices]of Object.entries(C.catalog))for(const [id]of choices){const d=C.defaults();d[key]=id;C.validate(d);const g=C.geometry(d);assert(g.bottom>g.eyeY+70);}
console.log('PASS: 원본/통합 일치, 독립 부품 선택, 신뢰도 표시, 미관측 외형 생략, 헤어 매핑, 입 연속성');
