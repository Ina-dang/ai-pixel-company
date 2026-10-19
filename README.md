# AI Pixel Company

최신성 체크: 2026-10-19 공식 문서·패키지 레지스트리·로컬 실행 검증 기준. 열람일과 개별 문서 변경일은 구분한다.

자연어 업무 지시를 PM·Developer·QA AI의 실제 개발 작업으로 연결하고, 검증된 실행 상태를 픽셀 사무실에 표시하는 AI 회사 운영 플랫폼이다.

**현재 상태: Phase 0 기반 구현 및 로컬 검증 완료. AI 직원 실행·픽셀 사무실·외부 통합은 후속 단계다.**

- B단계: Phase 0 기반 → Phase 1 실제 AI 실행 → Phase 2 픽셀 사무실.
- C단계: Phase 3 GitHub·Slack·채용 → Phase 4 평가·다중 프로젝트·운영.
- Phase 5: 음성 명령과 고급 조직·모델 최적화. 초기 출시 필수 범위가 아니다.

문서 탐색은 [전체 목차](docs/INDEX.md), 개발 원칙은 [프로젝트 지침](docs/PROJECT_INSTRUCTIONS.md)과 [AGENTS.md](AGENTS.md)를 따른다. 구현 순서는 [로드맵](docs/13-development-roadmap.md), 착수 조건과 검증 결과는 [구현 체크리스트](docs/IMPLEMENTATION_CHECKLIST.md)를 참조한다.

## 설계의 기준

PostgreSQL이 업무 상태의 기준이다. AI의 완료 선언, 큐의 처리 완료, 캐릭터 애니메이션만으로 업무를 완료 처리하지 않는다. 테스트·빌드·QA·승인 근거가 연결되어야 한다. 서버는 상태 변경과 이벤트·전달 의도를 함께 기록하며, 중복 전달은 실행 식별자와 부작용 기록으로 제어한다.

내부 협업은 영어, 사용자 명령·보고·상태·승인은 한국어다. 한국어 원문을 보존하고 영어 명세에 수용 기준과 고유명사를 추적한다. 영어 비용 절감은 가설이며 실측한다.

## 로컬 실행

Node 22.20.0, pnpm 10.15.1, Docker Compose를 사용한다. Python 계약 검증은 Python 3.12.4에서 확인했다. 의존성은 lockfile, PostgreSQL 18.6 이미지는 digest로 고정했다.

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

## 실제 검증 결과 — 2026-10-19

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 오류·경고 없음 |
| `pnpm typecheck` | 4개 workspace 및 테스트/스크립트 통과 |
| `pnpm test` | 27개 통과: API/통합 17 + DB 4 + 계약 6 |
| `pnpm verify:contracts` | TypeScript fixture 16개·Python JSON Schema fixture 26개 통과 |
| `pnpm build` | Next 프로덕션 빌드·API/공유 패키지 타입 빌드 통과 |
| `pnpm test:e2e` | Chromium 1개 통합 시나리오 통과: 생성/원문/새로고침/두 세션 SSE/390px 모바일/로그아웃 |
| `pnpm audit` | 검사 시점 패키지 취약점 보고 0개. 런타임 전체 안전성 보장은 아님 |
| DB 컨테이너 재시작 | 프로젝트 2개·업무 4개·이벤트 cursor 6 유지 확인 |
| Python HTTP 가용성 | stdlib 임시 loopback 서버 HTTP 200. LangGraph 실행 시험과 다름 |

브라우저 검증 전 `pnpm browsers:install`을 실행한다. 브라우저 바이너리·스크린샷·trace 등은 Git에서 제외한다. E2E는 개발 DB에 `브라우저 검증` 이름의 프로젝트/업무를 생성한다. 단위/통합 테스트는 이름에 별도 `test` 구간이 있는 전용 DB만 허용하며 그 fixture 데이터만 초기화한다.

코드 리뷰에서 확인한 페이지 누락·이벤트 필드·재실행 가능한 브라우저 fixture 문제를 수정했다. 실제 브라우저에서 발견한 Next gzip/SSE 버퍼링은 프록시 압축 비활성화 및 identity 스트림으로 해결했다. PostgreSQL 타임스탬프의 마이크로초를 pagination cursor에 보존하는 회귀 검증도 포함한다.

## 검증 범위와 확인 경로

✅ 파일 작성 전 작업 폴더가 비어 있고 Git 저장소가 아님을 확인했다. 기존 파일을 덮어쓰지 않았다. 사용자가 전달한 마스터 프롬프트의 추가 첨부에서 18~21장과 지정 파일 목록을 확인했다.

✅ Phase 0은 실제 PostgreSQL·Hono·Next와 브라우저를 연결해 검증했다. 세션 hash 저장/만료/철회, CSRF/Origin, tenant FK/조회, idempotency, version 경합, 원문 보존, 상태 이력, SSE replay/reset/권한 철회가 테스트 대상이다.

⚠️ LangGraph·Redis·Sandbox·LLM 비용·GitHub/Slack App은 아직 구현/검증하지 않았다. 기본 대시보드에 가짜 직원 실행을 표시하지 않는다. 버전·공식 확인 경로는 [기술 결정](docs/03-technology-decisions.md), 단계별 근거는 [체크리스트](docs/IMPLEMENTATION_CHECKLIST.md)를 참조한다.

## Phase 0 착수 판정

**Phase 0 완료 / Phase 1 CONDITIONAL GO**: 기반 gate를 통과했다. 후속 실제 AI 코드 실행은 Sandbox 차단·종료·비밀/네트워크 격리 검증과 provider/예산 설정 이후에만 허용한다. 운영 배포·merge·유료 자원 생성은 이번 작업에 포함하지 않는다.
