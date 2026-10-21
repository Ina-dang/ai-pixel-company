# Slack 협업과 사용자 보고

## Socket Mode 로컬 수신

### Windows 로그인 자동 실행

2026-10-21 후속으로 현재 사용자 전용 Windows 작업 `AI Pixel Company Local API-6AA56973`을 등록했다. 작업명 접미사는 프로젝트 절대 경로의 SHA256 앞8자리이며 다른 checkout과 충돌하지 않는다. [Microsoft 로그온 트리거](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger?view=windowsserver2025-ps), [실행 주체](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps), [작업 설정](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps)(열람 2026-10-21)에 따라 사용자 로그온20초 후 Interactive·Limited 권한으로 숨김 실행한다. 비밀번호·토큰은 작업 인수에 넣지 않고 실행 정책·방화벽·공개 수신 포트를 변경하지 않는다. 로그아웃 상태에서 실행하는 시스템 서비스는 아니다.

프로젝트 루트에서 다음 관리 명령을 사용한다. 설치/갱신 전에는 기존 작업을 중지한다. 작업의 사용자 SID·설명·권한·실행 경로가 다르면 덮어쓰거나 중지하지 않는다.

```powershell
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Status
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Start
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Restart
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Stop
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Uninstall
powershell.exe -NoProfile -File scripts/windows-local-api.ps1 -Action Install -NodePath C:\nodejs\node.exe
```

`Stop`은 현재 실행만 중지하며 다음 로그인에는 다시 시작한다. 로그인 자동 실행 자체를 제거하려면 `Uninstall`을 사용한다. 수동 `pnpm dev`로 개발할 때는 먼저 작업을 Stop하고, 개발 서버를 종료한 뒤 작업을 Start해 포트 충돌을 피한다.

이미 이 PC의 Docker Desktop은 사용자 로그인 자동 시작 설정이 켜져 있었다. 관리 프로세스는 Docker를 최대180초 기다리고 기존 고정 PostgreSQL 이미지·볼륨만 시작한다(`--pull never --no-build`). 이미지 다운로드·빌드·DB 초기화/삭제를 하지 않는다. API 준비 대기는 최대90초, API 오류 시15초 대기 후 최대3번 재시도한다. 최초 포함 최대 실행 시도는 `1 + 3 = 4`회이며 작업 스케줄러 추가 재시도는 설정하지 않는다. 영구 실패는 `.local/windows-api/status.json`에 안전한 오류 코드로 남고 수동 Start/다음 로그인이 필요하다. Docker·설정 부재를 숨기지 않으며 포트3001 점유 시 기존 서버를 종료하지 않고 실패한다.

IgnoreNew 작업 설정과 소유 프로세스 잠금으로 중복 실행을 막는다. 잠금은 PID뿐 아니라 프로세스 생성 시각·Node 실행 경로·프로젝트 관리 스크립트를 검사해 PID 재사용을 구분하며 다른 프로세스를 종료하지 않는다. Stop/Restart는 해당 실행 ID의 제어 파일과 자식 IPC로 정상 종료를 요청하고,45초 내 종료되지 않을 때만 검증된 작업 job을 중지한다. API가 부모 IPC를 잃으면 정상 정리를 시도한다. 로그는 자격 값·DB 주소·WebSocket 주소·개인 키를 가리고 `.local/windows-api/api.log`에2MB 기준으로 순환 보관한다. `.local` 전체는 Git 제외다.

등록된 작업의 실제 시작·정상 중지/재시작 후 Slack 상태 응답을 확인했다. 첫 실행 supervisor/API PID `87264/109792`, 작업 재시작 후 `39880/68516`이었다. 해당 자식 API만 한 번 강제 종료하자 동일 supervisor가 API `110972`를 attempt1로 복구했고 중복 실행 요청은 PID를 바꾸지 않았다. 실제 Windows 로그아웃·재로그인/PC 재부팅은 사용자 세션 보존을 위해 수행하지 않았다. 로그온 트리거 설정 검사와 동일 등록 action의 실행 검증을 구분한다.

PID 재사용 식별 보완을 적용한 마지막 정상 재시작 후 supervisor/API는 `17356/112952`였으며 생성 시각을 포함한 잠금·중복 차단·수신 상태와 동일 명령 근거를 다시 확인했다. Windows가 등록 시 SID를 계정명으로 정규화해 첫 설치 직후 신원 판별이 실패한 이력은 SID 재변환으로 수정했고, 최종 동일 사용자·Limited·Interactive 검사가 통과했다.

실제 Slack 결과는 상태 조회2건과 복구 뒤 사용자가 보낸 도움말1건이다. 마지막 명령은 서버에서 HELP로 분류됐으며 STATUS로 바꾸어 기록하지 않는다. 세 명령 모두 transport=SOCKET·PROCESSED·reply=SENT이고 baseline 대비 업무·직원 실행·merge·연동 작업 변경은0이다. [작업 시작 뒤 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792547587402399), [작업 재시작 뒤 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792547658889609), [API 종료 복구 뒤 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792548446984179)을 각각 대조했다.

`scripts/verify-windows-startup.ts baseline`은 기존 업무·실행·merge·연동 작업과 inbox를 읽기 전용으로 기록한다. `verify 1`, `verify 2`, `verify 3 HELP`는 각 단계의 실제 Socket 명령 분류·응답·동일 작업/포트 소유권을 확인하고 다른 상태가 바뀌면 실패한다. 마지막 명령 분류는 명시적으로 지정하며 기본은 STATUS다. Git 제외 `.local/windows-api-live.json`에 작업 주체·실행 PID·응답 근거를 보관한다.

복구 후 실제 데스크톱·390px 모바일 smoke에서 수신 중 상태·기존 업무 TODO/hash·실행0·처리 기록 총12개를 확인했다. 페이지 오류0·업무 쓰기0·가로 넘침 없음이었다. 최초 실행 래퍼에서 브라우저 종료/빌드 명령의 시간 초과를 관측했으며 동일 브라우저 검사를 native batch 경로로 다시 실행해 정상 종료했다. 첫 전체 검사에서 음성 복구 테스트의 PowerShell 준비가 시간 초과했고 해당8개 단독 재검사는 통과했다. 최종 전체24파일/303개가 통과했으며, 해당 배치의300초 제한으로 건너뛴 뒤 명령은 별도 실행해 lint·typecheck·build·계약 검사를 모두 통과했다. 관리 프로세스 관련 테스트9개도 통과했다. 실패 이력과 최종 성공을 구분한다.

API 자동 실행은 기존 권한/비용 가드와 Socket 연결만 유지한다. 대시보드·운영 배포·merge 권한을 추가하지 않는다. 이 구성에 새 유료 서비스·모델 호출은 없다.

2026-10-21 현재 로컬 명령 연결은 `SOCKET` 모드를 사용한다. 아래 HTTP Request URL·터널 시험 기록은 이전 검증 이력이다. [Slack 공식 문서](https://docs.slack.dev/apis/events-api/using-socket-mode/)(열람 2026-10-21, 변경일 미공개)에 따라 공식 `@slack/socket-mode@3.1.0` SDK와 앱 수준 `connections:write` 토큰으로 외부 발신 WebSocket 연결을 연다. 신규 유료 서비스·유료 API·모델 호출은 사용하지 않았다.

### 로컬 설정과 실행 조건

- Owner가 Slack 설정에서 Socket Mode를 켜고 앱 수준 토큰을 생성한다. 값은 Git 제외 `.local/integration-secrets/slack-app.txt`에 한 줄로 저장하며 채팅·로그에 출력하지 않는다.
- `.local/integrations.json`의 명령용 Slack 연결에 `config.mode: "SOCKET"`, `config.appId`, 기존 team/channel/userMappings와 `secretRefs.appToken: "file:slack-app.txt"`, `secretRefs.botToken`을 지정한다. 기존 how-to-trash 발신 전용 연결의 사용자 매핑은 비워 둔다. 같은 앱 ID의 Socket 수신 연결을 중복 구성하지 않는다.
- 등록된 Windows 로그인 작업 또는 `pnpm dev`/로컬 API 서버가 실행 중이어야 수신한다. PC 절전·종료·네트워크 단절 중 수신 가용성을 보장하지 않는다. SDK로 연결하고 애플리케이션이 재연결 Promise를 처리한다. 연결 후 단절은 1·2·4·8·16·최대30초 간격으로 재시도하며 API를 다시 시작하면 저장된 설정으로 연결한다. 최초 Socket 시작 실패는 안전한 오류 코드를 확인한 뒤 원인을 고치고 API를 재시작한다.
- 대시보드 → 명령 프로젝트 → 연동 현황의 ‘Slack 명령 수신 중/재연결 중/수신 중지/연결 확인 필요’와 마지막 연결·수신 시각으로 상태를 확인한다. 발신 연결의 설정 완료와 수신 중 상태는 별개다.

### 수신 경계

Slack 앱 ID·팀·채널·Owner 매핑·현재 멤버십·조직/프로젝트 활성 상태·연결 버전을 검사한다. HTTP 모드의 원문 서명 검증과 구분하며, Socket 연결에는 HTTP 수신을 허용하지 않는다. 명령은 기존 `/ai-pixel` 도움말·상태·업무 등록만 처리한다. 업무 등록은 TODO를 만들고 실행·수락·merge·배포를 시작하지 않는다.

inbox 영속화 후에만 ACK하고 DB 오류 시 ACK하지 않아 재전달을 받을 수 있다. Slack trigger ID를 중복 기준으로 사용해 envelope ID가 바뀐 재시도도 한 번만 처리한다. response_url·기존 token·WebSocket URL은 inbox에 보관하지 않는다. 과도한 동시 수신은 로컬 무제한 큐를 만들지 않고 ACK를 보류한다. 비활성/버전 변경/보관/유지보수 상태면 연결을 중단한다.

### 실제 검증 근거

`내손비` 비공개 `#ai-pixel-test`, 기존 Owner 매핑·시험 프로젝트 한 개에서 상태 조회·업무 등록·API 재시작 후 상태 조회·오류 수정 후 상태 조회를 실제 Slack UI로 전송했다. 네 inbox 모두 transport=SOCKET·PROCESSED·reply=SENT였다. 업무 `9536ff1c-6d44-42d3-92a3-c28ad0baf8c5` 한 개만 TODO·source=SLACK으로 생성됐으며 한국어 원문·공백 두 칸·SHA256을 보존했다. baseline 대비 모델 실행 증가0·merge 상태 변경0·외부 작업 변경0이다.

- [실제 업무 등록 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792545637706829), [API 재시작 후 상태 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792545678514979).
- `scripts/verify-slack-commands.ts baseline|verify|verify-restart|verify-recovery SOCKET`: 실제 DB 대조, Git 제외 `.local/slack-socket-commands-live.json`에 근거 저장. HTTP 시험 파일과 분리한다.
- `scripts/phase3-slack-smoke.ts <projectId> <taskId> --socket`: 실제 API·데스크톱/390px 모바일에서 연결 상태·처리 기록·업무 상세·원문 hash·실행0 확인. 페이지 오류0·업무 쓰기0·가로 넘침 없음. `.local/browser-evidence/slack-socket-desktop.png`, `slack-socket-mobile.png`를 저장했다. 재시작 후 같은 업무를 포함한 복수 보고 때문에 최초 단일 locator 검사가 실패했으며 모든 일치 보고의 표시 검사로 수정 후 통과했다.
- 최초 장시간 확인 중 SDK 3.1.0 자동 재연결의 요청 실패가 처리되지 않은 Promise 거부로 API를 종료했다. 설치된 공식 SDK의 close/retry 구현을 확인하고 SDK 내부 자동 재연결을 끈 뒤 애플리케이션의 catch·대기 간격·중복 타이머 방지·중지 시 취소를 적용했다. 수정 후 실제 API 연결·Slack 상태 응답과 브라우저를 다시 확인했다. [수정 후 실제 상태 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792546417216509).
- 모의 테스트는 실제 수신과 구분한다. 재연결 요청 거부→대기→복구·타이머 중복/중지, 저장 전 ACK 금지·잘못된 범위·중복·Owner 취소·연결 버전/비활성화를 테스트했다. 실제 네트워크 장기 단절이나 PC 절전 복구는 시험하지 않았다.
- 최종 회귀 검증: 재연결 수정 후 lint·typecheck·build 통과, 전체 Vitest 23파일/294개 통과(수정 전293개도 통과). Chromium 전체49개(수신 연결/재연결 표시 포함) 통과와 수정 후 실제 화면 smoke 결과를 분리해 기록한다.

공개 터널을 새로 열지 않았으며 로컬 API 연결은 시험 후 유지한다. 실제 merge·운영 배포는 수행하지 않았다.

## 실제 상태·업무 등록 후속 — 2026-10-21

Owner가 기존 `내손비/#ai-pixel-test`의 상태 조회1회·시험 업무 등록1회와 Slack POST 한 경로만 최대30분 공개하도록 새로 승인했다. 기존 `/ai-pixel` 명령의 Request URL만 임시 변경했으며 새 scope·설치·user mapping은 추가하지 않았다. 대상은 기존 매핑 프로젝트 `56c54d8a-de76-4400-8308-a63b1bd2adaa`이며 how-to-trash의 발신 전용 연결은 그대로다.

Chrome Slack 작성기에서 `/ai-pixel 상태`와 `/ai-pixel 업무 Slack 명령 실제 검증 20261021-5dd4e94e — 공백  2칸 유지, 자동 실행·수락·merge·운영 배포 금지`를 각1회 전송했다. 본문 재생이나 직접 inbox 주입은 사용하지 않았다. 실제 서명된 요청은 각각 `5cc7d4c4-34f6-408c-8f91-e5ff5199bf7a`, `f30cbea0-c384-4964-a28a-c7fb9b746eda`로 PROCESSED·SENT가 됐고 별도 Slack 조회로 다섯 보고 항목과 정확한 상세 링크를 확인했다. [상태 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792542921422889), [업무 등록 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792542952597479).

상태 조회 직후 업무 증가0건, 업무 등록 후 TODO1건(`852c6d52-0749-4584-bf5b-b0e1e87e3470`), source=SLACK, 한국어 원문·공백2칸·SHA256 보존을 확인했다. 사전 DB snapshot과 비교해 기존 task 상태·조직 전체 run id/status/version/turn·merge 상태·integration operation이 그대로였다. 새 모델 실행·결과 수락·merge·운영 배포는 없었다. 시험 TODO는 삭제·자동 실행하지 않고 남겼다.

`scripts/slack-command-tunnel.ts <connectionId> --approved-30-minutes`는 loopback3002와 지정 Slack POST 한 경로만 연결하고30분 만료 또는 일치하는 sessionId의 로컬 종료 요청에서 중계와 cloudflared를 함께 종료한다. 임시 hostname과 만료·종료 상태는 Git 제외 `.local/slack-command-tunnel.json`에 기록한다. 공식 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)(업데이트2026-09-30), [Slack slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/)(개별 변경일 미공개)를2026-10-21 확인했다. 새 요금제·유료 API·도메인은 사용하지 않았다.

실제 공개 주소에서 대시보드/Owner API/GitHub POST/Slack GET은404, unsigned Slack POST는403이었다. 시험 후 helper/cloudflared 프로세스와3002 listener가 사라졌고 외부 주소는530으로 종료를 확인했다. Slack의 Request URL은 시험 전 주소로 복원한 후 설정을 다시 열어 저장값을 확인했다. 현재 상시 외부 수신은 불가하다.

`scripts/verify-slack-commands.ts baseline|verify`는 실제 명령 전·후의 로컬 DB를 읽어 대조하며 Slack 발신이나 receipt 생성을 하지 않는다. 증거는 `.local/slack-commands-live.json`이다. 최초 비교는 postgres RowList와 JSON 배열의 prototype 차이로 실패했고 실제 행 값을 JSON 정규화해 재검증했다. 명령은 재전송하지 않았다. `scripts/phase3-slack-smoke.ts`로 실제 task 원문 해시·run0건·누적 명령5건(이전3+이번2)의 처리/응답 완료와 데스크톱/390px 화면, 업무 변경0·페이지 오류0을 검증했다. 최종 관련49개(연동34+보고11+중계4)·lint·typecheck·build를 통과했다.

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
