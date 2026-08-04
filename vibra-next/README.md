# vibra-next

`public/works/projects/vibra/vibra.html` (3051줄) 을 Next.js 로 옮기는 작업 폴더.

**원본은 건드리지 않는다.** 이 폴더는 원본을 읽기만 한다.

## 처음 받았을 때

```
npm install
scripts\link-media.cmd
npm run dev
```

`link-media.cmd` 는 원본 사이트의 미디어·공용 CSS 를 이 폴더로 **연결**한다.
복사가 아니라 바로가기(정션·하드링크)라 200MB 가 두 번 쌓이지 않고,
원본을 고치면 이쪽에도 그대로 반영된다. 관리자 권한은 필요 없다.

| 이 폴더 | → 실제 위치 |
|---|---|
| `public/media` | `../public/works/projects/vibra/media` |
| `public/assets` | `../public/assets` |
| `public/works/projects/vibra` | `../public/works/projects/vibra` (비교용 원본) |
| `public/common.css` | `../public/common.css` |
| `public/common.js` | `../public/common.js` |
| `lib/common.js` | `../public/common.js` |

## 원본과 화면 비교

`npm run dev` 만 띄우면 된다. 원본도 같은 서버에서 나온다.

```
http://localhost:3000/compare.html
```

원본을 굳이 이쪽 서버에서 서빙하는 이유: 포트가 다르면 브라우저가 남의
페이지로 막아서(`SecurityError`) 스크롤 위치를 읽을 수 없다. 같은 주소여야
좌우 스크롤이 붙는다.

- 좌우로 나란히 놓고 **스크롤이 같이** 움직인다
- **겹쳐보기** 를 켜면 두 화면을 포개서 차이를 색으로 드러낸다 — 검게 보이면 완전히 같다는 뜻
- 위쪽 슬라이더로 뷰포트 너비를 바꿔 반응형을 확인한다
- `R` 을 누르면 양쪽 새로고침

## CSS 를 손대지 않는 이유

원본 `<style>` 1367줄을 `public/vibra.css` 로 **한 글자도 안 고치고** 옮겼다.
`import` 대신 `<link>` 로 거는데, 그래야

1. CSS 안의 `url(media/hero.jpg)` 가 원본과 같은 방식(상대경로)으로 풀리고
2. Next 의 CSS 번들러를 안 거쳐 원문 그대로 전달된다

원본 CSS 가 바뀌면 다시 뽑는다:

```
node scripts/extract-css.mjs
```

## 진행 상황

- [x] 1단계 — 세팅 · CSS 이식 · 비교 도구
- [ ] 2단계 — 공용 컴포넌트 + 레이아웃(헤더·젤리 커서)
- [ ] 3단계 — Hero + Info (GSAP 1차)
- [ ] 4단계 — Background · Task&Goal · Process Timeline (GSAP 가로스크롤)
- [ ] 5단계 — 정량조사 · 정성조사
- [ ] 6단계 — Skybox · In Stadium · VIVA AI
- [ ] 7단계 — Interaction · Play Film · UI · Behind · Archive · Closing
- [ ] 8단계 — 원본 대조 · 정리
