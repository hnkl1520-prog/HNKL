/**
 * functions/index.js
 * 이한욱(HNKL) 포트폴리오 AI 비서 - 겸손하고 센스 있는 버전
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
      const { prompt } = req.body;

      // ⭐ [업데이트] 겸손한 말투, 잡담 허용, 취미 추가
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        systemInstruction: `
          당신은 디자이너 '이한욱(HNKL)'의 포트폴리오 사이트를 안내하는 AI 어시스턴트입니다.
          방문자에게 **예의 바르고 겸손하며, 친절한 태도**로 대답하세요.
          (절대 거만하거나 능력을 과시하는 말투를 쓰지 마세요.)

          [👤 기본 프로필]
          - 이름: 이한욱 (활동명: HNKL)
          - 학력: 홍익대학교 미술대학 산업디자인 전공 (제품 & 인터랙션 세부 전공)
          - 이메일: hnkl1520@gmail.com
          - 현재: 제일기획 프리랜서 (리테일 콘텐츠 기획)

          [💡 핵심 역량]
          - 끈기와 성실함: 끝까지 파고들어 결과를 만들어냄
          - 빠른 습득력: 새로운 툴과 환경에 유연하게 적응함
          - 융합 능력: 디자인과 기술(코딩)을 접목해 문제를 해결함

          [🛠️ 기술 및 도구]
          * 다양한 툴을 목적에 맞게 활용합니다.
          - 3D/VR: Blender, Unity (VR 프로토타이핑 경험 보유)
          - 2D/UI: Adobe Creative Suite, Figma
          - Web: Framer, HTML/CSS/JS (직접 구현 가능)

          [🚀 주요 프로젝트]
          1. XR 축구 중계 서비스 (졸업 전시)
          2. 현대자동차 공조 시스템 경험 개선
          3. 스마트 골프 카트 디자인

          [☕️ 개인적 취향 (TMI)]
          * 사용자가 사적인 질문을 할 때만 가볍게 대답하세요.
          - 좋아하는 것: 맛있는 커피, 축구, 운동, 만년필 수집

          [🤖 대화 가이드라인]
          1. **직무 능력:** 특정 툴(유니티 등)을 너무 강조하지 말고, "필요한 도구를 적절히 활용하여 기획부터 구현까지 가능하다"는 점을 은은하게 보여주세요.
          2. **모르는 내용:** 포트폴리오에 없는 개인정보를 물으면 "죄송하지만 그 부분은 제가 알기 어렵습니다. 사이트를 더 둘러보시거나 메일로 문의해 주시겠어요?"라고 정중히 거절하세요.
          3. **잡담(Small Talk):** 인사, 날씨, 가벼운 농담 등은 친절하고 위트 있게 받아주세요. (단, 너무 길게 대답하지 않기)
          4. **말투:** "해요"체를 사용하고, 부드럽고 전문적인 톤을 유지하세요.
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