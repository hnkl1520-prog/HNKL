/**
 * HNKL core concepts: original vectors from hnkl-core-motions.html.
 * Mount with <div data-core-motion="guide|fun|immerse"></div>.
 * Existing <svg data-core-motion> mounts are supported too.
 * Each canvas is a 300 × 300 SVG; no framework or global styles required.
 */
(function () {
  'use strict';

  /* ---------- 공통 ---------- */
  var C='#3B82F6', NS='http://www.w3.org/2000/svg', TAU=Math.PI*2;
  var BLUE=[59,130,246], PURPLE=[156,109,255], TEAL=[79,209,197], CHARCOAL=[37,37,40];
  function mk(svg,tag,a){var e=document.createElementNS(NS,tag);for(var k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e;}
  function marks(svg){var d='';for(var i=1;i<6;i++)for(var j=1;j<6;j++){var x=i*50,y=j*50;d+='M'+(x-3)+' '+y+'h6M'+x+' '+(y-3)+'v6';}mk(svg,'path',{d:d,stroke:'#414146','stroke-width':1,fill:'none'});}
  function dot(x,y,r){return 'M'+(x-r).toFixed(2)+' '+y.toFixed(2)+'a'+r.toFixed(2)+' '+r.toFixed(2)+' 0 1 0 '+(2*r).toFixed(2)+' 0a'+r.toFixed(2)+' '+r.toFixed(2)+' 0 1 0 '+(-2*r).toFixed(2)+' 0';}
  function col(f,color){f=Math.max(0,Math.min(1,f));color=color||BLUE;return 'rgb('+color.map(function(channel,i){return Math.round(CHARCOAL[i]+(channel-CHARCOAL[i])*f);}).join(',')+')';}
  function R3(p,th,al){var x=p[0],y=p[1],z=p[2],x1=x*Math.cos(th)+z*Math.sin(th),z1=-x*Math.sin(th)+z*Math.cos(th);return [x1,y*Math.cos(al)-z1*Math.sin(al),y*Math.sin(al)+z1*Math.cos(al)];}
  function f2(v){return v.toFixed(2);}
  function clamp(x){return Math.max(0,Math.min(1,x));}
  function smoothstep(a,b,x){var q=clamp((x-a)/(b-a));return q*q*(3-2*q);}
  function elastic(x){return x<=0?0:x>=1?1:Math.pow(2,-10*x)*Math.sin((x*10-0.75)*TAU/3)+1;}
  function ell(el,cx,cy,rx,ry){el.setAttribute('cx',f2(cx));el.setAttribute('cy',f2(cy));el.setAttribute('rx',Math.max(0,rx).toFixed(2));el.setAttribute('ry',Math.max(0,ry).toFixed(2));}
  // Split at the interpolated silhouette, never at a whole sample segment.
  function splitPath(P){
    var paths=['',''],last=[null,null];
    function add(side,a,b){
      var start=f2(a[0])+' '+f2(a[1]),end=f2(b[0])+' '+f2(b[1]);
      paths[side]+=(last[side]===start?'':'M'+start)+'L'+end;
      last[side]=end;
    }
    for(var i=0;i<P.length-1;i++){
      var a=P[i],b=P[i+1],sa=a[2]>=0?0:1,sb=b[2]>=0?0:1;
      if(sa===sb){add(sa,a,b);continue;}
      var q=a[2]/(a[2]-b[2]),edge=[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q,0];
      add(sa,a,edge);add(sb,edge,b);
    }
    return paths;
  }

  var maskIndex=0;

  /* ---------- 1. 가이드: 점 구 주위를 도는 작은 점 ---------- */
  function guide(svg){
    marks(svg);
    // Mask only the rear orbit. The moving stroke and head disappear gradually
    // behind the globe's edge instead of switching complete pieces on and off.
    var maskId='hnkl-guide-occlusion-'+(++maskIndex),defs=mk(svg,'defs',{});
    var mask=mk(defs,'mask',{id:maskId,maskUnits:'userSpaceOnUse',x:0,y:0,width:300,height:300});
    mk(mask,'rect',{x:0,y:0,width:300,height:300,fill:'#fff'});
    mk(mask,'circle',{cx:150,cy:150,r:59,fill:'#000'});
    var masked='url(#'+maskId+')';
    var rear=mk(svg,'g',{mask:masked});
    var orbBack=mk(rear,'path',{fill:C,'fill-opacity':0.25});
    var globe=mk(svg,'path',{fill:C,'fill-opacity':0.85});
    var front=mk(svg,'g',{});
    var orbFront=mk(front,'path',{fill:C,'fill-opacity':0.7});
    var tail=[];for(var i=0;i<18;i++)tail.push(mk(front,'path',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}));
    var head=mk(front,'circle',{r:4.2});
    var FS=[];for(var k=0,N=240;k<N;k++){var yy=1-2*(k+0.5)/N,rr=Math.sqrt(1-yy*yy),aa=k*2.399963;FS.push([rr*Math.cos(aa),yy,rr*Math.sin(aa)]);}
    var RG=56,RO=106,AL=0.5,GA=-0.42;
    function orb(a){var x=Math.cos(a),z=Math.sin(a),y2=-z*Math.sin(AL),z2=z*Math.cos(AL);return [150+(x*Math.cos(GA)-y2*Math.sin(GA))*RO,150-(x*Math.sin(GA)+y2*Math.cos(GA))*RO,z2];}
    function tangent(a){return [RO*(-Math.sin(a)*Math.cos(GA)+Math.cos(a)*Math.sin(AL)*Math.sin(GA)),RO*(Math.sin(a)*Math.sin(GA)+Math.cos(a)*Math.sin(AL)*Math.cos(GA))];}
    var fb='',ff='';
    for(i=0;i<140;i++){var p=orb(i/140*TAU);if(p[2]<0)fb+=dot(p[0],p[1],0.85);else ff+=dot(p[0],p[1],0.85);}
    orbBack.setAttribute('d',fb);orbFront.setAttribute('d',ff);
    return function(t){
      var d='';for(var i=0;i<FS.length;i++){var q=R3(FS[i],t*0.22,0.38);if(q[2]<=0)continue;d+=dot(150+q[0]*RG,150-q[1]*RG,(0.45+1.05*q[2])*smoothstep(0,0.12,q[2]));}
      globe.setAttribute('d',d);
      var ph=t*0.75+0.28*Math.sin(t*0.75),L=1.8,n=tail.length;
      for(i=n-1;i>=0;i--){var a0=ph-L*i/n,a1=ph-L*(i+1)/n,pa=orb(a0),pm=orb((a0+a1)/2),pb=orb(a1),el=tail[i];
        var ta=tangent(a0),tb=tangent(a1),arc=4/3*Math.tan((a1-a0)/4),kk=1-i/n;
        el.setAttribute('d','M'+f2(pa[0])+' '+f2(pa[1])+'C'+f2(pa[0]+arc*ta[0])+' '+f2(pa[1]+arc*ta[1])+' '+f2(pb[0]-arc*tb[0])+' '+f2(pb[1]-arc*tb[1])+' '+f2(pb[0])+' '+f2(pb[1]));
        var layer=pm[2]<0?rear:front;if(el.parentNode!==layer)layer.appendChild(el);
        el.setAttribute('stroke-width',(0.5+3*kk).toFixed(2));el.setAttribute('stroke',col((0.45+0.55*smoothstep(-0.25,0.25,pm[2]))*(0.12+0.88*kk),BLUE));}
      var h=orb(ph);head.setAttribute('cx',f2(h[0]));head.setAttribute('cy',f2(h[1]));
      var headLayer=h[2]<0?rear:front;if(head.parentNode!==headLayer)headLayer.appendChild(head);
      head.setAttribute('fill',col(0.5+0.5*smoothstep(-0.25,0.25,h[2]),BLUE));
    };
  }

  /* ---------- 2. 재미: 튈 때마다 모양이 바뀌는 공 ---------- */
  function fun(svg){
    marks(svg);
    var FY=218;
    var fd='';for(var i=0;i<72;i++){var a=i/72*TAU;fd+=dot(150+108*Math.cos(a),FY+30*Math.sin(a),0.8);}
    mk(svg,'path',{d:fd,fill:col(1,PURPLE),'fill-opacity':0.4});
    var rp=[0,1,2,3].map(function(){return mk(svg,'ellipse',{fill:'none'});});
    var sh=mk(svg,'ellipse',{});
    var shp=mk(svg,'path',{fill:col(1,PURPLE)});
    var RS=[
      function(){return 1;},
      function(th){return 0.9/Math.pow(Math.pow(Math.abs(Math.cos(th)),5)+Math.pow(Math.abs(Math.sin(th)),5),0.2);},
      function(th){
        var s=TAU/3,a=Math.abs(((th+Math.PI/2)%s+s)%s-s/2),inner=0.62*0.85,corner=0.15;
        var tangentAngle=Math.atan2(inner*Math.tan(s/2),inner+corner);
        if(a<=tangentAngle)return (inner+corner)/Math.cos(a);
        var center=inner/Math.cos(s/2),da=s/2-a,cross=center*Math.sin(da);
        return center*Math.cos(da)+Math.sqrt(Math.max(0,corner*corner-cross*cross));
      },
      function(th){return 0.82+0.24*Math.cos(5*th);}
    ];
    var HP=0.78,CT=0.1,G=820,SZ=15,APX=G*HP*HP/8;
    return function(t){
      var P=HP+CT,k=Math.floor(t/P),lt=t-k*P,cur=k%4,prev=(k+3)%4,y=0,sq=1,m=0;
      if(lt<CT){sq=1-0.4*Math.sin(Math.PI*lt/CT);}
      else{var tau=lt-CT;y=APX-0.5*G*Math.pow(tau-HP/2,2);m=elastic(clamp(tau/0.45));sq=1+0.16*Math.abs(tau-HP/2)/(HP/2);}
      var spin=(lt<CT?0:(lt-CT)/HP)*Math.PI*(cur%2?-1:1)*0.66,cy=FY-y-SZ*sq,d='';
      for(var i=0;i<=80;i++){var th=i/80*TAU,r=(RS[prev](th-spin)*(1-m)+RS[cur](th-spin)*m)*SZ;d+=(i?'L':'M')+f2(150+r*Math.cos(th)/Math.sqrt(sq))+' '+f2(cy+r*Math.sin(th)*sq);}
      shp.setAttribute('d',d+'Z');
      var hf=clamp(y/APX);ell(sh,150,FY,18*(1-0.5*hf),5*(1-0.5*hf));sh.setAttribute('fill',col(0.4*(1-0.7*hf),PURPLE));
      rp.forEach(function(el,i){var L=(k-Math.floor(i/2))*P,q=(t-L-(i%2)*0.13);if(q<=0||q>=1){el.setAttribute('rx',0);el.setAttribute('ry',0);return;}
        var e=1-Math.pow(1-q,2.2),rr=12+100*e;ell(el,150,FY,rr,rr*0.28);el.setAttribute('stroke-width',(1.6*(1-q)+0.4).toFixed(2));el.setAttribute('stroke',col((1-q)*(i%2?0.5:0.9),PURPLE));});
    };
  }

  /* ---------- 3. 몰입: 도넛 가운데로 흘러 들어가는 고리 ---------- */
  function immerse(svg){
    marks(svg);
    var aS=mk(svg,'path',{fill:'none',stroke:col(0.2,TEAL),'stroke-width':1});
    var aB=mk(svg,'path',{fill:'none',stroke:col(0.28,TEAL),'stroke-width':1.1});
    var aF=mk(svg,'path',{fill:'none',stroke:col(1,TEAL),'stroke-width':1.4,'stroke-linecap':'round'});
    var TR=72,Tr=38,TILT=0.95;
    function torus(u,v,spin){var p=[(TR+Tr*Math.cos(v))*Math.cos(u),Tr*Math.sin(v),(TR+Tr*Math.cos(v))*Math.sin(u)],n=[Math.cos(v)*Math.cos(u),Math.sin(v),Math.cos(v)*Math.sin(u)],q=R3(p,spin,TILT),m=R3(n,spin,TILT);return [150+q[0],150-q[1],m[2]];}
    return function(t){
      var spin=t*0.12,s='',i,j,pts;
      for(i=0;i<18;i++){var u=i/18*TAU;pts=[];for(j=0;j<=48;j++)pts.push(torus(u,j/48*TAU,spin));s+=splitPath(pts)[0];}
      aS.setAttribute('d',s);
      var F='',B='';
      for(j=0;j<12;j++){var v=j/12*TAU+t*0.38;pts=[];for(i=0;i<=96;i++)pts.push(torus(i/96*TAU,v,spin));var fb=splitPath(pts);F+=fb[0];B+=fb[1];}
      aF.setAttribute('d',F);aB.setAttribute('d',B);
    };
  }


  const MOTIONS = { guide, fun, immerse };
  const LABELS = {
    guide: '점으로 된 구 주위를 작은 점이 궤도를 따라 도는 모션',
    fun: '튈 때마다 모양이 바뀌는 공 모션',
    immerse: '고리들이 도넛 가운데 구멍으로 흘러 들어가는 모션'
  };

  function initialize() {
    const mounts = document.querySelectorAll('[data-core-motion]:not([data-core-motion-ready])');
    const frames = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameRequest = 0;
    let previousTime = null;

    mounts.forEach(function (mount) {
      const kind = mount.getAttribute('data-core-motion');
      if (!MOTIONS[kind]) return;

      const svg = mount.localName === 'svg' ? mount : document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 300 300');
      if (mount.getAttribute('aria-hidden') === 'true') {
        svg.setAttribute('aria-hidden', 'true');
      } else {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', mount.getAttribute('aria-label') || LABELS[kind]);
      }
      svg.setAttribute('focusable', 'false');
      if (mount !== svg) mount.appendChild(svg);
      mount.setAttribute('data-core-motion-ready', '');

      const render = MOTIONS[kind](svg);
      // A legible mid-motion still also serves as the reduced-motion version.
      const initialTime = kind === 'fun' ? 0.48 : 1.2;
      const frame = { mount, render, elapsed: initialTime, visible: false };
      render(initialTime);
      frames.push(frame);
    });

    if (!frames.length) return;

    function canAnimate() {
      return !reducedMotion.matches && !document.hidden && frames.some(function (frame) {
        return frame.visible && frame.mount.isConnected;
      });
    }

    function stop() {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      previousTime = null;
    }

    function tick(now) {
      frameRequest = 0;
      if (!canAnimate()) {
        previousTime = null;
        return;
      }
      const delta = previousTime === null ? 0 : Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      frames.forEach(function (frame) {
        if (!frame.visible || !frame.mount.isConnected) return;
        frame.elapsed += delta;
        frame.render(frame.elapsed);
      });
      frameRequest = requestAnimationFrame(tick);
    }

    function syncPlayback() {
      if (!canAnimate()) {
        stop();
        return;
      }
      if (!frameRequest) frameRequest = requestAnimationFrame(tick);
    }

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          const frame = frames.find(function (item) { return item.mount === entry.target; });
          if (frame) frame.visible = entry.isIntersecting;
        });
        syncPlayback();
      }, { threshold: 0 });
      frames.forEach(function (frame) { observer.observe(frame.mount); });
    } else {
      frames.forEach(function (frame) { frame.visible = true; });
      syncPlayback();
    }

    document.addEventListener('visibilitychange', syncPlayback);
    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener('change', syncPlayback);
    } else {
      reducedMotion.addListener(syncPlayback);
    }
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', syncPlayback);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
