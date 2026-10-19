# API 계약

## Phase 3 명령·merge API 보충 — 2026-10-19

- `POST /api/webhooks/slack/:connectionId`: Slack raw 서명·timestamp·team/channel/Owner를 검증하고 `/ai-pixel` 명령을 durable receipt로 접수한다. HTTP200 ephemeral ACK 후 비동기 처리하며 접수 성공과 task/알림 성공을 구분한다. `response_url`은 보관하지 않는다.
- `GET /api/v1/projects/:id/integrations`: 기존 connections/operations에 `mergeRequests`, `commands`를 추가한다. 명령 처리 결과와 `replyStatus`는 별개다. 원문·비밀/응답 URL·서명은 노출하지 않는다.
- `POST /api/v1/projects/:id/integrations/merges/:requestId/{validate,approve,execute,revoke,reconcile}`: `{expectedVersion,scopeHash}`. Owner session·Origin·CSRF를 요구한다. validate는 원격 읽기만 수행하며 ready/blockers를 반환한다. 나머지는 Idempotency-Key가 필요하다. approve는 승인 기록, execute는 승인한 같은 세션의 별도 실행 큐 요청이다. 실제 PUT 직전 scope·근거·권한을 다시 검사한다.
- reconcile은 UNKNOWN만 원격 조회해 실제 merged PR과 승인 head/base를 확인한다. 원격 PUT/재시도는 하지 않는다. revoke는 REQUESTED/APPROVED/QUEUED만 허용한다. RUNNING 뒤에는 취소 완료를 주장하지 않는다.

대표 차단: `MERGE_VERSION_CHANGED`, `MERGE_APPROVAL_EXPIRED`, `MERGE_SCOPE_CHANGED`, `MERGE_APPROVER_REVOKED`, `RESULT_ACCEPTANCE_REQUIRED`, `DRAFT_PULL_REQUEST`, `BRANCH_PROTECTION_READ_REQUIRED`. 변경 범위·권한은 새 승인 요청이 필요하며 UNKNOWN을 FAILED/미실행으로 숨기지 않는다.

## Phase 3 실제 계약 보충 — 2026-10-19

다음 경로는 `/api/v1` 기준이다. Owner 세션·조직/프로젝트 scope를 적용하며 쓰기는 Origin·CSRF·Idempotency-Key를 검사한다.

| 경로 | 실제 계약 |
|---|---|
| GET /employees/templates | PM/DEVELOPER/QA 템플릿, 도구·구독 모델·상한·avatar |
| GET/POST /employees | 목록 / template·nameKo 및 허용 프로필로 채용 |
| GET/PATCH /employees/:id | 이력 포함 상세 / expectedVersion을 검사하는 새 불변 프로필 |
| POST /employees/:id/employment | action suspend/retire/rehire, expectedVersion |
| GET/PUT /projects/:id/staffing | 배정 목록 / role·employeeId·기존 배정 expectedVersion |
| DELETE /projects/:id/staffing/:role | expectedVersion을 검사하는 배정 해제 |
| GET /projects/:id/integrations | connections·operations·비밀 없는 설정 이름. configured(발행 설정), webhookConfigured(서명 키 설정)를 분리 |
| POST /projects/:id/integrations/operations | kind·runId·expectedRunVersion·선택 title/body. 실제 test/build·동일 SHA QA PASS 및 scope를 재검사하고 durable operation을 202로 반환 |
| POST /projects/:id/integrations/operations/:operationId/reconcile | UNKNOWN GitHub 작업만 읽기 재조회, 중복 발행 없음 |

kind는 ISSUE_CREATE/BRANCH_CREATE/PUSH_CANDIDATE/DRAFT_PR_CREATE/CI_REFRESH/MERGE_REQUEST/SLACK_REPORT다. operation SUCCEEDED는 해당 작업 확인의 성공이며 CI_REFRESH의 실제 검사 판정은 externalRef.status와 headSha·required를 확인한다. MISSING/NOT_PASSED를 검사 통과로 표시하지 않는다. MERGE_REQUEST는 scope 기록만 수행하며 승인·실제 merge를 실행하지 않는다. 실행 응답의 staffing은 해당 실행에 고정된 세 역할 프로필이고 사무실 응답의 employeeId/profileVersion/assignmentStatus는 현재 배정에 맞는 투영이다.

공개 webhook `/api/webhooks/github/:connectionId`, `/api/webhooks/slack/:connectionId`는 Owner 쿠키 대신 raw body 서명·설치/team/channel/user scope와 durable delivery dedupe를 검사한다. Slack의 서명 inbox ACK는 업무 생성·실행·승인 완료를 의미하지 않는다. GitHub installation/token과 Slack 비밀값을 브라우저로 설정하는 API는 제공하지 않는다.

## Phase 2 사무실 구현 보충 — 2026-10-19

`GET /projects/:id/snapshot`은 같은 REPEATABLE READ 트랜잭션에서 `{projectId,cursor,tasks,agents,approvals,syncedAt}`을 반환한다. agents는 PM/DEVELOPER/QA 각 1명이며 직원 state, 별도 taskStatus/runStatus/stage, 연결 taskId/runId, 작업 설명·위치, version, evidenceSha, lastCompletedAt, 완료된 응답 usage, activeAssignments를 포함한다. 원시 프롬프트·파일·검증 로그·lease는 이 투영에 포함하지 않는다. approvals는 실제 WAITING_APPROVAL 실행의 id/runId/taskId/candidateSha/status/version 요약이다.

직원 상태는 서버가 실행/완료 근거에서 계산한다. SSE는 snapshot 재조회 신호이며 브라우저가 최종 상태를 결정하지 않는다. 브라우저는 조직 sequence·이벤트 중복·프로젝트 범위·같은 실행 version 역행을 검사한다. stream.reset은 새 snapshot/cursor로 복구하고 stream.auth-error는 세션과 사무실을 비운다. syncedAt은 서버 시각이다.

새 Sandbox 검증 결과의 test/build에는 실제 실행 argv인 command 배열을 추가한다. 과거 저장 checkpoint와의 호환을 위해 타입에서는 선택 필드지만 새 브로커 실행은 `node --test <실제 테스트 파일들>` 및 `node build.mjs`를 SHA·exitCode·output과 함께 기록한다.

## Phase 1 구독 실행 구현 보충 — 2026-10-19

다음 경로는 /api/v1 기준이며 Owner 세션 인증을 받는다. 쓰기에는 Origin/CSRF·Idempotency-Key가 필요하며 제어/수락에는 expectedVersion을 검사한다. 응답은 {data,requestId} envelope다.

| 경로 | 실제 계약 |
|---|---|
| GET /subscription | ready/reason/authMode/billingMode/windows/checkedAt. 호출·구매 없이 인증/한도 조회 |
| GET /tasks/:id/runs | {items:[run]} 최신 순서, 해당 조직/업무만 |
| POST /tasks/:id/runs | {fixture:"node-functions-v1"}만 허용. 임의 경로/명령/공급자 옵션 거부 |
| GET /runs/:id | status/checkpoint/roles/workspace/verification/usage 및 stopping/resumable. 비밀 token 제외 |
| POST /runs/:id/control | action pause/resume/cancel, expectedVersion. unknown-stop/recovery 재개 불가 |
| POST /runs/:id/accept | candidateSha/expectedVersion. 같은 SHA 변경·test/build0·Sandbox·QA PASS·Owner 후 단일 수락 |

run의 QUEUED/RUNNING/PAUSED/BLOCKED/WAITING_APPROVAL/SUCCEEDED/FAILED/CANCELLED는 task 상태와 구분한다. SSE에 workflow.run.created/updated, agent.completed, approval.requested/resolved를 추가한다. worker는 SUCCEEDED/COMPLETED를 직접 승인하지 못한다. /health는 phase와 worker 구성 여부를 반환하며 실제 구독 준비 상태는 인증된 /subscription에서 확인한다. 최초 Python 내부 HTTP 경로는 ADR-011 대체로 현재 미구현이다.

## Phase 0 구현 보충 — 2026-10-19

`GET /projects`, `GET /projects/:id/tasks`는 `limit=1..100`(기본100)·opaque `cursor`를 받으며 `{data:[],pagination:{nextCursor:string|null},requestId}`를 반환한다. created_at DESC/id DESC keyset으로 조회하고 PostgreSQL 마이크로초 원문을 커서에 보존한다. 브라우저 프로젝트 목록은 끝 페이지까지 조회한다. snapshot은 해당 프로젝트 전체 현재 task를 같은 REPEATABLE READ snapshot으로 반환한다.

세션 응답은 `{data:{user:{id,displayName},organization:{id,name},csrfToken},requestId}`다. pixel_session은 HttpOnly, pixel_csrf는 읽을 수 있는 double-submit cookie이며 두 값 모두 DB에는 SHA-256 hash만 저장한다. 쿠키는 SameSite=Strict, HTTPS 구성 시 Secure다. 변경 요청은 정확한 Origin과 X-CSRF-Token을 검사한다. 초기 Owner 키는 Argon2 hash로 검증한다. Phase 0은 loopback만 지원한다.

공개 API는 임의 task.status 변경을 허용하지 않는다. 상태 이력·완료 거부 시험은 HTTP에 노출하지 않는 검증 seam에서 수행한다. 아래 Phase 1~5 endpoint는 아직 구현하지 않았다. SSE는 작은 frame이 gzip에 버퍼링되지 않도록 identity/no-transform 응답과 Next 압축 비활성화를 적용했다.

## 1. 목적

한국어 사용자 명령, 인증된 상태 변경, 내부 실행 전달, 조회/SSE의 검증 계약을 정의한다. 아래 JSON은 문서용 예시이며 실행 코드가 아니다.

## 2. 범위

외부 `/api/v1`, 내부 `/internal/v1`, 웹훅 `/webhooks`를 분리한다. 모든 public 요청은 조직을 인증 context에서 결정하며 body의 organizationId를 신뢰하지 않는다. API 식별자는 영어, messageKo는 한국어다.

## 3. 요구사항

세션 쿠키(HttpOnly/Secure/SameSite)와 state-changing 요청의 CSRF 토큰을 사용한다. 로컬 전용 인증 상세는 [12](12-security-and-permissions.md). POST 생성/제어/승인에 Idempotency-Key가 필수다. 동일 key·다른 body는 409다. 갱신은 expectedVersion이 필수다. cursor pagination은 opaque cursor와 bounded limit을 사용한다.

## 4. 설계 내용

| Method / 경로 | 목적 / 주요 필드 | Phase |
|---|---|---|
| POST /auth/session, DELETE /auth/session, GET /me | 로컬 Owner 로그인/로그아웃/신원 | 0 |
| GET/POST /projects | 프로젝트 목록/등록, name/repositoryUrl/defaultBranch | 0 |
| GET/PATCH /projects/:id | 설정, expectedVersion | 0 |
| GET/POST /projects/:id/tasks | 목록/한국어 명령, title/commandOriginalKo/acceptanceCriteria/source | 0 |
| GET /tasks/:id | 상태·담당·최근 run·비용·승인 요약 | 0 |
| PATCH /tasks/:id | 시작 전 제목/우선순위, expectedVersion. 임의 status 쓰기 금지 | 0 |
| POST /tasks/:id/start | 실행 요청, expectedVersion | 1 |
| POST /runs/:id/pause, /resume, /cancel | 제어 의도, expectedVersion/reason | 1 |
| POST /tasks/:id/retry | FAILED 작업에 새 run, expectedVersion/reason/budgetRef | 1 |
| GET /runs/:id, /runs/:id/artifacts, /runs/:id/usage | 실행·근거·비용 | 1 |
| GET /artifacts/:id/content | 권한 검사 후 제한 크기의 로그/파일 전달 | 1 |
| GET /approvals, GET /approvals/:id | 승인 목록/정확한 대상·만료·범위 | 1 |
| POST /approvals/:id/decision | APPROVE/REJECT/REQUEST_CHANGES, expectedVersion/scopeHash | 1 |
| GET /projects/:id/snapshot | 업무/직원/승인 snapshot과 cursor | 0 |
| GET /events/stream?projectId=:id&after=:cursor | 인증된 SSE | 0 |
| GET /agents, GET /agents/:id | 직원/현재 업무 | 1 |
| POST /agents | 템플릿 채용, profile/tool/budget/avatar | 3 |
| PATCH /agents/:id, POST /agents/:id/profiles | 인사/불변 설정 버전 | 3 |
| POST /projects/:id/agents | 프로젝트 배정 | 3 |
| POST /agents/:id/retire, /rehire, /suspend | 인사 이력, expectedVersion/reason | 3~4 |
| GET/POST /departments | 부서 관리 | 3 |
| POST /tasks/:id/dependencies | dependsOnTaskId, expectedVersion | 4 |
| GET/POST /reviews, GET /reviews/:id/evidence | 근거 기반 평가 | 4 |
| GET /projects/:id/budget, POST /projects/:id/budget-change-requests | 조회/상한 변경 승인 요청 | 1 최소, 4 확장 |
| GET/POST /integrations, GET /integrations/:id/status | 설치 flow 시작·조회. 비밀 반환 금지 | 3 |
| POST /tasks/:id/pull-request-requests | 검증 SHA의 PR operation 생성 | 3 |
| POST /pull-requests/:id/merge-requests | merge 승인 요청. 즉시 merge 아님 | 3 |
| POST /commands/transcriptions | 확인 전 텍스트 후보만 생성 | 5 |

Phase 0 dashboard에서는 start/AI 실행은 아직 제공하지 않는다. task 전이 저장 시험은 API 도메인 service fixture 또는 명시된 개발 테스트 경로로 수행하며 운영용 임의 상태 변경 endpoint를 열지 않는다.

### 요청·응답 예시

프로젝트 생성, POST `/api/v1/projects`:

```json
{"name":"온고","repositoryUrl":"https://github.com/example/ongo.git","defaultBranch":"main"}
```

```json
{"data":{"id":"project_01","name":"온고","version":1},"requestId":"req_01"}
```

업무 생성, POST `/api/v1/projects/project_01/tasks`:

```json
{
  "title":"여행 일정 저장",
  "commandOriginalKo":"여행 일정 저장 기능을 구현하고 테스트해줘.",
  "source":"TEXT",
  "acceptanceCriteria":[{"id":"AC-1","descriptionKo":"새로고침 후 일정이 유지된다","method":"integration-test","required":true}]
}
```

```json
{"data":{"id":"task_01","status":"TODO","statusLabelKo":"할 일","version":1,"latestRunId":null},"requestId":"req_02"}
```

실행 시작의 HTTP 202 응답:

```json
{"data":{"runId":"run_01","status":"QUEUED","controlVersion":1,"taskId":"task_01"},"requestId":"req_03"}
```

snapshot 응답은 같은 DB snapshot의 상태와 cursor다:

```json
{"data":{"projectId":"project_01","cursor":"41","tasks":[{"id":"task_01","status":"IN_PROGRESS","version":3}],"agents":[],"approvals":[]},"requestId":"req_04"}
```

승인 결정, POST `/api/v1/approvals/approval_01/decision`:

```json
{"decision":"APPROVE","expectedVersion":1,"scopeHash":"sha256:documented-scope-hash"}
```

```json
{"data":{"id":"approval_01","status":"APPROVED","action":"ACCEPT_RESULT","version":2},"requestId":"req_05"}
```

승인 응답 성공은 실제 merge/배포 성공을 뜻하지 않는다. 실행 결과는 operation/event로 조회한다. REQUEST_CHANGES 결정은 해당 승인 기록을 REJECTED로 끝내고 reasonCode=CHANGES_REQUESTED를 결정 메타데이터에 기록하며, 남은 재작업 횟수를 검사한 뒤 새 candidate를 요청한다. 실제 ID는 UUID이며 위 짧은 값들은 가독성을 위한 placeholder다.

## 5. 기술적 근거

Hono Node adapter와 Zod 검증을 사용한다([Hono](https://hono.dev/docs/getting-started/nodejs), [Zod](https://zod.dev/), 2026-10-18 열람). contract 원본은 TypeScript schema로 관리하고 OpenAPI/JSON Schema를 산출해 Python fixture와 비교한다. 실제 스키마 산출 도구는 Phase 0에서 검증한다.

## 6. 데이터 흐름

### Node→Python 작업 전달

| 경로 | 계약 |
|---|---|
| POST Engine /internal/v1/executions | schemaVersion/operationId/workflowRunId/taskId/leaseToken/checkpointThreadId/specRef/profileRefs/policyRef; 202 인계 |
| GET Engine /internal/v1/executions/:operationId | ACCEPTED/RUNNING/WAITING/SUCCEEDED/FAILED/UNKNOWN, checkpointRef |
| POST Engine /internal/v1/executions/:operationId/control | pause/cancel 의도, controlVersion |
| POST API /internal/v1/runs/:id/claim | worker identity/expectedLease, 새 fencing token·만료 |
| POST API /internal/v1/runs/:id/heartbeat | leaseToken, 만료 연장 |
| POST API /internal/v1/runs/:id/events | sourceEventId/schemaVersion/leaseToken/expectedVersion/payload |
| POST API /internal/v1/operations | 도구 실행 전 권한·승인 소비·operation 등록 |
| POST API /internal/v1/operations/:id/result | leaseToken/status/artifactRefs/remoteRef |
| POST API /internal/v1/budget/reserve, /settle | operationId/accountRefs/amount 또는 usageRef |

Engine 인계 예시:

```json
{"schemaVersion":1,"operationId":"op_01","workflowRunId":"run_01","taskId":"task_01","leaseToken":"7","checkpointThreadId":"run_01","specRef":"artifact_spec_01","profileRefs":["profile_01"],"policyRef":"policy_01"}
```

Engine은 요청의 ID/tenant/lease를 내부 API에서 재검증한다. 토큰은 secret store의 service credential로 전달하며 queue payload에 넣지 않는다. HTTP timeout은 새 operation 생성 사유가 아니다. worker는 기존 operation을 조회한다. 완료 callback 유실은 재조회/reconcile로 복구한다.

## 7. 예외 처리

| HTTP | code | 의미 |
|---|---|---|
| 400/422 | INVALID_INPUT / SCHEMA_UNSUPPORTED | 잘못된 입력/계약 버전 |
| 401/403 | AUTH_REQUIRED / FORBIDDEN | 신원/권한/CSRF 실패 |
| 404 | NOT_FOUND | 접근 불가 조직 자원은 존재 노출 안 함 |
| 409 | VERSION_CONFLICT / INVALID_TRANSITION / IDEMPOTENCY_MISMATCH / STALE_APPROVAL / LEASE_STALE | 경합·오래된 실행 |
| 412 | EVIDENCE_REQUIRED | 테스트/QA/증거 미충족 |
| 429 | RATE_LIMITED / BUDGET_BLOCKED | 속도·비용 한도 |
| 503 | DEPENDENCY_UNAVAILABLE | DB/큐/엔진 장애 |

```json
{"error":{"code":"EVIDENCE_REQUIRED","messageKo":"테스트 결과를 확인할 수 없어 완료 처리할 수 없습니다.","details":{"missing":["build"]},"retryable":false},"requestId":"req_06"}
```

재시도 가능 오류는 Retry-After/backoff를 적용한다. UI는 코드로 분기하며 오류 문구를 파싱하지 않는다. SSE cursor 복구는 [06](06-event-driven-design.md)의 control event를 따른다.

## 8. 보안 고려사항

웹훅은 브라우저 쿠키 인증 대신 provider raw-body signature·delivery dedupe·설치 scope로 검증한다. 내부 API는 서비스 인증과 operation scope/lease를 함께 요구한다. 로그/Artifact는 signed storage URL 발급 전에도 조직·프로젝트 검사를 한다. arbitrary storage path나 command 문자열을 public API로 실행하지 않는다.

## 9. 구현 우선순위

Phase 0 auth/project/task/snapshot/SSE → Phase 1 run/approval/evidence/cost/internal → Phase 3 채용/통합 → Phase 4 조직/평가 → Phase 5 STT다.

## 10. 완료 기준

OpenAPI 계약·요청/응답 fixture·인증/권한·CSRF·중복 key·cross-tenant·stale version/lease·승인 이중 소비·SSE 복원 integration test를 통과한다. 모든 public 필수 error에 한국어 문구가 있다.

## 11. 미확정 사항

rate limit·페이지 최대 크기·Artifact 다운로드 상한·세션 TTL은 Phase 0에서 고정한다. Phase 5 미구현 API는 404/feature unavailable로 명확히 처리하고 가짜 STT 결과를 반환하지 않는다.
