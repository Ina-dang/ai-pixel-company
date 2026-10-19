# 직원 채용·프로필 관리

## 1. 목적

사용자가 역할 템플릿에서 AI 직원을 채용하고 실제 업무에 배정한다. 채용은 에이전트 프로필·실행 설정 생성이며 모델 학습이 아니다.

## 2. 범위

Phase 1은 고정 PM/Developer/QA, Phase 3은 템플릿 채용·프로필·권한·배정, Phase 4는 인사 운영 확장이다. 자유 직무는 Phase 5 이후 후보로 둔다.

## 3. 요구사항

이름·직무·부서·전문 기술·업무 성향·provider/model·역할 프롬프트·도구/권한·비용 상한/통화·픽셀 캐릭터·채용일을 설정한다. 조회/수정/프로젝트 배정/부서 이동/권한 변경/일시 중지/퇴사/재채용/업무·비용 이력을 제공한다.

## 4. 설계 내용

employmentStatus는 ACTIVE/SUSPENDED/RETIRED다. runtimeStatus(IDLE/RUNNING/WAITING/REVIEWING/BLOCKED/ERROR)는 별도다. 휴직/퇴사는 신규 배정을 막고 고용 event로 남긴다. 퇴사는 agent 삭제가 아니며 재채용은 같은 agent ID에 새 고용 event·profile version을 연결한다.

프로필은 immutable version이다. 역할 prompt·skills·성향·모델·도구·상한·avatar 변경은 새 version을 만든다. run은 profile snapshot을 고정하되 권한 철회·고위험 정책은 tool 호출 직전에 다시 검사한다. 기존 run에 새 권한을 조용히 소급하지 않는다.

도구는 역할 템플릿 범위 안에서 선택한다. 고위험 부여는 Owner 승인 전 활성화하지 않는다. 직원 목록은 재직 상태·실행 상태·현재 업무·기간 비용을 분리 표시한다. 모델 단가와 직원 비용 상한도 구분한다.

## 5. 기술적 근거

원문 7장의 설정·이력 보존·Phase 3 템플릿 채용 요구를 따른다. 설정 생성만으로 역량이 검증되는 것은 아니다. 실제 성능은 [에이전트 평가](14-testing-strategy.md)로 확인한다.

## 6. 데이터 흐름

템플릿 선택 → 한국어 설정 → 모델/도구 지원·예산·권한 검사 → 필요한 승인 → agent/profile/permission/employment event 저장 → project_agents 배정 → PM 후보 → run의 profileRef 고정 → 업무/비용 이력.

## 7. 예외 처리

미지원 모델/도구 조합은 거부한다. 미배정 직원은 실행하지 않는다. 휴직/퇴사 시 진행 중 작업은 안전 중지·인계·취소 중 명시적으로 처리한다. 재배정은 새 agent_run으로 기록하고 이전 결과/비용을 보존한다. 동시 수정은 expectedVersion으로 충돌 처리한다.

## 8. 보안 고려사항

role prompt는 앱 정책을 덮어쓰지 못한다. 채용/평가로 운영 비밀·도구 권한을 자동 부여하지 않는다. provider key는 프로필에 저장하지 않는다. 퇴사 시 lease·도구 세션을 폐기한다.

## 9. 구현 우선순위

3개 템플릿/프로필 상세 → 채용/권한 승인 → 배정/실제 실행 → 휴직/퇴사/재채용·이력 순서다.

## 10. 완료 기준

신규 Developer를 채용·배정해 fixture task를 실제 수행한다. 금지 도구 거부·프로필/예산 추적·퇴사/재채용 후 task/review/usage 보존을 시험한다.

## 11. 미확정 사항

성향 필드·avatar 라이선스·추가 템플릿·모델 설정은 실측 후 정한다. 성향 설정의 성능 개선을 보장하지 않는다.
