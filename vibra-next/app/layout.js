// 원본 vibra.html 의 <head> 를 그대로 옮긴 것.
//
// CSS 를 import 하지 않고 <link> 로 거는 이유:
//   1) 원본 CSS 안의 url(media/hero.jpg) 가 원본과 똑같은 방식(상대경로)으로 풀린다.
//   2) Next 의 CSS 번들러를 안 거치므로 한 글자도 안 바뀐 채로 전달된다.
// 순서도 원본과 동일해야 한다: Pretendard → common.css → vibra.css

export const metadata = {
    title: 'VIBRA — XR Football Broadcasting Platform',
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
};

import JellyCursor from '../components/JellyCursor';
import GlobalHeader from '../components/GlobalHeader';

export default function RootLayout({ children }) {
    return (
        <html lang="ko">
            <head>
                {/* Pretendard Font — 원본과 같은 CDN·버전 */}
                <link
                    rel="stylesheet"
                    as="style"
                    crossOrigin="anonymous"
                    href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
                />
                {/* 공통 스타일 (전역 헤더 + 젤리 커서) */}
                <link rel="stylesheet" href="/common.css" />
                {/* 페이지 전용 스타일 — vibra.html <style> 블록 원문 */}
                <link rel="stylesheet" href="/vibra.css" />
            </head>
            <body>
                {/* 원본 body 첫머리 순서 그대로: 커서 → 헤더 → 본문 */}
                <JellyCursor />
                <GlobalHeader />
                {children}
            </body>
        </html>
    );
}
