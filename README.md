# AI Pixel Company

최신성 체크: 2026-10-19 공식 문서·패키지 레지스트리·로컬 실행 검증 기준. 열람일과 개별 문서 변경일은 구분한다.

자연어 업무 지시를 PM·Developer·QA AI의 실제 개발 작업으로 연결하고, 검증된 실행 상태를 픽셀 사무실에 표시하는 AI 회사 운영 플랫폼이다.

**현재 상태: Phase 0 기반·Phase 1 구독 실행 핵심 경로·Phase 2 픽셀 사무실을 검증했다. Phase 3 채용·배정·칸반, GitHub App의 실제 Issue/branch/push/draft PR/현재 head 상태 조회, Slack 비공개 채널 보고와 두 공급자의 실제 서명된 webhook 연결 시험을 검증했다. merge 승인 실행기·Slack 명령 처리가 남아 전체 Phase 3 완료로 판정하지 않는다. 코드 실행 대상은 제한된 Node 함수 fixture이며 임의 저장소 실행은 지원하지 않는다.**

- B단계: Phase 0 기반 → Phase 1 실제 AI 실행 → Phase 2 픽셀 사무실.
- C단계: Phase 3 GitHub·Slack·채용 → Phase 4 평가·다중 프로젝트·운영.
- Phase 5: 음성 명령과 고급 조직·모델 최적화. 초기 출시 필수 범위가 아니다.

문서 탐색은 [전체 목차](docs/INDEX.md), 개발 원칙은 [프로젝트 지침](docs/PROJECT_INSTRUCTIONS.md)과 [AGENTS.md](AGENTS.md)를 따른다. 구현 순서는 [로드맵](docs/13-development-roadmap.md), 착수 조건과 검증 결과는 [구현 체크리스트](docs/IMPLEMENTATION_CHECKLIST.md)를 참조한다.

## 설계의 기준

PostgreSQL이 업무 상태의 기준이다. AI의 완료 선언, 큐의 처리 완료, 캐릭터 애니메이션만으로 업무를 완료 처리하지 않는다. 테스트·빌드·QA·승인 근거가 연결되어야 한다. 서버는 상태 변경과 이벤트·전달 의도를 함께 기록하며, 중복 전달은 실행 식별자와 부작용 기록으로 제어한다.

내부 협업은 영어, 사용자 명령·보고·상태·승인은 한국어다. 한국어 원문을 보존하고 영어 명세에 수용 기준과 고유명사를 추적한다. 영어 비용 절감은 가설이며 실측한다.

## 로컬 실행

Node 22.20.0, pnpm 10.15.1, Docker Compose를 사용한다. Python 계약 검증은 Python 3.12.4에서 확인했다. 의존성은 lockfile, PostgreSQL 18.6 및 Sandbox Node 이미지는 digest로 고정했다. 직원 실행은 설치된 Codex CLI 0.162.1의 ChatGPT 로그인을 사용하며 이 버전에서 실제 검증했다.

```text
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:migrate
pnpm db:test:prepare
pnpm dev
```

대시보드: `http://127.0.0.1:3000`, API: `http://127.0.0.1:3001/health`. `pnpm setup:local`은 임의 고엔트로피 Owner 키와 DB 자격 증명을 `.local/`에 생성하며 기존 설정을 덮어쓰지 않는다. 로그인 키는 `.local/owner-key`에서 로컬로 확인한다. 이 디렉터리와 환경 파일은 Git에서 제외한다. 키를 메시지·로그·커밋에 붙여 넣지 않는다. Windows에서는 해당 폴더 접근 권한도 관리한다.

실행 중단은 개발 터미널에서 종료하고, DB는 `pnpm db:down`으로 중지한다. 이 명령은 볼륨을 삭제하지 않는다. 포트 3000/3001/55432는 loopback에만 바인딩한다. 공개 배포용 인증·격리 구성이 아니다.

## Codex 구독 직원 실행

`codex login`으로 기존 ChatGPT 계정에 로그인한다. API 키를 입력하지 않는다. 무료 공식 컨테이너 이미지를 최초 한 번 준비한다. 프로그램은 이미지를 자동 다운로드하거나 유료 자원을 생성하지 않는다.

```text
docker pull node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af
pnpm verify:agents
```

위 마지막 명령은 서버가 실행 중일 때 실제 구독 한도를 사용해 검증 프로젝트·업무를 만들고 PM→Developer→격리 test/build→QA를 수행한다. 기본 `pnpm test`는 모델을 호출하지 않는다. 대시보드의 업무 상세에서도 `검증 프로젝트 실행`으로 같은 제한 fixture를 시작할 수 있다. PM은 영어 명세/AC를 만들고, Developer의 구조화 파일 결과를 capability broker가 실제 파일에 적용한다. QA는 같은 파일 SHA256과 실제 테스트/빌드 근거를 검토한다. AI에 호스트 셸·임의 저장소 경로를 주지 않는다. 결과 수락은 Owner가 별도로 수행한다.

ChatGPT 인증을 강제하고 API 키·공급자 URL·DB 비밀정보 환경변수를 자식 프로세스에 전달하지 않는다. 유료/무제한 크레딧 계정·조회 불가·불명확한 quota·사용률 90% 이상은 차단한다. 실제 한도 소진을 기다리지 않고 보수적으로 미리 멈춘다. 실행 중 5초마다 다시 확인하고 한도 오류에는 재시도/다른 모델/API 전환/크레딧 구매를 하지 않는다. 세 역할과 다른 Codex 사용은 구독 한도를 공유한다.

호출별 180초, 실행별 15분, 최대 7회 모델 호출·2회 재작업(최대 3 candidate)을 제한한다. 500,000 토큰은 완료된 응답 사용량의 다음 호출/승인 차단선이며 공급자 처리 중 토큰 증가를 선제적으로 보장하는 청구 상한은 아니다. 중단되어 공급자가 사용량을 반환하지 않은 호출은 합계에 포함할 수 없으므로 표시된 토큰은 **완료된 응답 합계**다. API 토큰 단가를 구독 청구액으로 환산하지 않는다. 계정의 자동 충전/외부 결제 설정을 변경하지 않으며, 외부에서 변경된 계정 상태의 반영 지연까지 막는 결제 보장은 하지 않는다.

종료 확인 실패 시 전체 worker를 차단하며 DB와 `.local/codex-worker/unsafe-stop.json`에 재시작 후에도 유지되는 interlock을 남긴다. 이 경우 자동 재개/초기화하지 않는다. 기록된 프로세스 트리와 컨테이너의 실제 종료를 운영자가 확인한 후 별도 복구해야 한다. 만료된 lease의 실행도 `RECOVERY_REQUIRED`로 중단해 알 수 없는 모델 호출을 자동 재실행하지 않는다.

## 픽셀 사무실

대시보드의 사무실은 대표실·개발실·회의실·QA실·공용 공간과 PM/Developer/QA 세 직원을 보여준다. Phaser3.90.0은 client-only로 로드하고, 896×512 Tiled JSON 및 직접 작성한 CC0 픽셀 타일/스프라이트를 사용한다. 외부 이미지·폰트·원격 코드를 로드하지 않는다. 직원 클릭이나 키보드 선택으로 실제 업무/실행/검증 SHA/완료된 응답 토큰을 확인한다. 승인 action은 별도 업무 상세에 유지한다.

서버는 같은 repeatable-read snapshot에서 업무·직원·승인·이벤트 cursor를 읽는다. 직원 상태는 실제 run 단계·제어 상태·역할별 결과에서 계산하며, 말풍선은 고정 한국어 문구다. SSE는 서버 snapshot을 새로 조회하게 할 뿐 직접 상태를 결정하지 않는다. 중복/역순·다른 프로젝트·동일 실행 version 역행을 거르고, 재접속/탭 복귀/명시적 reset에서 복원한다. 연결 단절 시 마지막 확인 시각을 표시하고 움직임을 멈춘다. 그래픽 오류·그래픽 끄기 상태에도 DOM 직원 목록과 상세가 동작한다. 장면 해제 시 canvas/listener/timer를 정리한다.

`pnpm test:e2e`는 모델을 호출하지 않는 브라우저 회귀 검증이다. `pnpm verify:office-live`는 기존 구독 한도를 사용하는 명시적 실험으로 실제 PM→Developer→QA 실행과 브라우저 사무실의 SSE 상태 전환·새로고침·모바일 화면을 확인한다. 포함 한도/차단 정책은 Phase 1과 같으며 결과를 자동 수락하지 않는다.

## Phase 3 채용·배정·협업

대시보드의 `협업·직원` 영역에서 서버 상태 기반 칸반, PM/Developer/QA 채용·프로필 이력·역할 배정·휴직/퇴사/재채용, 외부 작업 기록을 확인한다. 칸반 카드는 업무 상세를 열며 승인 조건을 건너뛰는 상태 변경을 만들지 않는다. 프로필과 실행 당시 직원 설정은 불변 버전으로 저장한다. 배정 변경·권한 철회는 실행을 fence하고 모델·파일 적용·검증 경계에서 다시 검사한다. 사무실은 교체 전 직원의 근거를 새 직원에게 표시하지 않는다.

현재 직원 provider/model은 기존 구독의 `CHATGPT_SUBSCRIPTION`/`codex-default`만 지원한다. turn/token/time 상한은 전역과 각 프로필 중 가장 낮은 값으로 전체 실행에 보수적으로 적용한다. 새로운 API 모델·결제·한도 구매 경로는 없다. `pnpm verify:staffing-live`는 실제 새 Developer를 채용·배정하여 기존 Codex 구독과 브라우저로 검증하는 명시적 opt-in 명령이며 결과를 자동 수락하지 않는다.

GitHub App의 저장소 범위와 Slack의 workspace/channel/Owner 매핑은 서버의 무시된 로컬 설정으로 지정한다. [GitHub 설정](docs/10-github-integration.md)·[Slack 설정](docs/11-slack-integration.md)을 따른다. 비밀값은 UI·채팅·Git에 넣지 않는다. `pnpm verify:integrations-live`는 설정된 실제 자격 증명을 읽기 전용으로 확인한다. 자격 증명이 없으면 실패로 종료한다. `gh` 로그인이나 Slack에 설치된 공식 GitHub/Copilot 앱을 전용 App 인증으로 재사용하지 않는다.

원격 작업은 실제 test/build0·동일 후보 QA PASS 뒤에만 요청하며 DB 작업 기록과 현재 connection/run/project version을 검사한다. 후보 manifest SHA256과 원격 Git commit SHA는 구분한다. 불명확한 원격 효과는 UNKNOWN으로 남겨 자동 재전송을 막고, 429는 제한된 횟수와 Retry-After를 따른다. 현재 merge는 범위가 고정된 요청 기록까지이며 승인 소비/실제 merge 실행기는 미구현이다. Slack은 한국어 보고·서명된 매핑 inbox 접수까지이며 명령→업무 생성/interactive 승인은 미구현이다.

## 실제 검증 결과 — 2026-10-19

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 오류·경고 없음 |
| `pnpm typecheck` | 7개 workspace 및 테스트/스크립트 통과 |
| `pnpm test` | 138개 = 기존97 + 직원12 + 외부 연동 PG15 + adapter11 + 제한 webhook 중계3. HTTP 모의 시험과 아래 실제 App 시험을 구분 |
| `pnpm verify:contracts` | TypeScript fixture 16개·Python JSON Schema fixture 26개 통과 |
| `pnpm build` | Next 프로덕션 빌드·API/공유 패키지 타입 빌드 통과 |
| `pnpm test:e2e` | Chromium 16개 = 기존5 + 사무실7 + 협업4. 직원 채용/불변 프로필/배정, 칸반, 연동 미설정/승인 gate/UNKNOWN 중복 차단과 기존 사무실 회귀 |
| `pnpm verify:agents` | Phase 1 실제 구독 PM/Developer/QA, 코드·추가 테스트 파일 수정, test/build exit0, QA PASS. 저장된 실행 수동 재개 성공, 아래 최종 결과는 사용자 지시로 수락 |
| `pnpm verify:office-live` | 실제 Codex→브라우저 PM 작업/Developer 작업/QA 검토 관측, 동일 SHA test/build0·QA PASS, reload/390px·page error0. 새 결과는 수락 대기 |
| `pnpm verify:staffing-live` | 실제 신규 Developer 채용/배정·Codex 코드 수정·Docker test/build0·동일 SHA QA PASS, 이름/reload/390px/page error0 확인. Owner 수락 대기 |
| `pnpm verify:integrations-live` | 실제 GitHub App JWT/제한 installation token의 시험 저장소·fixture-base head 및 Slack auth.test의 내손비 team/bot identity 조회 성공 |
| `pnpm verify:github-live <projectId> <runId>` | 시험 저장소만 허용하는 opt-in 외부 쓰기. Issue1개·작업 branch/push·draft PR1개·현재 head 로컬 검사 상태 PASS 확인. 모델/merge/Actions 실행 없음 |
| `pnpm audit` | 검사 시점 패키지 취약점 보고 0개. 런타임 전체 안전성 보장은 아님 |
| DB 컨테이너 재시작 | 프로젝트 2개·업무 4개·이벤트 cursor 6 유지 확인 |
| Python HTTP 가용성 | stdlib 임시 loopback 서버 HTTP 200. LangGraph 실행 시험과 다름 |

브라우저 검증 전 `pnpm browsers:install`을 실행한다. 브라우저 바이너리·스크린샷·trace 등은 Git에서 제외한다. E2E는 개발 DB에 `브라우저 검증` 이름의 프로젝트/업무를 생성한다. 단위/통합 테스트는 이름에 별도 `test` 구간이 있는 전용 DB만 허용하며 그 fixture 데이터만 초기화한다.

코드 리뷰에서 확인한 페이지 누락·이벤트 필드·재실행 가능한 브라우저 fixture 문제를 수정했다. 실제 브라우저에서 발견한 Next gzip/SSE 버퍼링은 프록시 압축 비활성화 및 identity 스트림으로 해결했다. PostgreSQL 타임스탬프의 마이크로초를 pagination cursor에 보존하는 회귀 검증도 포함한다.

Phase 1 최종 실제 실행: run `d17da4a3-443d-41d4-b9f1-7279ea54c15e`, manifest SHA256 `b97f16c03ed55616d740e5529f8800a9653bea7e3d8e99db0972723bf992943a`. `src/math.mjs`와 `test/extra-negative.mjs`가 변경되었고 test/build0·QA PASS다. 기존 PM/작업 폴더를 보존한 수동 재개 포함 총4회 호출을 기록한다. 2026-10-19 사용자의 수락 지시에 따라 실제 파일 SHA를 재확인하고 SUCCEEDED/task COMPLETED로 반영했다. 구독 한도를 실제로 소진시키는 시험은 수행하지 않았다.

Phase 2 실제 브라우저 연동 실행: 프로젝트 `실시간 사무실 검증 7229690d`, run `371918c2-6791-4f28-bb5e-b11187b8d641`, manifest SHA256 `76adf5777f4eec555b3692c49789bfa72f5a09d6379976028326880c35ee08fe`. ChatGPT 인증의 실제 PM/Developer/QA 각 응답과 사무실의 PM RUNNING→Developer RUNNING→QA REVIEWING→PM WAITING을 관측했다. `node --test test/extra-negative.mjs test/math.test.mjs`와 `node build.mjs` exit0·동일 SHA QA PASS를 확인했고, 물리 파일을 다시 읽어 저장 SHA와 일치함을 확인했다. 최초 결과는 자동 수락하지 않았으며, 이어진 2026-10-19 사용자의 Phase 2 수락 지시에 따라 물리 SHA를 재확인하고 SUCCEEDED/task COMPLETED로 반영했다. 데스크톱·390px 스크린샷은 `test-results/office-live-desktop.png`, `test-results/office-live-mobile.png`에 로컬 저장한다(Git 제외).

위 성공에 앞선 첫 브라우저 드라이버 실행은 PM 후 실패하여 안전하게 취소했다(진단 메시지 보완 전이라 정확한 원인은 확인 불가). 두 번째는 실제 테스트6개·빌드가 통과했으나 QA가 실행 명령 누락을 지적했고 재작업이 NO_CODE_CHANGE로 차단되어 성공으로 기록하지 않았다. 브로커의 실제 argv 기록을 보완하고 Docker 회귀 시험 및 전체 검증 후 위 새 실행이 통과했다. 실패 실행은 진단 이력을 보존하고 취소했다. 무한 재시도나 결과 자동 수락은 하지 않았다.

Phase 3 실제 신규 채용 실행: project `56c54d8a-de76-4400-8308-a63b1bd2adaa`, run `cb0640a8-25a3-400c-b339-8502d621a7c8`, Developer `검증 개발자 d80c8092` / profile v1. 불변 PM/Developer/QA snapshot 3개, PM RUNNING→Developer RUNNING→QA REVIEWING, 파일 수정·Docker test/build0·QA PASS를 확인했다. manifest SHA256은 `75d7ba066993bb9f1615ef8f2fb7609ab629ae6337045bcc3f06efafeaf2e9c5`다. 첫 채용 시험은 코드 검증이 통과했으나 브라우저에서 직원 이름 표시 결함을 발견해 취소했고, 표시 수정 후 새 실행으로 검증했다. 최종 실행은 WAITING_APPROVAL이며 자동 수락하지 않았다.

실제 GitHub App 시험은 설치 대상인 비공개 `Ina-dang/ai-pixel-company-integration-tests` 한 곳에서 수행했다. [Issue #1](https://github.com/Ina-dang/ai-pixel-company-integration-tests/issues/1)과 [draft PR #2](https://github.com/Ina-dang/ai-pixel-company-integration-tests/pull/2)의 작성자는 `ai-pixel-company-ina-dang[bot]`이다. base는 `fixture-base`, head는 `4e9d9ac099cfe97a2b9d68e6777a0a85253cec5d`이며 원격 파일 5개를 읽어 위 manifest와 일치함을 독립 확인하고 같은 SHA의 Docker test/build를 다시 통과했다. 독립 로컬 검증 주체(Ina-dang CLI)가 `ai-pixel/local-docker-verification` commit status를 게시했고 App이 그 현재 head의 PASS를 읽었다. 최초 MISSING 결과도 DB 이력에 보존한다. 이는 GitHub Actions 실행 결과가 아니며 hosted workflow를 만들거나 실행하지 않았다. PR은 draft·미병합, 실행 결과는 수락 대기다.

Slack 실제 시험: 전용 App `AI Pixel Company`, 내손비 team `T0BSCLLFFDJ`, 비공개 `#ai-pixel-test` channel `C0CAEGXQ5LL`과 Owner/봇 두 멤버를 확인했다. 교체한 로컬 봇 token의 auth.test가 해당 team을 반환했고, 서버의 `SLACK_REPORT` operation `d4de00e1-ec7a-4078-a5d4-143fd45683a4`가 동일 후보의 한국어 QA/수락 대기 보고를 보냈다. [실제 메시지](https://app.slack.com/archives/C0CAEGXQ5LL/p1792406459972519)는 timestamp `1792406459.972519`이며 별도 connector 읽기로 작성 봇·내용·채널을 확인했다. `--slack-report` opt-in은 이 시험 채널만 허용하고 성공한 보고는 재전송하지 않는다. 별도 Owner 승인을 받은 임시 HTTPS 중계에서 Slack 서버의 서명된 URL challenge가 Verified로 통과했다. 읽기 scope·이벤트 구독은 추가하지 않았으며 명령→업무 생성 시험과 구분한다.

임시 webhook 중계는 `pnpm dev:webhook-relay <githubConnectionId> <slackConnectionId>`로 loopback 3002에만 바인딩한다. `scripts/webhook-tunnel.ts`는 별도 Owner 승인 후에만 실행하는 개발용 CLI이며 지정 POST 두 경로를 기존 cloudflared Quick Tunnel로 최대 30분 공개하고 자식 프로세스를 종료한다. 대시보드·Owner API·다른 경로는 전달하지 않고 Cookie/Authorization도 전달하지 않는다. body 256KiB·동시32·timeout 상한을 적용한다. 공개 주소에서 루트/Owner API 404, 서명 없는 허용 webhook 403을 실제 확인했다. 운영 ingress나 상시 가동 서비스로 사용하지 않는다.

GitHub 실제 webhook 시험은 초기 ping의 403을 확인한 뒤 수정했다. App ping의 실제 payload는 installation/repository 없이 hook.app_id를 포함하므로, 서명 검증 뒤 ping에만 설정된 App ID를 검사하고 일반 이벤트에는 기존 설치/저장소 검사를 유지했다. 같은 delivery `9d4e162e-cbac-11f1-9a10-ea2e7e7abbc2`의 실제 재전달 두 번이 HTTP202/OK를 반환했고 inbox는 PROCESSED 1건·attempts1로 유지됐다. Slack의 실제 URL challenge Verified와 함께 원격 HTTPS 연결을 검증했으며, 일반 CI 이벤트/역순/철회는 자동 시험 결과와 구분한다. 시험 종료 후 GitHub webhook Active와 Slack 임시 이벤트 수신을 껐다. 감독·중계·터널을 실제 919초(허용1800초) 안에 종료하고 세 프로세스/3002 리스너가 0개임을 확인했다.

## 검증 범위와 확인 경로

✅ 파일 작성 전 작업 폴더가 비어 있고 Git 저장소가 아님을 확인했다. 기존 파일을 덮어쓰지 않았다. 사용자가 전달한 마스터 프롬프트의 추가 첨부에서 18~21장과 지정 파일 목록을 확인했다.

✅ Phase 0은 실제 PostgreSQL·Hono·Next와 브라우저를 연결해 검증했다. 세션 hash 저장/만료/철회, CSRF/Origin, tenant FK/조회, idempotency, version 경합, 원문 보존, 상태 이력, SSE replay/reset/권한 철회가 테스트 대상이다.

⚠️ 현재 Sandbox는 소유한 고정 fixture만 지원한다. 임의 저장소·의존성 설치·외부 네트워크 실행은 지원하지 않는다. GitHub App 외부 쓰기·현재 head의 로컬 검사 상태, Slack 실제 보고와 실제 webhook 연결을 검증했지만 일반 CI webhook의 원격 역순/철회 시험, Slack 명령 처리와 merge 승인 실행기는 남아 있다. 임시 공개 연결은 닫았으며 상시 ingress는 없다. Redis/Python LangGraph는 PostgreSQL 큐/Node worker로 대체했다(ADR-011). 한국어/영어 비교 실험은 미실행이다. 사무실은 프로젝트별 세 역할 투영이며 회의 시뮬레이션·대규모 조직은 후속 범위다.

## 구현 범위 판정

**Phase 0 완료 / Phase 1 제한 fixture 핵심 경로 / Phase 2 사무실 / Phase 3 채용·칸반·GitHub 외부 쓰기 검증**. 전체 Phase 3와 범용 저장소·언어 비교·운영 B 출시를 완료했다고 주장하지 않는다. 운영 배포·merge·유료 자원 생성은 수행하지 않았다. 공식 구독 근거는 [OpenAI 인증](https://learn.chatgpt.com/docs/auth), 그래픽 계약은 [Phaser3.90 Tilemap](https://docs.phaser.io/api-documentation/3.90.0/class/tilemaps-tilemap)·[Tiled JSON](https://doc.mapeditor.org/en/stable/reference/json-map-format/)을 따른다(열람 2026-10-19, 개별 변경일 미공개).
