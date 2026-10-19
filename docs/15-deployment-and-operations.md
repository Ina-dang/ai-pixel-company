# 개발 환경·운영·장애 복구

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
