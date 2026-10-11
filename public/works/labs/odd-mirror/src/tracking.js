// 얼굴 추론과 화면 그리기를 분리한다. 최신 프레임 하나만 처리하며 대기열을 쌓지 않는다.
const OddTracking=(()=>{
  async function workerMain(mpBase,model,cpu,moduleMode){
    let tracker;
    try{
      const {FilesetResolver,FaceLandmarker}=await import(mpBase+'/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(mpBase+'/wasm',moduleMode);
      const make=delegate=>FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:model,delegate},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,
        ...(delegate==='GPU'?{canvas:new OffscreenCanvas(1,1)}:{})
      });
      let delegate=cpu?'CPU':'GPU';
      try{tracker=await make(delegate);}catch{delegate='CPU';tracker=await make(delegate);}
      self.postMessage({type:'ready',delegate});
    }catch(e){self.postMessage({type:'failed',message:String(e)});return;}
    self.onmessage=({data:d})=>{
      if(d.type!=='frame')return;
      const started=performance.now();
      try{self.postMessage({type:'result',result:tracker.detectForVideo(d.bitmap,d.at),at:d.at,ms:performance.now()-started});}
      catch(e){self.postMessage({type:'failed',message:String(e)});}
      finally{d.bitmap.close();}
    };
  }
  function create({mpBase,model,cpu=false,onResult,onError,signal}){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new Error('cancelled'));return;}
      const url=URL.createObjectURL(new Blob([`(${workerMain})(${JSON.stringify(mpBase)},${JSON.stringify(model)},${cpu},${location.protocol!=='file:'})`],{type:'text/javascript'}));
      let worker;
      try{worker=new Worker(url,{type:location.protocol==='file:'?'classic':'module'});}catch(e){URL.revokeObjectURL(url);reject(e);return;}
      let closed=false,ready=false,busy=false,lastAt=-Infinity,pendingAt=0;
      const cleanup=()=>{if(closed)return;closed=true;clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);signal?.removeEventListener('abort',abort);};
      const fail=e=>{cleanup();if(ready)onError?.(e);else reject(e);};
      const abort=()=>{cleanup();if(!ready)reject(new Error('cancelled'));};
      const timer=setTimeout(()=>fail(new Error('얼굴 분석 준비 시간 초과')),25000);
      signal?.addEventListener('abort',abort,{once:true});
      const handle={mode:'worker',delegate:null,ms:0,get busy(){return busy;},get pendingAt(){return pendingAt;},close:cleanup,
        request(video,at){
          if(closed||!ready||busy||at-lastAt<Math.max(40,handle.ms*.65))return false;
          busy=true;lastAt=at;pendingAt=at;
          const width=Math.min(640,video.videoWidth),height=Math.round(video.videoHeight*width/video.videoWidth);
          createImageBitmap(video,{resizeWidth:width,resizeHeight:height}).then(bitmap=>{
            if(closed){bitmap.close();return;}
            worker.postMessage({type:'frame',bitmap,at},[bitmap]);
          }).catch(fail);
          return true;
        }
      };
      worker.onerror=e=>fail(new Error(e.message||'얼굴 분석 워커 오류'));
      worker.onmessage=({data:d})=>{
        if(closed)return;
        if(d.type==='ready'){clearTimeout(timer);ready=true;handle.delegate=d.delegate;resolve(handle);}
        else if(d.type==='result'){busy=false;handle.ms=d.ms;onResult(d.result,d.at,d.ms);}
        else if(d.type==='failed')fail(new Error(d.message));
      };
    });
  }
  return {create};
})();
