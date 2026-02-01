/**
 * Common Scripts for Portfolio
 * - Jelly Cursor Animation
 * - Header Scroll Interaction
 * - Common UI Interactions
 */

document.addEventListener('DOMContentLoaded', () => {

    // =================================================================
    // 1. HEADER SCROLL LOGIC
    // =================================================================
    const initHeader = () => {
        const header = document.getElementById('global-header');
        if (!header) return; // 헤더가 없는 페이지(404 등) 예외 처리

        let lastScrollY = 0;

        const updateHeader = () => {
            const currentScrollY = window.scrollY;

            // 1) 맨 꼭대기인지 확인 (투명 배경 vs 블러 배경)
            if (currentScrollY <= 10) {
                header.classList.add('at-top');
            } else {
                header.classList.remove('at-top');
            }

            // 2) 스크롤 방향에 따라 숨기기/보이기
            // 100px 이상 내려갔을 때만 동작
            if (currentScrollY > 100) {
                if (currentScrollY > lastScrollY) {
                    // 아래로 스크롤 중 -> 헤더 숨김
                    header.classList.add('header-hidden');
                } else {
                    // 위로 스크롤 중 -> 헤더 보임
                    header.classList.remove('header-hidden');
                }
            } else {
                // 상단 부근에서는 항상 보임
                header.classList.remove('header-hidden');
            }

            // 음수 스크롤 방지 (iOS 바운스 등)
            lastScrollY = currentScrollY <= 0 ? 0 : currentScrollY;
        };

        window.addEventListener('scroll', updateHeader, { passive: true });
        updateHeader(); // 초기 로드 시 한 번 실행
    };

    initHeader();


    // =================================================================
    // 2. JELLY CURSOR LOGIC
    // =================================================================
    const initCursor = () => {
        const cursorBgLayer = document.getElementById('cursor-bg-layer');
        const cursorCircle = document.getElementById('cursor-circle'); 
        const cursorTextLayer = document.getElementById('cursor-text-layer');
        const cursorText = document.getElementById('cursor-text');
        
        // 커서 요소가 없으면 실행 안 함 (모바일 등)
        if (!cursorBgLayer || !cursorCircle) return;

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        
        // 커서 원의 현재 위치 (Lerp용)
        let cursorX = mouseX;
        let cursorY = mouseY;
        
        let velX = 0;
        let velY = 0;

        // 마우스 위치 업데이트
        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        // 애니메이션 루프
        const animateCursor = () => {
            // 1. Follow Logic (Ease를 0.08로 설정하여 부드러운 뒤따름 효과)
            const ease = 0.08; 
            const nextX = cursorX + (mouseX - cursorX) * ease;
            const nextY = cursorY + (mouseY - cursorY) * ease;
            
            // 2. 속도 계산 (현재 위치와 다음 위치의 차이)
            velX = nextX - cursorX;
            velY = nextY - cursorY;
            
            cursorX = nextX;
            cursorY = nextY;
            
            // 3. Squash & Stretch (속도에 비례하여 찌그러짐)
            const dist = Math.sqrt(velX * velX + velY * velY);
            const angle = Math.atan2(velY, velX); // 이동 방향 각도
            
            // 속도가 빠를수록 길어짐 (최대 0.6배까지 늘어남)
            const stretch = Math.min(dist * 0.15, 0.6); 
            
            // X축(진행방향)은 늘리고, Y축(수직)은 줄여서 부피 유지
            const scaleX = 1 + stretch;      
            const scaleY = 1 - stretch * 0.4; 
            
            // 4. Transform 적용
            // 위치 이동 (translate3d로 GPU 가속 유도)
            const translate = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
            
            cursorBgLayer.style.transform = translate;
            if (cursorTextLayer) cursorTextLayer.style.transform = translate;
            
            // 원 변형 (회전 + 스케일)
            cursorCircle.style.transform = `rotate(${angle}rad) scale(${scaleX}, ${scaleY})`;

            requestAnimationFrame(animateCursor);
        };
        
        animateCursor();

        // 5. Hover Interaction (마우스 오버 효과)
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.hover-trigger, a, button, .work-item');

            if (target) {
                // 기본적으로 커서 배경(원)을 키움
                cursorBgLayer.classList.add('active-enter');
                
                // 상황별 텍스트 처리
                if (cursorTextLayer && cursorText) {
                    // 1) Work Item인 경우
                    if (target.closest('.work-item')) {
                        // 텍스트 영역(.work-meta) 위에서는 글자 숨김, 썸네일 위에서는 "View"
                        if (e.target.closest('.work-meta')) {
                            cursorTextLayer.classList.remove('active-enter');
                            cursorText.innerText = "";
                        } else {
                            cursorTextLayer.classList.add('active-enter');
                            cursorText.innerText = "View";
                        }
                    } 
                    // 2) Dock Button인 경우 (텍스트 없이 원만 커짐)
                    else if (target.closest('.dock-btn')) {
                        cursorTextLayer.classList.remove('active-enter');
                        cursorText.innerText = "";
                    } 
                    // 3) 그 외 일반 버튼/링크 (텍스트 없이 원만 커짐)
                    else {
                        cursorTextLayer.classList.remove('active-enter');
                        cursorText.innerText = "";
                    }
                }
            } else {
                // 호버 해제 시 원상복구
                cursorBgLayer.classList.remove('active-enter');
                if (cursorTextLayer) cursorTextLayer.classList.remove('active-enter');
            }
        });
    };

    initCursor();

});