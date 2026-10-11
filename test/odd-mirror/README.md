# Odd Mirror 검증 도구

앱은 `public/works/labs/odd-mirror/odd-mirror.html` 한 파일입니다. 여기 도구들은 앱 파일 속 `// ==== 이름 START/END ====` 구역을 그대로 떼어 와서 검사하므로, 앱 코드를 복사해 둔 사본이 따로 없습니다. (`public/` 은 배포되므로 검증 도구는 이 폴더에 둡니다.)

필요한 것: Node 20 이상, Google Chrome (헤드리스로 띄움). 외부 패키지 없음.

| 명령 | 무엇을 확인하나 | 모델·인터넷 |
| --- | --- | --- |
| `node test/odd-mirror/logic.test.mjs` | 좌표·정면화, 기본 형태, 부위별 신뢰도(각도·잘림·가림·흔들림·부위 관계), 입 벌림 연속성, 눈 흰 면 규칙, 헤어 정렬·잘림·전환 | 필요 없음 |
| `node test/odd-mirror/glasses.test.mjs` | 합성 영상으로 안경 판단의 기본 동작 (없음·그림자·둥근·사각·낮은 사각·얇은 테, 벗기). 약 2분 | 필요 없음 |
| `node test/odd-mirror/sheets.mjs` | 그림 확인 시트 → `results/sheet-*.png` (얼굴 비율, 표정, 입 연속, 흉상 구도, 눈, 헤어, 안경) | 필요 없음 |
| `node test/odd-mirror/photo.mjs` | 실제 MediaPipe 모델로 사진 한 장 처리 → `results/photo-real-model.png` | 필요 (모델 받음) |
| `node test/odd-mirror/app-flow.mjs <1280×720 BMP>` | 실제 앱 파일을 가짜 카메라로 열어 시작·권한 거부·다시 스캔(색 유지)·D 키·파일 직접 열기 | 필요 |

`app-flow.mjs` 용 카메라 그림은 macOS 기본 도구로 만들 수 있습니다.

```bash
node test/odd-mirror/camera-fixture.mjs
node test/odd-mirror/app-flow.mjs /private/tmp/odd-mirror-fixture-final.bmp
```

개발용 부품 비교는 `component-studio.html`에 보관합니다. 실제 사용자 페이지는 카메라 시작 화면으로 연결됩니다. `components-browser.mjs`는 얼굴·헤어 경계 576가지 조합과 따뜻한 입 안 색을 검사하고 최신 렌더링 시트를 저장합니다.

캐릭터 v4 검토:

- `node test/odd-mirror/expression-components.test.mjs`: 앱 표정 계산에서 실제 컴포넌트까지 찡그림·미소·비대칭·입술 누르기·윙크·연속성을 검증.
- `node test/odd-mirror/character-browser.mjs`: 직접 디자인한 8명, 동일 색 비교, 12표정, 눈 6종, 입 연속 시트, 통합 시작 화면을 `results/character-*.png`로 저장. 모든 눈의 감김·반감김·크게 뜨기를 픽셀로 검증.
- `character-study.html`: 모델 없이 보는 미술 검토용 시트. `?sheet=people|mono|expressions|eyes|mouth`. 카메라 진입 화면에 추가하지 않음.

`logic.test.mjs`의 이전 `eyeWhiteAmount`/`mouthGeometry` 검사는 옛 수치 모델의 검사입니다. 현재 그림 완성도 판단에는 실제 `OddComponents`를 쓰는 위 두 검사와 이미지 시트를 사용합니다.

### v6

- `expression-components.test.mjs`: Eww/가로 당김/거짓 웃음 점수/윗입술 비대칭 회귀 검사.
- `components.test.mjs`: 이마 노출·실제 앞머리·헤어라인 미관측의 서로 다른 부품 선택.
- `appearance.test.mjs`: 관측 수 없는 자동 완료 차단, 8초 이후 부분 결과, 4초 직접 진행.
- `app-flow.mjs <BMP> --http-only`: 로컬 모델로 시작·보정·재스캔·종료, 얼굴 워커와 렌더링 프레임 간격. `--gpu`는 일반 사용자와 같은 GPU 우선 경로입니다. 결과 JSON의 CPU/GPU와 입력 한계를 구분하세요.
- HTTP는 앱의 `vendor/`를 사용합니다. 파일 직접 열기는 CDN 대기와 브라우저 제한을 별도로 가집니다.
- 미술 시트는 Eww를 포함한 13표정으로 갱신했습니다.

## 한계 (이 도구로 검증되지 않는 것)

- 합성 얼굴·합성 영상은 알고리즘이 의도대로 움직이는지 보는 것이지, 실제 카메라 정확도 검증이 아닙니다.
- 사진 한 장(또는 그 사진을 반복하는 가짜 카메라)은 흔들림·조명 변화·움직임이 없어서 시간 안정성과 속도를 대표하지 못합니다.
- 헤드리스 크롬은 GPU 대신 소프트웨어로 돌아서 fps 수치는 실제 기기와 다릅니다.


## v5 전체 흐름

- `appearance.test.mjs`: 옷 대표 색·목선·어깨와 잘림, 시간만으로 확정하지 않는 스캔 게이트.
- `flow-resilience.mjs`: 카메라 권한 대기 중 취소와 늦은 스트림 해제.
- `app-flow.mjs`: 실제 헤어/옷 결과 수 확인, 낮은 신뢰도 보류 및 관객 선택, 헤어·안경·옷 보정, 원본 보기, 종료까지 포함합니다. 정지 사진을 반복하므로 실제 카메라 정확도/속도 검증은 아닙니다.
- `pupil-study.html`은 이전 비교 그림을 보관한 정적 페이지입니다. 파일 주소로 열어도 작동하며 실제 앱으로 연결됩니다.
