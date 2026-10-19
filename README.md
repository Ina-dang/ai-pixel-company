# AI Pixel Company

최신성 체크: 2026-10-19 공식 문서·패키지 레지스트리·로컬 실행 검증 기준. 열람일과 개별 문서 변경일은 구분한다.

자연어 업무 지시를 PM·Developer·QA AI의 실제 개발 작업으로 연결하고, 검증된 실행 상태를 픽셀 사무실에 표시하는 AI 회사 운영 플랫폼이다.

**현재 상태: Phase 0 기반·Phase 1 구독 실행 핵심 경로·Phase 2 픽셀 사무실을 구현하고 로컬 검증했다. 현재 코드 실행 대상은 제한된 Node 함수 fixture이며 임의 저장소 실행은 지원하지 않는다.**

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

## 실제 검증 결과 — 2026-10-19

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 오류·경고 없음 |
| `pnpm typecheck` | 6개 workspace 및 테스트/스크립트 통과 |
| `pnpm test` | 97개: Phase0 17 + Phase1 18 + Phase2 19 + workflow 16 + Sandbox 8 + DB 4 + 계약 7 + office 8 |
| `pnpm verify:contracts` | TypeScript fixture 16개·Python JSON Schema fixture 26개 통과 |
| `pnpm build` | Next 프로덕션 빌드·API/공유 패키지 타입 빌드 통과 |
| `pnpm test:e2e` | Chromium 12개 통과: 기존5 + 사무실7. 상태 전환/동시 직원/역순/재접속/초기 장애 복구/권한 철회/자산 실패/그래픽 해제/390px |
| `pnpm verify:agents` | Phase 1 실제 구독 PM/Developer/QA, 코드·추가 테스트 파일 수정, test/build exit0, QA PASS. 저장된 실행 수동 재개 성공, 아래 최종 결과는 사용자 지시로 수락 |
| `pnpm verify:office-live` | 실제 Codex→브라우저 PM 작업/Developer 작업/QA 검토 관측, 동일 SHA test/build0·QA PASS, reload/390px·page error0. 새 결과는 수락 대기 |
| `pnpm audit` | 검사 시점 패키지 취약점 보고 0개. 런타임 전체 안전성 보장은 아님 |
| DB 컨테이너 재시작 | 프로젝트 2개·업무 4개·이벤트 cursor 6 유지 확인 |
| Python HTTP 가용성 | stdlib 임시 loopback 서버 HTTP 200. LangGraph 실행 시험과 다름 |

브라우저 검증 전 `pnpm browsers:install`을 실행한다. 브라우저 바이너리·스크린샷·trace 등은 Git에서 제외한다. E2E는 개발 DB에 `브라우저 검증` 이름의 프로젝트/업무를 생성한다. 단위/통합 테스트는 이름에 별도 `test` 구간이 있는 전용 DB만 허용하며 그 fixture 데이터만 초기화한다.

코드 리뷰에서 확인한 페이지 누락·이벤트 필드·재실행 가능한 브라우저 fixture 문제를 수정했다. 실제 브라우저에서 발견한 Next gzip/SSE 버퍼링은 프록시 압축 비활성화 및 identity 스트림으로 해결했다. PostgreSQL 타임스탬프의 마이크로초를 pagination cursor에 보존하는 회귀 검증도 포함한다.

Phase 1 최종 실제 실행: run `d17da4a3-443d-41d4-b9f1-7279ea54c15e`, manifest SHA256 `b97f16c03ed55616d740e5529f8800a9653bea7e3d8e99db0972723bf992943a`. `src/math.mjs`와 `test/extra-negative.mjs`가 변경되었고 test/build0·QA PASS다. 기존 PM/작업 폴더를 보존한 수동 재개 포함 총4회 호출을 기록한다. 2026-10-19 사용자의 수락 지시에 따라 실제 파일 SHA를 재확인하고 SUCCEEDED/task COMPLETED로 반영했다. 구독 한도를 실제로 소진시키는 시험은 수행하지 않았다.

Phase 2 실제 브라우저 연동 실행: 프로젝트 `실시간 사무실 검증 7229690d`, run `371918c2-6791-4f28-bb5e-b11187b8d641`, manifest SHA256 `76adf5777f4eec555b3692c49789bfa72f5a09d6379976028326880c35ee08fe`. ChatGPT 인증의 실제 PM/Developer/QA 각 응답과 사무실의 PM RUNNING→Developer RUNNING→QA REVIEWING→PM WAITING을 관측했다. `node --test test/extra-negative.mjs test/math.test.mjs`와 `node build.mjs` exit0·동일 SHA QA PASS를 확인했고, 물리 파일을 다시 읽어 저장 SHA와 일치함을 확인했다. 최종 상태는 WAITING_APPROVAL이며 자동 수락하지 않았다. 데스크톱·390px 스크린샷은 `test-results/office-live-desktop.png`, `test-results/office-live-mobile.png`에 로컬 저장한다(Git 제외).

위 성공에 앞선 첫 브라우저 드라이버 실행은 PM 후 실패하여 안전하게 취소했다(진단 메시지 보완 전이라 정확한 원인은 확인 불가). 두 번째는 실제 테스트6개·빌드가 통과했으나 QA가 실행 명령 누락을 지적했고 재작업이 NO_CODE_CHANGE로 차단되어 성공으로 기록하지 않았다. 브로커의 실제 argv 기록을 보완하고 Docker 회귀 시험 및 전체 검증 후 위 새 실행이 통과했다. 실패 실행은 진단 이력을 보존하고 취소했다. 무한 재시도나 결과 자동 수락은 하지 않았다.

## 검증 범위와 확인 경로

✅ 파일 작성 전 작업 폴더가 비어 있고 Git 저장소가 아님을 확인했다. 기존 파일을 덮어쓰지 않았다. 사용자가 전달한 마스터 프롬프트의 추가 첨부에서 18~21장과 지정 파일 목록을 확인했다.

✅ Phase 0은 실제 PostgreSQL·Hono·Next와 브라우저를 연결해 검증했다. 세션 hash 저장/만료/철회, CSRF/Origin, tenant FK/조회, idempotency, version 경합, 원문 보존, 상태 이력, SSE replay/reset/권한 철회가 테스트 대상이다.

⚠️ 현재 Sandbox는 소유한 고정 fixture만 지원한다. 임의 저장소·의존성 설치·외부 네트워크·GitHub/Slack App은 미구현이다. Redis/Python LangGraph는 구독 로컬 경로에 맞춰 PostgreSQL 큐/Node worker로 대체했다(ADR-011). 한국어/영어 비용·품질 비교 실험은 미실행이며 영어 효율을 주장하지 않는다. 사무실은 고정 세 역할의 프로젝트별 투영이며 채용·회의 시뮬레이션·대규모 조직은 후속 범위다.

## 구현 범위 판정

**Phase 0 완료 / Phase 1 제한 fixture 핵심 경로 검증 / Phase 2 로컬 픽셀 사무실 검증**. 범용 저장소와 언어 비교가 남은 전체 Phase 1 계획 또는 운영 B 출시를 모두 완료했다고 주장하지 않는다. 운영 배포·merge·유료 자원 생성은 수행하지 않았다. 공식 구독 근거는 [OpenAI 인증](https://learn.chatgpt.com/docs/auth), 그래픽 계약은 [Phaser3.90 Tilemap](https://docs.phaser.io/api-documentation/3.90.0/class/tilemaps-tilemap)·[Tiled JSON](https://doc.mapeditor.org/en/stable/reference/json-map-format/)을 따른다(열람 2026-10-19, 개별 변경일 미공개).
