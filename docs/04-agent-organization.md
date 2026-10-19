# AI 직원 조직과 실행 계약

## 1. 목적

역할별 책임·도구·결과물을 고정해 AI의 자기 판단이 권한이나 완료 판정을 대체하지 않게 한다.

## 2. 범위

Phase 1은 PM·Developer·QA 세 직원 프로필이다. Phase 3 이후 실제 필요가 생길 때 Planner/Frontend/Backend/Designer/Research/DevOps 템플릿을 추가한다.

## 3. 요구사항

직원별 역할 프롬프트·모델·성향·도구 권한·상한·프로젝트 배정을 저장한다. 모든 직원이 동시에 실행될 필요는 없다. 프로필 변경은 실행 중 버전을 덮어쓰지 않는다.

## 4. 설계 내용

| 역할 | 책임 | 허용 도구 | 산출물 | 금지 |
|---|---|---|---|---|
| PM | 한국어 요구 분석·영어 명세·분해·담당 지정·보고 | read repository metadata, task planning, evidence read | planVersion, acceptanceCriteria, task graph, reportKo | host shell, 임의 승인, 테스트 성공 조작 |
| Developer | 저장소 분석·코드/테스트 수정·테스트/빌드 실행 | sandbox read/write/git/test/build | diff, SHA, changedFiles, command artifacts | main 직접 변경·merge·운영 접근 |
| QA | 수용 기준·같은 SHA·출력·영향 검토 | read artifacts, isolated test execution | PASS/FAIL/UNVERIFIABLE, criterion evidence, rework reasons | Developer 결과 무검증 승인·코드 자동 merge |

QA가 실행한 재검증은 원래 Developer 결과와 구분해 기록한다. QA에게 필요한 검증 snapshot은 읽기 전용으로 제공하고 수정이 필요하면 Developer에게 요청한다.

역할 프롬프트 버전, 모델 식별자, 허용 도구 snapshot, 정책 버전, temperature 등 공급자가 지원하는 설정을 run에 고정한다. 지원하지 않는 모델 설정을 임의 전달하지 않는다.

## 5. 기술적 근거

역할은 별도 모델 학습이 아니라 프로필/실행 정책이다. 같은 모델을 써도 PM·Dev·QA 입력/도구/결과물 계약은 독립적이다. 모델만 다르게 하면 독립 검증이 보장되는 것은 아니다.

## 6. 데이터 흐름

```json
{
  "schemaVersion": 1,
  "taskId": "task_01",
  "runId": "run_01",
  "role": "DEVELOPER",
  "specVersion": 1,
  "objective": "Implement itinerary persistence.",
  "acceptanceCriteriaIds": ["AC-1", "AC-2"],
  "artifactRefs": ["artifact_plan_01"],
  "constraints": {"maxRework": 2, "networkPolicy": "DENY_BY_DEFAULT"}
}
```

내부 메시지는 영어이며 긴 원문/코드 대신 version/hash가 있는 Artifact 참조를 전달한다. 한국어 UI 문구/경로/수치는 원형 보존 필드로 따로 유지한다.

## 7. 예외 처리

모델 응답은 schema 검증을 거친다. 필수 항목 누락/도구 오용은 제한된 재요청 후 `MODEL_OUTPUT_INVALID`로 중단한다. PM이 범위를 정하지 못하면 사용자 질문으로 전환한다. 실패 때문에 직원 권한을 자동 확대하지 않는다.

## 8. 보안 고려사항

도구의 최종 허용 집합 = 조직 정책 ∩ 프로젝트 정책 ∩ 직원 권한 ∩ 실행 승인 범위. 프롬프트는 정책 집행 수단이 아니다. Tool gateway가 모든 호출에서 검사한다. provider 비밀은 LLM gateway/Engine에만 두고 Sandbox에 전달하지 않는다.

## 9. 구현 우선순위

고정 프로필 3개와 순차 workflow를 먼저 실증한다. Phase 3 채용과 모델 설정, Phase 4 성과 분석을 추가한다. 복잡한 자율 회의나 다중 토론은 Phase 5 후보로 남긴다.

## 10. 완료 기준

각 역할이 필요한 Artifact만 보고 작업하고, 금지 도구가 실제 거부된다. 프로필 변경 후 기존 실행은 고정 snapshot으로 재현되고, 권한 철회는 실행 직전 다시 반영된다.

## 11. 미확정 사항

첫 모델 조합·context 한도·출력 길이·모델별 실패 분류는 평가로 정한다. 특정 모델이 특정 직무에 가장 적합하다는 공개 근거를 여기서 주장하지 않는다.
