# plan_record — 플랜두씨 다이어리

계획한 나와 실제의 나를 비교하는 개인 기록기. 습관, 운동, 게임, 학습 시간 등 원하는 항목을 기록·수정·삭제하고, 캘린더/테이블로 다시 확인한다. 백엔드 없이 순수 HTML/CSS/JS + `localStorage`만으로 동작한다.

**공개 주소**: https://whiteclover0542.github.io/plan_record/

## 미리보기

캘린더 뷰

![캘린더 뷰](submission/screenshots/card5-03-actual-5day-calendar.png)

테이블 뷰 (전체 목록 + 체크리스트)

![테이블 뷰](submission/screenshots/card5-04-actual-5day-table.png)

> 위 화면은 전부 `test` 태그를 붙인 합성(가상) 데이터다. 더 많은 스크린샷은 [SUBMISSION.md](SUBMISSION.md) 참고.

## 주요 기능

- 기록 생성·조회·수정·삭제 (고유 ID 기준, 캘린더/테이블 뷰)
- 반복·단발성 체크리스트 (요일 반복, 기간 설정, 오늘 완료 체크)
- 태그 필터링, 캘린더 칩 색상 커스터마이즈 + 중요 기록 강조 표시(굵게·★)
- JSON 내보내기/가져오기(전체 복원), 전체 삭제
- 구버전(v1) 기록을 새 필드(`tags`, `schemaVersion`)로 자동 변환(멱등)
- 주간 요약(월요일~일요일, `Asia/Seoul` 기준) — 잘못된 날짜·필수값 누락·중복 id·비숫자 값은 집계에서 제외하고 사유를 표시

## 데이터 구조

기록 한 건 = 언제(`date`, `Asia/Seoul` 기준) / 무엇을(`item`) / 얼마나(`value`, `unit`)를 나타낸다. 필드 정의와 v1→v2 변환 규칙은 [PROGRESS.md](PROGRESS.md#부록-필드-정의-카드1-확정)에 정리돼 있다.

## 로컬에서 실행

빌드 과정이 필요 없다. 저장소를 내려받은 뒤 정적 파일 서버로 열면 된다.

```bash
python -m http.server 8000
# http://localhost:8000 접속
```

`index.html`을 브라우저로 직접 열어도 동작하지만, 파일을 그대로 열면(`file://`) 브라우저에 따라 동작이 달라질 수 있어 로컬 서버 사용을 권장한다.

## 문서

- [ASSINGMENT.md](ASSINGMENT.md) — 과제 요구사항 원본(동결)
- [PROGRESS.md](PROGRESS.md) — 진행 상태, 설계 결정 이력, 검증 안내서, AI 3줄
- [card5-log.md](card5-log.md) — 5일 실사용 로그(날짜·완료 여부만, 실제 개인 기록 값은 비공개)
- [SUBMISSION.md](SUBMISSION.md) / [submission/SUBMISSION.pdf](submission/SUBMISSION.pdf) — 카드별 증거 스크린샷을 포함한 제출 문서

## 개인정보·보안 원칙

실제 개인 기록은 각자의 브라우저(`localStorage`)에만 남고, 이 저장소·공개 화면·제출 문서에는 합성(가상) 데이터만 사용한다. 백엔드가 없어 서버·비밀값 자체가 존재하지 않는다.
