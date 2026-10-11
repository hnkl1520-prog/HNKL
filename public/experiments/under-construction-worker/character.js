import { HEAD_PATHS, BOOT_PATHS, HAND_PATHS } from './parts.js';

const NS = 'http://www.w3.org/2000/svg';
const C = { ink:'#26333B', shirt:'#FFF9EC', pants:'#3F64AD', skin:'#F0B998', yellow:'#F3C64F', vest:'#F49827' };
const make = (tag,attrs,parent) => {const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));parent.append(n);return n;};
const set = (n,attrs)=>Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
const xy = v=>`${v.x.toFixed(3)} ${v.y.toFixed(3)}`;
const add=(a,b,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
const unit=(a,b)=>{const d=Math.hypot(b.x-a.x,b.y-a.y)||1;return{x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
const rotate=(v,a)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)});
const radians=degrees=>degrees*Math.PI/180;

// The final cross-section follows the cuff, not the shin/forearm direction.
// Its overlap is real geometry, so wrists and ankles stay joined when bent.
function limbOutline(bone,widths,endAxis={x:0,y:1},overlap=0){
  const {root,joint,end}=bone,u=unit(root,joint),v=unit(joint,end);
  const a={x:-u.y,y:u.x},b={x:-v.y,y:v.x};
  const normal=unit({x:0,y:0},add(a,b));
  const miter=Math.min(1.35,1/Math.max(.2,normal.x*b.x+normal.y*b.y));
  const tip=add(end,endAxis,overlap);
  let cuff={x:-endAxis.y,y:endAxis.x};
  if(cuff.x*b.x+cuff.y*b.y<0)cuff={x:-cuff.x,y:-cuff.y};
  const pts=[add(root,a,widths[0]),add(joint,normal,widths[1]*miter),add(tip,cuff,widths[2]),add(tip,cuff,-widths[2]),add(joint,normal,-widths[1]*miter),add(root,a,-widths[0])];
  const radii=[12,18,0,0,18,12];
  return pts.map((p,i)=>{
    const prev=pts[(i+5)%6],next=pts[(i+1)%6];
    const radius=Math.min(radii[i],Math.hypot(p.x-prev.x,p.y-prev.y)*.38,Math.hypot(p.x-next.x,p.y-next.y)*.38);
    return `${i?'L':'M'}${xy(add(p,unit(p,prev),radius))}Q${xy(p)} ${xy(add(p,unit(p,next),radius))}`;
  }).join('')+'Z';
}
function sleeveOutline(bone){
  const u=unit(bone.root,bone.joint),n={x:-u.y,y:u.x};
  const root=add(bone.root,u,-3),tip=add(bone.root,u,28);
  return `M${xy(add(root,n,16))}C${xy(add(add(root,n,16),u,-15))} ${xy(add(add(root,n,-16),u,-15))} ${xy(add(root,n,-16))}L${xy(add(tip,n,-16))}Q${xy(add(tip,u,2))} ${xy(add(tip,n,16))}Z`;
}
const handAxis=(mode,angle)=>rotate(mode==='ceiling'?{x:0,y:-1}:mode==='wall'?{x:1,y:0}:{x:0,y:1},radians(angle));

export function createCharacter(parent){
  const figure=make('g',{'data-character':'worker','stroke-linejoin':'round','stroke-linecap':'round'},parent);
  const group=id=>make('g',{'data-part':id},figure);
  const graphic=(d,fill,host=figure,extra={})=>make('path',{d,fill,stroke:C.ink,'stroke-width':1.15,...extra},host);
  function artwork(id,paths){const g=group(id);for(const {d,fill,strokeWidth=1.15,...attrs}of paths)graphic(d,fill,g,{'stroke-width':strokeWidth,...attrs});return g;}
  function arm(id){const g=group(id);return{g,skin:graphic('',C.skin,g),sleeve:graphic('',C.shirt,g)};}
  function leg(id){const g=group(id);return{g,path:graphic('',C.pants,g)};}
  function hand(id){const holder=group(id),modes={};for(const[mode,paths]of Object.entries(HAND_PATHS)){
    const g=make('g',{'data-glove':mode},holder);modes[mode]=g;
    for(const {d,fill,strokeWidth=1.15,...attrs}of paths)graphic(d,fill,g,{'stroke-width':strokeWidth,...attrs});
  }return{holder,modes};}

  const farArm=arm('far-arm'),farHand=hand('far-hand');
  const farBoot=artwork('far-boot',BOOT_PATHS),farLeg=leg('far-leg');
  const nearBoot=artwork('near-boot',BOOT_PATHS),nearLeg=leg('near-leg');
  // Two outline passes, followed by both fills, form one trouser silhouette.
  // This removes the artificial seam where the hip used to cap the thigh.
  set(nearLeg.path,{'stroke-width':2.3});
  const pelvisOutline=graphic('',C.pants,nearLeg.g,{'stroke-width':2.3});
  const legFill=graphic('',C.pants,nearLeg.g,{stroke:'none'});
  const pelvisFill=graphic('',C.pants,nearLeg.g,{stroke:'none'});
  const torso=group('torso');
  const neck=graphic('',C.skin,torso);
  const shirt=graphic('',C.shirt,torso);

  const vest=graphic('',C.vest,torso);
  const stripe=graphic('',C.yellow,torso,{'stroke-width':0});
  const seam=graphic('','none',torso,{'stroke-width':.85});
  const nearArm=arm('near-arm'),nearHand=hand('near-hand');
  const head=artwork('head',HEAD_PATHS);
  const parts={farArm,nearArm,farLeg,nearLeg};

  return {figure,render(pose){
    const hip=pose.torso.hip,angle=pose.torso.angle;
    const local=point=>rotate({x:point.x-hip.x,y:point.y-hip.y},-angle);
    const shoulders=pose.arms.map(b=>local(b.root));
    const top=(shoulders[0].y+shoulders[1].y)/2;
    const neckPoint=(x,y)=>local(add(pose.head,rotate({x,y},pose.head.angle||0)));
    const neckL=neckPoint(-8,14),neckR=neckPoint(9,13);
    set(torso,{transform:`translate(${xy(hip)}) rotate(${angle*180/Math.PI})`});
    set(neck,{d:`M${xy(neckL)}L${xy(neckR)}L12 ${top-2}L-11 ${top-2}Z`});
    set(shirt,{d:`M-10 ${top-12}Q-31 ${top-12} -33 ${top+12}L-33-5Q-33 15-10 19H15Q34 15 32-5L29 ${top+12}Q28 ${top-10} 10 ${top-12}Q2 ${top-2} -10 ${top-12}Z`});
    const pelvisD='M-32-17Q-2-7 30-17L32 0Q34 20 12 20H-13Q-34 20-33 2Z';
    for(const node of [pelvisOutline,pelvisFill])set(node,{d:pelvisD,transform:`translate(${xy(hip)}) rotate(${angle*180/Math.PI})`});
    set(vest,{d:`M-17 ${top-11}L-10 ${top-12}Q-5 ${top+3} 13 ${top+13}L16 ${top-10}Q27 ${top-4} 29 ${top+13}L33 7Q29 14 19 10L13 5Q-5 17-32 6L-32 ${top+12}Q-30 ${top-3} -17 ${top-11}Z`});
    set(stripe,{d:'M-32-30Q-3-19 31-29L32-22Q0-12-32-23Z'});
    set(seam,{d:`M13 ${top+13}L19 10`});

    [farLeg,nearLeg].forEach((nodes,i)=>{
      const bone=pose.legs[i],axis=rotate({x:0,y:1},radians(pose.bootAngles[i]));
      const d=limbOutline(bone,i?[23,20,12]:[22,19,11.5],axis,-7);
      set(nodes.path,{d});if(i)set(legFill,{d});
    });
    [farArm,nearArm].forEach((nodes,i)=>{
      const bone=pose.arms[i],mode=pose.handModes?.[i]||'rest';
      set(nodes.skin,{d:limbOutline(bone,[13.5,12,8],handAxis(mode,pose.handAngles[i]),1)});
      set(nodes.sleeve,{d:sleeveOutline(bone)});
    });
    for(const[key,nodes]of Object.entries(parts)){
      const i=key.startsWith('near')?1:0,bone=key.endsWith('Arm')?pose.arms[i]:pose.legs[i];
      nodes.g.dataset.root=xy(bone.root);nodes.g.dataset.joint=xy(bone.joint);nodes.g.dataset.end=xy(bone.end);
    }
    set(head,{transform:`translate(${xy(pose.head)}) rotate(${(pose.head.angle||0)*180/Math.PI})`});
    [farBoot,nearBoot].forEach((g,i)=>set(g,{transform:`translate(${xy(pose.legs[i].end)}) rotate(${pose.bootAngles[i]})`}));
    [farHand,nearHand].forEach((hand,i)=>{
      const mode=pose.handModes?.[i]||'rest';
      for(const[name,g]of Object.entries(hand.modes))g.style.display=name===mode?'':'none';
      set(hand.holder,{transform:`translate(${xy(pose.arms[i].end)}) rotate(${pose.handAngles[i]})`});
    });
    figure.dataset.poseName=pose.name||'';
  }};
}
