import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { placeContactStack, maintainContacts } from './contacts.js';
import { createStoneMaterial } from './stone-material.js';

const stage=document.querySelector('#stage');
const status=document.querySelector('#status');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(32,1,.1,40);
camera.position.set(0,.1,10.5);
camera.lookAt(0,0,0);
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
}catch(error){
  status.textContent='This page is under construction.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000,0);
stage.append(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xf0f2f4,0x77756f,.65));
const key=new THREE.DirectionalLight(0xffffff,3.4);
key.position.set(-4.5,5,4.5);
key.castShadow=true;
key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-3,right:3,top:4,bottom:-4,near:.1,far:20});
key.shadow.normalBias=.0025;
key.shadow.bias=-.000025;
key.shadow.radius=3;
scene.add(key);
const rim=new THREE.DirectionalLight(0xffffff,.35);
rim.position.set(3,2,-3);
scene.add(rim);
const fill=new THREE.DirectionalLight(0xe3e7eb,.18);
fill.position.set(4,-1,4);
scene.add(fill);

const specs=[
  {name:'S',position:[-.10,0,0],rotation:[.12,-.30,.24],scale:.94},
  {name:'O1',position:[.08,0,0],rotation:[-.12,.34,-.29],scale:1.06},
  {name:'O2',position:[-.28,0,0],rotation:[.06,-.35,.33],scale:1.14},
  {name:'N',position:[.04,0,0],rotation:[-.10,.36,-.36],scale:1.23}
];
const letters=[];
const proxies=[];
const neighborResponse=[1,.34,.13,.045];
const motionTargets=new Float64Array(specs.length);
const stoneModelView=new THREE.Matrix4();
let contacts=[],cameraDistance=10.5;
const pointer=new THREE.Vector2(5,5);
const ray=new THREE.Raycaster();
let active=-1,touchTimer=0,request=0,last=0,elapsed=0,ready=false;
let bounds=stage.getBoundingClientRect();

function resize(){
  bounds=stage.getBoundingClientRect();
  camera.aspect=bounds.width/bounds.height;
  camera.position.z=cameraDistance*(camera.aspect<.6?1.04:1);
  camera.updateProjectionMatrix();
  renderer.setSize(bounds.width,bounds.height);
  draw();
}

function setActive(index){
  active=index;
  stage.classList.toggle('is-hovered',index>=0);
  stage.dataset.activeLetter=index>=0?specs[index].name:'';
  wake();
}
function pick(event){
  pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);
  ray.setFromCamera(pointer,camera);
  const hit=ray.intersectObjects(proxies,false)[0];
  setActive(hit?hit.object.userData.index:-1);
}
stage.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')pick(event);});
stage.addEventListener('pointerleave',()=>{if(!touchTimer)setActive(-1);stage.classList.remove('is-pressed');});
stage.addEventListener('pointerdown',event=>{
  pick(event);
  stage.classList.add('is-pressed');
  if(event.pointerType==='touch'){
    clearTimeout(touchTimer);
    touchTimer=setTimeout(()=>{touchTimer=0;setActive(-1);},1800);
  }
});
stage.addEventListener('pointerup',()=>stage.classList.remove('is-pressed'));
stage.addEventListener('pointercancel',()=>{clearTimeout(touchTimer);touchTimer=0;setActive(-1);stage.classList.remove('is-pressed');});
document.querySelectorAll('[data-letter]').forEach((button,index)=>{
  button.addEventListener('focus',()=>setActive(index));
  button.addEventListener('blur',()=>setActive(-1));
  button.addEventListener('click',()=>setActive(index));
});

function update(dt){
  if(reduced.matches){
    letters.forEach((item,index)=>{
      item.hover=active<0?0:neighborResponse[Math.abs(index-active)];
      item.velocity=0;
    });
  }else{
    let remaining=dt;
    while(remaining>0){
      const step=Math.min(remaining,1/120);
      // Nearby stones follow the moving stone, with their own inertia. Sample
      // every target before integrating so the wave is independent of order.
      const driver=active<0?0:letters[active].hover;
      letters.forEach((_item,index)=>{
        motionTargets[index]=active<0?0:index===active?1:
          driver*neighborResponse[Math.abs(index-active)];
      });
      letters.forEach((item,index)=>{
        const stiffness=index===active?72:56;
        const damping=index===active?9:8;
        item.velocity+=((motionTargets[index]-item.hover)*stiffness-item.velocity*damping)*step;
        item.hover+=item.velocity*step;
      });
      remaining-=step;
    }
  }
  letters.forEach((item,index)=>{
    const h=item.hover;
    const tilt=reduced.matches?0:Math.sin(elapsed*.30+index*.9)*.005;
    const weight=index===3?.3:1;
    item.mesh.rotation.set(
      item.baseRotation.x-h*.078*weight,
      item.baseRotation.y+h*(index%2?.29:-.29)*weight,
      item.baseRotation.z+tilt*weight+h*(index%2?.055:-.055)*weight
    );
  });
  // Each upper stone turns around its lower contact. The stones above follow
  // the changed support point instead of separating and floating away.
  maintainContacts(letters,contacts);
}
function draw(){if(ready)renderer.render(scene,camera);}
function tick(now){
  request=0;
  if(document.hidden)return;
  const dt=last?Math.min((now-last)/1000,.05):1/60;
  last=now;elapsed+=dt;
  update(dt);draw();
  if(!reduced.matches)request=requestAnimationFrame(tick);
}
function wake(){if(ready&&!document.hidden&&!request)request=requestAnimationFrame(tick);}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){cancelAnimationFrame(request);request=0;last=0;}
  else wake();
});
reduced.addEventListener('change',()=>{last=0;wake();});
new ResizeObserver(resize).observe(stage);

async function texture(url,srgb=false){
  const map=await new THREE.TextureLoader().loadAsync(new URL(url,import.meta.url).href);
  map.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.repeat.set(1,1);
  map.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
  map.flipY=false;
  return map;
}

async function initialize(){
  const [gltf,map,normalMap,roughnessMap]=await Promise.all([
    new GLTFLoader().loadAsync(new URL('./assets/soon-stone.glb',import.meta.url).href),
    texture('./assets/limestone-color.jpg',true),
    texture('./assets/limestone-normal-gl.jpg'),
    texture('./assets/limestone-roughness.jpg')
  ]);
  gltf.scene.updateMatrixWorld(true);
  specs.forEach((spec,index)=>{
    const source=gltf.scene.getObjectByName(spec.name);
    if(!source?.isMesh)throw new Error(`Missing stone letter: ${spec.name}`);
    const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const size=geometry.boundingBox.getSize(new THREE.Vector3());
    geometry.center();
    const factor=spec.scale/size.y;
    geometry.scale(factor,factor,factor);
    geometry.computeBoundingBox();
    const material=createStoneMaterial({map,normalMap,roughnessMap},index,factor);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=spec.name;mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.onBeforeRender=(_renderer,_scene,renderCamera)=>{
      stoneModelView.multiplyMatrices(renderCamera.matrixWorldInverse,mesh.matrixWorld);
      material.userData.stoneToView.getNormalMatrix(stoneModelView);
    };
    const basePosition=new THREE.Vector3(...spec.position);
    const baseRotation=new THREE.Euler(...spec.rotation);
    mesh.position.copy(basePosition);mesh.rotation.copy(baseRotation);
    scene.add(mesh);
    letters.push({mesh,basePosition,baseRotation,hover:0,velocity:0});
    const box=geometry.boundingBox.getSize(new THREE.Vector3());
    const proxy=new THREE.Mesh(new THREE.BoxGeometry(box.x*1.14,box.y*1.07,Math.max(box.z,.4)),new THREE.MeshBasicMaterial({visible:false}));
    proxy.position.copy(basePosition);proxy.rotation.copy(baseRotation);proxy.userData.index=index;
    scene.add(proxy);proxies.push(proxy);
  });
  const stack=placeContactStack(letters);
  contacts=stack.contacts;
  cameraDistance=stack.height*1.23/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
  letters.forEach((item,index)=>proxies[index].position.copy(item.basePosition));
  update(0);
  scene.updateMatrixWorld(true);
  ready=true;
  resize();
  stage.classList.add('is-ready');
  status.classList.add('is-ready');
  status.textContent='Hover or tap the letters';
  document.body.dataset.ready='true';
  wake();
}
initialize().catch(error=>{
  console.error('Stone sculpture failed to load:',error);
  status.textContent='The sculpture could not load. Please refresh.';
  document.body.dataset.error='true';
});

// Read-only diagnostics for checking all three joints during hover and return.
export function inspectStack(){
  scene.updateMatrixWorld(true);
  return {
    active:stage.dataset.activeLetter,
    contacts:contacts.map((contact,i)=>({
      pair:`${letters[i].mesh.name}/${letters[i+1].mesh.name}`,
      gap:contact.upper.clone().applyMatrix4(letters[i].mesh.matrixWorld)
        .distanceTo(contact.lower.clone().applyMatrix4(letters[i+1].mesh.matrixWorld))
    })),
    letters:letters.map(item=>{
      const screen=item.mesh.position.clone().project(camera);
      return {name:item.mesh.name,hover:item.hover,rotation:item.mesh.rotation.toArray(),
        screen:{x:(screen.x+1)*bounds.width/2+bounds.left,y:(1-screen.y)*bounds.height/2+bounds.top}};
    })
  };
}
