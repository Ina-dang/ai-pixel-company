# 설계 의사결정 기록

## ADR-012 — 서버 투영 기반 픽셀 사무실 (2026-10-19, 구현·검증)

- 결정: Phase 2는 기존 snapshot/SSE 경로에 통합한다. 같은 DB snapshot에서 업무·조직 cursor·직원3명·승인 대기를 읽으며 이벤트는 재조회 신호로 쓴다. 업무/실행/직원 상태를 별도 필드로 유지한다.
- 근거: 실제 역할 단계와 완료 근거를 기반으로 해야 연결 지연·역순 이벤트·모델 문구가 최종 상태를 바꾸지 않는다. 프로젝트 범위·조직 sequence·실행 version을 검사하고 reset은 서버 snapshot으로 복구한다.
- 표현: Phaser3.90.0, 로컬 Tiled 맵과 직접 제작 CC0 자산. 그래픽 실패/비활성 시 같은 서버 근거의 DOM 목록과 상세를 유지한다. 애니메이션은 실행·승인 요청을 만들지 않는다.
- 검증: 실제 PG 투영19개, 동기화 단위8개, 사무실 Chromium7개를 기존 회귀 시험에 추가했다. 실제 Codex 실행 관측 결과는 README에 성공·중단을 구분해 기록한다. 범용 저장소/운영 출시 검증을 대신하지 않는다.
- 연동 중 발견한 보완: 실제 Sandbox test/build argv를 SHA·exitCode·output과 함께 기록한다. 기존 checkpoint 호환을 유지하며 LLM이 실행 명령을 추측하지 않도록 한다.

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

## ADR-011 — 기존 Codex 구독을 사용하는 제한된 Phase 1 실행

- 날짜/상태: 2026-10-19 / 사용자 구현·검증·push 승인, 고정 fixture 실제 실행 검증.
- 대상/배경: 사용자는 추가 API 비용 없이 현재 Codex 구독을 사용하고 한도 도달 시 중단할 것을 명시했다.
- 대안: 유료 API/LangGraph adapter, 비공식 토큰 추출, 공식 Codex CLI 연결. 공식 ChatGPT 로그인 CLI를 선택하며 인증 토큰을 직접 추출하지 않는다.
- 대체 관계: 최초 Phase 1 Redis·BullMQ→Python LangGraph HTTP 구성을 단일 로컬 Node worker + PostgreSQL 영구 큐/JSON checkpoint로 대체한다. API 금액 예약·가격 snapshot은 이 구독 전용 경로에 적용하지 않는다. 다중 공급자/분산 운영 도입 시 별도 ADR이 필요하다.
- 책임 유지: Hono/DB가 인증·상태·승인·lease fencing을 결정한다. worker가 PM/Developer/QA와 제한 재작업을 수행하고 Sandbox broker가 파일 적용·명령 실행을 담당한다. Codex 자체에 호스트 실행 도구를 주지 않는다.
- 인증/비용: forced_login_method=chatgpt, 기본 공급자 고정, API/DB/proxy 비밀 환경변수 제외, exec --ignore-user-config --strict-config 및 셸/앱/플러그인/브라우저/이미지 도구 비활성화. app-server는 인증과 rateLimits 조회에만 사용한다. 유료 크레딧·한도 불명·90% 이상·quota 오류는 중단한다. 구매·충전·banked reset·API fallback은 호출하지 않는다.
- 내구성/중단: PG claim·60초 lease·heartbeat·영구 checkpoint·단일 수락 기록. pause/cancel은 lease를 폐기하고 실제 teardown 확인 후 stop token을 단일 소비한다. 종료 불명은 worker 전체 및 DB 큐를 막고 로컬 interlock도 보존한다. 알 수 없는 진행 중 호출은 재시작 후 자동 replay하지 않는다.
- 결과/증거: PM 영어 명세/AC, Developer 구조화 파일을 broker가 실제 수정, 네트워크 없는 nonroot·read-only·seccomp/capability/resource 제한 Docker test/build, 동일 SHA256 QA, 별도 Owner 수락. SHA256은 fixture manifest 식별자이며 Git commit SHA와 구분한다. 실제 Codex thread ID를 보존하며 exec가 별도 turn ID를 노출하지 않아 turnId=null로 기록한다.
- 한계: 단일 로컬 계정·소유한 node-functions-v1 fixture만 허용한다. 임의 저장소/의존성 설치/네트워크/외부 배포·merge는 미지원이다. 구독 한도는 외부 Codex 사용과 공유되며 공급자 수치 반영 지연이 있다. 완료된 turn의 토큰만 합산하며 응답 없는 중단 호출의 사용량은 미확정이다. 언어 비교 미실행. 기존 범용 Phase 1 전부 완료를 의미하지 않는다.
- 근거: [공식 인증](https://learn.chatgpt.com/docs/auth), [app-server](https://learn.chatgpt.com/docs/app-server), [구독 한도](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan). 열람 2026-10-19, 개별 변경일 미공개. 로컬 CLI0.162.1 실제 호출 및 Docker/DB/브라우저 결과는 README/체크리스트.

## 변경 규칙

기존 결정을 바꾸면 ID를 조용히 덮어쓰지 않고 변경 이유·새 ADR·대체 관계를 기록한다. 기술 기능 사실·사용자 지정 요구·실험 결과·설계 가정을 구분한다. 원문 26장의 날짜/대상/배경/대안/선택/근거/영향/한계/상태를 유지한다.
