const NS = 'http://www.w3.org/2000/svg';
const C = { ink:'#303C44', shirt:'#FFF9EC', pants:'#446BA9', glove:'#446BA9', skin:'#F1B996', yellow:'#F0C657', vest:'#EF9143', sole:'#273C49', hair:'#644D3D' };
const make = (tag, attrs, parent) => { const n=document.createElementNS(NS,tag); Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v)); parent.append(n); return n; };
const set = (n,attrs)=>Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
const p = v => `${v.x.toFixed(3)} ${v.y.toFixed(3)}`;
const add=(a,b,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
const unit=(a,b)=>{const d=Math.hypot(b.x-a.x,b.y-a.y)||1;return{x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
const rotate=(v,a)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)});
const at=(v,a)=>({x:Math.cos(a)*v,y:Math.sin(a)*v});

// The cuff belongs to the hand/boot. Both its edge and the limb hem use this
// same axis, so a bent wrist or ankle cannot open a gap in the silhouette.
function limbPath(bone,widths,endAngle=0,hemOffset=0){
  const {root,joint,end}=bone;
  const u=unit(root,joint),v=unit(joint,end);
  const a={x:-u.y,y:u.x}, b={x:-v.y,y:v.x};
  const m=unit({x:0,y:0},add(a,b));
  const reach=Math.min(1.35,1/Math.max(.2,m.x*b.x+m.y*b.y));
  const normal=rotate({x:1,y:0},endAngle);
  const tip=add(end,rotate({x:0,y:1},endAngle),hemOffset);
  // Match the cuff's left and right sides to the limb's left and right.
  const n=(normal.x*b.x+normal.y*b.y)<0?{x:-normal.x,y:-normal.y}:normal;
  const pts=[add(root,a,widths[0]),add(joint,m,widths[1]*reach),add(tip,n,widths[2]),add(tip,n,-widths[2]),add(joint,m,-widths[1]*reach),add(root,a,-widths[0])];
  const radii=[10,14,0,0,14,10];
  return pts.map((pt,i)=>{
    const prev=pts[(i+5)%6],next=pts[(i+1)%6];
    const r=Math.min(radii[i],Math.hypot(pt.x-prev.x,pt.y-prev.y)*.38,Math.hypot(pt.x-next.x,pt.y-next.y)*.38);
    return `${i?'L':'M'}${p(add(pt,unit(pt,prev),r))}Q${p(pt)} ${p(add(pt,unit(pt,next),r))}`;
  }).join('')+'Z';
}
function sleevePath(bone){
  const u=unit(bone.root,bone.joint), n={x:-u.y,y:u.x};
  const root=add(bone.root,u,-7),tip=add(bone.root,u,24);
  return `M${p(add(root,n,12))}Q${p(add(root,u,-5))} ${p(add(root,n,-12))}L${p(add(tip,n,-12))}Q${p(add(tip,u,2))} ${p(add(tip,n,12))}Z`;
}

export function createCharacter(parent){
  const figure=make('g',{'data-character':'worker','stroke-linejoin':'round','stroke-linecap':'round'},parent);
  const group=id=>make('g',{'data-part':id},figure);
  const graphic=(d,fill,host=figure,extra={})=>make('path',{d,fill,stroke:C.ink,'stroke-width':1.2,...extra},host);
  function arm(id){const g=group(id);return{g,skin:graphic('',C.skin,g),sleeve:graphic('',C.shirt,g)};}
  function leg(id){const g=group(id);return{g,path:graphic('',C.pants,g)};}
  function boot(id){
    const g=group(id);
    graphic('M-13-13H11L13 0Q16 5 28 7Q36 8 36 14V17H-13Z',C.yellow,g);
    graphic('M-13-13H11L12-5H-13Z',C.sole,g,{'stroke-width':0});
    graphic('M-13 13H36V17H-13Z',C.sole,g,{'stroke-width':0});
    graphic('M13 2L7 3M18 5L12 6','none',g,{'stroke-width':1});
    return g;
  }
  function hand(id){
    const g=group(id);
    // A single mitten outline, with a broad cuff covering the forearm end.
    graphic('M-10-6H10V5Q15 8 13 13Q12 15 10 12L8 10V21Q8 25 4 25H-2Q-8 25-8 19L-10 4Z',C.glove,g);
    graphic('M-3 17V22M2 17V22','none',g,{'stroke-width':.8});
    graphic('M-9 1H9','none',g,{'stroke-width':.8});
    return g;
  }
  const farArm=arm('far-arm');
  const farHand=hand('far-hand');
  const farBoot=boot('far-boot'), farLeg=leg('far-leg');
  const nearBoot=boot('near-boot'), nearLeg=leg('near-leg');
  const torso=group('torso');
  const neck=graphic('',C.skin,torso);
  const shirt=graphic('',C.shirt,torso);
  const trousers=graphic('',C.pants,torso);
  const vest=graphic('',C.vest,torso);
  const vestStripe=graphic('',C.yellow,torso,{'stroke-width':0});
  const vestSeam=graphic('','none',torso,{'stroke-width':.9});
  const nearArm=arm('near-arm');
  // The sleeve root is open and filled into the shirt, rather than a separate
  // capped shape sitting on top of it. The short cuff stays a deliberate seam.
  const shoulderFill=graphic('',C.shirt,figure,{'stroke-width':0});
  const nearHand=hand('near-hand');
  const head=group('head');
  graphic('M-17-17H13Q17-12 15-5L21 4Q22 7 16 8L14 17Q11 24 3 24Q-8 21-13 12L-17 5Q-22 2-20-4L-16-6Z',C.skin,head);
  graphic('M-17-17H-8L-10-6Q-11-2-15-2L-18-7Z',C.hair,head,{'stroke-width':0});
  graphic('M-15-2Q-19-2-17 4','none',head,{'stroke-width':.85});
  // No eyes: the nose, ear and jaw carry the profile.
  graphic('M-23-17Q-22-37-3-37H1Q21-37 22-17Z',C.yellow,head);
  graphic('M-22-19H21Q26-19 26-14V-12H-25V-15Q-25-19-22-19Z',C.yellow,head);
  graphic('M-1-34V-22','none',head,{'stroke-width':1});

  return {figure,render(pose){
    const hip=pose.torso.hip,angle=pose.torso.angle;
    const local=point=>rotate({x:point.x-hip.x,y:point.y-hip.y},-angle);
    const shoulders=pose.arms.map(b=>local(b.root));
    const top=(shoulders[0].y+shoulders[1].y)/2;
    const h=local(pose.head);
    set(torso,{transform:`translate(${p(hip)}) rotate(${angle*180/Math.PI})`});
    // The neck overlaps both the jaw and the shirt collar in every preset.
    set(neck,{d:`M${h.x-10} ${h.y+9}L${h.x+8} ${h.y+10}L9 ${top+2}H-10Z`});
    set(shirt,{d:`M-9 ${top-12}Q-27 ${top-13} -27 ${top+10}L-25-2Q-27 18-8 19H11Q27 18 24-2L23 ${top+9}Q22 ${top-12} 9 ${top-12}Q0 ${top-4} -9 ${top-12}Z`});
    set(trousers,{d:'M-25-13Q-3-6 24-13L25 3Q29 19 11 21H-10Q-26 19-26 4Z'});
    set(vest,{d:`M-16 ${top-11}L-10 ${top-9}L-8 ${top+13}L12 ${top+16}L17 ${top-7}Q23 ${top-1} 23 ${top+12}L24-9Q3 3-25-7L-26 ${top+14}Q-26 ${top-3} -16 ${top-11}Z`});
    set(vestStripe,{d:'M-25-27Q-1-20 24-25V-20Q0-14-25-21Z'});
    set(vestSeam,{d:`M12 ${top+16}L14-9`});
    [farLeg,nearLeg].forEach((nodes,i)=>{
      const bone=pose.legs[i],a=pose.bootAngles[i]*Math.PI/180;
      set(nodes.path,{d:limbPath(bone,[19,16,11.5],a,-8)});
      nodes.g.dataset.root=p(bone.root);nodes.g.dataset.joint=p(bone.joint);nodes.g.dataset.end=p(bone.end);
    });
    [farArm,nearArm].forEach((nodes,i)=>{
      const bone=pose.arms[i],a=pose.handAngles[i]*Math.PI/180;
      set(nodes.skin,{d:limbPath(bone,[10,9,7.5],a,1)});
      set(nodes.sleeve,{d:sleevePath(bone)});
      nodes.g.dataset.root=p(bone.root);nodes.g.dataset.joint=p(bone.joint);nodes.g.dataset.end=p(bone.end);
    });
    const r=pose.arms[1].root,u=unit(r,pose.arms[1].joint),n={x:-u.y,y:u.x};
    // Remove just the artificial cap at the shoulder; retain the outer sleeve.
    const q=add(r,u,-5),s=add(r,u,2);
    set(shoulderFill,{d:`M${p(add(q,n,10.5))}L${p(add(q,n,-10.5))}L${p(add(s,n,-10.5))}L${p(add(s,n,10.5))}Z`});
    set(head,{transform:`translate(${p(pose.head)}) rotate(${(pose.head.angle||0)*180/Math.PI})`});
    [farBoot,nearBoot].forEach((n,i)=>set(n,{transform:`translate(${p(pose.legs[i].end)}) rotate(${pose.bootAngles[i]})`}));
    [farHand,nearHand].forEach((n,i)=>set(n,{transform:`translate(${p(pose.arms[i].end)}) rotate(${pose.handAngles[i]})`}));
  }};
}
