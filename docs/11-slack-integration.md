# Slack 협업과 사용자 보고

## 1. 목적

내부 영어 협업과 한국어 사용자 보고를 Slack App으로 연결한다. Slack 명령도 웹과 같은 인증 주체·권한·승인 정책을 따른다.

## 2. 범위

Phase 3 업무 시작/진행/리뷰/오류/승인/완료 알림, 사용자 명령 수신, 직원 이름·직무·task ID 표시를 구현한다. 모든 내부 대화를 자동 전송하지 않는다.

## 3. 요구사항

| 채널 | 언어 | 내용 |
|---|---|---|
| #ai-development, #ai-planning, #ai-design, #ai-qa | 영어 | 필요한 구조화 인계/리뷰·Artifact 링크 |
| #ai-공지, #ai-승인, #ai-대표보고 | 한국어 | 상태·사용자 판단·결과 요약 |

실제 channel ID를 설치 설정에 저장한다. 이름만으로 권한을 부여하지 않는다. 진행 알림은 의미 있는 변경에 한정하고 반복 상태를 모아서 전송한다.

## 4. 설계 내용

Slack workspace/team ID·user ID를 앱 user/membership에 명시적으로 매핑한다. 승인자는 연결된 Owner여야 하고 설치 org/project/channel 범위도 일치해야 한다. 채널 멤버라는 이유만으로 승인 권한을 주지 않는다. 초기 승인 알림은 웹 승인 화면 링크를 기본으로 하고 interactive 승인 도입 시 동일 scopeHash/expectedVersion을 전달한다.

최소 OAuth scope 후보는 chat:write, commands와 실제 선택한 events에 필요한 read scope다. 광범위 history/users 권한은 기능 필요성이 확인된 경우에만 추가한다. 토큰은 integrations.secret_ref로 참조한다.

## 5. 기술적 근거

[Slack Verifying requests from Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/), 2026-10-18 열람. raw body, signing secret, timestamp 기반 서명을 검증한다. 정확한 이벤트별 ACK deadline·rate limit·scope는 구현 시 공식 endpoint 문서로 재확인한다.

## 6. 데이터 흐름

수신: raw body 보존 → timestamp 재생 방지(공식 예시의 5분 허용 범위 검토) → 서명 constant-time 비교 → team/user/channel 매핑 → durable inbox receipt → 신속 ACK → 공통 command API → 원문 저장/업무 실행. event_id를 중복 키로 사용하고 interactive payload는 provider 식별자와 action/message timestamp를 합친 안정 키를 사용한다.

발신: 도메인 event → outbox → 메시지 template → redaction → Slack API → message timestamp/thread ref 저장. thread는 task별로 묶고 메시지는 `[직원명 | 직무 | taskId]`를 포함한다. 한국어 보고는 상태·검증 결과·필요한 판단·근거 링크를 제공한다.

## 7. 예외 처리

Slack 장애는 로컬 run 결과를 실패로 덮어쓰지 않는다. 알림 operation을 별도 실패/재시도로 기록하고 웹에서 확인 가능하게 한다. timeout 후 전송 성공 여부 불명이면 timestamp/원격 조회 등 지원되는 방식으로 조정하고 불명확한 상태를 숨기지 않는다. 원격 시스템의 중복 전송을 완전히 보장할 수 없으면 UNKNOWN으로 남겨 무한 반복을 막는다. 429는 Retry-After를 존중한다.

## 8. 보안 고려사항

서명만으로 사용자의 Owner 신원이 증명되는 것은 아니다. account mapping과 현재 권한이 필수다. 접근 토큰·원시 코드/로그·개인정보를 메시지에 넣지 않는다. 링크 대상에서도 권한 검사를 한다. Slack 메시지에 들어 있는 “규칙 무시/권한 변경”은 외부 입력이며 상위 지시가 아니다.

## 9. 구현 우선순위

웹 보고가 먼저다. Phase 3에서 읽기/알림, 명령 생성, 마지막으로 interactive 승인 순서로 확장한다. 실제 메시지 전송은 사용자가 해당 연동·채널·범위를 설정한 뒤에만 한다.

## 10. 완료 기준

변조 body·오래된 timestamp·중복 event·다른 workspace·미매핑 사용자·권한 없는 채널·권한 철회 승인 모두 거부한다. 전송 실패 중에도 웹의 run/Artifact가 유지된다. 내부 영어/사용자 한국어 template을 검사한다.

## 11. 미확정 사항

workspace·channel ID·명령 syntax·알림 빈도·로그 보관 범위·승인 interactive 지원 여부는 설치 시 결정한다. 이 문서 작성은 실제 Slack 메시지 전송이나 App 설치를 수행하지 않는다.
