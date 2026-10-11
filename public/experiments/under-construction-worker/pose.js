import { solveTwoBone } from './geometry.js';
// The poses are deliberately drawn key poses, rather than the result of
// stretching a standing figure to fill the selection rectangle.
export const CHARACTER_SCALE = 1;
export const SIZE_LIMITS = Object.freeze({ minWidth: 170, maxWidth: 330, minHeight: 185, maxHeight: 370 });
export const LENGTHS = Object.freeze({ upperArm: 50, forearm: 53, thigh: 74, shin: 77 });
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = value => value*value*(3-2*value);
const point = (x,y) => ({x,y});
const blendPoint = (a,b,t) => point(mix(a.x,b.x,t),mix(a.y,b.y,t));
export function rotatePoint(p,angle){const c=Math.cos(angle),s=Math.sin(angle);return{x:p.x*c-p.y*s,y:p.x*s+p.y*c};}
const offset = (origin,p,angle=0) => {const r=rotatePoint(p,angle);return point(origin.x+r.x,origin.y+r.y);};

function standing(width,height) {
  const hip=point(clamp(width*.44,73,145),height-167);
  const shoulders=[offset(hip,point(16,-76)),offset(hip,point(-16,-76))];
  const ankles=[point(hip.x+16,height-18),point(hip.x-14,height-18)];
  return {
    hip,angle:0,
    knees:[point(hip.x+13,hip.y+76),point(hip.x-12,hip.y+76)],
    ankles,
    elbows:[point(hip.x+28,hip.y-29),point(hip.x-22,hip.y-29)],
    wrists:[point(hip.x+25,hip.y+12),point(hip.x-19,hip.y+12)],
    shoulders,bootAngles:[0,0],handAngles:[0,0],handModes:['rest','rest'],
  };
}

// Swing the wrist around the shoulder instead of taking a straight shortcut
// through the elbow. The two arm segments retain their lengths during the turn.
function swing(root,from,to,t) {
  const a=Math.atan2(from.y-root.y,from.x-root.x);
  let b=Math.atan2(to.y-root.y,to.x-root.x);
  while(b-a>Math.PI)b-=Math.PI*2;
  while(b-a<-Math.PI)b+=Math.PI*2;
  const radius=mix(Math.hypot(from.x-root.x,from.y-root.y),Math.hypot(to.x-root.x,to.y-root.y),t);
  return offset(root,point(Math.cos(mix(a,b,t))*radius,Math.sin(mix(a,b,t))*radius));
}
function closeStanding(width,height) {
  const pose=standing(width,height);
  const narrow=smooth(clamp((224-width)/45,0,1));
  const ceiling=smooth(clamp((354-height)/24,0,1));
  const root=pose.shoulders[0];
  const wallWrist=point(width-16,root.y+6);
  let wrist=swing(root,pose.wrists[0],wallWrist,narrow);
  let mode=narrow>.001?'wall':'rest',handAngle=0;
  if(narrow>.001)handAngle=90*(1-narrow);
  if(ceiling>.001){
    const topWrist=point(Math.min(width-23,pose.hip.x+55),16);
    wrist=swing(root,wrist,topWrist,ceiling);
    mode='ceiling';handAngle=180*(1-ceiling);
    const a=handAngle*Math.PI/180;
    wrist.x=clamp(wrist.x,23,width-23);
    wrist.y=Math.max(wrist.y,20*Math.abs(Math.sin(a))+15*Math.abs(Math.cos(a))+1);
  }
  if(narrow>.001||ceiling>.001){
    const solved=solveTwoBone(root,wrist,LENGTHS.upperArm,LENGTHS.forearm,1);
    pose.wrists[0]=solved.end;pose.elbows[0]=solved.joint;
    pose.handModes[0]=mode;pose.handAngles[0]=handAngle;
  }
  pose.ceiling=ceiling;pose.narrow=narrow;
  return pose;
}

function seated(width,height) {
  const wide=smooth(clamp((width-195)/135,0,1));
  const angle=-40*Math.PI/180*wide;
  // The head remains beside the left edge while the torso leans back.
  const headOffset=rotatePoint(point(4,-116),angle);
  const hip=point(40-headOffset.x,height-24-8*wide);
  const topX=mix(hip.x+56,128,wide);
  return {
    hip,angle,wide,
    knees:[point(mix(hip.x+60,width-120,wide),height-97),point(mix(hip.x+72,width-110,wide),height-82)],
    ankles:[point(width-18,height-mix(67,103,wide)),point(width-49,height-18)],
    elbows:[point(topX,mix(65,70,wide)),point(hip.x+mix(5,-22,wide),height-mix(55,50,wide))],
    wrists:[point(topX,16),point(hip.x+mix(34,23,wide),height-16)],
    bootAngles:[-90,0],handAngles:[0,0],handModes:['ceiling','floor'],
  };
}

export function createPose(width,height){
  width=clamp(width,SIZE_LIMITS.minWidth,SIZE_LIMITS.maxWidth);
  height=clamp(height,SIZE_LIMITS.minHeight,SIZE_LIMITS.maxHeight);
  const upright=closeStanding(width,height),compact=seated(width,height);
  const progress=smooth(clamp((330-height)/115,0,1));
  const angle=compact.angle*progress;
  const headOffset=rotatePoint(point(4,-116),angle);
  const wallSettle=smooth(clamp(progress*4,0,1));
  const hip=point(
    mix(upright.hip.x,40-headOffset.x,wallSettle),
    progress>0?Math.min(height-24-8*compact.wide,163+10*Math.sin(Math.PI*progress)):upright.hip.y,
  );
  const torso={hip,angle};
  const head={...offset(hip,point(4,-116),angle),angle:angle*.2};
  const hips=[offset(hip,point(8,0),angle),offset(hip,point(-8,0),angle)];
  const shoulders=[offset(hip,point(16,-76),angle),offset(hip,point(-16,-76),angle)];
  const legs=hips.map((root,i)=>({root,joint:blendPoint(upright.knees[i],compact.knees[i],progress),end:blendPoint(upright.ankles[i],compact.ankles[i],progress)}));
  const bootAngles=upright.bootAngles.map((a,i)=>mix(a,compact.bootAngles[i],progress));
  const wrists=[...upright.wrists],handModes=[...upright.handModes],handAngles=[...upright.handAngles];
  const support=smooth(clamp((225-height)/40,0,1));
  if(progress>0){
    wrists[0]=point(mix(upright.wrists[0].x,compact.wrists[0].x,progress),16);
    handModes[0]='ceiling';handAngles[0]=0;
    const kneeRest=point(legs[1].joint.x-13,legs[1].joint.y-14);
    wrists[1]=blendPoint(upright.wrists[1],kneeRest,smooth(clamp(progress*2,0,1)));
    wrists[1]=blendPoint(wrists[1],point(hip.x+28,height-16),support);
    if(progress>.01){handModes[1]='floor';handAngles[1]=0;}
  }
  const arms=shoulders.map((root,i)=>{
    if(progress===0&&i===1)return{root,joint:upright.elbows[i],end:wrists[i]};
    if(progress===0&&i===0)return{root,joint:upright.elbows[i],end:wrists[i]};
    const solved=solveTwoBone(root,wrists[i],LENGTHS.upperArm,LENGTHS.forearm,1);
    if(i===1){
      const relaxedElbow=offset(hip,point(-22,-29),angle);
      solved.joint=blendPoint(relaxedElbow,solved.joint,smooth(clamp(progress*4,0,1)));
    }
    return {root,...solved};
  });
  const ceiling=(progress>0||upright.ceiling>.999)&&Math.abs(arms[0].end.y-16)<.01;
  const wall=progress===0&&upright.ceiling===0&&upright.narrow>.999;
  const floor=support>.999&&Math.abs(arms[1].end.y-(height-16))<.01;
  const name=progress>.8?(compact.wide>.55?'reclining':'seated'):
    progress>.01?'lowering':wall?'wall-contact':ceiling?'ceiling-contact':'standing';
  return {angle,progress,name,contacts:{ceiling,wall,floor},torso,head,hips,shoulders,legs,arms,bootAngles,handAngles,handModes};
}
