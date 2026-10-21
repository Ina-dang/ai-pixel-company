# Slack 협업과 사용자 보고

## 업무 중심 보고 후속 — 2026-10-21

결과 보고·업무 등록 응답·상태 조회를 업무명 → 변경 요약 → 검증 결과 → 다음 할 일 → 업무 상세 링크 순서로 표시한다. 상태 조회는 같은 조직·프로젝트의 최근 업무 3건과 업무별 최신 실행을 읽는다. 업무 등록은 미실행, 실패·중단은 중단 사유 확인, 검토 대기는 수락 여부 결정, 수락 완료는 후속 업무 결정으로 안내한다.

변경 설명은 현재 후보와 일치하는 Developer의 첫 설명 문장만 사용한다. 개발 당시의 미검증 단서는 현재 테스트 판정과 섞지 않는다. 검증 결과는 같은 후보 SHA의 서버 test/build exitCode·QA verdict/issue에서 읽고, 없는 결과를 성공으로 표시하지 않는다. 원시 코드·검증 로그는 Slack에 보내지 않는다. 사용자/모델 문자열의 mention·링크 구문을 차단하고 길이를 제한한다. 공식 [Slack 메시지 형식](https://docs.slack.dev/messaging/formatting-message-text/)의 링크·특수문자 규칙을 2026-10-21 확인했다(개별 변경일 미공개).

상세 링크는 로컬 `127.0.0.1:3000/?project=…&task=…#task-inspector`이며 로그인·프로젝트 접근 검사를 유지한다. 다른 기기용 운영 주소는 제공하지 않는다. 확인된 checkpoint delivery의 같은 후보·저장소·Git 커밋만 바로가기로 표시한다. 보고를 보내도 task/run 상태·수락·merge·배포는 변경하지 않는다.

`how-to-trash-v1`의 Slack 보고는 승인 manifest·로컬 snapshot·admissionSha를 포함한 파일 해시를 대조한다. 이 예외는 Slack 보고에만 적용하고 기존 GitHub 시험용 manifest 제한은 유지한다. snapshot을 확인할 수 없으면 발신을 거부한다. 실제 how-to-trash 프로젝트는 기존 `내손비/#ai-pixel-test`로 발신 연결만 추가했으며 userMappings는 비어 있어 명령 권한이 추가되지 않는다.

실제 outbox operation `f1160e36-851c-4510-9ee7-e59add4cab2c`는 SUCCEEDED이며 [Slack 메시지](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792541692107489)를 별도 connector로 읽어 다섯 항목·커밋 `7b07edc`를 확인했다. 발신 전 이미 결과는 SUCCEEDED·version42였고 발신 뒤 상태·version·turn6은 그대로였다. 1건을 발신한 뒤 같은 봇 메시지의 개발 당시 단서를 제거하도록 수정했다. 새 유료 API·직원 실행·터널·수락·merge·운영 배포는 실행하지 않았다. 이번에는 외부 slash command 수신을 재시험하지 않았으며, 명령 처리·중복 방지·권한 철회는 분리된 DB의 통합 테스트로 검증했다.

첫 실제 발신 전 검사는 수락 완료 상태와 기존 시험 전용 manifest 제한 때문에 각각 중단됐으며 메시지는 보내지 않았다. 이후 원래 저장소 검증 경계에 맞춰 보완했다. UNKNOWN 알림은 여전히 자동 재발행하지 않는다.

## Phase 3 구현·설정 경계 — 2026-10-19

Slack 전용 bot token, 고정 team/channel·Owner user mapping, raw body 서명/재생 방지·durable inbox와 한국어 결과 보고 adapter를 구현했다. `/ai-pixel 도움말|help`, `상태|status`, `업무|task <원문>`은 durable receipt 후 신속하게 HTTP200 ephemeral ACK하고 큐에서 처리한다. 접수 응답은 업무 생성·실행·승인 성공을 뜻하지 않는다. interactive 승인과 Slack에서의 실행·결과 수락·merge 명령은 지원하지 않는다.

업무 명령은 웹과 같은 task command/검증·이벤트 경로를 사용하며 원문 공백/줄바꿈과 SHA256을 보존한다. source=SLACK, TODO로 등록하고 수용 기준은 Owner 확인을 요구하는 manual AC-1로 둔다. 모델 실행은 자동 시작하지 않는다. 고정 연결 version과 현재 Owner·조직·프로젝트 권한을 큐 처리 및 알림 전송 경계에서 재검사한다. task 생성·결과 저장은 한 transaction이며 body hash 기반 중복 접수는 새 task를 만들지 않는다.

`response_url`·Slack 검증 토큰은 저장/호출하지 않는다. 처리 결과는 지정 채널로만 전송하고 웹에서 명령 상태와 알림 상태를 구분한다. 알림의 명확한 실패는 FAILED, timeout/재시작 중단 등 전송 여부 불명은 UNKNOWN이며 자동 재전송하지 않는다. 기존 업무/실행 결과는 변경하지 않는다. Owner가 commands scope와 30분 이내 임시 공개를 승인하고 최종 재설치를 직접 허용했다. 실제 TASK/STATUS/HELP 3건과 한국어 알림3건, TODO 업무1건/run0건을 확인했다. 터널 종료 후 상시 수신은 불가하다. 근거는 README를 따른다. 공식 [Slash Command 문서](https://docs.slack.dev/interactivity/implementing-slash-commands/)는 2026-10-19 열람했고 3초 ACK 요건을 확인했다(개별 변경일 미공개).

사진에서 확인한 Slack용 GitHub 앱은 GitHub/Copilot의 앱이며 AI Pixel Company 전용 앱과 인증이 분리된다. [Slack Apps](https://api.slack.com/apps)에서 전용 앱을 준비하고, 사용자 지정 시험 채널만 연결한다. 로컬 설정은 `.local/integrations.json`의 `connections` 중 `provider: SLACK`, `config: {teamId,channelId,userMappings}`, `secretRefs: {botToken,signingSecret}`다. `userMappings`는 Slack user ID→앱 Owner user UUID다. 비밀 참조는 `env:AI_PIXEL_SLACK_BOT_TOKEN`, `env:AI_PIXEL_SLACK_SIGNING_SECRET` 또는 `.local/integration-secrets/` 내 `file:파일명`이다. 토큰 값을 UI·채팅에 입력하지 않는다.

발신 보고에 필요한 기본 OAuth 권한은 `chat:write`다. 수신 commands 사용 시 `commands`를 별도로 설정한다. 수신 주소는 `/api/webhooks/slack/:connectionId`이고 Slack이 접근할 수 있는 HTTPS 주소가 필요하다. 현재 HTTP 서명 adapter는 Socket Mode client를 구현하지 않는다. 설정 후 `pnpm verify:integrations-live`의 read-only 인증 검사와 지정 채널의 실제 보고 시험을 구분한다.

실제 설치·채널 지정·발신·외부 webhook 수신 결과는 README를 따른다. 미설정은 연결 성공이 아니며 모의 전송을 실제 메시지로 기록하지 않는다.

2026-10-19 실제 시험은 `내손비`의 비공개 `#ai-pixel-test` 한 채널로 고정했다. 권한은 bot `chat:write` 한 개이며 event 구독은 없다. 전용 봇의 auth.test identity, 서버 SLACK_REPORT 성공, 별도 connector의 실제 한국어 메시지 조회를 확인했다. 토큰은 Git 제외 `.local/integration-secrets/slack-bot.txt`에서만 읽는다. 별도 Owner 승인으로 Socket Mode를 끄고 임시 HTTPS 주소에서 Slack의 실제 서명된 URL challenge Verified를 확인했다. 종료 후 임시 이벤트 수신과 터널을 껐다. 서명 키 없는 발신은 가능하나 서명 수신은 fail closed한다. `configured`는 발행 설정, `webhookConfigured`는 서명 키 유무이며 원격 수신 성공을 뜻하지 않는다.

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
