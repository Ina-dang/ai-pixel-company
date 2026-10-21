# 문서 목차

Slack 실제 명령 후속(2026-10-21): 새 30분 승인 범위에서 기존 시험 프로젝트에 상태 조회·업무 등록 각1회를 실제 Slack UI로 전송했다. 서명 수신/응답2건·TODO1건·원문과 공백2칸 보존·새 run0건을 DB/별도 Slack 조회/데스크톱·모바일로 확인하고 임시 tunnel·relay 종료 및 기존 URL 복원을 확인했다. 관련49개·lint/typecheck/build PASS다. 시험 업무는 할 일로 남겼고 merge·운영 배포·유료 API는 실행하지 않았다. README·11·14·체크리스트를 따른다.

Slack 보고 후속(2026-10-21): 업무명·변경 요약·검증 결과·다음 행동·업무 상세 링크를 표시한다. 기존 비공개 시험 채널에서 실제 how-to-trash 결과1건을 발신하고 별도 조회·상세 화면을 대조했다. 관련55개·lint/typecheck/build와 실제 UI 검사(업무 변경0·페이지 오류0)를 통과했다. 시험 전 이미 앱 결과는 SUCCEEDED·version42·turn6이었고 그대로 유지했다. 실행·수락·merge·운영 배포·유료 증설은 하지 않았다. 최신 설명은 README·11·14·체크리스트를 따른다. 아래 상태는 각 과거 검증 시점 기록이다.

결과 확인 후속(2026-10-21): 프로젝트·업무 선택 시 우측 패널에서 요약·검증·파일·확인된 커밋을 본다.
how-to-trash의 원격 전달 근거를 DB에 연결했고 관련 62개·전체 Chromium48개·실제 읽기 전용 UI 대조를 통과했다. 최초 39PASS/9FAIL 이력은 14에 보존한다.
Slack 안내의 로컬 업무 바로가기·프로젝트 기억/이름 묶음을 추가했으며 새로운 Slack 전송·모델 실행·수락·merge·운영 배포는 없다. README·ADR-020을 따른다.

실제 저장소 후속(2026-10-21): 사용자 승인 추가 5분·QA 1회로 how-to-trash의 같은 후보를 검증해 최종 QA PASS를 확인했다.
테스트 6개·lint/tsc/build·1440/375px × 지도 키 없음/SDK 차단 네 조건 통과 뒤 `codex/region-search`에 `7b07edc`를 push했다.
앱 결과는 미수락 `WAITING_APPROVAL`이며 merge·운영 배포는 하지 않았다. QA 1차 FAIL·원래 시간 종료 이력도 보존한다.
사무실은 사용자 이미지의 색감·대비·캐릭터 비율만 참고한 직접 제작 `original-v4`다. 관련 테스트 10개·Chromium 8개와 실제 서버 대조를 통과했고 실제 Chrome의 이전 번들을 갱신했다.
직전 전체 회귀 257/47과 아래 Phase5 244/45 기록은 각 시점의 결과이며 이번 관련 검사 수와 구분한다. 최신 상세 근거는 README·14·ADR-019·체크리스트를 따른다.

사무실 화면 시범(2026-10-19): Phaser·서버 상태 계약을 유지하며 MIT 팔레트 함수만 선별 재사용하고 원본 그래픽·가구·러그·말풍선을 개선했다. 당시 테스트141개·Chromium17개와 실제 서버 대조를 통과했고 사용자가 수락했다. 적용 범위·라이선스는 README와 09에 기록했다.

최신성 체크: 2026-10-20. P5-01/02-L·Windows 복구 수락 뒤 실제 마이크9480ms의 녹음/전사/취소·plaintext/임시 파일 정리1건을 사용자 보고/서버와 대조했다. 앱의 microphone=()를 same-origin 허용으로 수정했다. 최종 자동244=42+78+124(19파일/순차3묶음)·Chromium45=기존40+진단/정책5·계약/lint/typecheck/build PASS다. 단일 명령 시간 제한과 Docker1회 실패는 별도 보존하며 README의 불변 근거를 따른다. “수정해”→“수상해” 차이가 있어 정확도를 일반화하지 않는다. 다른 환경/운영 개인정보·기존 운영 C 제한은 남았고 merge/운영 배포/새 유료 자원은 미수행이다.12/14/20장·ADR-018·체크리스트를 따른다.

| 파일 | 목적 | 상태 |
|---|---|---|
| [README](../README.md) | 진입점·프로젝트 상태·착수 판정 | 신규 |
| [AGENTS](../AGENTS.md) | 개발 작업 규칙 | 신규 |
| [PROJECT_INSTRUCTIONS](PROJECT_INSTRUCTIONS.md) | 프로젝트 최상위 운영 지침 | 신규 |
| [00-project-overview](00-project-overview.md) | 목표·B/C 경계·성공 조건 | 신규 |
| [01-product-requirements](01-product-requirements.md) | 요구사항 ID·수용 기준·추적 | 신규 |
| [02-system-architecture](02-system-architecture.md) | 구성·통신·저장 경계 | 신규 |
| [03-technology-decisions](03-technology-decisions.md) | 공식 근거·버전 검증·제약 | 신규 |
| [04-agent-organization](04-agent-organization.md) | PM/Developer/QA 역할·권한 | 신규 |
| [05-agent-workflows](05-agent-workflows.md) | 상태 머신·실행·승인·복구 | 신규 |
| [06-event-driven-design](06-event-driven-design.md) | 이벤트·outbox·SSE·순서 | 신규 |
| [07-database-design](07-database-design.md) | 테이블·관계·제약·동시성 | 신규 |
| [08-api-specification](08-api-specification.md) | 공개/내부 API·예시·오류 | 신규 |
| [09-pixel-office-design](09-pixel-office-design.md) | 장면·상태·상세 패널·복원 | 신규 |
| [10-github-integration](10-github-integration.md) | GitHub App·PR·CI·merge 승인 | 신규 |
| [11-slack-integration](11-slack-integration.md) | 채널·서명·보고·명령 권한 | 신규 |
| [12-security-and-permissions](12-security-and-permissions.md) | 인증·승인·샌드박스·위협 | 신규 |
| [13-development-roadmap](13-development-roadmap.md) | Phase 0~5·예상 공수·출시 | 신규 |
| [14-testing-strategy](14-testing-strategy.md) | 테스트·평가·검증 증거 | 신규 |
| [15-deployment-and-operations](15-deployment-and-operations.md) | 로컬 구성·배포·복구·관측 | 신규 |
| [16-cost-management](16-cost-management.md) | 토큰·비용·예산·언어 비교 | 신규 |
| [17-decision-log](17-decision-log.md) | ADR·미확정 결정 | 신규 |
| [18-employee-recruitment](18-employee-recruitment.md) | 템플릿 채용·프로필·할당 | 신규 |
| [19-employee-performance-review](19-employee-performance-review.md) | 근거 기반 평가·편향 제어 | 신규 |
| [20-voice-command-design](20-voice-command-design.md) | Phase 5 음성 확장 | 신규 |
| [21-organization-management](21-organization-management.md) | 부서·다중 프로젝트·의존성 | 신규 |
| [22-language-and-communication-policy](22-language-and-communication-policy.md) | 원문 보존·협업·한국어 UI | 신규 |
| [IMPLEMENTATION_CHECKLIST](IMPLEMENTATION_CHECKLIST.md) | Phase별 검증·문서 감사·착수 조건 | 신규 |

이 목차 자체를 포함해 지정된 Markdown 파일은 28개다. 도메인 계약 변경 시 해당 문서와 API·DB·이벤트·체크리스트·ADR을 함께 검토한다.

권장 읽기 순서: 지침 → 00/01 → 02/03 → 05/06/07/08 → 12/14/16 → 13/체크리스트. 나머지는 담당 영역에 따라 읽는다.
