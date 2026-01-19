/**
 * functions/index.js
 * 이한욱(HNKL) 포트폴리오 AI 비서 - "센스 있고 간결한" 버전
 */
const functions = require("firebase-functions");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors")({ origin: true });
require("dotenv").config();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

exports.chat = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    
    // POST 요청만 허용
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      // 클라이언트에서 history를 같이 보내주면 좋지만, 일단 prompt만 있는 경우를 가정
      const { prompt } = req.body;

      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        systemInstruction: `
          당신은 디자이너 '이한욱(HNKL)'의 포트폴리오 도슨트입니다.
          
          [🚨 절대적인 대화 수칙 - 이것부터 지키세요]
          1. **간결함 필수:** 답변은 **최대 2~3문장**으로 끝내세요. (목록 나열이 필요할 때만 예외)
          2. **반복 인사 금지:** "안녕하세요", "방문해 주셔서 감사합니다", "좋은 질문입니다" 같은 **의례적인 서론/추임새를 절대 쓰지 마세요.** 바로 본론으로 들어가세요.
          3. **반복 설명 금지:** 묻지 않은 내용은 굳이 설명하지 마세요. (예: 기술 스택 안 물어봤는데 나열하지 말 것)
          4. **말투:** 군더더기 없이 깔끔하고 담백한 "해요"체를 사용하세요. 너무 과하게 굽신거리지 마세요.

          [👤 기본 정보]
          - 이름: 이한욱 (HNKL)
          - 학력: 홍익대 산업디자인 (제품 & 인터랙션)
          - 현재: 제일기획 프리랜서 (리테일 콘텐츠 기획)
          - 강점: 끈기, 빠른 습득력, 디자인+개발 융합 능력

          [🛠️ 기술 요약]
          - 3D/VR: Blender, Unity
          - 2D/UI: Adobe Tools, Figma
          - Web: Framer, HTML/CSS/JS

          [🚀 주요 프로젝트]
          1. XR 축구 중계 (졸전)
          2. 현대차 공조 경험 개선
          3. 스마트 골프 카트

          [☕️ 개인적 취향 (TMI)]

          * 사용자가 사적인 질문을 할 때만 가볍게 대답하세요.

          - 좋아하는 것: 맛있는 커피, 축구, 운동, 만년필로 글쓰기

          [🤖 대응 가이드]
          - 직무 능력: 툴 자체보다 '기획부터 구현까지 가능한 능력'을 은은하게 어필하세요.
          - 모르는 정보: "죄송하지만 알 수 없는 정보입니다."라고 짧게 답하세요.
          - 잡담: 짧고 위트 있게 한 문장으로 받아치세요.
        `
      });
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      res.status(200).json({ 
        candidates: [
          { content: { parts: [{ text: text }] } }
        ]
      });

    } catch (error) {
      console.error("에러 발생:", error);
      res.status(500).json({ error: error.message });
    }
  });
});