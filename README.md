# AI Pixel Company

최신성 체크: 2026-10-19 공식 문서·패키지 레지스트리·로컬 실행 검증 기준. 열람일과 개별 문서 변경일은 구분한다.

자연어 업무 지시를 PM·Developer·QA AI의 실제 개발 작업으로 연결하고, 검증된 실행 상태를 픽셀 사무실에 표시하는 AI 회사 운영 플랫폼이다.

**현재 상태: Phase 0 및 Phase 1의 Codex 구독 기반 핵심 실행 경로 구현·로컬 검증 완료. 현재 코드 실행 대상은 제한된 Node 함수 fixture이며 임의 저장소 실행은 지원하지 않는다.**

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

## 실제 검증 결과 — 2026-10-19

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 오류·경고 없음 |
| `pnpm typecheck` | 6개 workspace 및 테스트/스크립트 통과 |
| `pnpm test` | 69개: Phase0 17 + Phase1 DB/API 18 + workflow 16 + Sandbox 8 + DB 4 + 계약 6 |
| `pnpm verify:contracts` | TypeScript fixture 16개·Python JSON Schema fixture 26개 통과 |
| `pnpm build` | Next 프로덕션 빌드·API/공유 패키지 타입 빌드 통과 |
| `pnpm test:e2e` | Chromium 5개 통과: 기반 흐름 및 quota/제어/증거/동일 SHA 승인/390px |
| `pnpm verify:agents` | 실제 구독 PM/Developer/QA, 코드·추가 테스트 파일 수정, test/build exit0, QA PASS, Owner 수락 대기. 저장된 실행 수동 재개도 성공 |
| `pnpm audit` | 검사 시점 패키지 취약점 보고 0개. 런타임 전체 안전성 보장은 아님 |
| DB 컨테이너 재시작 | 프로젝트 2개·업무 4개·이벤트 cursor 6 유지 확인 |
| Python HTTP 가용성 | stdlib 임시 loopback 서버 HTTP 200. LangGraph 실행 시험과 다름 |

브라우저 검증 전 `pnpm browsers:install`을 실행한다. 브라우저 바이너리·스크린샷·trace 등은 Git에서 제외한다. E2E는 개발 DB에 `브라우저 검증` 이름의 프로젝트/업무를 생성한다. 단위/통합 테스트는 이름에 별도 `test` 구간이 있는 전용 DB만 허용하며 그 fixture 데이터만 초기화한다.

코드 리뷰에서 확인한 페이지 누락·이벤트 필드·재실행 가능한 브라우저 fixture 문제를 수정했다. 실제 브라우저에서 발견한 Next gzip/SSE 버퍼링은 프록시 압축 비활성화 및 identity 스트림으로 해결했다. PostgreSQL 타임스탬프의 마이크로초를 pagination cursor에 보존하는 회귀 검증도 포함한다.

Phase 1 최종 실제 실행: run `d17da4a3-443d-41d4-b9f1-7279ea54c15e`, manifest SHA256 `b97f16c03ed55616d740e5529f8800a9653bea7e3d8e99db0972723bf992943a`. `src/math.mjs`와 `test/extra-negative.mjs`가 변경되었고 실제 test/build0·QA PASS다. 중단된 Developer 단계에서 기존 PM/작업 폴더를 보존해 수동 재개했으며 총4회 호출을 기록한다. 구독 한도를 실제로 소진시키는 시험은 수행하지 않았고 한도/종료 불명 경계는 통제된 자동 시험으로 검증했다.

## 검증 범위와 확인 경로

✅ 파일 작성 전 작업 폴더가 비어 있고 Git 저장소가 아님을 확인했다. 기존 파일을 덮어쓰지 않았다. 사용자가 전달한 마스터 프롬프트의 추가 첨부에서 18~21장과 지정 파일 목록을 확인했다.

✅ Phase 0은 실제 PostgreSQL·Hono·Next와 브라우저를 연결해 검증했다. 세션 hash 저장/만료/철회, CSRF/Origin, tenant FK/조회, idempotency, version 경합, 원문 보존, 상태 이력, SSE replay/reset/권한 철회가 테스트 대상이다.

⚠️ 현재 Sandbox는 소유한 고정 fixture만 지원한다. 임의 저장소·의존성 설치·외부 네트워크·GitHub/Slack App·픽셀 사무실은 미구현이다. Redis/Python LangGraph는 구독 로컬 경로에 맞춰 PostgreSQL 큐/Node worker로 대체했다(ADR-011). 한국어/영어 비용·품질 비교 실험은 미실행이며 영어 효율을 주장하지 않는다.

## 구현 범위 판정

**Phase 0 완료 / Phase 1 제한 fixture 핵심 경로 검증 완료**. 전체 Phase 1 계획을 모두 완료했다고 주장하지 않는다. 범용 저장소 실행은 새로운 격리/의존성/수용 기준 검증이 필요하다. 운영 배포·merge·유료 자원 생성은 수행하지 않았다. 공식 인증/한도 근거는 [OpenAI 인증](https://learn.chatgpt.com/docs/auth), [구독 사용](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [app-server quota](https://learn.chatgpt.com/docs/app-server)를 따른다(열람 2026-10-19, 개별 변경일 미공개).
