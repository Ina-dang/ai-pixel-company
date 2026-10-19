# 개발 환경·운영·장애 복구

## Phase 4 실제 운영 구현 — 2026-10-20

아래 초기 후보 설계와 현재 구현을 구분한다. 활성 경로는 Hono API·PostgreSQL 큐·Codex 구독 worker·Docker Sandbox다. Redis/Python Engine은 ADR-011 이후 활성 경로가 아니므로 이번 복구 시험에서 해당 프로세스를 실행했다고 표시하지 않는다. 운영 배포·실제 merge·새 유료 인프라는 수행하지 않았다.

| 계층 | 실제 구현·경계 |
|---|---|
| 가용성 | `/health/live`는 DB와 독립, `/health/ready`와 기존 `/health`는 DB/점검 상태를 검사한다. 준비 확인은 2초 제한이며 원시 연결 오류를 응답에 넣지 않는다 |
| 계측 | worker heartbeat·lease·큐·실행/평가/통합 상태·완료 토큰/미확정 예약·최근 60초 API 표본 최대1,000·p95/5xx·SSE 연결·프로세스 RSS·Docker/Sandbox 상태. 미보고 사용량/실청구액은 미확인 |
| 로그 | 실제 서버는 requestId/method/정규 route/status/durationMs JSON만 기록한다. URL query·본문·헤더·토큰·비밀은 기록하지 않는다 |
| 경보 | 15초 수집, 같은 원인당 활성 episode 하나, OPEN→ACKNOWLEDGED→RESOLVED와 불변 이력. 확인은 원인 해결이 아니다. 오래된 계측은 정상으로 표시하지 않는다 |
| 알림 | 기존 프로젝트의 고정 Slack 연결만 사용한다. 새 경보/회복 event별 durable outbox, 전송 직전 정책·connection version·점검 상태 재검사. 429는 Retry-After 이상 대기·최대3회, 원격 효과 불명/재시작 SENDING은 UNKNOWN으로 두고 자동 반복하지 않는다 |
| 점검 | 단일 조직 Owner만 호스트 운영 제어/전체 DB 백업을 요청한다. 점검은 새 공급자 호출·외부 dispatch를 막으며 진행 중 호출의 즉시 종료를 보장하지 않는다. 백업 중에는 점검 token을 임의로 해제할 수 없다 |
| SSE | app instance당 연결10개, 조회 batch/보관 cursor 제한, 쓰기 대기5초 초과 시 종료. 재접속은 기존 cursor/snapshot 계약을 따른다 |
| 복구 | 시작 시뿐 아니라 주기적으로 만료 lease를 탐지한다. RECOVERY_REQUIRED/STOP_UNVERIFIABLE/AI 평가 UNKNOWN은 공유 슬롯을 막으며 자동 재호출하지 않는다 |

초기 경보 기준은 큐120초·API p95 1,000ms(20표본 이상)·5xx 3건/60초·worker heartbeat45초·백업24시간이다. 이는 현재 로컬 검증 정책이며 운영 SLA/RPO/RTO 약속이나 자동 백업 일정이 아니다. 원인 확인 없이 경보·UNKNOWN·종료 latch를 삭제해 실행을 재개하지 않는다.

### 백업·복원 절차

`pnpm ops backup` 또는 운영 화면의 별도 확인으로 BACKUP job을 요청한다. 활성 코드/평가/외부 전송이 있으면 drain을 요구한다. source business 데이터를 삭제하거나 강제 중단하지 않는다. 점검 fence를 세운 뒤 동일한 exported PostgreSQL MVCC snapshot에서 `pg_dump`와 테이블 행 수/내용 digest를 읽고, 실행 workspace의 물리 SHA를 checkpoint와 대조한다. 정상 백업 뒤 기존 점검 상태로 돌아가며 실패하면 점검 상태를 남겨 Owner 확인을 요구한다.

백업은 `.local/backups/<id>.aipxbak`, AES-256-GCM 키는 `.local/integration-secrets/backup-key.bin`이다. 키는 백업에 넣지 않으며 둘 다 Git 제외다. 키를 잃으면 암호화 백업을 복원할 수 없다. 파일 SHA256·GCM 인증·manifest/경로/크기/심볼릭 링크 검사를 수행한다. 테이블 digest는 행별 JSON의 정렬된 MD5 multiset과 행 수이며, 암호화 파일/코드 무결성은 SHA256/GCM으로 별도 검사한다.

`pnpm ops restore <backupId>`는 **원본을 교체하는 restore 명령이 아니라 격리 복원 검증**이다. 같은 PG18 image ID로 별도 DB 컨테이너·전용 bridge·고정 loopback 포트·소유 label이 있는 볼륨을 생성한다. IP masquerade를 끄지만 네트워크 egress 차단을 보장한다고 표시하지 않는다. 컨테이너 메모리768MiB/CPU1, dump 최대64MiB 등 현재 소규모 로컬 범위를 사용한다. 인증된 자체 백업만 받으며 사용자가 지정한 원격 URL/임의 파일/임의 Docker 명령은 받지 않는다.

복원 직후 모든 테이블 digest와 코드 SHA를 대조한다. 이어서 RESTORE_QUARANTINE·점검 중단, 기존 세션 폐기·통합 비활성화·task 예약 해제·미소비 merge 승인 철회·대기/진행 외부 전송 UNKNOWN 전환을 적용한다. 복원본에서 예전 호출이나 외부 효과를 재전송하지 않는다. 동일 시험 DB를 실제 중단/재시작하고 가용성 응답과 상태 보존을 확인한다. 원본 workflow/task/평가/결과 수락은 바꾸지 않는다. source의 운영 job/백업/경보 메타데이터는 정상적으로 갱신한다.

시험 종료 시 생성한 UUID/소유 label을 다시 확인한 뒤 그 컨테이너·네트워크·볼륨만 정리한다. 복원 파일은 `.local/restore-verifications/`에 Git 제외로 남는다. RUNNING 중 supervisor가 종료되면 job은 UNKNOWN이며 자동 재실행하지 않는다. 호스트 운영자가 해당 UUID의 파일·프로세스·컨테이너·볼륨을 확인해야 한다. 앱 화면에서 불명 결과를 강제로 성공/미실행으로 바꾸는 경로는 제공하지 않는다.

### 검증과 인계

- `pnpm verify:release`: 실제 lint/typecheck/contracts/test/build 및 Chromium을 실행하고 exit code·개수·출력 hash·현재 source digest를 `.local/operations-evidence/`와 DB에 연결한다. 클라이언트가 C gate의 PASS를 제출하는 API는 없다.
- `pnpm verify:operations-live --backup <id>`: 기존 암호화 백업의 격리 복원·실제 DB 장애/재시작·별도 native worker 강제 종료·자동 재호출 금지·100회 읽기/동시4·실제 GitHub/Slack read-only probe. 모델 호출은 없다. 최초 백업도 만들려면 `--backup`을 생략한다.
- Slack 시험 알림은 위 명령의 명시적 `--notify` 옵션이며 기존 고정 채널에 synthetic OPEN/RESOLVE를 보내고 원래 알림 정책으로 돌린다. 이후 원격 결과가 UNKNOWN이면 반복 시험으로 덮지 않고 먼저 확인한다.
- `pnpm ops status`: Owner 운영 상태 조회(실제 호출 확인). `pnpm ops watch`: API 프로세스 밖에서 readiness 변화를 최대60초 관측하는 수동 CLI다. 상시 supervisor/예약 서비스가 설치됐다는 뜻은 아니다.
- 현장 장애 시 먼저 신규 실행을 점검 중단하고 queued/running/UNKNOWN·lease·outbox·물리 SHA를 구분한다. 기존 Codex native 프로세스의 종료가 불명하면 호스트에서 소유 프로세스 tree를 검증하기 전 latch/lease를 지우지 않는다. 운영 데이터 삭제·원격 재전송·merge·배포는 별도 범위 승인이 필요하다.

### C gate 판정 범위

LOCAL_FIXTURE는 같은 source digest의 24시간 이내 자동/브라우저/복구/부하/외부 근거, 실제 검증한 최근 백업, 실제 Slack 시험 경보·회복 전송, 신선한 계측/worker, 구독/Sandbox 준비, 긴급 경보 없음·점검 해제를 모두 요구한다. 조건이 충족돼도 `READY_FOR_OWNER_REVIEW`이며 자동 출시 승인이 아니다.

운영 C는 **NO_GO**다. Owner 배포 승인·운영 환경·off-host 백업/복구·상시 ingress·범용 저장소/언어 비교·종료 불명 Codex native 프로세스의 자동 조정·독립 host supervisor 권한 분리가 남았다. 현재 고정 명령 supervisor는 로컬 Owner API 프로세스 안에 있고 Docker CLI 권한을 가진다. 모델/Sandbox에 socket을 넘기지 않지만 독립 운영 broker의 OS 권한 분리를 대체하지 못한다. 플랫폼·secret store·RPO/RTO·보관/경보 전달 정책을 확정하고 해당 환경에서 시험하기 전 운영 출시 완료로 표시하지 않는다.

공식 계약 확인: [PostgreSQL18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [Node22 crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html), 열람2026-10-20, 개별 수정일 미공개. 설치 버전과 최신 문서 버전은 별개이며 실제 동작/실패 이력은 README를 따른다.

## 1. 목적

로컬 재현성과 관측·복구를 먼저 확보하고 운영 요구가 확인된 뒤 배포 구성을 결정한다.

## 2. 범위

Local/Development/Staging/Production의 DB·Redis·인증 정보·외부 설치·Artifact 저장소를 분리한다. Kubernetes는 초기 전제가 아니다. 이번 작업은 Compose나 배포 코드를 생성하지 않는다.

## 3. 요구사항

장애 원인·재시도 여부·부분 완료·실행/비용/승인 상태를 보존한다. 일반 웹 서버와 비신뢰 코드 실행 환경은 분리한다. 운영 배포는 Owner 승인 후 수행한다.

## 4. 설계 내용

로컬 후보 구성: web, api, dispatcher(API 코드의 worker 모드), engine(Python), sandbox-worker, postgres, redis. Phase 0은 web/api/postgres만으로 시작하고 Phase 1에 나머지를 추가한다. 내부 HTTP용 Python ASGI 호스팅 adapter는 최소 의존성으로 선택하며 별도 orchestration 제품을 추가하지 않는다.

포트/네트워크는 로컬 웹/API만 loopback에 공개한다. DB/Redis/Engine은 내부 네트워크에 둔다. Sandbox network는 기본 차단하고 필요한 경우 제한된 egress만 별도 proxy로 연다. daemon socket을 app/Engine/Sandbox에 mount하지 않는다. 안전한 sandbox 생성 권한은 제한된 supervisor가 집행하며 구현 방식은 격리 시험에서 확정한다.

아래 값은 **운영 정책 후보**이며 구현 시 자원/부하 시험 후 확정한다:

| 항목 | 초기 후보 | 근거/주의 |
|---|---|---|
| 실행 동시성 | 프로젝트 1개, agent당 활성 assignment 1개 | B단계 복잡도 제한 |
| lease/heartbeat | lease 60초, heartbeat 15초 | lease=heartbeat×4; 중단/지연 시험 필요 |
| HTTP 인계 | 짧은 202 ACK, 장시간 결과는 조회/event | 요청 timeout이 task 실패와 다름 |
| 전송 재시도 | 최대 3회, exponential backoff+jitter | QA 재작업 2회와 별도 |
| SSE heartbeat/poll | 15초 / 1초 후보 | DB 부하·proxy 시험 후 조정 |
| 조회/replay 상한 | page 100, replay 1,000 후보 | 초과는 snapshot 복구 |
| 승인 만료 | 24시간 후보 | 고위험 action별 더 짧게 조정 가능 |
| 데이터 보관 | event 30일, 일반 로그 30일, 결과 증거 90일, 감사 180일 후보 | 법적 의무 확정값이 아님, 사용자/데이터 범위 검토 |
| 작업 timeout/자원 | per-tool 명시, 기본값 미확정 | hardware/저장소별 실험 없이는 실행 불허 |

보관 만료 전 승인/평가/진행 중 task가 참조하는 증거는 삭제하지 않고 별도 archive/검토한다. 퇴사로 이력을 삭제하지 않는다. 원시 음성은 별도 동의 없이는 저장하지 않는다.

## 5. 기술적 근거

원문 24~25장 장애 목록과 로컬 운영 요구를 바탕으로 했다. 컨테이너 격리 한계는 [Docker 공식 보안 문서](https://docs.docker.com/engine/security/), 2026-10-18 열람. Compose 설치/WSL2 사용 가능 여부는 아직 시험하지 않았다.

## 6. 데이터 흐름

structured log는 requestId/taskId/workflowRunId/agentRunId/operationId/eventId를 포함한다. metrics는 실행 직원/대기 작업/성공·실패율/평균·분포 시간/토큰·모델 비용/Sandbox 자원/provider 오류/SSE 연결·지연/outbox backlog·lease 만료를 수집한다. 사용자 알림은 의미 있는 오류·완료·승인 요구에 제한한다.

| 장애 | 분류·대응 | 복구 근거 |
|---|---|---|
| LLM 일시 오류/429 | 같은 논리 호출의 bounded retry, 비용 예약 유지 | request ID/usage 조정 |
| LLM 형식 오류 | schema 재요청 제한 후 BLOCKED/FAILED | invalid response Artifact |
| 토큰/예산 초과 | 신규 호출 중단, 승인 요청 | ledger/reservation |
| Sandbox 오류/timeout | process group 종료, Artifact 보존 | tool exit/status·lease |
| 테스트 실패 | QA 재작업 상한 2회 | candidate별 결과 |
| Git conflict | 자동 force 없이 차단/보고 | diff/base/head |
| GitHub/Slack 장애 | 통합 operation 별도 재시도/UNKNOWN 조정 | inbox/outbox/remote ref |
| DB 장애 | mutation/새 실행 fail-closed, 복구 후 미확정 lease 조정 | transaction/operation ledger |
| Redis 장애/유실 | DB intent 기준 큐 재구성, 실행 중 lease 확인 | outbox+workflow run |
| SSE 단절 | cursor replay 또는 snapshot reset | event log/cursor |
| Engine 비정상 종료 | checkpoint/lease 확인, 기존 tool 종료·조정 후 재개 | checkpoint+operation |
| 승인 중 재시작 | DB 승인 상태/thread_id로 대기 복원 | approval+checkpoint |

## 7. 예외 처리

recoverable transport failure와 permission/schema/요구사항 오류를 구분한다. UNKNOWN 원격 효과는 확인 전 자동 반복하지 않는다. cancellation은 lease 폐기와 외부/프로세스 종료 확인을 분리 기록한다. 부분 결과가 있으면 사용자 보고에 완료된 것/미완료된 것/확인 불가를 구분한다.

backup은 도메인 DB·checkpoint schema·Artifact metadata/실물의 일관성을 포함한다. restore 후 외부 부작용이 과거 상태로 되돌아가지 않았는지 operation을 reconcile한 다음 실행을 재개한다. 복구 시험 없이 backup 존재만으로 복구 가능하다고 표시하지 않는다.

## 8. 보안 고려사항

환경별 secret·권한 분리, 로그 redaction, dependency/image 고정, DB migration rollback/forward 전략, 방화벽·스토리지 접근 통제를 적용한다. 운영 migration/삭제·자원 증설은 승인 범위에 묶는다. root Docker daemon에 접근하는 앱은 금지한다.

## 9. 구현 우선순위

Phase 0 로컬 환경/health/readiness/log/audit 최소, Phase 1 checkpoint/queue/worker 복구, Phase 3 통합 장애, Phase 4 모니터링/backup restore·다중 프로젝트 운영이다.

## 10. 완료 기준

clean 환경 설치·DB migration·seed·종료/재시작·승인 대기 복원·Redis 재구성·backup restore·고아 프로세스 제거 시험이 통과한다. 사용자에게 실제 장애 원인과 재시도 상태가 한국어로 보인다.

## 11. 미확정 사항

배포 사업자·예산·RPO/RTO·부하 목표·관측 저장소·보관 승인·secret store·sandbox supervisor는 확인 필요다. 신규 유료 자원이나 운영 환경을 이 문서로 자동 승인하지 않는다.
