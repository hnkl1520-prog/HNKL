'use client';

// 스크롤 등장 애니메이션. 원본에서 107번 쓰인다.
//
// 원본(vibra.html)은 이렇게 돌아간다:
//   .reveal { opacity: 0; transform: translateY(40px); }   ← CSS 초기값
//   IntersectionObserver(threshold 0.15) 로 화면에 들어오면
//   gsap.to(el, { opacity: 1, y: 0, duration: 1.0, ease: 'power3.out' })
//   한 번 실행하고 unobserve — 다시 올라가도 되감기지 않는다.
//
// 감싸는 <div> 를 새로 만들지 않는다. 원본 CSS 에 `.vb-grid--2-1-1 > .reveal`
// 처럼 부모-자식 관계를 따지는 규칙이 있어서, 태그가 하나 끼면 무너진다.
// 그래서 as 로 받은 태그 자체에 클래스를 붙인다.
//
//   <Reveal as="h2" className="vb-title">제목</Reveal>
//   → <h2 class="vb-title reveal">제목</h2>

import { useCallback } from 'react';
import gsap from 'gsap';

// 107개가 각자 관찰자를 만들 필요는 없으므로 하나를 나눠 쓴다.
// 마지막 요소가 사라지면 정리한다(쓰는 곳 수를 세서 관리).
let io = null;
let users = 0;

function acquire() {
    if (!io) {
        io = new IntersectionObserver((entries, obs) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                gsap.to(entry.target, { opacity: 1, y: 0, duration: 1.0, ease: 'power3.out' });
                obs.unobserve(entry.target);   // 한 번만
            }
        }, { threshold: 0.15 });
    }
    users++;
    return io;
}

function release() {
    if (--users <= 0 && io) {
        io.disconnect();
        io = null;
        users = 0;
    }
}

/** 요소 하나를 등장 애니메이션에 등록하는 ref 를 준다. */
export function useRevealRef() {
    // React 19 는 ref 콜백이 돌려준 함수를 정리용으로 써준다.
    return useCallback((node) => {
        if (!node) return;
        const obs = acquire();
        obs.observe(node);
        return () => {
            obs.unobserve(node);
            gsap.killTweensOf(node);   // 진행 중이던 애니메이션도 멈춘다
            release();
        };
    }, []);
}

export default function Reveal({ as: Tag = 'div', className, children, ...rest }) {
    const ref = useRevealRef();
    return (
        <Tag ref={ref} className={className ? `${className} reveal` : 'reveal'} {...rest}>
            {children}
        </Tag>
    );
}
