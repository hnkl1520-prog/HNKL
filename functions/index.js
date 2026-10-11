const functions = require('firebase-functions');
const cors = require('cors')({origin:true});
require('dotenv').config();
const {respond} = require('./guide.cjs');
exports.chat = functions.https.onRequest((req,res) => {
  cors(req,res,async()=>{
    if(req.method!=='POST') return res.status(405).send('Method Not Allowed');
    res.set('Cache-Control','no-store');
    try { return res.status(200).json(await respond(req.body,process.env.GEMINI_API_KEY)); }
    catch(error) {
      console.error('Chat request failed',{type:error.name,status:error.upstreamStatus||error.status||500});
      return res.status(error.status===400?400:502).json({error:error.status===400?error.message:'답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'});
    }
  });
});
