/* 조합 화면의 모든 캐릭터는 카메라와 같은 OddComponents.draw로 그린다. */
(() => {
  const C=OddComponents, portrait=document.getElementById('portrait'),ctx=portrait.getContext('2d');
  let design=C.defaults(),count=0;
  design.face='column';design.values.length=1.08;
  const initial=structuredClone(design),motion={blink:0,smile:0,open:0,roll:0};
  const labels={face:'얼굴형',eyes:'눈',brows:'눈썹',nose:'코',mouth:'입',hair:'헤어',glasses:'안경'};
  const partRoot=document.getElementById('part-controls'),shapeRoot=document.getElementById('shape-controls'),exprRoot=document.getElementById('expression-controls');
  for(const [key,choices] of Object.entries(C.catalog)){
    const label=document.createElement('label');label.textContent=labels[key];const select=document.createElement('select');select.id='part-'+key;select.dataset.part=key;
    for(const [id,name] of choices){const op=document.createElement('option');op.value=id;op.textContent=name;select.append(op);}select.value=design[key];select.addEventListener('change',()=>{design[key]=select.value;if(key==='glasses')design.lens=null;render();});label.append(select);partRoot.append(label);
  }
  const sliders=[];
  function slider(root,key,title,min,max,value,step,change){
    const l=document.createElement('label'),span=document.createElement('span'),out=document.createElement('output'),range=document.createElement('input');span.textContent=title;out.value=Number(value).toFixed(2);span.append(out);
    range.type='range';range.min=min;range.max=max;range.step=step;range.value=value;range.id='value-'+key;out.htmlFor=range.id;l.append(span,range);root.append(l);
    range.addEventListener('input',()=>{out.value=Number(range.value).toFixed(2);change(Number(range.value));render();});sliders.push({key,range,out});
  }
  for(const [key,name,min,max] of [['width','얼굴 폭',.8,1.23],['length','얼굴 길이',.78,1.23],['eyeGap','눈 간격',.78,1.25],['eyeSize','눈 크기',.73,1.3],['noseLength','코 길이',.75,1.3],['mouthWidth','입 너비',.65,1.4]])slider(shapeRoot,key,name,min,max,design.values[key],.01,v=>design.values[key]=v);
  for(const [key,name,min,max] of [['blink','눈 감기',0,1],['smile','미소',0,1],['open','입 벌리기',0,.5],['roll','고개 기울기',-.3,.3]])slider(exprRoot,key,name,min,max,0,.01,v=>motion[key]=v);
  function expression(){const e=C.neutral();e.eyeR.open=e.eyeL.open=1-motion.blink;e.eyeR.lift=e.eyeL.lift=motion.smile*.6;e.mouth.smile=motion.smile;e.mouth.cR=[-motion.smile*.05,-motion.smile*.08];e.mouth.cL=[motion.smile*.05,-motion.smile*.08];e.mouth.open=motion.open;e.mouth.teeth=motion.smile*Math.min(1,motion.open*8);e.roll=motion.roll;return e;}
  function colors(){return document.getElementById('shared').checked?{face:'#3530ef',hair:'#151039',shirt:'#151039',bg:'#eeeae0'}:{face:'#afa0e4',hair:'#151039',shirt:'#151039',bg:'#e1ebe0'};}
  const variants=[];
  for(const [id,name] of C.catalog.face){const btn=document.createElement('button');btn.type='button';btn.className='variant';btn.dataset.face=id;const canvas=document.createElement('canvas');canvas.width=350;canvas.height=365;canvas.setAttribute('aria-label',name);const caption=document.createElement('span');caption.textContent=name;btn.append(canvas,caption);btn.addEventListener('click',()=>{design.face=id;document.getElementById('part-face').value=id;render();});document.getElementById('variants').append(btn);variants.push({id,btn,canvas});}
  function render(){
    const pal=colors(),e=expression(),g=C.geometry(design),bust=document.getElementById('bust').checked;
    ctx.fillStyle=pal.bg;ctx.fillRect(0,0,720,720);
    C.draw(ctx,design,{x:360,y:35+(g.bottom-42-42)*1.72,scale:1.72,colors:pal,expression:e,bust});
    for(const {id,btn,canvas} of variants){const d=structuredClone(design);d.face=id;const c=canvas.getContext('2d');c.fillStyle=pal.bg;c.fillRect(0,0,350,365);const geom=C.geometry(d);C.draw(c,d,{x:175,y:15+(geom.bottom-42-40)*.94,scale:.94,colors:pal,expression:e,bust:false});btn.setAttribute('aria-pressed',String(design.face===id));}
    window.__componentPreview={design:structuredClone(design),motion:{...motion},version:C.version};
  }
  function sync(){for(const s of partRoot.querySelectorAll('select'))s.value=design[s.dataset.part];for(const s of sliders){s.range.value=s.key in motion?motion[s.key]:design.values[s.key];s.out.value=Number(s.range.value).toFixed(2);}render();}
  document.getElementById('shuffle').addEventListener('click',()=>{count++;let i=0;for(const [key,list]of Object.entries(C.catalog)){design[key]=list[(count*(i%2?3:1)+i)%list.length][0];i++;}design.lens=null;sync();});
  document.getElementById('reset').addEventListener('click',()=>{design=structuredClone(initial);for(const key in motion)motion[key]=0;document.getElementById('shared').checked=false;document.getElementById('bust').checked=true;sync();});
  for(const id of ['shared','bust'])document.getElementById(id).addEventListener('change',render);
  render();window.__done=true;
})();
