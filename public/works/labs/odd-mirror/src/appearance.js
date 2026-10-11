// 초기 외형 스캔의 판정과 옷 측정. 기하/색 관측이며 옷 종류를 분류하는 모델은 아니다.
const OddAppearance=(()=>{
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:0;};
  function clothing(masks,rgba,S,meta){
    if(!masks.clothes||!rgba||!meta||!(meta.faceWidth>0))return null;
    const colors=[[],[],[]],rows=[],start=Math.max(0,Math.ceil(meta.chinY+S*.025)),end=Math.min(S-2,Math.floor((meta.bottom??S)-2),Math.floor(meta.chinY+meta.faceWidth*1.4));
    for(let y=start;y<end;y++){
      let l=S,r=-1,n=0;
      for(let x=2;x<S-2;x++){
        const i=y*S+x;
        if(masks.clothes[i]<.72)continue;
        l=Math.min(l,x);r=Math.max(r,x);n++;
        if(Math.abs(x-meta.centerX)<meta.faceWidth*1.1&&y>start+meta.faceWidth*.18){
          colors.forEach((a,k)=>a.push(rgba[4*i+k]));
        }
      }
      if(n>meta.faceWidth*.65)rows.push({l,r,y,n});
    }
    if(colors[0].length<Math.max(90,S*S*.007))return null;
    // RGB 채널 중앙값으로 하이라이트·작은 프린트·손/배경 오염을 약화.
    const rgb=colors.map(median),spread=median(colors[0].map((r,i)=>Math.abs(r-rgb[0])+Math.abs(colors[1][i]-rgb[1])+Math.abs(colors[2][i]-rgb[2])))/3;
    const color='#'+rgb.map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
    const complete=rows.filter(q=>q.l>Math.max(4,(meta.left??0)+2)&&q.r<Math.min(S-5,(meta.right??S)-3)&&q.y<Math.min(S-6,(meta.bottom??S)-3));
    const widths=complete.map(q=>(q.r-q.l)/meta.faceWidth).sort((a,b)=>a-b);
    const shoulderRatio=widths.length>8?clamp(widths[Math.floor(widths.length*.75)],1.65,2.65):null;
    const depths=[];
    for(let x=Math.round(meta.centerX-meta.faceWidth*.08);x<=meta.centerX+meta.faceWidth*.08;x++){
      if(x<0||x>=S)continue;
      for(let y=start;y<end-3;y++){
        if(masks.clothes[y*S+x]>.72&&masks.clothes[(y+1)*S+x]>.72&&masks.clothes[(y+2)*S+x]>.72){depths.push((y-meta.chinY)/meta.faceWidth);break;}
      }
    }
    const neckDepth=depths.length>4?clamp((median(depths)-.16)*60+16,10,42):null;
    return {color,rgb,confidence:clamp(1-spread/95,.3,1),shoulderRatio,neckDepth,pixels:colors[0].length,provenance:'observed'};
  }
  function addClothing(state,sample){
    if(!sample)return;
    state.samples.push(sample);if(state.samples.length>5)state.samples.shift();
    const a=state.samples,rgb=[0,1,2].map(k=>median(a.map(s=>s.rgb[k])));
    const dist=a.map(s=>Math.hypot(...s.rgb.map((v,k)=>v-rgb[k])));
    const stable=a.length>=2&&median(dist)<34&&median(a.map(s=>s.confidence))>.5;
    const value=key=>{const values=a.map(s=>s[key]).filter(Number.isFinite);return values.length?median(values):null;};
    state.result={color:'#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''),confidence:Math.min(...a.map(s=>s.confidence)),
      shoulderRatio:value('shoulderRatio'),neckDepth:value('neckDepth'),provenance:stable?'observed':'partial',stable};
  }
  function scanStatus(p,segMode,now,{minSamples=8,minMs=1000}={}){
    const elapsed=now-p.bornAt,n=p.scan.samples.length;
    const face=n>=minSamples,appearance=p.segCount>=2&&p.clothesCount>=2&&!!p.clothing?.result?.stable;
    const glasses=p.glasses.samples>=6&&(!p.glasses.worn||!!p.glasses.shape);
    const settledGlasses=glasses||elapsed>=4500;
    return {face,appearance,glasses:!!glasses,ready:face&&appearance&&settledGlasses&&elapsed>=minMs,
      timedOut:face&&elapsed>=8000,canContinue:n>=3&&elapsed>=4000,unavailable:segMode==='failed',progress:Math.round(15+35*Math.min(1,n/minSamples)+25*Math.min(1,p.segCount/2)+15*Math.min(1,p.clothesCount/2)+10*Math.min(1,p.glasses.samples/6))};
  }
  return {clothing,addClothing,scanStatus};
})();
