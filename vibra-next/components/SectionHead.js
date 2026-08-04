'use client';

// 섹션 머리말. 원본에서 11번 반복되는 묶음이다.
//
//   <span class="vb-eyebrow reveal">Background</span>
//   <h2 class="vb-title reveal">축구 중계, 그 다음은?</h2>
//   <p class="bg-desc reveal">…</p>
//
// 설명 문단의 클래스가 섹션마다 다르고(bg-desc / tg-desc / vb-body),
// 제목 안에 <span> 으로 색을 다르게 준 곳도 있어서 둘 다 밖에서 넘길 수 있게 뒀다.
// 셋 다 없으면 그 줄은 아예 안 그린다 — 원본에도 없는 빈 태그를 만들지 않기 위해서.

import Reveal from './Reveal';

export default function SectionHead({
    eyebrow,
    title,
    desc,
    titleClassName = 'vb-title',
    descClassName = 'vb-body',
}) {
    return (
        <>
            {eyebrow && <Reveal as="span" className="vb-eyebrow">{eyebrow}</Reveal>}
            {title && <Reveal as="h2" className={titleClassName}>{title}</Reveal>}
            {desc && <Reveal as="p" className={descClassName}>{desc}</Reveal>}
        </>
    );
}
