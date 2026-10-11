import assert from 'node:assert/strict';
import {load} from './extract.mjs';
import {PEOPLE,scanPerson,shapeFace,project,observe,blendshapes} from './synth.mjs';
const G=load(['STYLE','GEOM','SHAPE','EXPR','HAIR','GLASSES','DRAW'],['OddComponents','TEMPLATE','CANON_IMG','U','EYE_MID','LM','fitPose','frontalize','referenceFace','createShapeScan','shapeAddSample','shapeFinalize','exprTarget','exprUpdate','neutralExpr']);
const C=G.OddComponents,shape=scanPerson(G,PEOPLE.보통),frame=observe(G,project(G,shapeFace(G,PEOPLE.보통)));
for(const [eyes]of C.catalog.eyes){
  const d=C.defaults();d.eyes=eyes;const e=C.neutral(),a=C.pupilMetrics(d,C.geometry(d),e);
  e.eyeR.open=e.eyeL.open=1.4;const b=C.pupilMetrics(d,C.geometry(d),e);
  assert.deepEqual([a.rx,a.ry,a.y],[b.rx,b.ry,b.y],'눈꺼풀만 커지고 동공 형태와 중심은 유지');
}
const frown=G.exprTarget(frame.F,shape,{mouthFrownLeft:.9,mouthFrownRight:.9,browDownLeft:.9,browDownRight:.9},frame.pose);
const smilingFrame=observe(G,project(G,shapeFace(G,PEOPLE.보통,{smile:.8})));
const smile=G.exprTarget(smilingFrame.F,shape,blendshapes({smile:.8}),smilingFrame.pose);
const calibration={mouthSmileLeft:.28,mouthSmileRight:.28,mouthFrownLeft:.1,mouthFrownRight:.1};
const calibrated=G.exprTarget(frame.F,{...shape,baseBS:calibration},calibration,frame.pose);
const noScores=G.exprTarget(frame.F,shape,{},frame.pose);
assert.equal(calibrated.mouth.smile,noScores.mouth.smile,'기본 표정의 상시 웃음 점수가 라이브 표정에 중복되지 않음');
assert.equal(calibrated.mouth.frown,0);
const stretched=Float32Array.from(frame.F);stretched[2*61]-=.1;stretched[2*291]+=.1;
const flatStretch=G.exprTarget(stretched,shape,{mouthStretchLeft:.9,mouthStretchRight:.9},frame.pose);
assert(flatStretch.mouth.smile<.02,'수평으로만 당긴 입을 웃음으로 바꾸지 않음');
const conflictingSmile=G.exprTarget(stretched,shape,{mouthStretchLeft:.9,mouthStretchRight:.9,mouthSmileLeft:.9,mouthSmileRight:.9},frame.pose);
assert(conflictingSmile.mouth.smile<.03,'웃음 점수가 높아도 입꼬리 상승 근거 없는 가로 당김을 미소로 만들지 않음');
const ew=Float32Array.from(stretched);ew[2*13+1]-=.04;ew[2*81+1]-=.10;ew[2*311+1]-=.03;
const disgust=G.exprTarget(ew,shape,{noseSneerLeft:.85,noseSneerRight:.5,mouthUpperUpLeft:.8,mouthUpperUpRight:.5,mouthStretchLeft:.8,mouthStretchRight:.8,mouthSmileLeft:.45,mouthSmileRight:.45},frame.pose);
assert(disgust.mouth.smile<.01,'찡그림과 웃음 점수가 섞여도 Eww를 미소로 만들지 않음');
assert(disgust.mouth.upperR>disgust.mouth.upperL+.3,'한쪽 윗입술 들림을 별도 채널로 유지');
assert.equal(disgust.mouth.teeth,0);
let ewState=G.neutralExpr();for(let i=0;i<20;i++)ewState=G.exprUpdate(ewState,disgust,16,1);
assert(ewState.mouth.sneer>.8&&ewState.mouth.upperR>ewState.mouth.upperL,'새 채널도 실제 평활화를 통과');
const curvature=m=>m.cy-(m.l[1]+m.r[1])/2;
for(const [mouth]of C.catalog.mouth){
  const d=C.defaults();d.mouth=mouth;
  assert(Math.abs(curvature(C.mouthMetrics(d,C.neutral())))<.01,'기본값에 웃음 곡률이 없음');
  assert(curvature(C.mouthMetrics(d,frown))<-6,'찡그림 점수가 들어오면 입 중앙이 입꼬리 위로 올라감');
  assert(curvature(C.mouthMetrics(d,smile))>6,'웃음은 반대 방향으로 휘어짐');
  const e=C.neutral();e.mouth.cR[1]=e.mouth.cL[1]=.06;
  assert(curvature(C.mouthMetrics(d,e))<-5,'블렌드셰이프 없이 입꼬리 좌표만 내려도 찡그림');
  e.mouth.cR[1]=-.08;e.mouth.cL[1]=.03;
  assert(C.mouthMetrics(d,e).r[1]-C.mouthMetrics(d,e).l[1]>10,'한쪽 입꼬리 차이가 남음');
  e.mouth.open=.35;const opened=C.mouthMetrics(d,e).open;e.mouth.press=1;
  assert(C.mouthMetrics(d,e).open<opened*.25,'입술 누르기가 벌림을 억제');
  e.mouth.press=0;e.mouth.open=0;let last=null;
  for(let i=0;i<=120;i++){e.mouth.open=i*.005;const m=C.mouthMetrics(d,e);if(last){assert(m.open>=last.open);assert(m.open-last.open<.46);}last=m;}
}
assert.equal(frown.mouth.teeth,0,'찡그림에 치아가 생기지 않음');
assert(frown.browR.inn<-.08&&frown.browL.inn<-.08,'찡그릴 때 눈썹 안쪽도 내려감');
let state=G.neutralExpr();for(let i=0;i<30;i++)state=G.exprUpdate(state,frown,16,1);
assert(state.mouth.frown>.85,'새 찡그림 채널이 실시간 평활화를 통과');
for(let i=0;i<35;i++)state=G.exprUpdate(state,frown,16,0);
assert(state.mouth.frown<.01,'신뢰도 하락 시 찡그림도 무표정으로 풀림');
const winkFrame=observe(G,project(G,shapeFace(G,PEOPLE.보통,{blinkR:1})));
const wink=G.exprTarget(winkFrame.F,shape,blendshapes({blinkR:1}),winkFrame.pose);
assert(wink.eyeR.open<.15&&wink.eyeL.open>.8,'한쪽 눈만 감김');
console.log('PASS: 실제 앱 표정 계산 → 부품 렌더링 제어값, 4가지 입의 미소/찡그림/비대칭/누르기/연속성, 윙크, 신뢰도 복귀');
