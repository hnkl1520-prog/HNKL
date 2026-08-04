'use client';

// 젤리 커서. 원본 common.js 의 initCursor 를 그대로 옮긴 것.
// 마크업은 vibra.html 1390~1391행, 스타일은 common.css.
//
// 리액트로 옮기면서 바뀐 점은 '정리'뿐이다.
// 원본은 rAF 루프가 페이지가 살아있는 내내 무한히 돈다. 리액트에서는
// 화면을 벗어날 때 루프와 이벤트를 반드시 끊어야 한다. 안 그러면
// 사라진 DOM 을 계속 만지면서 루프가 남는다.

import { useEffect, useRef } from 'react';

export default function JellyCursor() {
    const bgRef = useRef(null);
    const circleRef = useRef(null);
    const textLayerRef = useRef(null);
    const textRef = useRef(null);

    useEffect(() => {
        const cursorBgLayer = bgRef.current;
        const cursorCircle = circleRef.current;
        const cursorTextLayer = textLayerRef.current;
        const cursorText = textRef.current;
        if (!cursorBgLayer || !cursorCircle) return;

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;

        // 커서 원의 현재 위치 (Lerp용)
        let cursorX = mouseX;
        let cursorY = mouseY;
        let velX = 0;
        let velY = 0;

        const onMouseMove = (e) => { mouseX = e.clientX; mouseY = e.clientY; };

        const onMouseOver = (e) => {
            const target = e.target.closest('.hover-trigger, a, button, .work-item');

            if (target) {
                // 기본적으로 커서 배경(원)을 키움
                cursorBgLayer.classList.add('active-enter');

                if (cursorTextLayer && cursorText) {
                    // 1) Work Item — 썸네일 위에서는 "View", 텍스트 영역에서는 숨김
                    if (target.closest('.work-item')) {
                        if (e.target.closest('.work-meta')) {
                            cursorTextLayer.classList.remove('active-enter');
                            cursorText.innerText = '';
                        } else {
                            cursorTextLayer.classList.add('active-enter');
                            cursorText.innerText = 'View';
                        }
                    }
                    // 2) Dock Button / 3) 그 외 링크·버튼 — 원만 커짐
                    else {
                        cursorTextLayer.classList.remove('active-enter');
                        cursorText.innerText = '';
                    }
                }
            } else {
                cursorBgLayer.classList.remove('active-enter');
                if (cursorTextLayer) cursorTextLayer.classList.remove('active-enter');
            }
        };

        let raf = 0;
        const animateCursor = () => {
            // 1. 뒤따라오기 (ease 0.1)
            const ease = 0.1;
            const nextX = cursorX + (mouseX - cursorX) * ease;
            const nextY = cursorY + (mouseY - cursorY) * ease;

            // 2. 속도 = 현재 위치와 다음 위치의 차이
            velX = nextX - cursorX;
            velY = nextY - cursorY;
            cursorX = nextX;
            cursorY = nextY;

            // 3. 속도에 비례해 찌그러짐 (최대 0.6배까지 늘어남)
            const dist = Math.sqrt(velX * velX + velY * velY);
            const angle = Math.atan2(velY, velX);
            const stretch = Math.min(dist * 0.15, 0.6);
            const scaleX = 1 + stretch;          // 진행방향은 늘리고
            const scaleY = 1 - stretch * 0.4;    // 수직은 줄여서 부피 유지

            // 4. 적용 (translate3d 로 GPU 가속 유도)
            const translate = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
            cursorBgLayer.style.transform = translate;
            if (cursorTextLayer) cursorTextLayer.style.transform = translate;
            cursorCircle.style.transform = `rotate(${angle}rad) scale(${scaleX}, ${scaleY})`;

            raf = requestAnimationFrame(animateCursor);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseover', onMouseOver);
        raf = requestAnimationFrame(animateCursor);

        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseover', onMouseOver);
        };
    }, []);

    return (
        <>
            <div id="cursor-bg-layer" ref={bgRef}><div id="cursor-circle" ref={circleRef} /></div>
            <div id="cursor-text-layer" ref={textLayerRef}><span id="cursor-text" ref={textRef} /></div>
        </>
    );
}
