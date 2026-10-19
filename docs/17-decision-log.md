# 설계 의사결정 기록

최신성 체크: 2026-10-18 설계 결정/공식 자료 열람 기준. “설계 채택”은 구현 성공을 뜻하지 않는다. 외부 기술 근거는 [03](03-technology-decisions.md)에 모았다.

## ADR-001 — PostgreSQL을 도메인 상태의 기준으로 사용

- 날짜/상태: 2026-10-18 / 설계 채택, 구현 미검증.
- 대상/배경: Redis·Engine·UI 상태가 다르면 실제 완료를 판별하기 어렵다.
- 대안: Redis 중심 상태, 프런트엔드 상태 중심, DB 중심.
- 선택/근거: PostgreSQL에 task/run/approval/evidence를 영구 저장하고 API 전이만 허용한다.
- 영향: Redis 유실 시 DB intent로 재구성. UI는 projection이다.
- 한계/검증: transaction·constraint·복구 시험이 필요하다. 대상 문서 02/05/07/14.

## ADR-002 — BullMQ Node worker와 Python 사이의 명시적 HTTP 계약

- 날짜/상태: 2026-10-18 / 설계 채택, 호환성 gate 미통과.
- 대상/배경: BullMQ와 LangGraph의 책임·언어 경계를 정해야 한다.
- 대안: Python BullMQ 직접 소비, 별도 broker 추가, Node dispatcher→HTTP.
- 선택/근거: Node 큐 운영을 유지하고 동일 코드베이스 worker 모드로 Python에 식별자/Artifact 참조를 전달한다. 별도 broker를 추가하지 않는다.
- 영향: lease·fencing·operationId·상태 조회/reconcile이 필요하다. 승인 대기엔 worker slot을 해제한다.
- 한계/검증: HTTP timeout/ACK 유실과 Python 호스팅 adapter를 Phase 0/1 수직 시험한다. 대상 02/08/15.

## ADR-003 — Transactional event/outbox와 조직별 cursor

- 날짜/상태: 2026-10-18 / 설계 채택, 구현 미검증.
- 대상/배경: DB 상태 변경 뒤 전송 실패, SSE commit 순서 누락 위험.
- 대안: 메모리/pubsub 전용, 단순 bigserial replay, 조직 counter lock.
- 선택/근거: 동일 transaction에서 상태/event/outbox 저장, 조직 counter lock을 commit까지 유지한다.
- 영향: 조직 내 event transaction이 직렬화되며 snapshot/replay 기준이 명확해진다.
- 한계/검증: 초기 규모에서 lock 경합을 수용한다. 부하 증가 시 stream 분할 등 재검토한다. 대상 06/07/14.

## ADR-004 — 검증 증거와 승인으로 완료 판정

- 날짜/상태: 2026-10-18 / 설계 채택.
- 대상/배경: LLM 완료 주장·queue 완료·animation 완료는 제품 완료 증거가 아니다.
- 대안: 모델 self-report, 테스트만, 수용 기준+SHA+test/build+QA+Owner.
- 선택/근거: 마지막 조합을 필수 gate로 한다. 결과 수락과 merge/배포를 별도 action으로 둔다.
- 영향: 테스트 불가 시 UNVERIFIABLE로 차단, stale SHA는 재검증한다.
- 한계/검증: QA 자체도 의견/근거 검토 대상이다. 대상 05/08/14.

## ADR-005 — 최소 로컬 인증과 독립 Sandbox 경계

- 날짜/상태: 2026-10-18 / 설계 채택, 라이브러리/런타임 미확정.
- 대상/배경: 초기 1인 개발 복잡도를 제한하면서 무인증 실행을 막아야 한다.
- 대안: 무인증 로컬, 초기 전체 조직 SSO, 로컬 Owner 인증 후 공개 전 OIDC.
- 선택/근거: local Owner session/CSRF와 서버 도구 gate, 비신뢰 코드는 별도 Sandbox.
- 영향: 공개 전 별도 인증/격리 gate 필요. Worktree는 보안 경계가 아니다.
- 한계/검증: Docker만으로 완전 격리를 보장하지 않는다. 대상 12/15.

## ADR-006 — 영어 내부 협업·한국어 사용자 경험과 비용 실측

- 날짜/상태: 2026-10-18 / 사용자 요구에 따라 채택, 비용 효과 미측정.
- 대상/배경: 원문 보존·의미 손실 방지·중복 번역 비용 통제.
- 대안: 전부 한국어, 전부 영어, 역할별 언어 분리.
- 선택/근거: 내부 영어, 사용자 한국어, 불변 필드/수용 기준 ID, 필요한 시점의 한국어 요약.
- 영향: 언어 평가에 번역/요약 비용과 cache 효과 포함.
- 한계/검증: 영어 비용 절감을 보장하지 않는다. 대상 16/22.

## ADR-007 — B→C 단계 구분과 공통 조직 식별자

- 날짜/상태: 2026-10-18 / 설계 채택.
- 대상/배경: 통합·인사·평가를 처음부터 모두 구현하면 핵심 실행이 늦어진다.
- 대안: 모든 기능 동시 구현, B 전용 모델 후 재작성, 공통 모델+단계별 활성화.
- 선택/근거: B는 단일 프로젝트/3역할, org/project 식별자를 처음부터 둬 C 확장 시 엔진을 유지한다.
- 영향: PR/Slack/템플릿 채용은 Phase 3, 평가/다중 프로젝트는 Phase 4, 음성은 Phase 5.
- 한계/검증: 외부 PR 없는 Phase 1과 통합 목표 흐름을 구분한다. 대상 00/13/18/21.

## ADR-008 — 호출 전 예약·호출 후 정산

- 날짜/상태: 2026-10-18 / 설계 채택, 공급자 usage 조정 미검증.
- 대상/배경: 병렬 run이 같은 잔여 예산을 각각 소비할 수 있다.
- 대안: 사후 집계, 실행별 단독 상한, 공유 ledger 예약.
- 선택/근거: org/project/agent 예산을 고정 순서로 lock해 예약하고 실제 usage로 정산한다.
- 영향: UNKNOWN 사용량은 예약 유지, 신규 호출 중단. priceVersion 불변 저장.
- 한계/검증: 공급자 청구 지연/초과를 소급 막는 보장이 아니다. 대상 07/16.

## ADR-009 — 버전·환경 확정과 착수 gate

- 날짜/상태: 2026-10-18 / 미확정.
- 대상/배경: 빈 workspace이고 설치/호환성 시험이 없다.
- 대안: 최신 자동 설치, 임의 과거 버전, 공식 지원 범위 확인 후 lock.
- 선택 방향/근거: Node 24/Python 3.12/PostgreSQL 18 후보와 사용자 지정 Phaser 3를 실제 지원 조합으로 검증한 뒤 정확한 버전/digest 고정.
- 영향: Phase 0 첫 작업에 Turbo/내구 실행 공식 문서 재확인·Docker 가용성·SSE/proxy·TS/Python fixture 시험 포함.
- 한계/검증: 현재 “전체 스택 호환”을 확정하지 않는다. 대상 03/체크리스트.

## ADR-010 — Phase 0 실제 검증 결과와 호환성 수정

- 날짜/상태: 2026-10-19 / Phase 0 로컬 검증 완료. ADR-009의 Phase 0 버전/환경 결정을 대체한다.
- 대상/배경: 실제 설치·DB/API·브라우저 연결로 설계 가정을 확인해야 했다.
- 대안: Node 24 도입 대 기존 Node 22 지원 조합, 단일 PG client 대 raw/ORM 분리, proxy gzip 유지 대 SSE 즉시 flush.
- 선택/근거: Node22.20/pnpm10.15.1/PG18.6 및 lockfile 조합을 실증했다. serializer 충돌은 별도 client, SSE 버퍼링은 Next compress:false/identity로 해결했다. Argon2 Owner 키·hashed opaque session·double-submit CSRF를 로컬 인증으로 구현했다.
- 영향: 실제 DB/API 테스트27개, Chromium E2E1개, TS16/Python26 fixture, lint/typecheck/build/audit를 실행했다. 모든 결과는 README에 기록한다.
- 한계: 공개 서비스 인증·LangGraph·Redis·Sandbox·provider 과금·운영 배포 검증은 범위 밖이다. Phase 1 진입 시 각각 재검증한다.

## 변경 규칙

기존 결정을 바꾸면 ID를 조용히 덮어쓰지 않고 변경 이유·새 ADR·대체 관계를 기록한다. 기술 기능 사실·사용자 지정 요구·실험 결과·설계 가정을 구분한다. 원문 26장의 날짜/대상/배경/대안/선택/근거/영향/한계/상태를 유지한다.
