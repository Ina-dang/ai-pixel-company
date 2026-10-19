# GitHub 연동

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
