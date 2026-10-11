const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepare,normalize,respond,MODEL}=require('../functions/guide.cjs');
test('rejects empty, malformed and oversized questions',()=>{
 for(const body of [null,{}, {prompt:''},{prompt:42},{prompt:'x'.repeat(2001)}]) assert.throws(()=>prepare(body),{status:400});
});
test('uses trusted current section details and bounded history',()=>{
 const payload=prepare({prompt:'이 로고는?',page:{path:'/works/projects/hnkl/hnkl.html',section:'logo',title:'UNTRUSTED'},history:Array.from({length:12},()=>({role:'user',text:'x'.repeat(2100)}))});
 const system=payload.systemInstruction.parts[0].text;
 assert.match(system,/"section":"로고"/); assert.doesNotMatch(system,/UNTRUSTED/);
 assert.equal(payload.contents.length,9); assert.equal(payload.contents[0].parts[0].text.length,2000);
 assert.match(prepare({prompt:'hi',page:{path:'/unknown',section:'evil'}}).systemInstruction.parts[0].text,/확인되지 않은 페이지/);
});
test('only returns unique known destinations and preserves old client response',()=>{
 const out=normalize({candidates:[{content:{parts:[{text:JSON.stringify({reply:'로고입니다.',destinations:['hnkl-logo','https://evil.test','hnkl-logo','labs']})}]}}]});
 assert.deepEqual(out.actions.map(a=>a.href),['/works/projects/hnkl/hnkl.html#logo','/works.html?category=labs']);
 assert.equal(out.candidates[0].content.parts[0].text,out.reply); assert.equal(out.model,MODEL);
 assert.throws(()=>normalize({candidates:[]}));
});
test('calls selected model, keeps credentials in headers, hides upstream error body',async()=>{
 await respond({prompt:'hello'},'test-key',async(url,options)=>{
   assert.match(url,/gemini-3\.8-flash:generateContent$/); assert.ok(!url.includes('test-key'));
   assert.equal(options.headers['x-goog-api-key'],'test-key');
   assert.equal(JSON.parse(options.body).generationConfig.responseMimeType,'application/json');
   return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"reply":"hello","destinations":[]}'}]}}]})};
 });
 await assert.rejects(()=>respond({prompt:'hello'},'test-key',async()=>({ok:false,status:429})),{message:'Model request failed',upstreamStatus:429});
});
