// 모델/카메라 없이 실제 앱 함수를 합성 랜드마크로 실행한다.
import assert from 'node:assert/strict';
import { sectionCode } from './extract.mjs';
import { shapeFace, project, observe, synthHairMasks } from './synth.mjs';
let pixelReads=0;
const context=new Proxy({}, {get:(_,key)=>key==='getImageData'?()=>{pixelReads++;throw new Error('스캔 밖에서 픽셀을 읽음')}:()=>{}});
const element={textContent:'',style:{},setAttribute(){},classList:{toggle(){}},addEventListener(){},querySelector(){return this},getContext(){return context},videoWidth:1280,videoHeight:720};
const env={document:{getElementById(){return element}},window:{},location:{search:'',protocol:'http:',href:'http://localhost/odd-mirror.html'},OffscreenCanvas:class {getContext(){return context}},requestAnimationFrame(){},addEventListener(){}};
const exports=['state','createPerson','manualRescan','finishScan','onLandmarks','onSegResult','requestSegment','personRig',
  'applyGlassesChoice','applyAppearanceChoice','checkSegmentHealth',
  'CANON_IMG','U','EYE_MID','LM','fitPose','frontalize','referenceFace','shapeAddSample','HAIR','shapeFinalize','headOutline','hairAddSample'];
const G=new Function(...Object.keys(env),sectionCode(['STYLE','GEOM','SHAPE','EXPR','HAIR','GLASSES','DRAW','MAIN'])+`\nreturn {${exports}}`)(...Object.values(env));
const p=G.state.person=G.createPerson(2,0);
G.state.personCount=3;
const face=shapeFace(G,{}), lm=project(G,face), o=observe(G,lm);
for(let t=0;t<2400;t+=100)G.shapeAddSample(p.scan,o.P,o.F,o.pose,o.ref,{},1280,720,t);
assert(p.scan.samples.length>=10);
const masks=synthHairMasks(G,G.shapeFinalize(p.scan).geo,'long');
const rgb=new Uint8ClampedArray(G.HAIR.segPx**2*4);
for(let t=0;t<3;t++)G.hairAddSample(p.hair,masks.masks,masks.valid,rgb,1000+t*400,1);
p.glasses.worn=true;p.glasses.shape={a:.3,b:.22};
G.finishScan(p,2400);
assert.equal(p.phase,'live');assert.equal(p.glasses.alpha,1);
assert(p.hair.target && p.hair.display,'실제 합성 헤어가 확정되어야 함');
assert.deepEqual(p.glasses.drawShape,{a:.3,b:.22});
assert.notEqual(p.glasses.drawShape,p.glasses.shape);
// 분할이 가능한 상태에서도 라이브 프레임은 머리/안경 픽셀을 다시 읽지 않는다.
G.state.seg.mode='worker';
assert(p.components,'스캔 완료 시 부품 조합 확정');
const frozen=JSON.stringify([p.hair,p.glasses,p.components]);
for(let t=2500;t<25000;t+=100){
  G.onLandmarks({faceLandmarks:[lm]},t);
  assert.equal(G.state.person,p);
}
assert.equal(JSON.stringify([p.hair,p.glasses,p.components]),frozen);
assert(p.expr,'표정 업데이트는 유지');
G.requestSegment(p,o.pose,25000);
assert.equal(pixelReads,0);
// 스캔 종료 직후 도착한 동일 epoch 결과도 반영하면 안 된다.
G.state.seg.pending={id:40,personId:p.id,epoch:p.epoch};G.state.seg.busy=true;
G.onSegResult(40,{});
assert.equal(G.state.seg.busy,false);assert.equal(p.segCount,0);
assert.equal(JSON.stringify([p.hair,p.glasses,p.components]),frozen);
// 직접 보정은 자동 관측과 구분하고, 자동으로 돌아가면 최초 결과를 복원한다.
p.manualGlasses='rect';G.applyGlassesChoice(p);
assert.equal(p.components.glasses,'rect');assert.equal(p.components.provenance.glasses,'user');
assert.equal(p.components.lens,null);
p.manualGlasses='auto';G.applyGlassesChoice(p);
assert.equal(JSON.stringify([p.hair,p.glasses,p.components]),frozen);
p.manualGlasses='round';G.applyGlassesChoice(p);
p.manualHair='back';p.manualShirt='#f4f1e9';G.applyAppearanceChoice(p);
assert.equal(p.components.hair,'back');assert.equal(G.personRig(p).colors.shirt,'#f4f1e9');
// 수동 스캔은 id(팔레트)를 보존하고 액세서리와 분석 시각을 초기화한다.
G.state.seg.pending={id:41,personId:p.id,epoch:p.epoch};G.state.seg.busy=true;
G.manualRescan(26000);
assert.equal(p.id,2);assert.equal(p.epoch,1);assert.equal(p.phase,'scan');
assert.equal(p.glasses.shape,null);assert.equal(p.hair.n,0);
assert.equal(p.components,null);
assert.equal(p.manualGlasses,'round','같은 사람의 명시적인 안경 보정은 재스캔에도 유지');
assert.equal(p.manualHair,'back');assert.equal(p.manualShirt,'#f4f1e9');
assert.equal(p.lastGlasses,-1e9);assert.equal(p.lastFit,-1e9);
G.onSegResult(41,{}); // 이전 epoch 결과가 도착해도 새 스캔을 오염시키지 않는다.
assert.equal(p.segCount,0);assert.equal(G.state.seg.busy,false);
// 실제로 자리를 비운 뒤 돌아오면 새로운 사람 스캔을 시작한다.
G.state.seg.mode='failed';p.lastSeen=26000;p.missedFrames=8;
const turned=project(G,face,{yaw:.7}); // 초기 안경 픽셀 추출은 이 테스트 대상 아님
G.onLandmarks({faceLandmarks:[turned]},29000);
assert.notEqual(G.state.person,p);assert.equal(G.state.person.phase,'scan');
assert.equal(G.state.person.glasses.shape,null);
assert.equal(G.state.person.manualGlasses,'auto','새 사람은 자동 판단으로 시작');
assert.equal(G.state.person.manualHair,'auto');assert.equal(G.state.person.manualShirt,null);
// 충분한 관측이 모인 정상 경로는 별도 확인 버튼 없이 완료한다.
const ready=G.state.person=G.createPerson(4,30000);
for(let t=30000;t<32400;t+=100)G.shapeAddSample(ready.scan,o.P,o.F,o.pose,o.ref,{},1280,720,t);
ready.segCount=3;ready.clothesCount=2;ready.clothing.result={color:'#f1efe9',stable:true,confidence:.95,shoulderRatio:2.1,neckDepth:17,provenance:'observed'};
ready.glasses.samples=6;ready.lastGlasses=32500;G.state.seg.mode='worker';
G.onLandmarks({faceLandmarks:[lm]},32500);
assert.equal(ready.phase,'live','신뢰할 표본이 모이면 자동으로 완료');
assert.equal(G.personRig(ready).colors.shirt,'#f1efe9','관측한 흰 옷 색이 실제 렌더러까지 전달');
assert.equal(ready.components.clothing.neckDepth,17);
let recovered=false;G.state.phase='running';G.state.seg.busy=true;G.state.seg.sentAt=0;G.state.seg.fallback=()=>{recovered=true;};
G.checkSegmentHealth(9000);assert(recovered,'얼굴 입력이 없어도 지연된 분할을 복구');
console.log('PASS: 초기 고정, 22초 라이브 유지, 표정 유지, 재분석 차단, 늦은 응답 차단, 수동 재스캔 색 유지, 새 사람 자동 스캔');
