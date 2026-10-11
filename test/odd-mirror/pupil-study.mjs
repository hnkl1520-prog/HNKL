import path from 'node:path';
import {launch,ROOT} from './chrome.mjs';
const b=await launch();
try{
  const p=await b.open('/test/odd-mirror/pupil-study.html',{width:1080,height:1000});
  await p.waitFor('window.__done');
  await p.send('Emulation.setDeviceMetricsOverride',{width:1080,height:await p.eval('document.body.scrollHeight'),deviceScaleFactor:1,mobile:false});
  await p.screenshot(path.join(ROOT,'test/odd-mirror/results/pupil-study-page.png'));
  const errors=p.logs.filter(s=>/exception|\[error\]/i.test(s)&&!/favicon/.test(s));if(errors.length)throw Error(errors.join('\n'));
  console.log('동공 비교 시트 저장. 실제 카메라 앱은 변경하지 않았습니다.');
}finally{await b.close();}
