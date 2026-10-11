import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {launch} from './odd-mirror/chrome.mjs';

const workerURL='http://localhost:8000/experiments/under-construction-worker/';
const workerPath='/experiments/under-construction-worker/';
const mobilePath='/experiments/soon-editor/';

// Measure the real paths before clipping, including their transformed strokes.
// A clipPath hiding a limb outside the box must not count as containment.
function measureArtwork(root,coordinateSpace) {
 const inverse=coordinateSpace.getCTM().inverse();
 const bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
 const parts={};let samples=0;
 for(const el of root.querySelectorAll('path')) {
  const length=el.getTotalLength(),matrix=inverse.multiply(el.getCTM()),style=getComputedStyle(el);
  const radius=style.stroke==='none'?0:parseFloat(style.strokeWidth)/2;
  const padX=radius*Math.hypot(matrix.a,matrix.c),padY=radius*Math.hypot(matrix.b,matrix.d);
  const part=el.closest('[data-part]')?.dataset.part??'artwork';
  const partBounds=parts[part]??={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
  const count=Math.max(1,Math.ceil(length));
  for(let i=0;i<=count;i++) {
   const point=el.getPointAtLength(length*i/count),p=new DOMPoint(point.x,point.y).matrixTransform(matrix);
   samples++;
   for(const target of [bounds,partBounds]) {
    target.left=Math.min(target.left,p.x-padX);target.right=Math.max(target.right,p.x+padX);
    target.top=Math.min(target.top,p.y-padY);target.bottom=Math.max(target.bottom,p.y+padY);
   }
  }
 }
 return {bounds,parts,samples};
}

const browser=await launch({serveRoot:false});
try {
 const page=await browser.open(workerURL,{width:1280,height:900});
 await page.waitFor("document.body?.dataset.ready==='true'");
 await page.eval('document.fonts.ready');
 const config=await page.eval("import('/experiments/under-construction-worker/pose.js').then(m=>({limits:m.SIZE_LIMITS,lengths:m.LENGTHS,scale:m.CHARACTER_SCALE}))");
 assert.equal(config.scale,1,'the character has a fixed native scale');
 const settle=()=>page.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const point=async i=>page.eval(`(()=>{const e=document.querySelector('[data-corner="${i}"]').getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+e.height/2}})()`);
 const drag=async(index,dx,dy)=>{
  const from=await point(index),to={x:from.x+dx,y:from.y+dy};
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});
  for(let k=1;k<=8;k++)await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+dx*k/8,y:from.y+dy*k/8,button:'left',buttons:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});
  await settle();
 };
 const undo=async()=>{
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:4});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:0});
  await settle();
 };
 const inspect=async()=>page.eval(`(()=>{
  const svg=document.querySelector('#worker-canvas'),rect=document.querySelector('#frame').getBBox();
  const measured=(${measureArtwork.toString()})(document.querySelector('#artwork'),svg);
  const bones=[...document.querySelectorAll('[data-root][data-joint][data-end]')].map(el=>{
   const parse=key=>el.dataset[key].split(' ').map(Number),root=parse('root'),joint=parse('joint'),end=parse('end');
   return{part:el.dataset.part,a:Math.hypot(joint[0]-root[0],joint[1]-root[1]),b:Math.hypot(end[0]-joint[0],end[1]-joint[1]),root,joint,end};
  });
  const matrix=svg.getCTM().inverse().multiply(document.querySelector('[data-positioner]').getCTM());
  return{...measured,bones,scale:Math.hypot(matrix.a,matrix.b),pose:+svg.dataset.pose,
   rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},stage:{w:svg.viewBox.baseVal.width,h:svg.viewBox.baseVal.height}};
 })()`);
 const checkBones=(bones)=>{
  assert.equal(bones.length,4);
  for(const bone of bones) {
   const expected=bone.part.endsWith('leg')?[config.lengths.thigh,config.lengths.shin]:[config.lengths.upperArm,config.lengths.forearm];
   assert.ok(Math.abs(bone.a-expected[0])<.002&&Math.abs(bone.b-expected[1])<.002,`${bone.part} keeps both bone lengths: ${bone.a}, ${bone.b}`);
  }
 };
 const check=(state)=>{
  const {rect,bounds}=state;
  assert.ok(bounds.left>=rect.x-.2&&bounds.top>=rect.y-.2&&bounds.right<=rect.x+rect.w+.2&&bounds.bottom<=rect.y+rect.h+.2,`actual artwork stays in frame: ${JSON.stringify({rect,bounds})}`);
  assert.ok(state.samples>100,'containment inspects actual artwork');
  assert.ok(Math.abs(state.scale-config.scale)<1e-6,'box resizing never scales the character');
  assert.ok(rect.w>=config.limits.minWidth-.01&&rect.w<=config.limits.maxWidth+.01,'width limits');
  assert.ok(rect.h>=config.limits.minHeight-.01&&rect.h<=config.limits.maxHeight+.01,'height limits');
  assert.ok(rect.x>=25.99&&rect.x+rect.w<=state.stage.w-25.99,'horizontal screen bounds');
  assert.ok(rect.y>=25.99&&rect.y+rect.h<=state.stage.h-25.99,'vertical screen bounds');
  checkBones(state.bones);
 };

 const grid=await page.eval(`(async()=>{
  const {createCharacter}=await import('/experiments/under-construction-worker/character.js');
  const {createPose,SIZE_LIMITS}=await import('/experiments/under-construction-worker/pose.js');
  const ns='http://www.w3.org/2000/svg',stage=document.createElementNS(ns,'svg'),parent=document.createElementNS(ns,'g');
  stage.setAttribute('viewBox','0 0 760 540');stage.style.cssText='position:fixed;left:-10000px;top:0;width:760px;height:540px';
  stage.append(parent);document.body.append(stage);const rig=createCharacter(parent),results=[];
  const series=(a,b)=>Array.from({length:7},(_,i)=>a+(b-a)*i/6);
  try {
   for(const width of series(SIZE_LIMITS.minWidth,SIZE_LIMITS.maxWidth))for(const height of series(SIZE_LIMITS.minHeight,SIZE_LIMITS.maxHeight)) {
    const pose=createPose(width,height);rig.render(pose);
    const measured=(${measureArtwork.toString()})(rig.figure,rig.figure),{bounds}=measured;
    const bones=[...pose.legs,...pose.arms].map((bone,i)=>({
     part:(i%2?'near-':'far-')+(i<2?'leg':'arm'),root:bone.root,joint:bone.joint,end:bone.end,
     a:Math.hypot(bone.joint.x-bone.root.x,bone.joint.y-bone.root.y),
     b:Math.hypot(bone.end.x-bone.joint.x,bone.end.y-bone.joint.y),
     reach:Math.hypot(bone.end.x-bone.root.x,bone.end.y-bone.root.y),
    }));
    results.push({width,height,...measured,bones,angle:pose.torso.angle,hip:pose.torso.hip,margin:{left:bounds.left,top:bounds.top,right:width-bounds.right,bottom:height-bounds.bottom}});
   }
  } finally {stage.remove();}
  return results;
 })()`);
 await writeFile('/tmp/worker-pose-grid.json',JSON.stringify({grid},null,2));
 assert.equal(grid.length,49);
 assert.deepEqual(grid.filter(s=>Object.values(s.margin).some(value=>value<-.2)).map(({width,height,margin})=>({width,height,margin})),[],'all 49 actual outlines fit before clipping');
 for(const state of grid) {
  checkBones(state.bones);
  for(const part of ['far-boot','near-boot']) {
   const floorGap=state.height-state.parts[part].bottom;
   assert.ok(floorGap>=-.2&&floorGap<=2.5,`${part} rests on the floor at ${state.width}x${state.height}: gap ${floorGap}`);
  }
  assert.ok(Math.abs(state.parts['far-boot'].bottom-state.parts['near-boot'].bottom)<.25,'both boot soles share a floor');
 }
 const standing=grid.filter(state=>state.height===config.limits.maxHeight);
 for(const state of standing) {
  assert.ok(Math.abs(state.angle)<.5*Math.PI/180,'tall boxes keep the torso upright');
  for(const leg of state.bones.slice(0,2))assert.ok(leg.reach/(leg.a+leg.b)>=.97,`standing ${leg.part} is nearly straight`);
 }
 const compact=grid.find(state=>state.width===config.limits.minWidth&&state.height===config.limits.minHeight);
 assert.ok(compact.parts.torso.left>=-.2&&compact.parts.torso.left<=4,'the smallest seated pose rests its back and seat at the left wall');
 for(const leg of compact.bones.slice(0,2))assert.ok(leg.joint.y<leg.root.y-15,'the smallest pose folds its knees upward');

 const initial=await inspect();check(initial);
 await drag(2,40,-50);const changed=await inspect();check(changed);
 assert.notDeepEqual(changed.rect,initial.rect,'mouse drag changes the frame');
 await undo();const restored=await inspect();check(restored);
 assert.deepEqual(restored.rect,initial.rect,'desktop undo restores the previous frame');
 const results=[initial];
 for(const [corner,dx,dy] of [[2,1000,1000],[0,1000,1000],[0,-1000,-1000],[1,1000,1000],[3,1000,-1000]]) {
  await drag(corner,dx,dy);const state=await inspect();check(state);results.push(state);
 }
 for(const dimension of ['Width','Height']) {
  const key=dimension==='Width'?'w':'h';
  assert.ok(results.some(state=>Math.abs(state.rect[key]-config.limits['min'+dimension])<.01),`drag reaches minimum ${dimension.toLowerCase()}`);
  assert.ok(results.some(state=>Math.abs(state.rect[key]-config.limits['max'+dimension])<.01),`drag reaches maximum ${dimension.toLowerCase()}`);
 }
 assert.ok(results.some(state=>state.pose>initial.pose+.3),'compression changes the pose');
 assert.equal(await page.eval('document.documentElement.scrollWidth>innerWidth'),false,'desktop layout does not overflow');
 assert.equal(page.logs.length,0,'no desktop browser errors');
 await page.close();

 const routes=[];
 for(const width of [767,768]) {
  const routePage=await browser.open(workerURL,{width,height:844});
  const expected=width<=767?mobilePath:workerPath;
  await routePage.waitFor(`location.pathname===${JSON.stringify(expected)}&&document.body?.dataset.ready==='true'`);
  const actual=await routePage.eval('location.pathname');assert.equal(actual,expected);routes.push({width,path:actual,pointer:'fine'});
  await routePage.close();
 }
 const coarsePage=await browser.open(workerURL,{width:1024,height:768});
 await coarsePage.waitFor("document.body?.dataset.ready==='true'");
 await coarsePage.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await coarsePage.waitFor(`location.pathname===${JSON.stringify(mobilePath)}&&document.body?.dataset.ready==='true'`);
 assert.equal(await coarsePage.eval("matchMedia('(pointer: coarse)').matches"),true);
 routes.push({width:1024,path:await coarsePage.eval('location.pathname'),pointer:'coarse'});
 assert.equal(await coarsePage.eval('document.documentElement.scrollWidth>innerWidth'),false,'mobile fallback does not overflow');
 await coarsePage.close();
 console.log(JSON.stringify({gridPoses:grid.length,minimumGridMargin:Math.min(...grid.flatMap(s=>Object.values(s.margin))),desktopPoses:results.map(s=>s.pose),frames:results.map(s=>s.rect),constantScale:config.scale,rigidLimbs:true,contained:true,standing:true,seated:true,desktopUndo:true,routes}));
} finally {await browser.close();}
