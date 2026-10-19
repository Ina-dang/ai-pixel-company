# 픽셀 사무실 설계

## Phase 2 실제 구현 — 2026-10-19

Phaser3.90.0 client-only Canvas renderer·896×512/32px Tiled JSON·3직원·5공간을 구현했다. 기본 목표30fps, reduced-motion과 탭 비활성/연결 단절에서는 움직임을 멈춘다. 타일·3역할×7동작 sprite atlas는 직접 작성한 procedural pixel art이며 CC0-1.0이다. 외부 이미지/폰트는 사용하지 않는다. 원본/라이선스는 office-map.json properties와 office-art.ts에 기록한다. Phaser 의존성은 MIT다. 기존 지정 Phaser3를 유지하며 최신 기본 문서의 Phaser4 API와 구분해 버전 문서/실제 빌드를 검증했다.

API snapshot은 동일 repeatable-read/조직 cursor에서 정확히 PM/DEVELOPER/QA 3명 및 실제 pending approval을 조회한다. 역할별 활성 실행을 우선하고 완료된 역할은 실제 evidence 완료 시각으로 선택한다. 과거 결과의 늦은 Owner 수락이 최신 QA를 덮지 않도록 회귀 검증한다. 전체 활성 배정 수는 조회 cap으로 잘리지 않는다. 테스트·빌드 VERIFY와 QA 단계는 QA REVIEWING이지만 구체 단계는 상세에서 구분한다. task/run/직원 상태는 각각 표시한다.

브라우저는 서버 snapshot만 투영한다. SSE event ID·조직 cursor·동일 실행 version을 검사하고 요청을 직렬화/병합한다. 초기 snapshot 실패도 재조회 후 SSE를 복구한다. 명시적 stream.reset은 새 snapshot/cursor로 시작한다. 그래픽 실패 시 키보드 가능한 직원 목록·상세를 유지하며, 직원 선택이 승인을 수행하지 않는다. 390px에서는 지도를 축소하고 동일 정보는 DOM으로 읽는다. 그래픽 해제·권한 철회·project 전환 시 장면을 정리한다.

검증: 실제 PG projection19개·브라우저 사무실7개·순서/맵 단위8개. 모든 안정 interaction point 사이 경로64개를 collision grid에서 확인했다. 정확한 전체 검사/실제 모델 연동 결과는 README를 따른다. 원래 전체 확장 설계는 아래에 보존한다.

## 1. 목적

AI 직원의 실제 실행 상태를 읽기 쉬운 픽셀 공간으로 표현한다. 표현 엔진의 동작이 실제 실행 성공을 결정하지 않는다.

## 2. 범위

Phase 2에 Phaser 3 client scene·Tiled JSON tilemap·직원 캐릭터·상태 말풍선·업무 패널을 추가한다. 서버실/디자인/리서치/인사 공간은 실제 부서 수요가 있을 때 확장한다.

## 3. 요구사항

대표실·개발 작업 공간·회의실·QA 검토 공간·공용 공간을 둔다. 직원 클릭으로 현재 업무·run·상태·승인·근거·비용을 보여준다. 한국어 라벨, 여러 직원 동시 표시, 중복 제거, 재접속/새로고침 복원이 필수다.

## 4. 설계 내용

| 서버 사실 | 목표 위치/행동 | 한국어 표시 |
|---|---|---|
| assignment.created | 역할별 책상으로 이동 | 업무를 배정받았어요 |
| RUNNING | 책상 타이핑 | 작업 중 |
| REVIEWING | QA 공간·검토 | 검토 중 |
| WAITING | 현재 위치에서 대기 | 응답 대기 |
| IDLE | 공용 공간·휴식 | 대기 중 |
| BLOCKED | 현재 위치·차단 아이콘 | 진행 불가 |
| ERROR / run.failed | 경고 아이콘 | 오류 발생 |
| approval.requested | 대표실 이동, tool/결과 승인 구분 | 승인을 기다리고 있어요 |
| task COMPLETED | 일회성 완료 표현 후 휴식 | 업무를 완료했어요 |
| meeting event(후속) | 회의실 | 회의 중 |

직원 상태가 RUNNING이어도 오래된 완료 이벤트를 재생하지 않는다. 현재 업무 panel에는 task와 agent 상태를 함께 표시한다. 고정 한국어 문구를 사용하며 애니메이션마다 LLM을 호출하지 않는다.

Tiled layer 계약: floor/walls/furniture/collision/interactionPoints. interaction point는 desk:role/owner/qa/lounge/meeting 같은 안정 ID를 사용한다. sprite atlas는 idle/walk/type/review/wait/error/complete state를 제공한다. 선택한 Phaser 3 버전으로 JSON/atlas 로딩을 시험한다.

React가 서버 snapshot/SSE projection을 소유하고 Phaser adapter는 의미 있는 상태 변경만 전달받는다. Phaser는 client-only dynamic import로 만들고 scene destroy 시 listener·timer·texture 사용을 정리한다. UI 상세 패널은 DOM으로 구현해 키보드 접근과 텍스트 가독성을 제공한다.

## 5. 기술적 근거

[Phaser 공식 개요](https://docs.phaser.io/phaser/getting-started/what-is-phaser), [Tiled 교환 형식](https://doc.mapeditor.org/en/stable/manual/export-generic/), 2026-10-18 열람. 브라우저 2D/타일맵 적합성은 확인했지만 Phaser 3와 선택 자산의 실제 로딩/SSR 시험은 미실행이다.

## 6. 데이터 흐름

DB snapshot+cursor → React projection → character state map → target animation. SSE 이벤트는 projection reducer에서 eventId/aggregateVersion 검사를 통과한 뒤 적용한다. 재접속 replay에서는 현재 위치를 최종 상태로 맞추고 과거 완료 효과를 반복하지 않는다. pathfinding 지연은 시각 표현만 지연시킨다.

## 7. 예외 처리

SSE 단절 시 “연결 복구 중”과 마지막 동기화 시각을 표시한다. 캐릭터가 움직인다고 작업 중이라고 단정하지 않는다. 알 수 없는 직원은 fallback sprite와 서버 상태 라벨을 사용한다. 자산 실패/그래픽 미지원 시 DOM 직원 목록이 계속 작동한다. 탭 비활성 시 animation을 줄이고 복귀 때 snapshot을 재검사한다.

## 8. 보안 고려사항

말풍선/직원 이름/업무 설명은 text로 렌더링한다. 비밀·원시 tool 출력은 말풍선에 넣지 않는다. 자산 외부 URL·원격 코드 로딩을 허용 목록으로 제한한다. 클릭이 승인으로 오해되지 않도록 승인 action은 별도 확인 UI에서 처리한다.

## 9. 구현 우선순위

먼저 정적 맵과 3명 상태 전환 → 실제 snapshot/SSE → 상세 패널 → 동시 동작/복원 → 접근성·성능 순서다. 회의 시뮬레이션은 Phase 5까지 보류한다.

## 10. 완료 기준

실제 Dev/QA run 이벤트, 승인 대기, 오류, 완료가 올바른 상태로 표시된다. 새로고침/중복 replay/역순 이벤트에도 서버 최종 상태와 일치하고 Phaser 오류가 실행 엔진에 영향을 주지 않는다. 키보드로 직원 상세에 접근할 수 있다.

## 11. 미확정 사항

타일 크기·화면 해상도·FPS 목표·모바일 범위·캐릭터/타일 라이선스는 확인 필요다. 기본 3명과 동시 표시 시험을 먼저 통과한 뒤 규모를 확장한다.
