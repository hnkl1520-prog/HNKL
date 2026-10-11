const NS='http://www.w3.org/2000/svg';
const C={ink:'#39414B',shirt:'#F5EDDD',blue:'#5878A8',skin:'#E9B79B',yellow:'#E8BD5C',hair:'#584B41'};
const make=(tag,attrs,parent)=>{const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));parent.append(n);return n;};
const set=(n,attrs)=>Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
const coords=p=>`${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
const add=(a,b,k=1)=>({x:a.x+b.x*k,y:a.y+b.y*k});
const unit=(a,b)=>{const d=Math.hypot(b.x-a.x,b.y-a.y)||1;return{x:(b.x-a.x)/d,y:(b.y-a.y)/d};};

// Closed, tapered clothing silhouettes. Ankles end in a horizontal hem inside
// the boot shaft, rather than a diagonal stroked line poking through the shoe.
function limbPath(bone,widths,leg){
  const {root,joint,end}=bone, u=unit(root,joint),v=unit(joint,end);
  const a={x:-u.y,y:u.x},b={x:-v.y,y:v.x};
  const m=unit({x:0,y:0},add(a,b));
  const reach=Math.min(1.5,1/Math.max(.15,m.x*b.x+m.y*b.y));
  const tip=leg?{x:end.x,y:end.y-6}:add(end,v,-1);
  const normal=leg?{x:-1,y:0}:b;
  const points=[add(root,a,widths[0]),add(joint,m,widths[1]*reach),add(tip,normal,widths[2]),add(tip,normal,-widths[2]),add(joint,m,-widths[1]*reach),add(root,a,-widths[0])];
  const radii=[6,9,0,0,9,6];
  const rounded=points.map((p,i)=>{
    const before=points[(i+points.length-1)%points.length],after=points[(i+1)%points.length];
    const radius=Math.min(radii[i],Math.hypot(p.x-before.x,p.y-before.y)*.3,Math.hypot(p.x-after.x,p.y-after.y)*.3);
    return {p,start:add(p,unit(p,before),radius),end:add(p,unit(p,after),radius)};
  });
  return rounded.map((r,i)=>`${i?'L':'M'}${coords(r.start)}Q${coords(r.p)} ${coords(r.end)}`).join('')+'Z';
}

export function createCharacter(parent){
  const figure=make('g',{'data-character':'worker','stroke-linejoin':'round','stroke-linecap':'round'},parent);
  const graphic=(d,fill,host=figure,extra={})=>make('path',{d,fill,stroke:C.ink,'stroke-width':1.35,...extra},host);
  const group=id=>make('g',{'data-part':id},figure);
  function limb(id,color,widths,leg=false){
    const g=group(id),path=graphic('',color,g);
    return {g,path,widths,leg};
  }
  function boot(id){
    const g=group(id);
    graphic('M-14-10Q-14-12-11-12H10Q13-12 13-9L14 3Q18 7 28 8Q35 9 35 14V16H-14Z',C.yellow,g);
    graphic('M-13 12H34','none',g,{'stroke-width':1.1});
    return g;
  }
  function hand(id){
    const g=group(id);
    graphic('M-6-2H6L7 6Q10 7 10 11L8 14L7 12V20Q7 25 3 25H-1Q-7 25-7 19L-8 8Z',C.skin,g);
    graphic('M2 16V22M-2 17V22','none',g,{'stroke-width':.85});
    return g;
  }
  const farArm=limb('far-arm',C.shirt,[13,10,7]);
  // Boots are drawn beneath the trouser hems; their shafts overlap by 6 units.
  const farBoot=boot('far-boot');
  const farLeg=limb('far-leg',C.blue,[19,15,11],true);
  const nearBoot=boot('near-boot');
  const nearLeg=limb('near-leg',C.blue,[20,16,11],true);
  const torso=group('torso');
  graphic('M-6-99H10L12-75H-7Z',C.skin,torso);
  graphic('M-12-84Q-26-82-25-63L-24-22V0Q-24 18-10 18H14Q25 16 25 3L22-36L20-70Q20-82 8-84Z',C.shirt,torso);
  graphic('M-24-23Q-7-24 7-38L8-58H22L26 3Q26 18 11 18H-10Q-24 18-24 0Z',C.blue,torso);
  graphic('M0-83L8-82L16-49L8-47Z',C.blue,torso);
  const nearArm=limb('near-arm',C.shirt,[14,10.5,7]);
  const farHand=hand('far-hand');
  const nearHand=hand('near-hand');
  figure.insertBefore(farHand,torso);
  const head=group('head');
  // Small rounded nose, chin, ear and eye give the profile a human reading.
  graphic('M-17-17H12Q17-11 15-4L20 3Q22 6 16 7L15 14Q13 23 4 23Q-5 22-10 15L-15 9Q-21 6-20 0Q-20-4-16-5Z',C.skin,head);
  graphic('M-17-17H-9L-11-4L-16-1Q-21-7-17-17Z',C.hair,head,{'stroke-width':0});
  graphic('M-14-2Q-19-3-17 4L-14 6','none',head,{'stroke-width':1});
  graphic('M9-5a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0-2.3 0',C.ink,head,{'stroke-width':0});
  graphic('M11 12Q13 13 15 12','none',head,{'stroke-width':.9});
  graphic('M-22-17Q-21-35-3-35H1Q20-35 20-17Z',C.yellow,head);
  graphic('M-21-19H20Q25-19 25-15V-13H-23Q-24-13-24-16Q-24-19-21-19Z',C.yellow,head);
  graphic('M-1-33V-22','none',head,{'stroke-width':1.1});

  return {figure,render(pose){
    for(const [nodes,bone] of [[farLeg,pose.legs[0]],[nearLeg,pose.legs[1]],[farArm,pose.arms[0]],[nearArm,pose.arms[1]]]){
      set(nodes.path,{d:limbPath(bone,nodes.widths,nodes.leg)});
      nodes.g.dataset.root=coords(bone.root);nodes.g.dataset.joint=coords(bone.joint);nodes.g.dataset.end=coords(bone.end);
    }
    set(torso,{transform:`translate(${coords(pose.torso.hip)}) rotate(${pose.torso.angle*180/Math.PI})`});
    set(head,{transform:`translate(${coords(pose.head)}) rotate(${(pose.head.angle||0)*180/Math.PI})`});
    [farBoot,nearBoot].forEach((n,i)=>set(n,{transform:`translate(${coords(pose.legs[i].end)}) rotate(${pose.bootAngles[i]})`}));
    [farHand,nearHand].forEach((n,i)=>set(n,{transform:`translate(${coords(pose.arms[i].end)}) rotate(${pose.handAngles[i]})`}));
  }};
}
