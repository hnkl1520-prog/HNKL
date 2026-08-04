'use client';

// 전역 헤더. 원본 vibra.html 1394~1411행 마크업 그대로.
// 스타일은 common.css 가 담당한다.
//
// 동작(원본 common.js 의 initHeader):
//   - 맨 위(10px 이내)면 at-top   → 배경 투명
//   - 100px 넘게 내려간 뒤 아래로 스크롤하면 header-hidden → 헤더 숨김
//   - 위로 올리면 다시 보임
//
// 링크는 원본 사이트의 다른 페이지를 가리킨다. 이번 전환 범위는 vibra 한 장이라
// 이 프로젝트 안에는 그 페이지들이 없다(눌러도 안 열림).

import { useEffect, useRef } from 'react';

export default function GlobalHeader() {
    const ref = useRef(null);

    useEffect(() => {
        const header = ref.current;
        if (!header) return;

        let lastScrollY = 0;

        const updateHeader = () => {
            const y = window.scrollY;

            // 1) 맨 꼭대기인지 (투명 배경 vs 블러 배경)
            if (y <= 10) header.classList.add('at-top');
            else header.classList.remove('at-top');

            // 2) 스크롤 방향에 따라 숨기기/보이기 — 100px 이상 내려갔을 때만
            if (y > 100) {
                if (y > lastScrollY) header.classList.add('header-hidden');
                else header.classList.remove('header-hidden');
            } else {
                header.classList.remove('header-hidden');
            }

            // 음수 스크롤 방지 (iOS 바운스 등)
            lastScrollY = y <= 0 ? 0 : y;
        };

        window.addEventListener('scroll', updateHeader, { passive: true });
        updateHeader();   // 처음 한 번

        return () => window.removeEventListener('scroll', updateHeader);
    }, []);

    return (
        <header id="global-header" className="at-top" ref={ref}>
            <div className="header-inner">
                <div className="header-left">
                    <a href="/index.html" className="header-logo hover-trigger">
                        <img src="/assets/logo.svg" alt="HANUK Logo" />
                    </a>
                    <nav className="header-nav">
                        <a href="/about.html" className="nav-link hover-trigger">About</a>
                        <a href="/works.html" className="nav-link active hover-trigger">Works</a>
                    </nav>
                </div>
                <div className="header-right">
                    <button className="lang-btn active hover-trigger">KR</button>
                    <span className="lang-divider">/</span>
                    <button className="lang-btn hover-trigger">EN</button>
                </div>
            </div>
        </header>
    );
}
