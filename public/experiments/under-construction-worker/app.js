import { resizeRect } from './geometry.js';
import { createPose, CHARACTER_SCALE, SIZE_LIMITS } from './pose.js';
import { createCharacter } from './character.js';

const svg=document.querySelector('#worker-canvas');
const artwork=document.querySelector('#artwork');
const frame=document.querySelector('#frame');
const clip=document.querySelector('#clip-rect');
const cornerLayer=document.querySelector('#corners');
const status=document.querySelector('#status');
const ns='http://www.w3.org/2000/svg';
const make=(tag,attrs,parent)=>{const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));parent.append(n);return n;};
const positioner=make('g',{'data-positioner':'worker'},artwork);
const character=createCharacter(positioner);
const stageWidth=760;
const stageHeight=540;
let rect={left:stageWidth/2-120,top:100,right:stageWidth/2+120,bottom:440};
let drag=null,pending=0;
const history=[];
const corners=['왼쪽 위','오른쪽 위','오른쪽 아래','왼쪽 아래'].map((name,i)=>{
  const g=make('g',{class:'corner','data-corner':i,role:'button',tabindex:0,'aria-label':`${name} 모서리 크기 조절`,'aria-description':'드래그하거나 방향키로 크기를 조절합니다.'},cornerLayer);
  make('rect',{class:'corner-hit'},g);make('rect',{class:'corner-box'},g);return g;
});
const getCorner=(r,i)=>({x:i===0||i===3?r.left:r.right,y:i<2?r.top:r.bottom});
const limits=()=>({...SIZE_LIMITS,maxWidth:Math.min(SIZE_LIMITS.maxWidth,stageWidth-52),bounds:{left:26,top:26,right:stageWidth-26,bottom:stageHeight-26}});
const localPoint=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());

function render(){
  svg.setAttribute('viewBox',`0 0 ${stageWidth} ${stageHeight}`);
  const width=rect.right-rect.left,height=rect.bottom-rect.top;
  for(const n of [frame,clip])for(const [k,v] of Object.entries({x:rect.left,y:rect.top,width,height}))n.setAttribute(k,v);
  const unit=1/(svg.getScreenCTM()?.a||1);
  corners.forEach((g,i)=>{
    const p=getCorner(rect,i);g.setAttribute('transform',`translate(${p.x} ${p.y})`);
    [[g.firstElementChild,44*unit],[g.lastElementChild,10*unit]].forEach(([n,s])=>{
      for(const [k,v] of Object.entries({x:-s/2,y:-s/2,width:s,height:s}))n.setAttribute(k,v);
    });
  });
  const pose=createPose(width,height);
  character.render(pose);
  // Pose coordinates belong to the box; body parts never stretch to fit.
  positioner.setAttribute('transform',`translate(${rect.left} ${rect.top}) scale(${CHARACTER_SCALE})`);
  svg.dataset.pose=pose.progress.toFixed(4);
  svg.dataset.characterScale=CHARACTER_SCALE;

}
function requestRender(){if(!pending)pending=requestAnimationFrame(()=>{pending=0;render();});}
function start(e) {
  const group = e.target.closest('.corner');
  if (!group || e.button !== 0 || drag) return;
  e.preventDefault();
  const index = Number(group.dataset.corner), p = localPoint(e), q = getCorner(rect,index);
  drag = {index, pointer:e.pointerId, before:{...rect}, offset:{x:q.x-p.x,y:q.y-p.y}};
  svg.setPointerCapture(e.pointerId); group.focus({preventScroll:true});
  group.classList.add('is-active'); svg.classList.add('is-dragging');
}
svg.addEventListener('pointerdown', start);
svg.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const p = localPoint(e);
  rect = resizeRect(rect, drag.index, {x:p.x+drag.offset.x,y:p.y+drag.offset.y}, limits());
  
  requestRender();
});
function finish(e, cancel=false) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const active = drag;
  if (cancel) rect = active.before;
  else if (JSON.stringify(rect) !== JSON.stringify(active.before)) { history.push(active.before); if(history.length>30)history.shift(); }
  drag = null;
  if(svg.hasPointerCapture(active.pointer))svg.releasePointerCapture(active.pointer);
  corners[active.index].classList.remove('is-active'); svg.classList.remove('is-dragging');
  status.textContent = cancel ? '변형을 취소했습니다.' : '박스 크기에 맞춰 작업자의 자세를 바꿨습니다.';
  requestRender();
}
svg.addEventListener('pointerup', e=>finish(e));
svg.addEventListener('pointercancel', e=>finish(e,true));
svg.addEventListener('lostpointercapture', e=>finish(e));
svg.addEventListener('keydown', e=>{
  if (e.key==='Escape' && drag) { finish({pointerId:drag.pointer},true); return; }
  const group=e.target.closest('.corner'); if(!group)return;
  const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(!direction)return; e.preventDefault();
  if(!e.repeat){history.push({...rect});if(history.length>30)history.shift();}
  const index=Number(group.dataset.corner),p=getCorner(rect,index),step=e.shiftKey?20:6;
  rect=resizeRect(rect,index,{x:p.x+direction[0]*step,y:p.y+direction[1]*step},limits());requestRender();
});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!drag&&history.length){e.preventDefault();rect=history.pop();requestRender();}
});
new ResizeObserver(requestRender).observe(svg);
render();document.body.dataset.ready='true';
