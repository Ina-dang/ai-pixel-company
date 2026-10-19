# 기술 검증과 선택

## Phase 0 검증 업데이트 — 2026-10-19

실제 실행 조합: Node 22.20.0 / pnpm 10.15.1 / Python 3.12.4 / PostgreSQL 18.6 / Docker Engine 29.7.2·Compose 5.4.0. 패키지는 Next 16.4.2, React 19.3.1, Hono 4.13.13·Node adapter 2.1.5, Zod 4.6.7, Drizzle ORM 0.45.4, postgres.js 3.4.9, Turbo 2.11.9, TypeScript 5.9.3, Vitest 5.0.5, Playwright 1.64.1, Biome 2.5.15로 lock했다. 각 major의 최신 패치 전체를 보장하는 표가 아니라 이번에 실행한 조합이다.

기존 Node 22 설치를 유지해 검증했다. Node 24는 후보였으며 필수 조건이 아니었다. Next의 Node>=20.9, Vitest의 Node22.12+ 조건과 실제 설치/타입/빌드/테스트를 확인했다. PostgreSQL 이미지는 `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`로 고정했다. Drizzle CLI 기반 자동 migration 생성 대신 Drizzle 타입 schema와 명시 SQL/checksum migration을 사용한다. 수동 SQL은 transaction/constraint/rollback 테스트로 확인한다.

초기 수집 실패 자료를 재확인했다: [Turborepo 설치](https://turborepo.dev/docs/getting-started/installation), [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [Argon2 라이브러리 원문](https://github.com/napi-rs/node-rs/tree/main/packages/argon2). 공식 자료 열람과 실제 구현 검증은 구분한다. LangGraph는 Phase 1에서 별도 실행 검증한다.

실증된 호환성 쟁점: Drizzle와 직접 SQL의 serializer 충돌은 독립 클라이언트/풀로 분리했다. Next gzip은 작은 SSE frame을 버퍼링해 `compress:false`/identity 응답을 사용했다. TS/Python 계약 검증기는 Zod JSON Schema의 propertyNames를 처리하도록 보완하고 정상/잘못된 키 fixture를 함께 검사했다. 자세한 실제 결과는 README를 참조한다.

아래 2026-10-18 표는 설계 당시 조사 기록이며, 이 업데이트가 Phase 0의 최신 확인 결과다.

## 1. 목적

최신성 체크: 2026-10-18 공식 문서 열람 기준. 페이지별 최종 변경일은 대부분 확인되지 않아 정책 변경일로 단정하지 않는다. 공식 기능의 존재와 프로젝트 호환성 실증을 분리한다.

## 2. 범위

권장 스택을 유지하되 정확한 패치 버전·lockfile·이미지 digest는 Phase 0에서 결정한다. 지금은 의존성 설치·빌드·실행을 하지 않았다.

## 3. 요구사항

지원 런타임·보안 유지보수·OS·직렬화 계약을 검증하고, 검증 전 조합 전체가 호환된다고 표시하지 않는다. prerelease를 자동 채택하지 않는다.

## 4. 설계 내용

| 영역 | 설계 선택 | 확인 수준 / Phase 0 검증 |
|---|---|---|
| pnpm/Turbo | pnpm workspace + Turborepo task graph | pnpm 공식 페이지 확인. Turbo 페이지 수집 실패, 재확인 필요 |
| Node | Node 24 계열 후보 | 지원 상태/패치 확인 필요. Next 최소 조건과 pnpm 설치 조건을 모두 충족하는지 시험 |
| Web | Next.js App Router + React + TypeScript strict | 공식 Next 설치 문서상 Node 최소 20.9. React/TS peer 조합은 lock 시 검증 |
| Pixel | Phaser 3 + Tiled JSON | 사용자가 지정한 major 유지. 최신 문서가 Phaser 3 전용이라고 가정하지 않음. dynamic import/SSR 경계와 타일맵을 시험 |
| API | Hono Node adapter + Zod | 공식 Node adapter·strict 안내 확인. SSE/proxy·OpenAPI 추출·JSON Schema 조합 시험 |
| Engine | Python 3.12 후보 + LangGraph | interrupt/checkpoint 기능 공식 문서 확인. Python 지원 범위·checkpoint backend 버전은 확인 필요 |
| DB | PostgreSQL 18 계열 후보 + Drizzle 안정판 | 공식 current locking 문서는 18. preview/RC 자동 선택 금지. 마이그레이션·드라이버 시험 |
| Queue | Redis + BullMQ Node | 멱등 job 지침 확인. Redis 버전/라이선스·내구 설정·BullMQ 요구 버전은 고정 전 검증 |
| Realtime | Hono SSE + DB replay | WHATWG Last-Event-ID 확인. 런타임/proxy flush·연결 제한 시험 |
| Sandbox | 별도 worker + 제한된 컨테이너/격리 런타임 | Docker만으로 완전 격리 보장 불가. 실제 공격/중단 시험 전 신뢰할 수 없는 코드 금지 |
| LLM | OpenAI/Anthropic provider adapter | 모델 ID/지원 기능/가격/보관 정책 확인 필요. 특정 모델/단가를 여기서 확정하지 않음 |
| Infra | Docker Compose 로컬 | 설치/WSL/자원/volume 권한 확인 필요 |

## 5. 기술적 근거

아래 공식 원문은 2026-10-18 열람했다. 내용은 필요한 기능·제약만 확인했으며 실행 호환성의 증거가 아니다.

| 공식 기관/문서 | 확인 내용 | 링크 |
|---|---|---|
| Vercel, Next.js Installation | 설치·런타임 조건 | [공식](https://nextjs.org/docs/app/getting-started/installation) |
| Hono, Node.js | Node adapter 사용 | [공식](https://hono.dev/docs/getting-started/nodejs) |
| Zod, Introduction | strict TypeScript 요구 | [공식](https://zod.dev/) |
| Drizzle, Overview | DB/ORM 선택 근거 | [공식](https://orm.drizzle.team/docs/overview) |
| pnpm, Installation | npm 설치 시 Node 22.13+ 안내 | [공식](https://pnpm.io/installation) |
| Turborepo, Installation | 수집 도구 오류로 내용 미확인 | [재확인](https://turborepo.com/docs/getting-started/installation) |
| LangChain, LangGraph Interrupts | 중단·resume·재실행 주의 | [공식](https://docs.langchain.com/oss/python/langgraph/interrupts) |
| LangChain, Durable execution | 수집 실패, 별도 확인 필요 | [재확인](https://docs.langchain.com/oss/python/langgraph/durable-execution) |
| Taskforce, BullMQ Idempotent jobs | 실패/재시도 시 같은 최종 효과 설계 | [공식](https://docs.bullmq.io/patterns/idempotent-jobs) |
| Taskforce, BullMQ Python | Python 패키지 존재 | [공식](https://docs.bullmq.io/python/introduction) |
| PostgreSQL, Explicit Locking | row lock 기반 동시성 | [공식](https://www.postgresql.org/docs/current/explicit-locking.html) |
| WHATWG, Server-sent events | Last-Event-ID·연결 복구 | [표준](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| GitHub, Validating webhook deliveries | webhook 서명 검증 | [공식](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) |
| GitHub, Installation access token | installation 범위 토큰·토큰 형식 변화 주의 | [공식](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) |
| Slack, Verifying requests | raw body 기반 서명 검증 | [공식](https://docs.slack.dev/authentication/verifying-requests-from-slack/) |
| Docker, Engine security | daemon·kernel·권한 경계 검토 | [공식](https://docs.docker.com/engine/security/) |
| Phaser, What is Phaser | 브라우저 2D 표현 적합성 | [공식](https://docs.phaser.io/phaser/getting-started/what-is-phaser) |
| Tiled, Generic file formats | JSON 등 타일맵 교환 형식 | [공식](https://doc.mapeditor.org/en/stable/manual/export-generic/) |

## 6. 데이터 흐름

TypeScript 도메인 계약 → JSON Schema/OpenAPI 산출 → Python validator와 같은 fixture로 검증한다. Zod에서 Python 타입으로 자동 변환된다고 가정하지 않는다. 계약에는 schemaVersion을 두고 major 불일치는 실행 전에 거부한다.

BullMQ Python 직접 소비 대신 Node dispatcher→Python HTTP를 선택했다. Node 큐 제어를 유지하는 대신 HTTP 중복·타임아웃·lease 조정 부담을 수용한다.

## 7. 예외 처리

공식 문서 수집 실패는 기능 부재의 증거가 아니다. 실패 원인을 기록하고 Phase 0 재확인을 gate로 둔다. 버전 불일치 시 lock을 억지로 통과시키지 않고 지원 조합과 대안을 ADR에 기록한다.

## 8. 보안 고려사항

취약점/라이선스·서명·지원 종료를 lock 전 검사한다. SDK 토큰 형식 길이를 하드코딩하지 않는다. 외부 가격표/모델은 검증 전 실청구액이나 지원을 보장하지 않는다.

## 9. 구현 우선순위

가장 먼저 Node/pnpm/Next/Hono/SSE/DB 조합을 고정한다. 이후 Python/체크포인트, 큐 전달, Sandbox를 작은 수직 시험으로 검증한다. 프레임워크 교체는 실패 근거가 있을 때 검토한다.

## 10. 완료 기준

선택 버전·열람일·lockfile·이미지 digest·OS·호환성 시험 결과를 ADR-009에 기록한다. 재현 가능한 설치/마이그레이션/API/SSE/재시작 시험이 통과해야 기술 조합을 검증 완료로 바꾼다.

## 11. 미확정 사항

현재 표의 후보는 설계안이다. 최신 패치·Node/Python 지원 수명·Turbo 내용·Redis 라이선스·provider 가격·Phaser 3 호환 자산은 확인 필요다. 유료 리소스 도입은 별도 승인 대상이다.
