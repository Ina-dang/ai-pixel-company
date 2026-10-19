# GitHub 연동

## Phase 3 구현·설정 경계 — 2026-10-19

GitHub App 전용 JWT/installation token, 지정 repository ID·소유자·이름·브랜치 범위, webhook 서명과 durable inbox, Issue/검증 후보 branch/push/draft PR/CI 조회 adapter를 구현했다. `gh` 로그인이나 PAT를 서비스의 App 인증 대체 수단으로 사용하지 않는다. 설정이 없으면 미설정으로 표시하고 원격 쓰기를 거부한다. merge는 범위 재검증 → Owner 승인 → 별도 실행 요청 → 서버 큐의 재검사 순서다. 결과 수락은 merge 승인이 아니다. 실제 merge는 별도 Owner 승인 전 수행하지 않는다.

승인 scope는 installation/repository/connection version, PR 번호·branch·head/base SHA, 검증 후보·run version, squash 방법·정책 버전·필수 CI의 결과와 검사 식별자, 실제 보호/ruleset 해시를 묶는다. 15분 후 만료되며 SHA·CI·정책·권한 변경은 차단한다. Draft·로컬 미수락·mergeability 불명은 승인할 수 없다. 보호 브랜치는 기존 권한으로 정책을 확인할 수 없으면 `BRANCH_PROTECTION_READ_REQUIRED`로 차단한다. 관리자가 별도 승인받아 Administration read를 설치하고 로컬 `protectionRead: true`를 설정한 경우에만 해당 읽기 권한을 요청한다. 권한을 자동 확대하지 않는다.

재시작 중단·timeout은 UNKNOWN으로 남겨 PUT을 자동 반복하지 않는다. 명시적 원격 조회 조정은 PR head/base 범위와 squash commit의 단일 부모(base SHA)를 확인하며 재merge하지 않는다. GitHub REST merge의 `sha`는 head에 대한 서버 측 조건이고 base SHA의 원자적 조건은 지원하지 않는다. 최종 조회와 PUT 사이 원격 base 변경 경합을 완전히 제거했다고 주장하지 않는다. GitHub의 보호 정책을 우회하지 않으며 운영 보호 정책 도입은 별도 범위다.

실제 시험 저장소 PR #2의 head/base·CI·보호/ruleset 조회와 브라우저 차단을 검증했다. 실제 merge 성공은 시험하지 않았다. 자세한 근거와 제한은 README를 따른다. 공식 [Merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)·[Branch protection 권한](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection)은 2026-10-19 열람했으며 개별 변경일은 미공개다.

로컬 설정은 Git에서 제외된 `.local/integrations.json`의 `connections` 배열이다. 각 연결은 `organizationId`, `projectId`, `provider: GITHUB`, `config: {appId,installationId,repositoryId,owner,repo,baseBranch,requiredChecks,policyVersion}`, `secretRefs: {privateKey,webhookSecret}`를 사용한다. 비밀 참조는 `env:AI_PIXEL_GITHUB_PRIVATE_KEY`, `env:AI_PIXEL_GITHUB_WEBHOOK_SECRET` 또는 `.local/integration-secrets/` 아래 파일의 `file:파일명` 형식이다. 실제 키를 코드·화면·채팅에 붙이지 않는다.

App 등록 경로는 [GitHub Apps](https://github.com/settings/apps/new)다. 선택한 시험 저장소만 설치 대상으로 지정한다. 필요 권한은 Metadata read, Contents/Issues/Pull requests write, Checks/Actions/Commit statuses read다. workflow 쓰기·Actions 실행·운영 배포 권한은 요청하지 않는다. 실제 설치/키 준비 후 `pnpm verify:integrations-live`는 메시지·Issue·PR·push 없이 인증과 저장소 head를 조회한다. `pnpm verify:github-live <projectId> <runId>`는 고정 시험 저장소의 실제 외부 쓰기 opt-in 시험이며 성공한 Issue/PR을 재생성하지 않고 CI 조회만 새로 기록한다. 서명 webhook 주소는 `/api/webhooks/github/:connectionId`이며 GitHub가 접근할 수 있는 HTTPS 주소가 있어야 실제 전달을 시험할 수 있다. localhost에 코드가 있다는 것만으로 외부 수신 성공을 주장하지 않는다.

2026-10-19 실제 시험: App `AI Pixel Company Ina-dang`은 비공개 `Ina-dang/ai-pixel-company-integration-tests` 한 곳에 설치됐다. App 작성 Issue #1·draft PR #2·검증 후보 push 및 현재 head의 로컬 Docker 검사 status PASS 조회를 확인했다. 원격 파일 전체와 후보 manifest가 일치했다. GitHub Actions workflow는 생성/실행하지 않았다. 별도 승인한 최대30분 임시 중계에서 실제 ping을 재전달해 HTTP202와 durable PROCESSED·중복1건을 확인했다. 실제 App ping은 installation/repository 없이 hook.app_id를 보내므로 이 event만 서명 후 App ID를 검사한다. 일반 event의 설치/저장소 검사는 유지한다. 일반 CI event의 원격 역순/철회는 별도 미검증이다. 종료 후 Active를 끄고 터널을 닫았다. API의 `configured`는 발행 자격 증명, `webhookConfigured`는 서명 키 유무이며 실제 원격 전달 성공을 뜻하지 않는다.

실제 App 설치·저장소·원격 결과 검증 여부는 README의 최신 검증 결과가 기준이다. 아래 항목은 전체 계획을 보존하며 모의 HTTP 시험을 실제 App 시험으로 대신 기록하지 않는다.

## 1. 목적

실제 branch·Issue·PR·CI를 업무 및 증거에 연결하되 merge는 Owner의 별도 승인으로만 실행한다.

## 2. 범위

Phase 3 GitHub App 설치, repository/branch 조회, branch 생성, commit/push, Issue 생성/조회, PR 생성/조회, 리뷰/CI 상태 동기화, merge 승인 요청을 구현한다. B단계는 로컬 격리 branch/diff로 검증한다.

## 3. 요구사항

작업별 독립 branch/worktree를 쓰고 main 직접 수정·commit을 금지한다. 테스트 결과가 없으면 PR 생성 gate를 통과하지 못한다. branch protection을 우회하지 않는다. 원격 mutation은 설치 범위와 사용자 설정으로 허용된 경우에만 실행한다.

## 4. 설계 내용

GitHub App은 선택한 저장소만 설치한다. 초기 권한 후보는 metadata read, contents read/write(승인된 push), issues read/write, pull requests read/write, checks/actions read다. endpoint별 최소 권한과 organization 정책을 설치 전 재확인한다. workflow 파일 수정 등 추가 scope가 필요한 작업은 기본 거부하고 별도 검토한다.

installation access token은 필요 시 발급하고 SDK/secret store에서 관리한다. 만료/철회 시 상태를 갱신한다. 토큰 문자열의 길이/형식을 가정하지 않는다. repository URL과 installation repository id를 묶어 다른 저장소로 push하지 못하게 한다.

## 5. 기술적 근거

GitHub 공식 [webhook 서명 검증](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), 2026-10-18 열람. API별 권한·rate limit·branch protection 조합은 Phase 3 설치 시험으로 확인한다.

## 6. 데이터 흐름

QA PASS·필수 테스트/빌드 성공·candidate SHA 확정 → PR operation 기록 → scoped credential로 해당 branch push → remote SHA 확인 → draft/일반 PR 생성(프로젝트 설정) → PR ref Artifact 저장 → webhook/조회로 CI 갱신 → 사용자 한국어 보고 → 별도 merge 요청.

merge 승인 scope는 installation/repo/base/head SHA/merge method/정책 버전/CI 결과를 포함한다. 실행 직전 현재 head·필수 checks·branch protection·승인자 권한을 재조회한다. SHA가 변하면 기존 승인은 폐기한다. 결과 수락 승인과 merge 승인을 재사용하지 않는다.

webhook은 raw body와 X-Hub-Signature-256을 constant-time 비교하고 X-GitHub-Delivery를 inbox key로 사용한다. 서명 검증 후 durable receipt를 남기고 비동기로 처리한다. 순서 역전 시 최신 원격 API 상태를 조회해 reconcile한다.

## 7. 예외 처리

Issue/PR 생성 timeout 시 같은 operation을 재조회하고 기존 branch/head/base와 operation marker로 원격 생성 여부를 확인한다. 생성 여부를 확정할 수 없으면 UNKNOWN으로 차단하며 중복 POST하지 않는다. 429/일시 오류는 provider 지침에 따라 제한 backoff한다. 인증 철회·권한 부족·Git conflict는 자동 권한 확대/force push 없이 보고한다. CI 실패는 COMPLETED 근거로 쓰지 않는다.

## 8. 보안 고려사항

clone URL에 토큰을 삽입해 로그에 남기지 않는다. 자격 증명은 필요한 Git operation에만 단기 주입하고 Sandbox 일반 셸에 제공하지 않는다. 비신뢰 저장소의 hooks/submodules/설치 스크립트 실행을 통제한다. git worktree는 샌드박스 내부 또는 격리 clone에서 사용하며 host `.git` 쓰기를 공유하지 않는다.

## 9. 구현 우선순위

설치/읽기 → webhook 서명/중복 → 승인된 push/PR → Issue/CI 동기화 → merge 승인 집행 순서다. 자동 merge 기능은 도입하지 않는다.

## 10. 완료 기준

시험 저장소에서 동일 operation PR 1개, CI/head 일치, webhook 중복/역순·토큰 철회·403·rate limit·merge SHA 변경·승인 이중 소비 거부를 확인한다. 운영 저장소 테스트로 대체하지 않는다.

## 11. 미확정 사항

App 소유자·설치 저장소·GitHub.com/Enterprise 지원·merge 방식·필수 CI 목록은 확인 필요다. 운영 승인과 연동 계정 설정 전에는 실제 외부 쓰기를 실행하지 않는다.
