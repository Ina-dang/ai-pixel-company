# 문서 목차

사무실 화면 시범(2026-10-19): Phaser·서버 상태 계약을 유지하며 MIT 팔레트 함수만 선별 재사용하고 원본 그래픽·가구·러그·말풍선을 개선했다. 당시 테스트141개·Chromium17개와 실제 서버 대조를 통과했고 사용자가 수락했다. 적용 범위·라이선스는 README와 09에 기록했다.

최신성 체크: 2026-10-20. 사용자 수락한 P4 로컬 검증에 이어 P5-01/02-L 로컬 한국어 STT 후보·수정/확인·공통 업무 등록을 구현했다. 자동223개·Chromium37개·TS16/Python26 계약·lint/typecheck/build, 실제 native STT/취소·raw 임시 파일0·브라우저·table45/workspace14 복원과 기존 GitHub/Slack 읽기 연동을 확인했다. 취소/정리 실패 중 슬롯 유지와 native close도 검증했다. LOCAL_FIXTURE는 READY_FOR_OWNER_REVIEW/blocker0, 운영 C는 NO_GO다. 물리 마이크·강제 종료 뒤 음성 자동 정리/운영 개인정보 정책·TTS/회의·모델 최적화와 기존 off-host/운영 환경·supervisor 분리·상시 ingress·일반 CI/범용 실행 검증은 남았다. 실제 merge/운영 배포/새 유료 자원은 미수행이다. ADR-015/016·15/20장·README·체크리스트를 따른다.

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
