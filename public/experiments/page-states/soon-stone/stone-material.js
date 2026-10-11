import * as THREE from 'three';

// Sample the scanned rock in object space. A shared physical density across
// front faces and broken edges avoids stretched UV islands and moving grain.
export function createStoneMaterial({map,normalMap,roughnessMap},index,geometryScale=1){
  const stoneToView=new THREE.Matrix3();
  const material=new THREE.MeshStandardMaterial({
    color:0xf1eee8,map,normalMap,roughnessMap,roughness:.98,metalness:0,
    normalScale:new THREE.Vector2(.34,.34)
  });
  material.userData.stoneToView=stoneToView;
  material.onBeforeCompile=shader=>{
    shader.uniforms.stoneToView={value:stoneToView};
    shader.uniforms.stoneOffset={value:new THREE.Vector3(index*.713,index*1.379,index*-.817)};
    // The relief is baked before each glyph receives its display scale.
    shader.uniforms.stoneDensity={value:.75/geometryScale};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
        varying vec3 vStonePosition;
        varying vec3 vStoneNormal;
      `)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vStonePosition=position;
        vStoneNormal=normal;
      `);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec3 vStonePosition;
        varying vec3 vStoneNormal;
        uniform vec3 stoneOffset;
        uniform float stoneDensity;
        uniform mat3 stoneToView;

        vec3 stoneWeights(vec3 n){
          vec3 w=pow(abs(n),vec3(8.0));
          return w/max(dot(w,vec3(1.0)),.0001);
        }
        vec3 stoneSign(vec3 n){return step(vec3(0.0),n)*2.0-1.0;}
        vec4 stoneSample(sampler2D tex,vec3 p,vec3 n){
          vec3 w=stoneWeights(n),s=stoneSign(n);
          return texture2D(tex,vec2(-p.z*s.x,p.y))*w.x
            +texture2D(tex,vec2(p.x,-p.z*s.y))*w.y
            +texture2D(tex,vec2(p.x*s.z,p.y))*w.z;
        }
        vec3 stoneDetailNormal(sampler2D tex,vec3 p,vec3 n,vec2 strength){
          vec3 w=stoneWeights(n),s=stoneSign(n);
          vec3 nx=texture2D(tex,vec2(-p.z*s.x,p.y)).xyz*2.0-1.0;
          vec3 ny=texture2D(tex,vec2(p.x,-p.z*s.y)).xyz*2.0-1.0;
          vec3 nz=texture2D(tex,vec2(p.x*s.z,p.y)).xyz*2.0-1.0;
          nx.xy*=strength;ny.xy*=strength;nz.xy*=strength;
          nx=normalize(nx);ny=normalize(ny);nz=normalize(nz);
          // Remove each projection's flat normal before blending, so the
          // sculpted surface normal remains the baseline on sloping facets.
          vec3 dx=vec3((nx.z-1.0)*s.x,nx.y,-nx.x*s.x);
          vec3 dy=vec3(ny.x,(ny.z-1.0)*s.y,-ny.y*s.y);
          vec3 dz=vec3(nz.x*s.z,nz.y,(nz.z-1.0)*s.z);
          return normalize(n+dx*w.x+dy*w.y+dz*w.z);
        }
      `)
      .replace('#include <map_fragment>',`
        vec3 stoneP=vStonePosition*stoneDensity+stoneOffset;
        vec3 stoneN=normalize(vStoneNormal);
        vec3 mineral=stoneSample(map,stoneP,stoneN).rgb;
        float mineralLuma=dot(mineral,vec3(.2126,.7152,.0722));
        // Limestone has quieter mineral color than the weathered source scan.
        // Let the broken geometry and scanned normals carry the relief.
        vec3 limestone=vec3(.14+mineralLuma*.90);
        limestone+=(mineral-vec3(mineralLuma))*.025;
        diffuseColor.rgb*=limestone;
      `)
      .replace('#include <roughnessmap_fragment>',`
        float roughnessFactor=clamp(stoneSample(roughnessMap,stoneP,stoneN).g*roughness,.78,1.0);
      `)
      .replace('#include <normal_fragment_maps>',`
        normal=normalize(stoneToView*stoneDetailNormal(normalMap,stoneP,stoneN,normalScale))*faceDirection;
      `);
  };
  material.customProgramCacheKey=()=> 'limestone-triplanar-v1';
  return material;
}
