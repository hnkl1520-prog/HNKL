import SectionHead from '../components/SectionHead';

// 2단계: 공용 부품(Reveal · SectionHead)과 레이아웃(헤더 · 젤리 커서) 확인용.
// 원본 vibra.html 1581~1589행 "Task & Goal" 섹션을 그대로 옮겼다.
// 머리말만 있는 가장 단순한 섹션이라 부품이 맞게 도는지 보기에 적당하다.
//
// 나머지 섹션은 3단계부터 순서대로 채운다.

export default function Page() {
    return (
        <main>
            {/* 헤더가 스크롤에 반응하는지 보려면 스크롤 여지가 필요하다.
                3단계에서 히어로가 들어오면 지운다. */}
            <div style={{ height: '100vh' }} aria-hidden />

            <section className="vb-section tg-section">
                <div className="vb-wrap">
                    <div className="tg-head">
                        <SectionHead
                            eyebrow="Task & Project Goal"
                            title="그렇다면, 무엇을 제공해야 하는가?"
                            desc="XR 기반 중계는 압도적인 현장감과 몰입을 약속합니다. 하지만 경쟁력 있고 지속 가능한 서비스가 되려면 그 이상이 필요합니다. 이 프로젝트는 미래의 XR 축구 중계 플랫폼이 제공해야 할 가치와 기능을 사용자 니즈 중심으로 탐구했습니다."
                            descClassName="tg-desc"
                        />
                    </div>
                </div>
            </section>

            <div style={{ height: '60vh' }} aria-hidden />
        </main>
    );
}
