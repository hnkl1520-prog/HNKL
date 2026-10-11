import * as THREE from 'three';

// Rasterize the actual triangle surfaces onto XZ. Bounds alone leave gaps
// between slanted letters; vertex-only samples miss the sloping stone faces.
function surfaceProfile(item, step=.008){
  const geometry=item.mesh.geometry;
  const positions=geometry.getAttribute('position');
  const indices=geometry.getIndex();
  const vertices=[];
  const point=new THREE.Vector3();
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyQuaternion(item.mesh.quaternion);
    vertices.push([point.x+item.basePosition.x,point.y,point.z+item.basePosition.z]);
  }
  const profile=new Map();
  const count=indices?indices.count:positions.count;
  for(let i=0;i<count;i+=3){
    const a=vertices[indices?indices.getX(i):i];
    const b=vertices[indices?indices.getX(i+1):i+1];
    const c=vertices[indices?indices.getX(i+2):i+2];
    const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(Math.abs(denominator)<1e-12)continue;
    const x0=Math.ceil(Math.min(a[0],b[0],c[0])/step);
    const x1=Math.floor(Math.max(a[0],b[0],c[0])/step);
    const z0=Math.ceil(Math.min(a[2],b[2],c[2])/step);
    const z1=Math.floor(Math.max(a[2],b[2],c[2])/step);
    for(let ix=x0;ix<=x1;ix++)for(let iz=z0;iz<=z1;iz++){
      const x=ix*step,z=iz*step;
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator;
      const w=1-u-v;
      if(u<-.000001||v<-.000001||w<-.000001)continue;
      const y=u*a[1]+v*b[1]+w*c[1];
      const key=`${ix},${iz}`;
      const cell=profile.get(key);
      if(cell){cell.top=Math.max(cell.top,y);cell.bottom=Math.min(cell.bottom,y);}
      else profile.set(key,{x,z,top:y,bottom:y});
    }
  }
  return profile;
}

export function placeContactStack(letters){
  const profiles=letters.map(item=>surfaceProfile(item));
  const contacts=[];
  letters.at(-1).basePosition.y=0;
  for(let i=letters.length-2;i>=0;i--){
    const upper=letters[i],lower=letters[i+1];
    let lift=-Infinity,point;
    for(const [key,cell]of profiles[i]){
      const support=profiles[i+1].get(key);
      if(!support)continue;
      const height=support.top-cell.bottom;
      if(height>lift){
        lift=height;
        point=new THREE.Vector3(cell.x,lower.basePosition.y+support.top,cell.z);
      }
    }
    if(!point)throw new Error(`No stone contact between ${upper.mesh.name} and ${lower.mesh.name}`);
    upper.basePosition.y=lower.basePosition.y+lift;
    contacts[i]={
      upper:point.clone().sub(upper.basePosition).applyQuaternion(upper.mesh.quaternion.clone().invert()),
      lower:point.clone().sub(lower.basePosition).applyQuaternion(lower.mesh.quaternion.clone().invert())
    };
  }
  const bounds=new THREE.Box3();
  for(const item of letters){
    item.mesh.position.copy(item.basePosition);
    item.mesh.updateMatrixWorld(true);
    bounds.union(new THREE.Box3().setFromObject(item.mesh));
  }
  const center=bounds.getCenter(new THREE.Vector3());
  for(const item of letters){item.basePosition.sub(center);item.mesh.position.copy(item.basePosition);}
  return {contacts,height:bounds.max.y-bounds.min.y};
}

const contactWorld=new THREE.Vector3();
const upperOffset=new THREE.Vector3();
export function maintainContacts(letters,contacts){
  const bottom=letters.at(-1);
  bottom.mesh.position.copy(bottom.basePosition);
  for(let i=letters.length-2;i>=0;i--){
    const upper=letters[i].mesh,lower=letters[i+1].mesh;
    contactWorld.copy(contacts[i].lower).applyQuaternion(lower.quaternion).add(lower.position);
    upperOffset.copy(contacts[i].upper).applyQuaternion(upper.quaternion);
    upper.position.copy(contactWorld).sub(upperOffset);
  }
}
