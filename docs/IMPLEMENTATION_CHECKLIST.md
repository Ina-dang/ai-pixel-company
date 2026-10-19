# 구현 체크리스트와 설계 감사

최신성 체크: 2026-10-19 실제 구현·검증 반영. 아래 2026-10-18 문서 감사는 초기 설계 이력이다.

## 현재 상태

Phase 0 인증·DB/API·SSE·한국어 대시보드를 구현했다. 실제 테스트27개, Chromium E2E1개, TS16/Python26 fixture, lint/typecheck/build/audit가 통과했다. DB 컨테이너 재시작 후 데이터/cursor 유지도 확인했다. 실행 명령/환경은 README에 있다. provider 호출·외부 App 설치/메시지·merge·운영 배포는 수행하지 않았다.

## Phase 0 — Foundation

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

## Phase 1 — AI Agent Core

- [ ] P1-01 BullMQ/outbox→Node dispatcher→Python HTTP·operation 조회·lease fencing(T04/T08).
- [ ] P1-02 영구 checkpoint/thread_id·pause/cancel/resume·승인 중 재시작(T08/T18).
- [ ] P1-03 PM/Developer/QA 프로필·영어 명세/AC/Artifact 인계(T06/T21).
- [ ] P1-04 Sandbox 파일/네트워크/명령/리소스/secret 차단·고아 프로세스 종료(T10). 실패/미실행 시 비신뢰 실행 차단.
- [ ] P1-05 fixture 실제 코드 수정·test/build·같은 SHA QA·결과 수락(T06).
- [ ] P1-06 실패/검증 불가·재작업 2회·최대 3 candidate·상한 종료(T01/T07).
- [ ] P1-07 고위험 action 승인 scope/단일 소비·권한 철회·stale SHA(T09).
- [ ] P1-08 토큰/시간/retry·가격 snapshot·예약/UNKNOWN 정산·상한(T02/T11).
- [ ] P1-09 동일 과제 한국어/영어 품질/비용/시간·표본/한계 비교(T12).
- [ ] P1-10 결과물/로그/SHA/검증/승인/비용의 한국어 추적 보고.

완료 gate: 자연어 task로 실제 수정·test/build·QA·제한 재작업·중단/복구·승인·계측을 끝까지 입증한다. 원격 PR은 Phase 3 gate다.

## Phase 2 — Pixel Office / B 출시

- [ ] P2-01 Phaser 3/Tiled JSON·자산 license·client-only scene lifecycle.
- [ ] P2-02 대표/개발/회의/QA/공용 공간·3명 캐릭터·한국어 말풍선.
- [ ] P2-03 실제 이벤트 상태/행동·동시 표시·직원 상세·DOM fallback(T13).
- [ ] P2-04 snapshot/replay·중복/역순/reload/단절/권한 철회(T05/T13).
- [ ] P2-05 animation/실행 독립성·B gate 통합 검증.

## Phase 3 — Collaboration & Recruitment

- [ ] P3-01 GitHub App scope/token·webhook signature/inbox·역순 reconcile(T14).
- [ ] P3-02 Issue/branch/push/PR/CI·SHA/테스트 gate·중복 부작용 조정(T14).
- [ ] P3-03 merge 별도 승인·head/CI/권한 재검사(T09/T14).
- [ ] P3-04 Slack team/user/channel·서명/replay/dedupe·보고·장애 격리(T15).
- [ ] P3-05 한국어 칸반 카드·gate 없는 drag 전이 금지(T16).
- [ ] P3-06 템플릿 채용·모델/성향/도구/상한·부서/프로젝트(T16).
- [ ] P3-07 신규 직원 실제 수행·권한 거부·불변 프로필 이력(T16).

## Phase 4 — Company Operations / C 출시

- [ ] P4-01 AUTO/SELF/PEER/PM/USER 분리·근거/가중치/한국어 요약(T17).
- [ ] P4-02 동일 모델/상호점수 편향·loop 제한·Owner 검토·자동 해고/권한 상승 금지(T17).
- [ ] P4-03 휴직/퇴사/재채용·task/review/usage 이력 보존(T17).
- [ ] P4-04 다중 프로젝트 권한/저장소/통합/예산·DAG/scheduler(T11/T17).
- [ ] P4-05 성과/비용/오류/지연/queue/Sandbox/provider·감사/경보(T19).
- [ ] P4-06 DB/Redis/Engine/외부 장애·backup restore·운영 인계·C gate(T18/T19).

## Phase 5 — 후속 기능

- [ ] P5-01 필요/가격/보관/provider 공식 근거 확인 후 STT 후보→확인→공통 command(T20).
- [ ] P5-02 원시 음성 비저장/동의/삭제·상한·위험 별도 승인(T20).
- [ ] P5-03 TTS·고급 조직/회의/추가 연동은 별도 요구사항으로 평가.
- [ ] P5-04 자동 모델/비용 최적화는 품질/성공률·rollback 근거 후 도입.

## 문서 정합성 자체 감사

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

## Phase 0 착수 평가

**Phase 0 완료**. 2026-10-19 실제 테스트·브라우저 검증으로 기반 gate를 통과했다. D07의 Phase0 버전/설치 불확실성은 ADR-010으로 해소했다. D06(Sandbox 실차단)은 Phase1의 실행 차단 조건으로 유지한다. Phase1은 provider/예산·격리 검증을 전제로 CONDITIONAL GO다.

다음 우선순위: Phase1 범위 확인 → provider/모델/예산 → Redis/dispatcher↔Python → checkpoint/lease → 비밀 없는 fixture Sandbox 부정 시험 → PM/Dev/QA 실제 실행. 운영 배포와 merge는 별도 승인한다.
