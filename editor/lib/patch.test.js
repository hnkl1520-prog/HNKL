// patch.js 검증. 실행: node lib/patch.test.js
import { patchInlineStyle, patchCssRule, parseStyle, stringifyStyle } from './patch.js';

let pass = 0, fail = 0;
function check(name, actual, expected) {
    const ok = actual === expected;
    if (ok) { pass++; console.log(`  OK   ${name}`); }
    else {
        fail++;
        console.log(`  FAIL ${name}`);
        console.log(`       기대: ${JSON.stringify(expected)}`);
        console.log(`       실제: ${JSON.stringify(actual)}`);
    }
}
function checkThrows(name, fn) {
    try { fn(); fail++; console.log(`  FAIL ${name} (예외가 안 남)`); }
    catch { pass++; console.log(`  OK   ${name}`); }
}

const SAMPLE = `<!doctype html>
<html>
<head>
<style>
    :root { --vb-s: 1; --fs-body: 18px; }
    .card {
        margin-bottom: 56px;
        padding: clamp(20px, 2.2vw, 28px) 14px;
    }
    .card, .other { color: red; }
    @media (min-width: 1024px) {
        .card { margin-bottom: 24px; }
    }
</style>
</head>
<body>
<main>
    <section class="a">
        <h2 style="font-size: 1.125rem; color: blue;">제목</h2>
        <p>본문</p>
        <img src="x.png" alt="" />
    </section>
    <section class="b"><div><span>깊은 요소</span></div></section>
</main>
</body>
</html>`;

console.log('\n[1] style 문자열 파싱/직렬화');
check('파싱', JSON.stringify(parseStyle('a: 1px; b:2px')), JSON.stringify({ a: '1px', b: '2px' }));
check('빈 값', JSON.stringify(parseStyle('')), '{}');
check('직렬화', stringifyStyle({ a: '1px', b: '2px' }), 'a: 1px; b: 2px');

// 경로: html(0) > body(1) > main(0) > section.a(0) > h2(0)
// head=0, body=1 이므로 [1,0,0,0]
console.log('\n[2] 기존 인라인 style 수정');
{
    const r = patchInlineStyle(SAMPLE, [1, 0, 0, 0], { 'font-size': '2rem' });
    check('값이 바뀜', r.text.includes('style="font-size: 2rem; color: blue"'), true);
    check('다른 부분 그대로', r.text.includes('<p>본문</p>'), true);
    check('길이 변화가 국소적', Math.abs(r.text.length - SAMPLE.length) < 20, true);
}

console.log('\n[3] 속성 추가 (style 없는 요소)');
{
    // p 요소 = section.a 의 두 번째 자식
    const r = patchInlineStyle(SAMPLE, [1, 0, 0, 1], { 'margin-top': '8px' });
    check('새 속성 삽입', r.text.includes('<p style="margin-top: 8px">본문</p>'), true);
}

console.log('\n[4] 자기닫는 태그(img)');
{
    const r = patchInlineStyle(SAMPLE, [1, 0, 0, 2], { 'width': '100%' });
    check('/> 앞에 삽입', r.text.includes('style="width: 100%"/>') || r.text.includes('style="width: 100%" />'), true);
}

console.log('\n[5] 속성 삭제');
{
    const r = patchInlineStyle(SAMPLE, [1, 0, 0, 0], { 'font-size': null, 'color': null });
    check('style 속성 자체가 사라짐', r.text.includes('<h2>제목</h2>'), true);
}

console.log('\n[6] 깊이 중첩된 요소');
{
    // main(0) > section.b(1) > div(0) > span(0)
    const r = patchInlineStyle(SAMPLE, [1, 0, 1, 0, 0], { 'color': 'green' });
    check('중첩 요소 수정', r.text.includes('<span style="color: green">깊은 요소</span>'), true);
}

console.log('\n[7] CSS 규칙 수정');
{
    const r = patchCssRule(SAMPLE, '.card', 'margin-bottom', '80px');
    // 같은 선택자가 @media 안에도 있음 → 뒤에 오는 것(=미디어쿼리 안)이 선택되어야 함
    check('마지막 규칙이 바뀜', r.text.includes('.card { margin-bottom: 80px; }'), true);
    check('앞 규칙은 그대로', r.text.includes('margin-bottom: 56px;'), true);
}

console.log('\n[8] 값에 괄호/쉼표가 있는 속성');
{
    const r = patchCssRule(SAMPLE, '.card', 'padding', '10px 5px');
    check('clamp() 값 교체', r.text.includes('padding: 10px 5px;'), true);
}

console.log('\n[9] 쉼표로 묶인 선택자');
{
    const r = patchCssRule(SAMPLE, '.other', 'color', 'blue');
    check('.card, .other 에서 찾음', r.text.includes('.card, .other { color: blue; }'), true);
}

console.log('\n[10] 규칙에 없는 속성 새로 추가');
{
    // .card 는 padding 을 한 줄로 쓰므로 padding-top 이 따로 없다 → 새로 삽입되어야 함
    const r = patchCssRule(SAMPLE, '.card', 'padding-top', '30px');
    check('삽입 방식', r.mode, 'insert');
    check('규칙 안에 추가됨', /\.card \{[\s\S]*padding-top: 30px;[\s\S]*\}/.test(r.text), true);
    check('기존 선언 유지', r.text.includes('margin-bottom: 56px;'), true);
    // 들여쓰기를 주변과 맞췄는지
    check('들여쓰기 유지', r.text.includes('\n        padding-top: 30px;'), true);
}
{
    // 한 줄짜리 규칙에 추가
    const r = patchCssRule(SAMPLE, '.other', 'font-weight', '700');
    check('한 줄 규칙에 추가', r.text.includes('color: red; font-weight: 700;'), true);
}
{
    // 삽입 후에도 정상 CSS 인지 (다시 찾아서 바꿀 수 있어야 함)
    const once = patchCssRule(SAMPLE, '.card', 'padding-top', '30px').text;
    const twice = patchCssRule(once, '.card', 'padding-top', '40px');
    check('추가한 속성을 다시 수정', twice.mode, 'replace');
    check('값이 바뀜', twice.text.includes('padding-top: 40px;'), true);
}

console.log('\n[11] 실패 상황');
checkThrows('없는 경로', () => patchInlineStyle(SAMPLE, [1, 0, 9, 9], { a: 'b' }));
checkThrows('없는 선택자', () => patchCssRule(SAMPLE, '.nope', 'color', 'red'));
checkThrows('없는 선택자 (삽입 허용해도 실패)', () => patchCssRule(SAMPLE, '.nope', 'color', 'red', { insertIfMissing: true }));
check('삽입 끄면 예외', (() => {
    try { patchCssRule(SAMPLE, '.card', 'z-index', '1', { insertIfMissing: false }); return false; }
    catch { return true; }
})(), true);

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
