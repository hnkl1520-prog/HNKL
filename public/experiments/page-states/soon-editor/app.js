import { originalGlyphs } from './glyphs.js';

const svg=document.querySelector('#letter-canvas');
const status=document.querySelector('#status');
const ns='http://www.w3.org/2000/svg';
const clone=value=>structuredClone(value);
let glyphs=clone(originalGlyphs),selection={g:2,c:0,n:6},drag=null;
const history=[];
const paths=[],points=[];
const make=(tag,attributes={},parent=svg)=>{
  const node=document.createElementNS(ns,tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,value);
  parent.append(node);return node;
};
const shapeLayer=make('g',{'aria-hidden':'true'});
const handleLayer=make('g');
const anchorLayer=make('g');
const controlLine=make('path',{class:'control-line'},handleLayer);
const controls=['inHandle','outHandle'].map((kind,i)=>make('circle',{
  class:'control-point','data-kind':kind,tabindex:0,role:'button',
  'aria-label':i?'나가는 곡선 핸들':'들어오는 곡선 핸들'
},handleLayer));
const key=({g,c,n})=>`${g}:${c}:${n}`;
const nodeAt=ref=>glyphs[ref.g].contours[ref.c][ref.n];
const format=point=>point.map(v=>v.toFixed(2)).join(' ');
function outline(glyph){
  return glyph.contours.map(contour=>{
    let d=`M ${format(contour[0].p)}`;
    contour.forEach((node,i)=>{
      const next=contour[(i+1)%contour.length];
      d+=` C ${format(node.outHandle)} ${format(next.inHandle)} ${format(next.p)}`;
    });
    return d+' Z';
  }).join(' ');
}
for(let g=0;g<glyphs.length;g++){
  paths.push(make('path',{class:'letter-shape','fill-rule':'evenodd','data-letter':glyphs[g].id},shapeLayer));
  glyphs[g].contours.forEach((contour,c)=>contour.forEach((_node,n)=>{
    const ref={g,c,n};
    const element=make('rect',{class:'anchor','data-point':key(ref),tabindex:-1,role:'button',
      'aria-label':`${g+1}번째 글자 ${glyphs[g].name}, 윤곽점 ${c+1}-${n+1}`},anchorLayer);
    element.addEventListener('focus',()=>select(ref,false));
    points.push({ref,element});
  }));
}
function unit(){return 1/(svg.getScreenCTM()?.a||1);}
function select(ref,focus=false){
  selection={...ref};render();
  if(focus)points.find(item=>key(item.ref)===key(ref)).element.focus({preventScroll:true});
}
function render(){
  paths.forEach((path,i)=>path.setAttribute('d',outline(glyphs[i])));
  const compact=svg.clientWidth<600;
  for(const {ref,element}of points){
    const size=(compact?4.5:6)*unit();
    const [x,y]=nodeAt(ref).p;
    element.setAttribute('x',x-size/2);element.setAttribute('y',y-size/2);
    element.setAttribute('width',size);element.setAttribute('height',size);
    const current=key(ref)===key(selection);
    element.style.visibility=compact&&ref.g!==selection.g?'hidden':'visible';
    element.classList.toggle('is-selected',current);
    element.setAttribute('tabindex',current?'0':'-1');
  }
  const node=nodeAt(selection);
  controlLine.setAttribute('d',`M ${format(node.inHandle)} L ${format(node.p)} L ${format(node.outHandle)}`);
  controls.forEach((element,i)=>{
    const handle=node[i?'outHandle':'inHandle'];
    element.setAttribute('cx',handle[0]);element.setAttribute('cy',handle[1]);element.setAttribute('r',3*unit());
  });
}
function position(event){
  return new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
}
function nearest(point,pointerType){
  const radius=(pointerType==='touch'?20:11)*unit();
  let best=null,distance=radius;
  for(const item of points){
    const p=nodeAt(item.ref).p,d=Math.hypot(p[0]-point.x,p[1]-point.y);
    if(d<distance){distance=d;best={...item.ref,kind:'p'};}
  }
  const node=nodeAt(selection);
  for(const kind of ['inHandle','outHandle']){
    const p=node[kind],d=Math.hypot(p[0]-point.x,p[1]-point.y);
    if(d<distance){distance=d;best={...selection,kind};}
  }
  return best;
}
function remember(snapshot=clone(glyphs)){
  history.push(snapshot);if(history.length>30)history.shift();
}
function movePoint(ref,kind,x,y,source,independent=false){
  const node=nodeAt(ref);
  x=Math.min(1104,Math.max(16,x));y=Math.min(344,Math.max(16,y));
  if(kind==='p'){
    const dx=x-source.p[0],dy=y-source.p[1];
    for(const part of ['p','inHandle','outHandle'])node[part]=[source[part][0]+dx,source[part][1]+dy];
  }else{
    node[kind]=[x,y];
    const other=kind==='inHandle'?'outHandle':'inHandle';
    const a=[source[kind][0]-source.p[0],source[kind][1]-source.p[1]];
    const b=[source[other][0]-source.p[0],source[other][1]-source.p[1]];
    const lengthA=Math.hypot(...a),lengthB=Math.hypot(...b);
    const smooth=lengthA>.1&&lengthB>.1&&(a[0]*b[0]+a[1]*b[1])/(lengthA*lengthB)<-.985;
    if(smooth&&!independent){
      const dx=x-node.p[0],dy=y-node.p[1],length=Math.hypot(dx,dy);
      if(length>.1)node[other]=[node.p[0]-dx/length*lengthB,node.p[1]-dy/length*lengthB];
    }
  }
  render();
}
svg.addEventListener('pointerdown',event=>{
  if(event.button!==0||drag)return;
  const p=position(event),hit=nearest(p,event.pointerType);
  if(!hit){
    const g=paths.indexOf(event.target);
    if(g>=0){
      const candidates=points.filter(item=>item.ref.g===g);
      candidates.sort((a,b)=>Math.hypot(nodeAt(a.ref).p[0]-p.x,nodeAt(a.ref).p[1]-p.y)-Math.hypot(nodeAt(b.ref).p[0]-p.x,nodeAt(b.ref).p[1]-p.y));
      select(candidates[0].ref,true);
    }
    return;
  }
  event.preventDefault();svg.setPointerCapture(event.pointerId);
  select(hit,hit.kind==='p');
  if(hit.kind!=='p')controls[hit.kind==='outHandle'?1:0].focus({preventScroll:true});
  drag={...hit,pointer:event.pointerId,start:[p.x,p.y],source:clone(nodeAt(hit)),before:clone(glyphs),moved:false};
  svg.classList.add('is-dragging');
});
svg.addEventListener('pointermove',event=>{
  if(!drag){svg.style.cursor=nearest(position(event),event.pointerType)?'grab':'';return;}
  if(event.pointerId!==drag.pointer)return;
  const p=position(event),dx=p.x-drag.start[0],dy=p.y-drag.start[1];
  if(Math.hypot(dx,dy)>.5)drag.moved=true;
  const source=drag.source[drag.kind];
  movePoint(drag,drag.kind,source[0]+dx,source[1]+dy,drag.source,event.altKey);
});
function finish(event,cancel=false){
  if(!drag||event.pointerId!==drag.pointer)return;
  if(cancel)glyphs=drag.before;
  else if(drag.moved){remember(drag.before);status.textContent=`${glyphs[drag.g].name}의 모양을 수정했습니다.`;}
  if(svg.hasPointerCapture(drag.pointer))svg.releasePointerCapture(drag.pointer);
  drag=null;svg.classList.remove('is-dragging');svg.style.cursor='';render();
}
svg.addEventListener('pointerup',event=>finish(event));
svg.addEventListener('pointercancel',event=>finish(event,true));
svg.addEventListener('lostpointercapture',event=>finish(event));
svg.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&drag){finish({pointerId:drag.pointer},true);return;}
  if(event.key==='['||event.key===']'){
    event.preventDefault();
    const index=points.findIndex(item=>key(item.ref)===key(selection));
    select(points[(index+(event.key===']'?1:points.length-1))%points.length].ref,true);return;
  }
  const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  const direction=directions[event.key];if(!direction)return;
  event.preventDefault();if(!event.repeat)remember();
  const kind=event.target.dataset.kind||'p',source=clone(nodeAt(selection)),amount=event.shiftKey?10:2;
  movePoint(selection,kind,source[kind][0]+direction[0]*amount,source[kind][1]+direction[1]*amount,source,event.altKey);
});
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!drag&&history.length){
    event.preventDefault();glyphs=history.pop();render();status.textContent='마지막 수정을 취소했습니다.';
  }
});
new ResizeObserver(render).observe(svg);
render();document.body.dataset.ready='true';
