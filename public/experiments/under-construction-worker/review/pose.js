import { solveTwoBone } from './geometry.js';

export const CHARACTER_SCALE = 1;
export const SIZE_LIMITS = Object.freeze({ minWidth: 205, maxWidth: 380, minHeight: 215, maxHeight: 350 });
export const LENGTHS = Object.freeze({ upperArm: 48, forearm: 46, thigh: 74, shin: 77 });
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = value => value*value*(3-2*value);
export function rotatePoint(p,angle){const c=Math.cos(angle),s=Math.sin(angle);return{x:p.x*c-p.y*s,y:p.x*s+p.y*c};}
const offset = (origin,point,angle) => {const rotated=rotatePoint(point,angle);return{x:origin.x+rotated.x,y:origin.y+rotated.y};};

export function createPose(width,height){
  const progress=smooth(clamp((330-height)/115,0,1));
  const room=clamp((width-205)/175,0,1);
  const angle=-20*Math.PI/180*room*progress;
  // A standing body settles onto the floor as its knees fold. The minimum box
  // places the back and seat beside its left edge; extra width allows a lean.
  const seatedX=27-116*Math.sin(angle);
  const seatClearance=21-24*Math.sin(angle)+18*(Math.cos(angle)-1);
  const hip={x:mix(width*.5,seatedX,progress),y:mix(height-167.5,height-seatClearance,progress)};
  const torso={hip,angle};
  const head={...offset(hip,{x:4,y:-116},angle),angle:angle*.2};
  const hips=[offset(hip,{x:mix(-8,0,progress),y:0},angle),offset(hip,{x:8,y:0},angle)];
  const shoulders=[offset(hip,{x:-5,y:-70},angle),offset(hip,{x:5,y:-70},angle)];
  const feet=[
    {x:hip.x+mix(-14,110,progress),y:height-17},
    {x:hip.x+mix(14,125,progress),y:height-17},
  ];
  const legs=feet.map((goal,i)=>({root:hips[i],...solveTwoBone(hips[i],goal,LENGTHS.thigh,LENGTHS.shin,-1)}));
  const hands=legs.map((leg,i)=>({
    x:mix(hip.x+(i===0?-8:18),leg.joint.x-(i===0?14:11),progress),
    y:mix(hip.y+18,leg.joint.y-(i===0?17:15),progress),
  }));
  const arms=hands.map((goal,i)=>({root:shoulders[i],...solveTwoBone(shoulders[i],goal,LENGTHS.upperArm,LENGTHS.forearm,1)}));
  return {angle,progress,torso,head,hips,shoulders,legs,arms,bootAngles:[0,0],handAngles:[-85*progress,-85*progress]};
}
