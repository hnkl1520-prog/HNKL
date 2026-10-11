// Odd Mirror components. 카메라와 조합 화면이 공유하는 독립 Canvas 라이브러리.
// 분류 경계는 미술적 선택 기준이며 인구 통계/생체 식별 기준이 아니다.
const OddComponents = (() => {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mix=(a,b,t)=>a+(b-a)*t;
  const finite=(v,f)=>Number.isFinite(v)?v:f;
  const catalog={
    face:[['column','긴 U형'],['taper','좁아지는 턱'],['angular','넓고 각진 턱'],['round','둥근 볼'],['oval','달걀형'],['pear','아래로 넓어지는 볼']],
    eyes:[['ring','둥근 사각 눈'],['almond','가로로 둥근 눈'],['heavy','무거운 눈꺼풀'],['round','둥근 눈'],['slit','작은 캡슐 눈'],['tilted','비스듬한 둥근 눈']],
    brows:[['line','가는 곡선'],['bar','두꺼운 곡선'],['angle','각진 눈썹']],
    nose:[['bend','긴 물방울 코'],['slope','둥근 쐐기 코'],['short','작고 둥근 코'],['wide','넓은 코']],
    mouth:[['level','평평한 입'],['curve','부드러운 입'],['full','도톰한 입술'],['bow','윗입술이 도드라진 입']],
    hair:[['none','헤어 없음'],['crop','두상에 붙은 머리'],['cap','둥근 앞머리'],['sweep','옆으로 흐르는 머리'],['back','뒤로 넘긴 머리'],['bob','단발'],['long','긴 머리']],
    glasses:[['none','안경 없음'],['round','둥근 테'],['rect','각진 테']]
  };
  function defaults(){return {face:'taper',eyes:'almond',brows:'line',nose:'slope',mouth:'level',hair:'sweep',glasses:'none',
    values:{width:1,length:1,jaw:1,eyeSize:1,eyeGap:1,eyeTilt:0,eyeY:0,browY:0,browWidth:1,browTilt:0,noseLength:1,noseWidth:1,mouthWidth:1,mouthY:0,lip:1,curve:0,hairVolume:1,hairSweep:1,fringe:.5},provenance:{source:'designed'}};}
  function validate(d){
    for(const [k,choices] of Object.entries(catalog))if(!choices.some(([id])=>id===d[k]))throw new Error(`알 수 없는 부품: ${k}/${d[k]}`);
    return d;
  }
  function geometry(d){
    const v=d.values,w=88*clamp(finite(v.width,1),.78,1.26), bottom=190+136*clamp(finite(v.length,1),.76,1.25);
    return {w,top:82,bottom,eyeY:192+clamp(finite(v.eyeY,0),-12,12),gap:43*clamp(finite(v.eyeGap,1),.74,1.3),ew:25*clamp(finite(v.eyeSize,1),.72,1.35),v};
  }
  function facePath(d){
    const {w,top,bottom,v}=geometry(d), x=180, cheek=210;
    const f={column:{temple:1,cheek:1.04,jaw:1,chin:.65,corner:.86},taper:{temple:1.01,cheek:1,jaw:.79,chin:.23,corner:.76},angular:{temple:1.1,cheek:1.12,jaw:1.1,chin:.49,corner:.79},round:{temple:.98,cheek:1.09,jaw:.94,chin:.4,corner:.77},oval:{temple:.97,cheek:1.02,jaw:.78,chin:.35,corner:.72},pear:{temple:.85,cheek:1.12,jaw:1.09,chin:.59,corner:.78}}[d.face];
    const j=Math.min(clamp(finite(v.jaw,1),.85,1.15),f.cheek/f.jaw),h=bottom-cheek,jy=cheek+h*f.corner;
    const p=new Path2D();
    p.moveTo(x,top);p.bezierCurveTo(x+w*.9,top,x+w*f.temple,top+9,x+w*f.temple,160);
    p.bezierCurveTo(x+w*f.temple,185,x+w*f.cheek,195,x+w*f.cheek,cheek);
    if(d.face==='angular'){
      p.lineTo(x+w*f.jaw*j,jy-10);p.quadraticCurveTo(x+w*f.jaw*j,jy+3,x+w*f.jaw*j-14,jy+12);
      p.lineTo(x+w*f.chin,bottom-3);p.quadraticCurveTo(x,bottom+13,x-w*f.chin,bottom-3);
      p.lineTo(x-w*f.jaw*j+14,jy+12);p.quadraticCurveTo(x-w*f.jaw*j,jy+3,x-w*f.jaw*j,jy-10);
      p.lineTo(x-w*f.cheek,cheek);
    }else{
      p.bezierCurveTo(x+w*f.cheek,cheek+h*.52,x+w*f.jaw*j,jy+12,x+w*f.chin,bottom);
      p.bezierCurveTo(x+w*f.chin*.5,bottom+5,x-w*f.chin*.5,bottom+5,x-w*f.chin,bottom);
      p.bezierCurveTo(x-w*f.jaw*j,jy+12,x-w*f.cheek,cheek+h*.52,x-w*f.cheek,cheek);
    }
    p.bezierCurveTo(x-w*f.cheek,195,x-w*f.temple,185,x-w*f.temple,160);
    p.bezierCurveTo(x-w*f.temple,top+9,x-w*.9,top,x,top);p.closePath();return p;
  }
  // 관측한 헤어의 큰 구조를 부품으로 단순화한다. 정확한 헤어스타일 분류가 아니다.
  function chooseHair(h,geo){
    if(!h||!h.target)return {id:'none',prov:'unobserved',volume:1,sweep:0,fringe:.5};
    const t=h.target;if(t.bald)return {id:'none',prov:'observed',volume:1,sweep:0,fringe:0};
    const K=t.radii.length;let low=-Infinity,topThickness=0,topN=0;
    for(let k=0;k<K;k++){
      if(t.prov[k]===3||t.edge[k]<.5)continue;
      const theta=-Math.PI/2+k/K*Math.PI*2;
      const px=Math.cos(theta)*t.radii[k],py=-.35+Math.sin(theta)*t.radii[k];
      if(Math.abs(px)>.65)low=Math.max(low,py);
      if(Math.cos(theta-Math.PI*1.5)>.6){topThickness+=Math.max(0,t.radii[k]-t.headR[k]);topN++;}
    }
    const line=Array.from(t.hairline), half=Math.floor(line.length/2);
    const mean=a=>{const f=a.filter(Number.isFinite);return f.length?f.reduce((s,x)=>s+x,0)/f.length:null;};
    const left=mean(line.slice(0,half)),right=mean(line.slice(half+1));
    const slope=left!==null&&right!==null?clamp((right-left)*2,-1,1):0;
    const observed=mean(line.slice(Math.floor(line.length*.2),Math.ceil(line.length*.8))),thick=topN?topThickness/topN:null;
    // 이마 높이를 사람의 얼굴에 상대적으로 잰다. 불확실할 때 둥근 앞머리를 기본값으로 씌우지 않는다.
    const forehead=Math.max(.55,Math.abs(geo.topY||-.9));
    const fringe=observed===null?0:clamp((observed+forehead)/forehead,0,1);
    const openForehead=observed!==null&&fringe<.4;
    let id=low>geo.chinY+.2?'long':low>geo.chinY*.65?'bob':Math.abs(slope)>.2?'sweep':openForehead?'back':observed!==null&&fringe>.54?'cap':'crop';
    return {id,prov:observed===null||t.estimatedShare>.15?'partial':'observed',volume:clamp(thick===null?1:.8+thick,.7,1.45),sweep:slope,fringe};
  }
  function fromMeasurements({geo,base,parts={},hair=null,glasses=null,asym={}}){
    const d=defaults(),r=k=>finite(geo[k]/base[k],1),confidence=k=>parts[k]?.c??1;
    const long=r('chinY')/r('faceW'),jaw=r('jawW')/r('faceW'),ap=r('eyeOpen');
    d.face=confidence('face')<.35?'round':jaw>1.18?'angular':jaw<.85?'taper':long<.94?'round':long>1.08?'column':jaw>1.06?'pear':'oval';
    d.eyes=confidence('eyes')<.35?'almond':ap<.68?'slit':ap<.9?'heavy':ap>1.35?'round':ap>1.13&&r('eyeW')<1.05?'ring':Math.abs(geo.eyeTilt)>.085?'tilted':'almond';
    d.brows=confidence('brows')>.35&&r('browThick')>1.22?(Math.abs(geo.browTilt)>.06?'angle':'bar'):'line';
    d.nose=r('noseW')>1.18?'wide':r('noseY')<.93?'short':r('noseY')>1.08?'bend':'slope';
    d.mouth=r('loLip')>1.22?'full':r('upLip')>1.18?'bow':r('mouthW')<.9?'curve':'level';
    const hr=chooseHair(hair,geo);d.hair=hr.id;
    const sh=glasses?.drawShape||glasses?.shape;
    d.glasses=sh&&(glasses.alpha??1)>.01?(sh.nT>2.8?'rect':'round'):'none';
    d.lens=sh?{...sh}:null;
    d.values={width:clamp(r('faceW'),.8,1.23),length:clamp(r('chinY'),.78,1.23),jaw:clamp(jaw,.87,1.12),eyeSize:clamp(r('eyeW'),.73,1.3),eyeGap:clamp(r('eyeGap'),.78,1.25),eyeTilt:clamp(geo.eyeTilt,-.25,.25),eyeY:(geo.eyeY-base.eyeY)*80,browY:(geo.browY-base.browY)*65,browWidth:clamp(r('browLen'),.75,1.3),browTilt:geo.browTilt,noseLength:clamp(r('noseY'),.75,1.3),noseWidth:clamp(r('noseW'),.7,1.4),mouthWidth:clamp(r('mouthW'),.65,1.4),mouthY:(geo.mouthY-base.mouthY)*80,lip:clamp(r('loLip'),.7,1.3),curve:clamp(-geo.cornerY*100,-5,5),hairVolume:hr.volume,hairSweep:hr.sweep,fringe:hr.fringe};
    d.asym={...asym};
    d.provenance={source:'measured',face:parts.face?.prov||'observed',eyes:parts.eyes?.prov||'observed',brows:parts.brows?.prov||'observed',nose:parts.nose?.prov||'observed',mouth:parts.mouth?.prov||'observed',hair:hr.prov,glasses:sh?'experimental':'unconfirmed'};
    return validate(d);
  }
  const neutral=()=>({eyeR:{open:1,lift:0},eyeL:{open:1,lift:0},browR:{inn:0,out:0},browL:{inn:0,out:0},mouth:{open:0,pucker:0,smile:0,frown:0,press:0,teeth:0,cR:[0,0],cL:[0,0],upY:0},roll:0,pitch:0,yaw:0,gazeX:0,gazeY:0});
  function tint(a,b,t){
    const rgb=s=>{s=s.replace('#','');if(s.length===3)s=[...s].map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16));};
    return '#'+rgb(a).map((v,i)=>Math.round(mix(v,rgb(b)[i],t)).toString(16).padStart(2,'0')).join('');
  }
  function palette(colors={}){
    const face=colors.face||'#e7aa91',ink=colors.ink||'#292638';
    return {face,hair:colors.hair||'#353042',ink,brow:colors.brow||colors.hair||'#353042',white:'#fffaf0',shirt:colors.shirt||'#353042',
      nose:colors.nose||tint(face,'#884c58',.2),lip:colors.lip||tint(face,'#824751',.45),mouth:colors.mouth||tint(face,'#773f50',.76),inside:colors.inside||tint(face,'#b66371',.6)};
  }
  function stroke(ctx,p,col,width=3.8){ctx.strokeStyle=col;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(p);}
  function fill(ctx,p,col){ctx.fillStyle=col;ctx.fill(p);}
  function path(s){return new Path2D(s);}
  function hairPaths(d){
    const {w:faceW,bottom,v}=geometry(d),w=faceW*(d.face==='pear'?.88:1),x=180,L=x-w*1.05,R=x+w*1.05,top=82-25*clamp(v.hairVolume,.65,1.5),bang=112+40*clamp(v.fringe,0,1),sw=clamp(v.hairSweep,-1,1);
    if(d.hair==='none')return {};
    const back=new Path2D(),front=new Path2D();
    if(d.hair==='bob'||d.hair==='long'){
      const end=bottom+(d.hair==='long'?95:4),X=faceW*1.27;
      back.moveTo(x-X,end);back.bezierCurveTo(x-X+9,240,x-X-10,145,x-w*.94,90);
      back.bezierCurveTo(x-w*.55,top-5,x+w*.55,top-8,x+w*.94,90);
      back.bezierCurveTo(x+X+4,135,x+X-4,260,x+X+8,end);
      back.quadraticCurveTo(x+X*.6,end+14,x,end+5);back.quadraticCurveTo(x-X*.6,end+14,x-X,end);back.closePath();
      front.moveTo(L-8,215);front.bezierCurveTo(L-17,167,L-6,104,x-w*.75,86);
      front.bezierCurveTo(x-w*.35,top-5,x+w*.6,top-2,R+6,114);
      front.lineTo(R+6,217);front.quadraticCurveTo(R-8,193,R-15,bang+2);
      front.bezierCurveTo(x+w*.42,bang+26,x-13,bang-18,x-36,bang-9);
      front.quadraticCurveTo(L+19,bang+3,L+17,163);front.quadraticCurveTo(L+14,192,L+3,216);front.closePath();
    }else if(d.hair==='back'){
      // 넘긴 머리: 노출된 이마, 뒤로 기운 상단 덩어리와 짧은 옆머리. 반원형 모자를 피한다.
      front.moveTo(L,198);front.lineTo(L-4,113);front.quadraticCurveTo(L-6,87,L+12,72);
      front.quadraticCurveTo(x-45,top-10,x+26,top-15);front.lineTo(R-10,top-20);
      front.quadraticCurveTo(R+4,top-5,R+8,88);front.quadraticCurveTo(R+12,130,R,198);
      front.lineTo(R-10,198);front.lineTo(R-21,135);
      front.quadraticCurveTo(R-22,110,x+30,106);front.quadraticCurveTo(x,112,x-27,108);
      front.quadraticCurveTo(L+22,112,L+21,135);front.lineTo(L+10,198);front.closePath();
    }else if(d.hair==='sweep'){
      // 한 번 흐르는 앞머리. 얼굴 밖으로 꺾여 나가던 뾰족한 홈을 없앤다.
      const fringe=127+15*clamp(v.fringe,0,1);
      front.moveTo(L,199);front.bezierCurveTo(L-12,156,L-9,106,L+19,84);
      front.bezierCurveTo(x-22,top-11,x+w*.35,top-8,R-18,top-4);
      front.bezierCurveTo(R+12,top+31,R+8,148,R-2,197);
      front.quadraticCurveTo(R-9,200,R-12,193);front.lineTo(R-17,fringe-4);
      front.bezierCurveTo(x+w*.45,fringe-34,x+5,fringe-5,x-32,fringe+8);
      front.bezierCurveTo(L+30,fringe+14,L+17,fringe+8,L+14,170);
      front.lineTo(L+9,199);front.closePath();
    }else{
      const small=d.hair==='crop',b=small?98:102+32*clamp(v.fringe,0,1);
      front.moveTo(L,180);front.bezierCurveTo(L-4,135,L-4,111,L+15,91);
      front.bezierCurveTo(x-w*.5,small?75:top,x+w*.55,small?72:top,R-12,94);
      front.quadraticCurveTo(R+7,118,R,176);front.lineTo(R-8,178);front.lineTo(R-12,b+10);
      front.bezierCurveTo(x+w*.4,b+5+sw*8,x-w*.4,b+7-sw*8,L+12,b+13);front.lineTo(L+9,180);front.closePath();
    }
    // 좌우 방향도 관측/선택 파라미터. 임의 요동을 넣지 않는다.
    return {back,front,flip:d.hair==='sweep'&&sw<0};
  }
  function drawHair(ctx,h,col,layer){if(!h[layer])return;ctx.save();if(h.flip){ctx.translate(360,0);ctx.scale(-1,1);}fill(ctx,h[layer],col);ctx.restore();}
  function eyePath(kind,w){
    const p=new Path2D(),h=w*({ring:.77,round:.93,heavy:.8,slit:.36,tilted:.63,almond:.61}[kind]||.61);
    if(kind==='ring'){
      p.roundRect(-w*.87,-h,w*1.74,h*2,w*.51);
    }else if(kind==='round'){
      p.ellipse(0,0,w,h,0,0,Math.PI*2);
    }else if(kind==='heavy'){
      p.roundRect(-w,-h,w*2,h*2,[w*.23,w*.23,w*.76,w*.76]);
    }else if(kind==='slit'){
      p.roundRect(-w*.85,-h,w*1.7,h*2,h);
    }else if(kind==='tilted'){
      p.moveTo(-w,-h*.45);p.bezierCurveTo(-w*.75,-h*1.2,w*.6,-h*1.05,w,-h*.5);
      p.bezierCurveTo(w*1.1,h*.5,w*.25,h*1.2,-w*.5,h*.7);p.quadraticCurveTo(-w,h*.3,-w,-h*.45);
    }else{
      p.roundRect(-w,-h,w*2,h*2,[h*.8,h*.8,h,h]);
    }p.closePath();return {p,h};
  }
  // 눈 부품은 고정하고 윗/아랫눈꺼풀, 시선, 눈썹의 기울기로 같은 눈을 움직인다.
  function eyeMetrics(d,g,e,side){
    const ex=(side<0?e.eyeR:e.eyeL)||{},b=(side<0?e.browR:e.browL)||{};
    const op=clamp(finite(ex.open,1),0,1.4),lift=clamp(ex.lift||0,0,1),w=g.ew;
    const h=eyePath(d.eyes,w).h*(1+Math.max(0,op-1)*.9);
    const lid=d.eyes==='heavy'?.35:d.eyes==='slit'?.12:.025;
    const coverage=clamp(lid+(1-op)*.92-Math.max(0,op-1)*.7,0,1);
    return {w,h,op,lift,top:-h+2*h*coverage,bottom:h-lift*h*.6,
      slope:clamp((finite(b.inn,0)-finite(b.out,0))*4,-.55,.55)};
  }
  function pupilMetrics(d,g,e){
    const w=g.ew,aspect={ring:.77,round:.93,heavy:.8,slit:.36,tilted:.63,almond:.61}[d.eyes]||.61;
    // 크기는 기본 눈에만 종속된다. 놀라서 눈을 크게 떠도 동공은 늘어나지 않는다.
    const rx=w*(d.eyes==='round'?.47:d.eyes==='slit'?.43:.44),ry=w*(d.eyes==='round'?.55:d.eyes==='slit'?.46:.53);
    return {rx,ry,x:clamp(e.gazeX||0,-1,1)*w*.42,y:aspect*w*(.24+clamp(e.gazeY||0,-1,1)*.29)};
  }
  function drawEye(ctx,d,g,e,side,c){
    const {w,h,op,lift,top,bottom,slope}=eyeMetrics(d,g,e,side);
    ctx.save();ctx.translate(180+side*g.gap,g.eyeY);ctx.rotate(-side*(g.v.eyeTilt||0));
    const base=eyePath(d.eyes,w),p=base.p,sy=h/base.h;
    const fade=clamp(op/.16,0,1)*clamp((bottom-top)/(h*.2),0,1);
    if(op>.002){
      ctx.save();ctx.globalAlpha*=fade;
      // 감길 때 눈 아래로 사라지던 동공을 개방부 안에서 읽히도록 배치한다.
      const clip=path(`M${-w-3} ${top-side*slope*w} L${w+3} ${top+side*slope*w} L${w+3} ${h+5} L${-w-3} ${h+5}Z`);
      const lowerClip=path(`M${-w-3} ${-h-5} L${w+3} ${-h-5} L${w+3} ${bottom} Q0 ${bottom-lift*h*.22} ${-w-3} ${bottom}Z`);
      ctx.clip(clip);ctx.clip(lowerClip);ctx.scale(1,sy);ctx.clip(p);fill(ctx,p,c.white);
      const pupil=pupilMetrics(d,g,e),ip=new Path2D();
      ip.ellipse(pupil.x,pupil.y/sy,pupil.rx,pupil.ry/sy,0,0,Math.PI*2);
      fill(ctx,ip,c.ink);ctx.restore();
    }
    if(fade<1){ctx.save();ctx.globalAlpha*=1-fade;const bend=lift>.25?-w*.36:w*.2;stroke(ctx,path(`M${-w*.88} ${h*.35} Q0 ${h*.35+bend} ${w*.88} ${h*.35}`),c.ink,4.5);ctx.restore();}
    ctx.restore();
  }
  function drawBrow(ctx,d,g,e,side,c){
    const b=side<0?e.browR:e.browL,x=180+side*g.gap,y=g.eyeY-36+g.v.browY,w=20*g.v.browWidth;
    ctx.save();ctx.translate(x,y);ctx.scale(side,1);
    const yi=clamp(-finite(b.inn,0)*110,-27,18)+g.v.browTilt*25,yo=clamp(-finite(b.out,0)*110,-27,18)-g.v.browTilt*25;
    const p=path(`M${-w} ${yi} Q0 ${-5+(yi+yo)/2} ${w} ${yo}`);
    if(d.brows==='angle')fill(ctx,path(`M${-w-2} ${yi} L${w*.4} ${yo-7} L${w+3} ${yo+1} L${w+5} ${yo+9} L${w*.3} ${yo+2} L${-w-2} ${yi+7}Z`),c.brow);
    else if(d.brows==='bar')fill(ctx,path(`M${-w} ${yi-3} Q0 ${-8+(yi+yo)/2} ${w} ${yo-3} Q${w+4} ${yo+1} ${w} ${yo+5} Q0 ${(yi+yo)/2} ${-w} ${yi+5} Q${-w-3} ${yi+1} ${-w} ${yi-3}Z`),c.brow);
    else stroke(ctx,p,c.brow,4.8);ctx.restore();
  }
  function drawNose(ctx,d,g,c){
    const v=g.v,tip=232+22*(v.noseLength-1),nw=12*v.noseWidth,top=tip-(d.nose==='short'?17:d.nose==='bend'?45:32);
    let p;
    if(d.nose==='short')p=path(`M180 ${top} C${180-nw*.3} ${top+3} ${180-nw} ${tip-8} ${180-nw} ${tip-2} C${180-nw} ${tip+10} ${180+nw} ${tip+10} ${180+nw} ${tip-2} Q${180+nw*.7} ${top+5} 180 ${top}Z`);
    else if(d.nose==='wide')p=path(`M180 ${top} C174 ${top+4} ${180-nw*1.2} ${tip-9} ${180-nw*1.3} ${tip-1} Q${180-nw*1.4} ${tip+8} 180 ${tip+8} Q${180+nw*1.4} ${tip+8} ${180+nw*1.3} ${tip-1} Q${180+nw} ${tip-12} 180 ${top}Z`);
    else if(d.nose==='bend')p=path(`M181 ${top} C177 ${top+7} 178 ${tip-16} ${180-nw*.8} ${tip-6} Q${180-nw*1.25} ${tip+9} 181 ${tip+9} Q${180+nw*1.1} ${tip+9} ${180+nw*.8} ${tip-3} Q184 ${top+14} 181 ${top}Z`);
    else p=path(`M184 ${top} Q179 ${top-2} ${180-nw*.9} ${tip-3} Q${180-nw*1.4} ${tip+6} ${180-nw*.4} ${tip+7} L${180+nw*.7} ${tip+7} Q${180+nw*1.1} ${tip+6} ${180+nw*.8} ${tip}Z`);
    fill(ctx,p,c.nose);
  }
  function mouthMetrics(d,e){
    const g=geometry(d),m=e.mouth||{},y=Math.min(g.bottom-39,270+g.v.mouthY);
    const sneer=clamp(m.sneer||0,0,1),stretch=clamp(m.stretch||0,0,1);
    const smile=clamp(m.smile||0,-1,1)*(1-sneer),frown=clamp(m.frown||0,0,1),press=clamp(m.press||0,0,1),pucker=clamp(m.pucker||0,0,1);
    const w=28*g.v.mouthWidth*(1-.5*pucker)*(1+stretch*.08+Math.max(0,smile)*.08);
    const l=[180-w+clamp(m.cR?.[0]||0,-.2,.2)*70,y+clamp(m.cR?.[1]||0,-.2,.2)*110];
    const r=[180+w+clamp(m.cL?.[0]||0,-.2,.2)*70,y+clamp(m.cL?.[1]||0,-.2,.2)*110];
    // 입 중앙은 입술 중앙의 움직임을 따른다. 입꼬리를 내릴 때 중앙까지 따라 내려가면 찡그림이 사라진다.
    const cy=y+clamp(m.upY||0,-.14,.14)*35+clamp(g.v.curve,-1,1)*(1-sneer)+smile*8-frown*7-sneer*3;
    const space=Math.max(8,g.bottom-26-(l[1]+r[1])/2),open=Math.min(space,29,Math.max(0,m.open||0)*68)*(1-.82*press);
    return {l,r,cy,open,width:w,smile,frown,press,pucker,sneer,stretch,upperR:clamp(m.upperR||0,0,1),upperL:clamp(m.upperL||0,0,1),y,lip:clamp(g.v.lip,.7,1.3)};
  }
  function drawMouth(ctx,d,e,c){
    const m=mouthMetrics(d,e),ex=e.mouth||{},p=new Path2D(),cx=(m.l[0]+m.r[0])/2;
    // 여섯 제어점의 같은 입: 다문 선에서 둥근 벌림까지 연속, 입술 누르기는 폭·두께에 반영.
    const spread=m.width*.7,top=m.cy-m.open*.7,bottom=m.cy+m.open*.85;
    const raiseR=m.upperR*9,raiseL=m.upperL*9;
    p.moveTo(...m.l);p.bezierCurveTo(cx-spread,top-raiseR,cx+spread,top-raiseL,...m.r);
    if(m.open>.001){
      p.bezierCurveTo(cx+spread,bottom,cx-spread,bottom,...m.l);p.closePath();fill(ctx,p,c.mouth);
      ctx.save();ctx.clip(p);
      // 벌릴 때마다 생기던 둥근 혀 같은 면은 제거. 하나의 차분한 내부 면을 유지한다.
      const teeth=clamp(ex.teeth||0,0,1);
      if(teeth>0){ctx.save();ctx.globalAlpha*=teeth;const h=Math.min(6,m.open*.28);fill(ctx,path(`M${m.l[0]-2} ${m.l[1]-2} Q${cx} ${top-2} ${m.r[0]+2} ${m.r[1]-2} L${m.r[0]+2} ${m.r[1]+h} Q${cx} ${top+h+2} ${m.l[0]-2} ${m.l[1]+h}Z`),c.white);ctx.restore();}
      ctx.restore();
    }
    const seam=clamp(1-m.open/4,0,1),lw=(d.mouth==='full'?2.8:d.mouth==='bow'?2.2:2.4)*m.lip*(1-.45*m.press);
    if(d.mouth==='full'||d.mouth==='bow'){
      const lip=new Path2D();lip.moveTo(...m.l);lip.bezierCurveTo(cx-spread,bottom+lw,cx+spread,bottom+lw,...m.r);lip.bezierCurveTo(cx+spread,bottom,cx-spread,bottom,...m.l);lip.closePath();fill(ctx,lip,c.lip);
      if(d.mouth==='bow')fill(ctx,path(`M${m.l[0]} ${m.l[1]} Q${cx-m.width*.28} ${top-2*m.lip-raiseR} ${cx} ${top-1} Q${cx+m.width*.28} ${top-2*m.lip-raiseL} ${m.r[0]} ${m.r[1]} Q${cx} ${top+1} ${m.l[0]} ${m.l[1]}Z`),c.lip);
    }
    if(seam>0){ctx.save();ctx.globalAlpha*=seam;const q=new Path2D();q.moveTo(...m.l);q.bezierCurveTo(cx-spread,m.cy-raiseR,cx+spread,m.cy-raiseL,...m.r);stroke(ctx,q,c.lip,lw);ctx.restore();}
  }
  function drawGlasses(ctx,d,g,c){
    if(d.glasses==='none')return;
    const sh=d.lens,w=Math.min(g.gap-5,sh?clamp(sh.a*80,23,40):30),h=sh?clamp(sh.b*80,14,32):23;
    const y=g.eyeY+(sh?clamp(sh.dy*80,-7,10):0),off=sh?clamp(sh.dx*80,-8,8):0;
    const col=sh&&!sh.dark?c.white:c.ink,lw=sh?.thick?5.8:3.8;
    for(const side of [-1,1]){
      const x=180+side*(g.gap+off),p=new Path2D();
      if(d.glasses==='round')p.ellipse(x,y,w,h,0,0,Math.PI*2);
      else p.roundRect(x-w,y-h,w*2,h*2,Math.min(h*.45,9));
      stroke(ctx,p,col,lw);stroke(ctx,path(`M${x+side*w} ${y-5} L${180+side*g.w*1.04} ${y-10}`),col,lw);
    }
    stroke(ctx,path(`M${180-g.gap-off+w} ${y-3} Q180 ${y-12} ${180+g.gap+off-w} ${y-3}`),col,lw);
  }
  function draw(ctx,d,{x=180,y=290,scale=1,colors={},expression=null,mirror=false,bust=false}={}){
    const g=geometry(d),c=palette(colors),e=expression||neutral(),P=g.bottom-42,roll=(e.roll||0)*(mirror?-1:1),m=mirror?-1:1;
    const h=hairPaths(d),fp=facePath(d),nw=clamp(g.w*.3,24,34),sh=g.w*clamp(d.clothing?.shoulderRatio||2.2,1.65,2.65),shoulder=g.bottom-P+18;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.lineCap='round';ctx.lineJoin='round';
    const head=()=>{ctx.rotate(roll);ctx.scale(m,1);ctx.translate(-180,-P);};
    ctx.save();head();drawHair(ctx,h,c.hair,'back');ctx.restore();
    if(bust){
      const rot=(a,b)=>[Math.cos(roll)*a-Math.sin(roll)*b,Math.sin(roll)*a+Math.cos(roll)*b];
      const l=rot(-nw,-8),r=rot(nw,-8),neck=new Path2D();neck.moveTo(...l);neck.lineTo(...r);neck.quadraticCurveTo(nw,shoulder,nw*1.16,shoulder+23);neck.lineTo(-nw*1.16,shoulder+23);neck.quadraticCurveTo(-nw,shoulder,...l);neck.closePath();fill(ctx,neck,c.face);
      const neckDepth=clamp(d.clothing?.neckDepth??20,10,42);
      fill(ctx,path(`M${-nw*1.2} ${shoulder} Q0 ${shoulder+neckDepth} ${nw*1.2} ${shoulder} C${sh*.6} ${shoulder+3} ${sh*.93} ${shoulder+39} ${sh} ${shoulder+95} L${sh+60} 1400 L${-sh-60} 1400 L${-sh} ${shoulder+95} C${-sh*.93} ${shoulder+39} ${-sh*.6} ${shoulder+3} ${-nw*1.2} ${shoulder}Z`),c.shirt);
    }else{ctx.save();head();fill(ctx,path(`M${180-nw} ${g.bottom-30} Q${180-nw+5} ${g.bottom+11} ${180-nw} ${g.bottom+24} Q180 ${g.bottom+30} ${180+nw} ${g.bottom+24} Q${180+nw-5} ${g.bottom+10} ${180+nw} ${g.bottom-30}Z`),c.face);ctx.restore();}
    ctx.save();head();
    const yaw=clamp(e.yaw||0,-.6,.6)*17,pitch=clamp(e.pitch||0,-.5,.5)*10;
    for(const s of [-1,1]){const ear=new Path2D();ear.ellipse(180+s*(g.w+3),210,15,20,s*.15,0,Math.PI*2);fill(ctx,ear,c.face);stroke(ctx,path(`M${180+s*(g.w+3)} 211 L${180+s*(g.w+13)} 207`),c.ink);}
    fill(ctx,fp,c.face);
    ctx.save();ctx.translate(yaw,pitch);drawEye(ctx,d,g,e,-1,c);drawEye(ctx,d,g,e,1,c);drawBrow(ctx,d,g,e,-1,c);drawBrow(ctx,d,g,e,1,c);drawNose(ctx,d,g,c);drawMouth(ctx,d,e,c);ctx.restore();
    drawHair(ctx,h,c.hair,'front');
    ctx.save();ctx.translate(yaw,pitch);drawGlasses(ctx,d,g,c);ctx.restore();
    ctx.restore();ctx.restore();
  }
  return {version:'6.0',catalog,defaults,validate,geometry,facePath,fromMeasurements,chooseHair,neutral,draw,mouthMetrics,eyeMetrics,pupilMetrics,palette};
})();
