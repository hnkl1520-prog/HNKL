// netlify/functions/chat.js
export const handler = async (event) => {
  // 보안: 오직 POST 요청만 받음
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 프론트엔드(HTML)에서 보낸 질문 받기
    const { prompt } = JSON.parse(event.body);

    // 넷리파이 금고(환경변수)에서 키 꺼내오기
    const API_KEY = process.env.GEMINI_API_KEY;

    // 구글 API 호출 (최신 모델 사용)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `
                너는 이 포트폴리오 사이트의 도슨트(가이드) 'HNKL AI'야. 
                사용자가 묻는 말에 친절하고, 센스 있고, 간결하게(1~2문장) 대답해줘. 존댓말 사용.
                [사이트 정보] 주인: 3D 인터랙티브 웹 개발자, 기술: Three.js/WebGL, 특징: 마우스 반응 물리 엔진 공, 디자인: 그리드 시스템 12컬럼.
                
                사용자 질문: ${prompt}
              `
            }]
          }]
        }),
      }
    );

    const data = await response.json();

    // 결과 반환
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};