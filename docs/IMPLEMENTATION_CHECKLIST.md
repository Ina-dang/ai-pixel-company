# 구현 체크리스트와 설계 감사

최신성 체크: 2026-10-21 문서·사무실 후속 정리. 실제 업무 시범은 2026-10-20 기록과 구분한다.

## 현재 상태

**how-to-trash 지역 목록·검색 개선: 최종 QA PASS · 결과 수락 대기**

| 구분 | 상태 |
|---|---|
| 수락된 검증 | Phase 5 로컬 음성·Windows 복구·실제 사용자 마이크 1건 |
| 현재 실제 업무 | 고정 저장소에서 PM·Developer 코드 수정, 오프라인 검사·브라우저 네 조건 확인 |
| 최종 QA | 사용자 승인 추가 5분 창에서 같은 후보 QA 1회 PASS. 1차 FAIL 이력 보존 |
| 직전 전체 회귀 (2026-10-20) | 자동 **257개** = 42 + 80 + 135 · Chromium **47개** 통과 |
| 사무실 후속 (2026-10-21) | 관련 단위·동기화 **10개** · 사무실 Chromium **8개** 통과 |
| 정적 검사·빌드 | TS 16 / Python 26 계약·lint·typecheck·build 통과 |
| 전달·출시 | how-to-trash `codex/region-search`의 `7b07edc` push 확인. 앱 결과 미수락·운영 C **NO_GO** |

실제 merge·운영 배포·새 유료 자원은 미수행이다.
실행 ID·SHA·실패 이력은 [README](../README.md)와 [ADR-019](17-decision-log.md)에 연결한다.

## 다음 진행 순서

1. **변경 검토** — 최종 QA PASS의 지역 목록·검색과 브라우저 결과를 확인한다.
2. **결과 수락 여부 결정** — 앱의 `WAITING_APPROVAL`을 Owner가 검토한다. 자동 수락하지 않는다.
3. **잔여 범위 우선순위 결정** — 아래 미완료 6개 항목은 별도다. merge·운영 배포는 승인 대기다.

## 단계별 한눈에 보기

체크는 **각 항목에 적힌 범위의 충족**을 뜻한다. 단계 전체나 운영 출시 승인을 뜻하지 않는다.
특히 P5-03은 기능 구현이 아니라 **보류 결정**을 확인한 항목이다.

| 단계 | 체크 / 전체 | 남은 항목·판정 |
|---|---:|---|
| [Phase 0 · 기반](#phase-0--foundation) | 11 / 11 | 기반 gate 통과 |
| [Phase 1 · 실행](#phase-1--ai-agent-core) | 9 / 10 | P1-09 언어 비교 |
| [Phase 2 · 사무실](#phase-2--pixel-office--b-출시) | 4 / 5 | P2-05 전체 B 출시 gate |
| [Phase 3 · 협업](#phase-3--collaboration--recruitment) | 6 / 7 | P3-01 원격 CI 역순·철회 |
| [Phase 4 · 운영](#phase-4--company-operations--c-출시) | 6 / 7 | P4-06-C 운영 C 출시 NO_GO |
| [Phase 5 · 후속](#phase-5--후속-기능) | 3 / 5 | P5-02-H 환경·정책 / P5-04 최적화 |

집계: 체크 **39개** = 11 + 9 + 4 + 6 + 6 + 3, 미체크 **6개**, 총 **45개**.
아래의 별도 사무실 시범 확인 6개는 이 집계에 포함하지 않는다.

## 미완료 항목

| ID | 남은 일 | 확인할 근거 |
|---|---|---|
| P1-09 | 같은 과제의 한국어·영어 품질·비용·시간 비교 | 표본·한계를 포함한 T12 비교 |
| P2-05 | 전체 B 출시 조건 충족 | 언어 비교·범용 저장소 등 잔여 검증. 고정 저장소 시범과 구분 |
| P3-01 | 일반 CI webhook의 원격 역순·권한 철회 시험 | 실제 원격 이벤트·차단 기록 |
| P4-06-C | 운영 환경·복구·권한·상시 ingress·Owner 승인 | 아래 상세 조건과 운영 C gate |
| P5-02-H | 다른 환경·소음·장문·운영 metadata 정책 | Windows 복구·마이크 1건을 넘어선 검증 |
| P5-04 | 자동 모델·비용 최적화의 도입 판단 | 품질·성공률·rollback 근거 |

## 상세 체크리스트

단계별로 펼치면 원래 항목·테스트 ID·시점별 근거를 볼 수 있다.

## Phase 0 — Foundation

**기반 gate 통과 · 11 / 11**

<details>
<summary>인증·DB·API·SSE·대시보드 항목 보기</summary>

- [x] P0-01 Git·feat/phase-0-foundation·ignore, 지정 원격/Ina-dang 계정 확인.
- [x] P0-02 Node22.20/pnpm10.15.1/PG18.6 등 실제 조합·lock/digest 확인(ADR-010). 패키지 감사0건.
- [x] P0-03 미확인 공식 자료·Docker/WSL·볼륨 지속성·Python3.12.4 stdlib HTTP200 probe. LangGraph 실행은 Phase1.
- [x] P0-04 web/api/contracts/db workspace·lint/typecheck/test/build. engine/worker는 Phase1.
- [x] P0-05 Argon2 Owner/hashed session·CSRF/Origin·권한/logout/expiry(T03).
- [x] P0-06 PG migration 반복/checksum·FK/CHECK/version/rollback·append-only audit(T01/T03).
- [x] P0-07 생성/조회·한국어 원문·전이 이력·불법 전이/증거 없는 완료 거부(T01/T03).
- [x] P0-08 commit 순서·snapshot·SSE replay/재접속/reload/reset·권한 철회(T04/T05). 프록시 gzip 버퍼링 수정.
- [x] P0-09 한국어 dashboard·오류/단절·접근성 lint·390px 모바일 smoke.
- [x] P0-10 TS16/Python26 fixture·schemaVersion 거부(T21)·동시 이벤트 기본 측정. SLA 달성 주장은 없음.
- [x] P0-11 새 workspace 설치/PG 볼륨 초기화부터 migration/검증/build 수행. Phase1 공수는 실제 과제 규모로 재산정하며 LLM 비용은 미발생.

완료 gate: 인증된 프로젝트/업무 생성·조회, 상태 이력 저장, SSE 수신·재접속·새로고침 복원이 실제로 통과한다.

</details>

## Phase 1 — AI Agent Core

**제한 fixture 핵심 경로 통과 · 9 / 10 · P1-09 남음**

<details>
<summary>실행·격리·예산·승인 항목과 검증 이력 보기</summary>

- [x] P1-01 ADR-011로 PG 영구 큐→Node Codex worker 대체. concurrent claim·lease fencing 실증. Redis/Python HTTP 미도입.
- [x] P1-02 JSON checkpoint/실제 thread ID·pause/cancel/stop ack·수동 resume·만료 lease fail-closed 복구. 별도 provider turnId는 미노출로 null.
- [x] P1-03 PM/Developer/QA 역할·영어 명세/AC/파일/검증 인계, 실제 Codex 3역할 성공.
- [x] P1-04 소유 fixture 한정 파일/네트워크/명령/resource/secret 부정시험·timeout/cancel 종료. 임의 저장소 실행 차단.
- [x] P1-05 실제 src/math.mjs 변경·컨테이너 test/build0·동일 manifest SHA256 QA PASS. 수락 API gate/단일 소비는 실제 PG 시험, 실제 모델 결과는 Owner 수락 대기.
- [x] P1-06 실패/검증 불가·재작업 2회·최대 3 candidate/7호출·중단/복구 회귀 시험.
- [x] P1-07 결과 수락 scope·single-use·철회/stale SHA 차단. 고위험 merge/deploy/payment action은 미노출/차단.
- [x] P1-08 구독 인증 강제·API/구매 fallback 없음·유료 크레딧/한도 불명/90% 차단·실행 중 재확인·시간/turn/완료토큰 차단선. 금액 ledger는 ADR-011로 현재 비적용.
- [ ] P1-09 동일 과제 한국어/영어 품질/비용/시간·표본/한계 비교(T12).
- [x] P1-10 결과 파일/diff/manifest SHA256/test/build/QA/수락/완료된 응답 토큰·구독 모드의 한국어 UI·SSE 보고.

현재 판정: 제한 fixture 핵심 경로 통과. 단위/통합69개, Chromium5개 및 실제 구독 PM→Developer→QA 성공을 확인한다. P1-09 언어 비교는 미실행이며 전체 Phase 1 완료로 표시하지 않는다. 범용 저장소는 현재 허용하지 않는다. 원격 PR은 Phase 3 gate다. 실행별 실제 사용량/승인 상태는 DB와 UI가 기준이다.

</details>

## Phase 2 — Pixel Office / B 출시

**로컬 사무실 검증 통과 · 4 / 5 · 전체 B 출시 미완료**

2026-10-21 화면 정리: 차용 팔레트 함수 제거, 연속 세로 벽·장식 축소·최대 896px 그림·HTML 이름표/활동 표시로 변경했다.
후속 레퍼런스 개선에서는 나무 바닥·짙은 벽·청록 작업 가구·자주 소파와 캐릭터 1.25배를 적용했다.
관련 단위/동기화 10개·브라우저 8개를 재검사했고 실제 Chrome의 이전 번들을 새 빌드로 갱신했다.
실제 서버의 PM IDLE / Developer BLOCKED / QA IDLE 대조와 데스크톱·390px 확인을 통과했다.
새 모델 호출·결과 수락·업무 변경·merge·배포 없이 화면만 검증했다. 아래 시범 기록은 과거 이력이다.

<details>
<summary>그래픽·서버 상태 연동·B 출시 조건 보기</summary>

- [x] P2-01 Phaser3.90.0/MIT·Tiled JSON·직접 제작 CC0 자산·client-only 생성/정리·재시도/단일 canvas.
- [x] P2-02 대표/개발/회의/QA/공용 공간·3명·한국어 말풍선·충돌 회피. 상호작용 지점64개 경로 검사.
- [x] P2-03 실제 서버 실행/완료 근거 투영·동시 직원·상세·키보드/390px DOM fallback(T13).
- [x] P2-04 원자 snapshot/SSE·중복/역순/reload/reset·단절/권한 철회(T05/T13). PG19·동기화 단위8·사무실 브라우저7개 통과.
- [ ] P2-05 animation/실행 독립성은 브라우저에서 검증했다(그래픽 off·탭 비활성·reduce motion·쓰기 요청0). 전체 B 출시 gate는 언어 비교·범용 저장소 등 잔여 범위 때문에 미완료다. Phase 2 로컬 사무실 검증과 운영 출시를 구분한다.

2026-10-20 실제 저장소 1차에서는 QA 1차 FAIL·원래 15분 종료 뒤 승인을 기다렸다. 당시 자동257=42+80+135 통과 이력을 보존한다.
2026-10-21 사용자가 추가 5분·QA 1회를 허용했고, 같은 후보의 테스트 6개·lint/tsc/build·브라우저 네 조건 뒤 QA PASS를 확인했다.
후보 `ae2afa1c1f6eebec7471c0cffc7ee7319c94e7c147873f940beaa0f99e2e2e28`, target commit `7b07edc`를 작업 브랜치에 push했다.
앱 결과는 `WAITING_APPROVAL`이다. 이 시범을 전체 B/C 출시·merge/운영 배포 승인으로 확대하지 않는다. README·ADR-019를 따른다.

</details>

## Phase 3 — Collaboration & Recruitment

**협업·채용 검증 · 6 / 7 · 원격 CI 역순·철회 미검증**

<details>
<summary>GitHub·Slack·merge 승인·채용 항목 보기</summary>

- [ ] P3-01 App JWT/제한 token·서명 inbox·역순 reconcile 자동 시험 통과. 실제 App 한 저장소 설치·인증 및 ping HTTP202/중복 제거·PROCESSED 1건 확인. 일반 CI webhook의 원격 역순/철회는 미검증.
- [x] P3-02 후보 manifest/원격 commit SHA 분리·불변 fixture byte 검사·version/권한·UNKNOWN/429 gate 및 실제 App Issue/branch/push/draft PR 검증. 원격 전체 파일 일치·동일 SHA Docker 재검증, 현재 head 로컬 검사 status PASS를 App이 조회. hosted Actions 미실행.
- [x] P3-03 head/base/CI 검사 식별자/정책 scope 요청·별도 Owner 승인·같은 세션의 실행 요청·서버 재검사·철회/만료/UNKNOWN/읽기 전용 조정 구현. 모의 merge 성공/실패와 실제 PR 승인 전 차단을 검증했다. 실제 merge는 별도 Owner 승인 전 수행하지 않는다.
- [x] P3-04 고정 team/channel/Owner·서명/replay/dedupe·한국어 보고·장애 격리와 Slack 명령→공통 task command 구현. 사용자 직접 재설치 후 실제 비공개 #ai-pixel-test의 TASK/STATUS/HELP 모두 처리/전송 확인. interactive 승인·Slack 실행/merge 명령은 도입하지 않는다. 터널 종료 후 상시 수신 불가.
- [x] P3-05 한국어 서버 상태 칸반·키보드/390px·업무 상세 연결·승인 gate 우회 상태 변경 없음(T16). Chromium 회귀20개 및 실제 Slack task/GitHub 승인 차단 화면 확인.
- [x] P3-06 세 템플릿·Codex 구독 기본 모델만·성향/도구/turn-token-time 상한·부서/프로젝트·고용/불변 프로필 이력 구현·실제 PG 시험 통과(T16).
- [x] P3-07 신규 Developer 채용·배정 후 실제 Codex 코드 수정/test/build0/QA PASS·브라우저 이름·reload/390px 검증. 프로필 snapshot·권한 철회·교체 직원 집계 시험 통과(T16). run/SHA는 README 참조.

</details>

## Phase 4 — Company Operations / C 출시

**로컬 운영·복원 검증 · 6 / 7 · 운영 C NO_GO**

<details>
<summary>평가·다중 프로젝트·경보·복원·운영 출시 조건 보기</summary>

- [x] P4-01 AUTO/SELF/PEER/PM/USER·facts/opinion·rubric1/null·한국어 원문/요약·불변 근거/수정본(T17). PG/API와 실제 Codex AI3종 각1회·5종 DRAFT 확인.
- [x] P4-02 동일 모델/상호점수 편향 표시·최초/수정 총2회·Owner 게시/이의·자동 해고/권한 상승 금지(T17). 오래된/미확정/무점수 게시 거부·UNKNOWN 공유 슬롯 차단 시험.
- [x] P4-03 휴직/퇴사/재채용·부서 이동·task/review/usage 불변 이력(T17). PostgreSQL fixture로 과거 pinned profile/review 보존 확인.
- [x] P4-04 Owner 조직/프로젝트·저장소/workspace/통합 격리·진행 예약 포함 예산·DAG/명시 예약·우선순위/FIFO·공유 슬롯1(T11/T17). 실제2프로젝트 test/build0·QA PASS, 후속 DEPENDENCY/run0. 범위는 제한 Node fixture/Owner 역할이며 범용 실행·세부 관리자·공정 할당 미포함.
- [x] P4-05 로컬 성과/토큰/오류/지연/queue/Sandbox/provider·구조화 로그·경보/확인/회복·고정 Slack outbox(T19). 실제 알림2건 SENT·원격 불명 재전송 금지·429 Retry-After/3회·100읽기/동시4·SSE fanout/slow-consumer 검증. 청구액 미확인/운영 SLA 미확정은 유지.
- [x] P4-06-L 현재 PG/Codex 구조의 로컬 DB/worker/외부 장애·암호화 backup/격리 restore·점검/격리·runbook·로컬 C 기술 gate(T18/T19). 실제 table44/workspace14 내용 대조·PG 중단/재시작·native worker 강제 종료·새 호출 차단. Redis/Python Engine은 활성 구조가 아니며 실행 시험으로 세지 않음.
- [ ] P4-06-C 운영 C 출시: off-host/새 호스트 clean 설치·RPO/RTO/secret store·운영 환경·host supervisor 프로세스/권한 분리·종료 불명 native Codex 조정·상시 ingress·범용 실행/언어 검증·Owner 승인. 현재 판정 NO_GO이며 배포/merge 미실행.

**2026-10-19 당시 기록**: 전체 테스트188=이전158+Phase4 30, Chromium25=이전20+Phase4 5, lint/typecheck/contracts/build 통과. 선행 조건에 막힌 예약31건 뒤의 실행 가능한 업무가 누락되지 않는 회귀도 포함한다. 실제 성공/실패 시험과 SHA/스크린샷/사용량 범위는 README. 실제 merge/자동 결과 수락/운영 배포는 미수행이다. 당시 P4-05는 지표/큐/기본 감사 일부만 구현됐으며, 아래 2026-10-20 후속 검증과 구분한다. 전체 C 운영 출시 완료를 의미하지 않는다.

2026-10-20 후속: 테스트206=188+운영18, Chromium30=25+운영5. 같은 source digest의 자동/브라우저/복구/부하/외부 근거5종 PASS와 실제 복원·알림·신선한 계측·긴급 경보 없음·점검 해제로 LOCAL_FIXTURE/blocker0을 확인했다. 첫 복원 실패와 수정 후 두 성공, 정책 복원 뒤 대기 알림 차단도 이력으로 남겼다. P4-06-C와 기존 출시 미검증 범위는 이 로컬 통과로 완료 처리하지 않는다.

</details>

## Phase 5 — 후속 기능

**로컬 음성·복구·마이크 검증 수락 · 3 / 5 · 환경·정책·최적화 남음**

<details>
<summary>STT·음성 정리·미검증 환경·보류 기능 보기</summary>

- [x] P5-01 공식 배포/모델 hash·MIT 확인 후 로컬 whisper.cpp/tiny STT 후보→수정/확인→기존 공통 task command(T20). 일반 task POST의 VOICE 위조 거부·source/version/원문·수정 감사 연결.
- [x] P5-02-L 정상 처리/취소의 임시 WAV 삭제·동의·만료·30초/동시1/UTC일20회/60초 timeout·권한 재검사·위험 별도 승인(T20). 실제 native 취소/close, 원시 파일0, 수정 확인 뒤 TODO/자동 run0 확인. 유료 fallback/자동 retry 없음.
- [ ] P5-02-H 전체 host 검증: Windows 강제 종료 뒤 소유권 기반 native/WAV 복구는 구현·시험 완료(ADR-017). 2026-10-20 사용자 직접 물리 microphone의 녹음/전사/취소·plaintext/파일 정리1건은 서버와 대조 완료. 앱의 microphone=() 헤더를 self로 수정했다. 단일 문장의 오인식이 있어 정확도 일반화·다른 OS/브라우저/noise/장문·운영 metadata 정책은 남음. 불명 소유권/구형 영수증은 후속 STT 차단/수동 확인 유지.
- [x] P5-03 범위 평가: TTS·고급 조직/회의/추가 연동은 별도 요구가 없어 보류. 실제 구현/출시 완료 표시는 하지 않음.
- [ ] P5-04 자동 모델/비용 최적화는 품질/성공률·rollback 근거 후 도입.

2026-10-20: P5-01/02-L 로컬 구현. 최종 자동223=기존206+음성17, Chromium37=기존30+음성7과 lint/typecheck·TS16/Python26 계약·build PASS. 승인 체크박스 선택자와 UI 시험의 실제 로그인 의존성을 수정했고 첫 전체 browser FAIL 이력은 release_checks에 보존했다. 최종 경계 리뷰에서 취소 중 슬롯/cleanup 불명 차단·native error/close 구분도 보완·시험했다. 실제 물리 마이크가 아닌 로컬 한국어 합성 시험 문장을 사용한다. 최종 실제 source digest/후보·task/backup·restore·스크린샷은 README를 따른다. 운영 C·실제 merge/운영 배포는 이 통과로 승인되지 않는다.

2026-10-20 후속 복구 검증: DB 경계11+Windows 실행 경계8+실제 API 강제 종료2=추가21개. 실제 whisper와 장시간 native 대역을 구분했다. API 강제 종료 전 native 생존/복구 시 이미 종료를 관찰했고 WAV1개 삭제·잔여0·task/run0, 별도 Windows 시험에서는 살아 있는 정확한 잔여 native1개 종료를 확인했다. 브라우저 추가3개는 복구 동의/version·실패 차단 유지·숨김 녹음 폐기다. 물리 마이크 성공을 주장하지 않는다. 최종 전체244/40과 기존 223/37 수락 이력을 구분한다.

</details>

## 초기 설계·시범 검증 이력

현재 진행 상태와 구분한 과거 기록이다. 당시의 미실행·착수 판정을 보존한다.

<details>
<summary>2026-10-18 설계 감사 · 2026-10-19 Phase 0 착수·사무실 시범 기록</summary>

### 문서 정합성 자체 감사

| 원문 검증 기준 | 설계 위치 | 확인 수준 |
|---|---|---|
| B→C 확장·1인 범위 | 00/02/13/21·ADR-007 | 설계 반영 |
| 실제 코드/test·Engine/Worker 책임 | 02/04/05/12/14 | 구현 시험 필요 |
| Hono↔Python·Postgres/Redis | 02/06/07/08·ADR-001/002 | 계약 정의 |
| task/agent 상태 분리·이벤트→픽셀 | 05/06/09 | 계약 정의 |
| 한국어 사용자·영어 내부·원문 | 01/04/22 | 정책 반영 |
| 토큰/비용·언어 효율 | 07/14/16 | 평가 정의, 효과 미측정 |
| 채용→할당·평가 근거/한계 | 18/19/21 | 계약 정의 |
| GitHub/Slack 인증/권한 | 10/11/12 | 시험 필요 |
| 음성 후속 확장 | 08/20/22 | Phase 5 분리 |
| 복구/중복/승인/예산 | 05/06/07/12/15/16 | 실증 필요 |
| Phase별 검증 가능 완료 조건 | 01/13/14/이 문서 | T01~T21 연결 |
| 문서 모순/누락·목차/링크 | INDEX/03/17/이 문서 | 정적 감사 |
| Phase 0 착수 가능성 | 아래 판정 | CONDITIONAL GO |

### 발견 쟁점과 처리

| ID / 심각도 | 근거·영향 | 수정/대응 | 대상·상태 |
|---|---|---|---|
| D01 / High | sequence/commit 역전 시 SSE 누락 | counter lock+snapshot 계약 | 06/07, 설계 보완 |
| D02 / High | HTTP/큐 재전달 시 부작용 중복 | operation/lease/fencing·UNKNOWN reconcile | 02/08/10/15, 설계 보완 |
| D03 / High | B 작업과 통합 PR 시점 혼동 | B 로컬 근거, PR Phase 3 | 00/05/13, 설계 보완 |
| D04 / High | 감사/비용을 Phase 4까지 미루면 초기 통제 불가 | Phase 0 감사·Phase 1 상한 | 07/12/13/16, 설계 보완 |
| D05 / Medium | 최초 첨부의 18~21장 누락 | 추가 첨부로 일정/문서 구조 확인 | PROJECT_INSTRUCTIONS/INDEX, 해소 |
| D06 / High | 실제 Sandbox 차단/종료 미실증 | T10 이전 비신뢰 코드 차단 | 12/14, Phase 1 gate 미해결 |
| D07 / Medium | 버전/설치 미시험·일부 공식 페이지 수집 오류 | Phase 0 수직 시험/ADR-009 | 03/17, gate 미해결 |
| D08 / Medium | 평가 의견의 비교/모델 편향 | 근거/유형 분리·표본/편향·Owner | 19, 잔여 한계 |

Critical(현재 설계 착수를 막는 문서 결함)은 자체 검토에서 확인하지 못했다. 숨은 결함 부재나 제품 안전성 검증을 뜻하지 않는다. D06/D07은 실제 통과 전까지 해소로 표시하지 않는다.

### 정적 검증 결과

2026-10-18 Node.js 파일 검사로 지정 파일 28/28개, 로컬 문서 링크 54개 대상 존재, JSON 예시 13개 파싱, 코드 fence 짝을 확인했다. Mermaid 다이어그램 7개는 존재/본문을 검토했으며 별도 renderer 실행은 하지 않았다. 번호형 도메인 문서(ADR 형식인 17 제외)의 11개 절, 필수 테이블 17개, 요구사항 R01~R21, 테스트 계획 T01~T21의 존재를 확인했다. 구현 항목 43개는 모두 미완료 상태다.

자체 검토에서 발견한 사용자 평가 원문/nullable 점수, 미확인 토큰의 null 처리, REQUEST_CHANGES 결정 메타데이터를 DB/API 문서에 맞췄다. 정적 검사는 링크 대상/JSON/문서 구조를 확인하는 것으로 API·DB·SSE·샌드박스 실제 동작을 검증하지 않는다. lint/typecheck/test/build는 서비스 코드/설정이 없어 미실행이다.

### Phase 0 착수 평가

### 사무실 화면 시범 확인 — 2026-10-19

- [x] 기존 Phaser·실행 구조·충돌/목표 좌표 유지
- [x] pixel-agents 고정 commit MIT 확인, 팔레트 함수 출처/저작권/라이선스 보존
- [x] 직접 제작 캐릭터 의상·커피 머신·서버 선반·러그·서버 상태 말풍선 적용
- [x] lint·typecheck·테스트141개·계약 fixture·build 성공
- [x] Chromium17개 및 실제 서버 상태 대조·390px·키보드·그래픽 토글·새로고침 확인
- [x] 데스크톱/모바일 스크린샷 직접 확인, 페이지 오류/업무 변경/외부 요청0건

제한: 화면 시범이다. 레이아웃 편집기·회의 시뮬레이션과 전체 Phase 3의 미완료 항목을 완료로 변경하지 않는다. 이번 검증은 기존 기록을 읽었으며 새로운 모델 실행은 포함하지 않는다.

**Phase 0 완료**. 2026-10-19 실제 테스트·브라우저 검증으로 기반 gate를 통과했다. D07의 Phase0 버전/설치 불확실성은 ADR-010으로 해소했다. D06(Sandbox 실차단)은 Phase1의 실행 차단 조건으로 유지한다. Phase1은 provider/예산·격리 검증을 전제로 CONDITIONAL GO다.

현재 이력 보충(2026-10-19): 위 최초 착수 경로는 ADR-011로 대체했다. 구독/PG checkpoint/lease/제한 Sandbox/PM·Dev·QA 핵심 검증을 완료했고 Phase 1 최종 결과를 사용자 지시로 수락했다. Phase 2 사무실과 실제 Codex→브라우저 상태 연동도 검증했다(README의 run/SHA 근거). 다음 우선순위는 새 검증 결과의 Owner 검토, 언어 비교 실험의 필요성 판단, 범용 저장소 격리·의존성 정책 및 Phase 3 범위 결정이다. 운영 배포와 merge는 별도 승인한다.

</details>
