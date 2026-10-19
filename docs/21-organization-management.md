# 조직·프로젝트·업무 관리

## 1. 목적

단일 프로젝트 엔진을 보존하면서 부서·직원·다중 프로젝트·의존성·예산을 운영한다.

## 2. 범위

Phase 3 부서·배정·칸반, Phase 4 다중 프로젝트·예산/권한/통합/이력·DAG/scheduler. B단계는 활성 프로젝트 1개로 제한하되 org/project 식별자를 유지한다.

## 3. 요구사항

Owner는 회사/프로젝트/직원·업무·pause/resume/cancel·예산·승인·평가를 관리한다. 칸반은 8개 task 상태를 한국어로 표시한다.

## 4. 설계 내용

| 영역 | 운영 규칙 |
|---|---|
| 조직 | membership·직원·부서·프로젝트 소유 |
| 부서 | 직원은 초기 0~1개 부서, archive 전 재배치·이력 보존 |
| 프로젝트 | 저장소·직원·task·예산·권한·통합·실행 이력 독립 |
| 배정 | project_agents와 역할/권한을 충족하는 ACTIVE 직원 |
| 카드 | 제목·프로젝트·담당·우선순위·상태·시작 시각·추정/확인 비용·Issue/PR·로그·승인 |
| 칸반 | drag만으로 실행/완료하지 않고 command/gate로 전이 |
| 동시성 | B는 agent당 활성 assignment 1개, 여러 agent는 각 lease/예산으로 실행 |
| 예산 | org/project/agent 중 가장 제한적인 정책 |

의존성은 같은 프로젝트 내 DAG다. 선행 task가 모두 COMPLETED여야 시작한다. 독립 task는 슬롯·예산·파일 충돌 정책이 허용하면 병렬 실행한다. run은 branch/worktree를 공유하지 않는다. cross-project 의존성과 복잡한 조직 계층은 후속 검토한다.

edge 삽입은 프로젝트 lock+경로 검사로 cycle을 막는다. 실행 시작 뒤 의존성 변경은 기존 계획을 재평가한다. scheduler는 priority/대기 시각의 명시 정책을 사용하며 모델이 숨겨진 우선순위를 만들지 않는다.

## 5. 기술적 근거

원문 7/14/17/18장과 [DB 계약](07-database-design.md), [예산 계약](16-cost-management.md)을 따른다. 다중 프로젝트 지원 사실은 구현 시험 뒤에만 표시한다.

## 6. 데이터 흐름

프로젝트→저장소/통합/예산/권한→직원 배정→task/DAG→scheduler claim→workflow→증거/승인→선행 완료 event→후속 eligibility 재검사. 큐 적재 후에도 실행 직전 dependency/권한/예산을 다시 검사한다.

## 7. 예외 처리

선행 실패/취소는 후속을 자동 성공/취소하지 않는다. 후속은 TODO와 blockedReason=DEPENDENCY로 표시하고 run을 만들지 않는다. 활성 run의 외부 응답 대기는 WAITING, 해결 불가 조건은 BLOCKED다. 부서 이동은 실행 snapshot을 바꾸지 않으며 인계는 새 assignment로 기록한다.

## 8. 보안 고려사항

프로젝트 간 Artifact·예산·외부 token을 공유하지 않는다. Owner도 고위험 실행에는 scope 승인이 필요하다. 부서/평가로 도구 권한을 자동 확대하지 않는다. archive 시 신규 실행을 막고 진행 run·승인·보관을 명시 처리한다.

## 9. 구현 우선순위

단일 task 목록→칸반/부서/배정→다중 프로젝트 권한/예산→DAG/scheduler→운영 분석/복구. 고급 조직은 실제 필요 확인 후 추가한다.

## 10. 완료 기준

프로젝트 간 같은 직원의 슬롯/예산 경합, cycle/self-edge/cross-project edge 거부, 선행 실패 표시, 권한 격리, 퇴사 이력, 칸반 gate를 시험한다.

## 11. 미확정 사항

2026-10-19 구현은 URGENT→HIGH→MEDIUM→LOW, 같은 순위는 생성 시각 FIFO다. workflow와 AI 평가의 전체 공급자 슬롯은 1개다. 명시적으로 예약한 task만 scheduler가 검사하며 미예약 업무를 자동 실행하지 않는다. 우선순위 aging·프로젝트별 공정 할당·큰 목록 pagination·별도 관리자 역할은 후속 범위다. 현재 권한 모델은 조직 Owner와 project staffing 경계다.

## Phase 4 구현 범위 — 2026-10-19

프로젝트마다 저장소/기준 branch·staffing·실행 workspace·task/DAG·통합 설정·평가·토큰 정책을 유지한다. 기존 프로젝트의 GitHub/Slack 연결과 비밀은 새 프로젝트에 복제하지 않는다. 조직/프로젝트/직원 한도와 진행 예약을 함께 검사한다. 호출 직전에 Owner membership·직원 상태·project active·선행 완료·예산을 재검사한다. 실제 merge 승인은 기존 별도 경계를 그대로 유지한다.

0~1개 정식 부서 배정과 불변 이동 이력을 추가했다. 이동은 새 직원 profile version이고 과거 실행 snapshot·평가·퇴사 이력은 유지한다. 빈 부서만 보관하며 프로젝트 보관은 활성 run/AI 생성/미해결 merge를 검사한다. 앱의 토큰 정책은 구독 청구 한도가 아니며 [16장](16-cost-management.md)의 미확정 사용량 한계를 따른다. 운영 경보/backup restore/C 출시 gate는 이 기능의 검증과 별도다.
