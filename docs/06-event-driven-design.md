# 이벤트와 실시간 상태

## 1. 목적

DB 상태와 픽셀/대시보드를 일치시키고 중복·역순·재접속·새로고침을 복구한다.

## 2. 범위

서버 도메인 이벤트, outbox, 내부 수신 중복 방지, 조직별 SSE cursor와 클라이언트 projection을 정의한다.

## 3. 요구사항

필수 필드는 eventId/runId/taskId/agentId/sequence/timestamp/type/payload다. 실행 외 이벤트에서는 연관 ID를 null로 허용한다. organizationId·projectId·schemaVersion·aggregateVersion을 추가한다.

## 4. 설계 내용

```json
{
  "schemaVersion": 1,
  "eventId": "evt_01",
  "organizationId": "org_01",
  "projectId": "project_01",
  "runId": "run_01",
  "taskId": "task_01",
  "agentId": "agent_dev",
  "sequence": "41",
  "timestamp": "2026-10-18T01:00:00Z",
  "type": "task.status.changed",
  "aggregateVersion": 3,
  "payload": {"from": "PLANNING", "to": "IN_PROGRESS", "labelKo": "진행 중"}
}
```

sequence는 조직별 영구 증가 bigint이고 JSON에서는 정밀도 손실을 막기 위해 문자열이다. organization_event_counters row를 트랜잭션 초기에 lock해 increment한다. **해당 조직의 모든 이벤트 transaction은 이 lock을 먼저 얻고 commit까지 유지**한다. 이렇게 commit 순서보다 늦게 나타나는 작은 cursor를 막는다. 단순 bigserial 할당 순서만으로 commit 순서를 보장한다고 가정하지 않는다. 초기에는 이 직렬화 비용을 수용하고 규모가 커지면 별도 ADR로 재설계한다.

| type | payload 핵심 | 사용자 영향 |
|---|---|---|
| project.created / task.created | id, version | 목록 추가 |
| task.status.changed | from, to, version | 칸반/상태 |
| agent.status.changed | status, activeAssignmentId | 픽셀/직원 |
| assignment.created / closed | taskId, agentId | 담당 업무 |
| run.started / paused / resumed / failed / cancelled | reasonCode, checkpointRef | 실행 제어 |
| artifact.created / verification.recorded | ref, hash, SHA, result | 증거 패널 |
| approval.requested / decided | purpose, action, scopeHash, status | 승인 UI |
| usage.recorded / budget.blocked | estimatedCost, currency, reason | 비용 UI |
| integration.operation.changed | operationId, status | 원격 결과 |

## 5. 기술적 근거

WHATWG는 EventSource 재접속에 Last-Event-ID를 정의한다. [공식 표준](https://html.spec.whatwg.org/multipage/server-sent-events.html), 2026-10-18 열람. 도메인 replay·권한·보관 범위는 이 프로젝트가 구현해야 하는 계약이다.

## 6. 데이터 흐름

Engine/worker가 sourceEventId·operationId·leaseToken을 포함해 API에 제출 → API가 inbox 중복/권한/version 검사 → counter lock → 상태+event+outbox 같은 transaction commit → relay가 큐/외부 알림 전달. SSE는 DB event log를 조회하며 Redis pubsub 유실에 의존하지 않는다. 초기엔 제한된 간격의 DB 조회를 쓰고 fanout은 후속 최적화한다.

snapshot API는 REPEATABLE READ transaction에서 상태와 조직 cursor를 함께 읽는다. 웹은 snapshot을 그린 뒤 `after=cursor`로 SSE를 연결한다. snapshot 이후 commit은 replay에 포함된다. 재접속 시 Last-Event-ID가 우선하며 첫 연결은 after를 사용한다. cursor는 인증 조직 범위로 검증한다.

SSE frame 예시:

```text
id: 41
event: task.status.changed
data: {"eventId":"evt_01","sequence":"41","schemaVersion":1,"payload":{"to":"IN_PROGRESS"}}

```

정규 payload는 위 envelope 전체다. 예시 frame은 읽기 편의상 일부 필드를 생략했다. heartbeat는 comment로 보내며 eventId/cursor를 진전시키지 않는다. API는 `text/event-stream`, cache 방지, proxy buffering 해제와 연결 종료 처리를 적용한다.

## 7. 예외 처리

서버 replay는 sequence 오름차순이다. 클라이언트는 eventId로 중복 제거하고 aggregateVersion이 낮은 갱신은 무시한다. 알려지지 않은 schema/type은 완료 애니메이션으로 대체하지 않고 재동기화한다. 보관 기한 이전 cursor는 `stream.reset` control event를 보내 연결을 닫고 새 snapshot을 요구한다. 브라우저가 HTTP 오류 body를 읽는 것에 의존하지 않는다.

권한 필터로 sequence가 건너뛰어도 정상이다. 서버는 조회한 범위의 마지막 cursor를 `stream.cursor` control event로 알릴 수 있다. 미전송 업무 내용은 포함하지 않는다. backlog가 상한을 넘으면 snapshot 복구를 요청한다. 재시도는 backoff+jitter, terminal 인증 실패는 무한 재접속하지 않는다.

## 8. 보안 고려사항

SSE는 읽기 권한을 연결/재연결 때 검사하고 권한 철회 시 닫는다. 토큰을 URL에 넣지 않는다. 인증 조직 cursor 외 데이터는 조회하지 않는다. 메시지 본문·비밀·긴 로그는 이벤트 대신 권한 검사된 Artifact 참조로 전달한다.

## 9. 구현 우선순위

Phase 0 이벤트/snapshot/replay, Phase 1 worker inbox/outbox, Phase 2 Phaser adapter, Phase 3 외부 webhook inbox 순서다.

## 10. 완료 기준

중복·역순·counter 동시 commit·snapshot 중 상태 변경·재접속·retention reset·권한 철회·브라우저 reload 시험 후 최종 projection이 DB snapshot과 같아야 한다.

## 11. 미확정 사항

poll 주기·최대 replay 개수·event 보관 기간은 운영 부하와 개인정보 범위를 확인한 후 고정한다. 초기 후보는 [15](15-deployment-and-operations.md)에 있다. exactly-once 전송을 주장하지 않는다.
