# 설계 의사결정 기록

## ADR-012 — 서버 투영 기반 픽셀 사무실 (2026-10-19, 구현·검증)

- 결정: Phase 2는 기존 snapshot/SSE 경로에 통합한다. 같은 DB snapshot에서 업무·조직 cursor·직원3명·승인 대기를 읽으며 이벤트는 재조회 신호로 쓴다. 업무/실행/직원 상태를 별도 필드로 유지한다.
- 근거: 실제 역할 단계와 완료 근거를 기반으로 해야 연결 지연·역순 이벤트·모델 문구가 최종 상태를 바꾸지 않는다. 프로젝트 범위·조직 sequence·실행 version을 검사하고 reset은 서버 snapshot으로 복구한다.
- 표현: Phaser3.90.0, 로컬 Tiled 맵과 직접 제작 CC0 자산. 그래픽 실패/비활성 시 같은 서버 근거의 DOM 목록과 상세를 유지한다. 애니메이션은 실행·승인 요청을 만들지 않는다.
- 검증: 실제 PG 투영19개, 동기화 단위8개, 사무실 Chromium7개를 기존 회귀 시험에 추가했다. 실제 Codex 실행 관측 결과는 README에 성공·중단을 구분해 기록한다. 범용 저장소/운영 출시 검증을 대신하지 않는다.
- 연동 중 발견한 보완: 실제 Sandbox test/build argv를 SHA·exitCode·output과 함께 기록한다. 기존 checkpoint 호환을 유지하며 LLM이 실행 명령을 추측하지 않도록 한다.

최신성 체크: 2026-10-18 설계 결정/공식 자료 열람 기준. “설계 채택”은 구현 성공을 뜻하지 않는다. 외부 기술 근거는 [03](03-technology-decisions.md)에 모았다.

## ADR-001 — PostgreSQL을 도메인 상태의 기준으로 사용

- 날짜/상태: 2026-10-18 / 설계 채택, 구현 미검증.
- 대상/배경: Redis·Engine·UI 상태가 다르면 실제 완료를 판별하기 어렵다.
- 대안: Redis 중심 상태, 프런트엔드 상태 중심, DB 중심.
- 선택/근거: PostgreSQL에 task/run/approval/evidence를 영구 저장하고 API 전이만 허용한다.
- 영향: Redis 유실 시 DB intent로 재구성. UI는 projection이다.
- 한계/검증: transaction·constraint·복구 시험이 필요하다. 대상 문서 02/05/07/14.

## ADR-002 — BullMQ Node worker와 Python 사이의 명시적 HTTP 계약

- 날짜/상태: 2026-10-18 / 설계 채택, 호환성 gate 미통과.
- 대상/배경: BullMQ와 LangGraph의 책임·언어 경계를 정해야 한다.
- 대안: Python BullMQ 직접 소비, 별도 broker 추가, Node dispatcher→HTTP.
- 선택/근거: Node 큐 운영을 유지하고 동일 코드베이스 worker 모드로 Python에 식별자/Artifact 참조를 전달한다. 별도 broker를 추가하지 않는다.
- 영향: lease·fencing·operationId·상태 조회/reconcile이 필요하다. 승인 대기엔 worker slot을 해제한다.
- 한계/검증: HTTP timeout/ACK 유실과 Python 호스팅 adapter를 Phase 0/1 수직 시험한다. 대상 02/08/15.

## ADR-003 — Transactional event/outbox와 조직별 cursor

- 날짜/상태: 2026-10-18 / 설계 채택, 구현 미검증.
- 대상/배경: DB 상태 변경 뒤 전송 실패, SSE commit 순서 누락 위험.
- 대안: 메모리/pubsub 전용, 단순 bigserial replay, 조직 counter lock.
- 선택/근거: 동일 transaction에서 상태/event/outbox 저장, 조직 counter lock을 commit까지 유지한다.
- 영향: 조직 내 event transaction이 직렬화되며 snapshot/replay 기준이 명확해진다.
- 한계/검증: 초기 규모에서 lock 경합을 수용한다. 부하 증가 시 stream 분할 등 재검토한다. 대상 06/07/14.

## ADR-004 — 검증 증거와 승인으로 완료 판정

- 날짜/상태: 2026-10-18 / 설계 채택.
- 대상/배경: LLM 완료 주장·queue 완료·animation 완료는 제품 완료 증거가 아니다.
- 대안: 모델 self-report, 테스트만, 수용 기준+SHA+test/build+QA+Owner.
- 선택/근거: 마지막 조합을 필수 gate로 한다. 결과 수락과 merge/배포를 별도 action으로 둔다.
- 영향: 테스트 불가 시 UNVERIFIABLE로 차단, stale SHA는 재검증한다.
- 한계/검증: QA 자체도 의견/근거 검토 대상이다. 대상 05/08/14.

## ADR-005 — 최소 로컬 인증과 독립 Sandbox 경계

- 날짜/상태: 2026-10-18 / 설계 채택, 라이브러리/런타임 미확정.
- 대상/배경: 초기 1인 개발 복잡도를 제한하면서 무인증 실행을 막아야 한다.
- 대안: 무인증 로컬, 초기 전체 조직 SSO, 로컬 Owner 인증 후 공개 전 OIDC.
- 선택/근거: local Owner session/CSRF와 서버 도구 gate, 비신뢰 코드는 별도 Sandbox.
- 영향: 공개 전 별도 인증/격리 gate 필요. Worktree는 보안 경계가 아니다.
- 한계/검증: Docker만으로 완전 격리를 보장하지 않는다. 대상 12/15.

## ADR-006 — 영어 내부 협업·한국어 사용자 경험과 비용 실측

- 날짜/상태: 2026-10-18 / 사용자 요구에 따라 채택, 비용 효과 미측정.
- 대상/배경: 원문 보존·의미 손실 방지·중복 번역 비용 통제.
- 대안: 전부 한국어, 전부 영어, 역할별 언어 분리.
- 선택/근거: 내부 영어, 사용자 한국어, 불변 필드/수용 기준 ID, 필요한 시점의 한국어 요약.
- 영향: 언어 평가에 번역/요약 비용과 cache 효과 포함.
- 한계/검증: 영어 비용 절감을 보장하지 않는다. 대상 16/22.

## ADR-007 — B→C 단계 구분과 공통 조직 식별자

- 날짜/상태: 2026-10-18 / 설계 채택.
- 대상/배경: 통합·인사·평가를 처음부터 모두 구현하면 핵심 실행이 늦어진다.
- 대안: 모든 기능 동시 구현, B 전용 모델 후 재작성, 공통 모델+단계별 활성화.
- 선택/근거: B는 단일 프로젝트/3역할, org/project 식별자를 처음부터 둬 C 확장 시 엔진을 유지한다.
- 영향: PR/Slack/템플릿 채용은 Phase 3, 평가/다중 프로젝트는 Phase 4, 음성은 Phase 5.
- 한계/검증: 외부 PR 없는 Phase 1과 통합 목표 흐름을 구분한다. 대상 00/13/18/21.

## ADR-008 — 호출 전 예약·호출 후 정산

- 날짜/상태: 2026-10-18 / 설계 채택, 공급자 usage 조정 미검증.
- 대상/배경: 병렬 run이 같은 잔여 예산을 각각 소비할 수 있다.
- 대안: 사후 집계, 실행별 단독 상한, 공유 ledger 예약.
- 선택/근거: org/project/agent 예산을 고정 순서로 lock해 예약하고 실제 usage로 정산한다.
- 영향: UNKNOWN 사용량은 예약 유지, 신규 호출 중단. priceVersion 불변 저장.
- 한계/검증: 공급자 청구 지연/초과를 소급 막는 보장이 아니다. 대상 07/16.

## ADR-009 — 버전·환경 확정과 착수 gate

- 날짜/상태: 2026-10-18 / 미확정.
- 대상/배경: 빈 workspace이고 설치/호환성 시험이 없다.
- 대안: 최신 자동 설치, 임의 과거 버전, 공식 지원 범위 확인 후 lock.
- 선택 방향/근거: Node 24/Python 3.12/PostgreSQL 18 후보와 사용자 지정 Phaser 3를 실제 지원 조합으로 검증한 뒤 정확한 버전/digest 고정.
- 영향: Phase 0 첫 작업에 Turbo/내구 실행 공식 문서 재확인·Docker 가용성·SSE/proxy·TS/Python fixture 시험 포함.
- 한계/검증: 현재 “전체 스택 호환”을 확정하지 않는다. 대상 03/체크리스트.

## ADR-010 — Phase 0 실제 검증 결과와 호환성 수정

- 날짜/상태: 2026-10-19 / Phase 0 로컬 검증 완료. ADR-009의 Phase 0 버전/환경 결정을 대체한다.
- 대상/배경: 실제 설치·DB/API·브라우저 연결로 설계 가정을 확인해야 했다.
- 대안: Node 24 도입 대 기존 Node 22 지원 조합, 단일 PG client 대 raw/ORM 분리, proxy gzip 유지 대 SSE 즉시 flush.
- 선택/근거: Node22.20/pnpm10.15.1/PG18.6 및 lockfile 조합을 실증했다. serializer 충돌은 별도 client, SSE 버퍼링은 Next compress:false/identity로 해결했다. Argon2 Owner 키·hashed opaque session·double-submit CSRF를 로컬 인증으로 구현했다.
- 영향: 실제 DB/API 테스트27개, Chromium E2E1개, TS16/Python26 fixture, lint/typecheck/build/audit를 실행했다. 모든 결과는 README에 기록한다.
- 한계: 공개 서비스 인증·LangGraph·Redis·Sandbox·provider 과금·운영 배포 검증은 범위 밖이다. Phase 1 진입 시 각각 재검증한다.

## ADR-011 — 기존 Codex 구독을 사용하는 제한된 Phase 1 실행

- 날짜/상태: 2026-10-19 / 사용자 구현·검증·push 승인, 고정 fixture 실제 실행 검증.
- 대상/배경: 사용자는 추가 API 비용 없이 현재 Codex 구독을 사용하고 한도 도달 시 중단할 것을 명시했다.
- 대안: 유료 API/LangGraph adapter, 비공식 토큰 추출, 공식 Codex CLI 연결. 공식 ChatGPT 로그인 CLI를 선택하며 인증 토큰을 직접 추출하지 않는다.
- 대체 관계: 최초 Phase 1 Redis·BullMQ→Python LangGraph HTTP 구성을 단일 로컬 Node worker + PostgreSQL 영구 큐/JSON checkpoint로 대체한다. API 금액 예약·가격 snapshot은 이 구독 전용 경로에 적용하지 않는다. 다중 공급자/분산 운영 도입 시 별도 ADR이 필요하다.
- 책임 유지: Hono/DB가 인증·상태·승인·lease fencing을 결정한다. worker가 PM/Developer/QA와 제한 재작업을 수행하고 Sandbox broker가 파일 적용·명령 실행을 담당한다. Codex 자체에 호스트 실행 도구를 주지 않는다.
- 인증/비용: forced_login_method=chatgpt, 기본 공급자 고정, API/DB/proxy 비밀 환경변수 제외, exec --ignore-user-config --strict-config 및 셸/앱/플러그인/브라우저/이미지 도구 비활성화. app-server는 인증과 rateLimits 조회에만 사용한다. 유료 크레딧·한도 불명·90% 이상·quota 오류는 중단한다. 구매·충전·banked reset·API fallback은 호출하지 않는다.
- 내구성/중단: PG claim·60초 lease·heartbeat·영구 checkpoint·단일 수락 기록. pause/cancel은 lease를 폐기하고 실제 teardown 확인 후 stop token을 단일 소비한다. 종료 불명은 worker 전체 및 DB 큐를 막고 로컬 interlock도 보존한다. 알 수 없는 진행 중 호출은 재시작 후 자동 replay하지 않는다.
- 결과/증거: PM 영어 명세/AC, Developer 구조화 파일을 broker가 실제 수정, 네트워크 없는 nonroot·read-only·seccomp/capability/resource 제한 Docker test/build, 동일 SHA256 QA, 별도 Owner 수락. SHA256은 fixture manifest 식별자이며 Git commit SHA와 구분한다. 실제 Codex thread ID를 보존하며 exec가 별도 turn ID를 노출하지 않아 turnId=null로 기록한다.
- 한계: 단일 로컬 계정·소유한 node-functions-v1 fixture만 허용한다. 임의 저장소/의존성 설치/네트워크/외부 배포·merge는 미지원이다. 구독 한도는 외부 Codex 사용과 공유되며 공급자 수치 반영 지연이 있다. 완료된 turn의 토큰만 합산하며 응답 없는 중단 호출의 사용량은 미확정이다. 언어 비교 미실행. 기존 범용 Phase 1 전부 완료를 의미하지 않는다.
- 근거: [공식 인증](https://learn.chatgpt.com/docs/auth), [app-server](https://learn.chatgpt.com/docs/app-server), [구독 한도](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan). 열람 2026-10-19, 개별 변경일 미공개. 로컬 CLI0.162.1 실제 호출 및 Docker/DB/브라우저 결과는 README/체크리스트.

## ADR-012 — Phase 3 고정 직원 프로필과 범위 제한 외부 연동

- 날짜/상태: 2026-10-19 / 채용·칸반·GitHub 실제 외부 쓰기·Slack 비공개 채널 한국어 보고 검증, 수신 webhook/명령 처리/승인 실행기 일부 미완료.
- 배경/선택: 기존 Codex 구독 worker/DB/검증 gate를 유지하며 별도 유료 모델·호스팅 없이 채용 프로필과 외부 adapter를 추가한다. 불변 employee profile·run snapshot과 단조 배정 version으로 직원 교체 및 ABA 경합을 구분한다. 현재 배정/고용/도구/lease를 모델·파일 적용·검증 경계에서 다시 검사한다.
- 외부 범위: GitHub App installation/repository ID·이름·base branch, Slack team/channel/Owner mapping을 서버 로컬 설정으로 고정한다. gh/PAT를 서비스 App 인증으로 대체하지 않는다. 각 원격 호출 직전에 connection/project/run version과 동일 SHA 근거를 재검사한다. effect 불명은 UNKNOWN으로 보존해 재발행을 막는다.
- 증거/비용: candidate manifest SHA256과 remote Git SHA를 분리하고 immutable baseline byte를 확인한다. 전용 시험 저장소에서 App Issue/branch/push/draft PR을 검증했다. 독립 로컬 Docker 검사 status를 App이 읽으며 GitHub hosted Actions는 실행하지 않았다. 발행 설정과 webhook 서명 키 유무를 별도 투영한다.
- 한계: merge는 대상 SHA/CI/정책 scope 요청 기록까지만 제공한다. 승인 소비·실제 merge 집행과 Slack 명령→업무 생성/interactive 승인 및 외부 HTTPS webhook 전달은 미완료다. 전체 Phase 3 완료로 표시하지 않는다. 실제 run/SHA/PR과 검증 수치는 README를 기준으로 한다.

## ADR-013 — Slack 명령 큐와 별도 merge 승인 소비

- 날짜/상태: 2026-10-19 / 구현·전체 회귀158개/Chromium20개 통과. Owner 허용 및 직접 재설치 후 실제 Slack 명령3건·채널 알림과 업무1건/run0건 확인, 터널 종료. 실제 merge는 사용자 지시로 미수행.
- 대체 관계: ADR-012의 명령 처리·승인 실행기 미구현 범위를 후속 구현한다. 기존 실행 엔진·Phaser·서버 projection은 유지한다.
- 선택: `/ai-pixel` 도움말/상태/업무를 서명 검증·고정 Owner mapping·durable receipt 이후 처리하고 공통 task command로 TODO만 생성한다. Slack interactive/merge 승인과 자동 모델 실행은 도입하지 않는다. 비밀인 response_url은 저장하지 않는다.
- merge: 결과 수락과 분리된 REQUESTED→APPROVED→QUEUED→RUNNING 상태를 사용한다. 별도 클릭·scopeHash/version·승인 세션과 만료를 요구하며 원격 head/base/CI 식별자·보호/ruleset 및 로컬 검증 근거를 다시 확인한다. 불명 결과는 UNKNOWN, 원격 조회만으로 조정한다. 재merge/자동 재전송은 없다.
- 한계: GitHub REST PUT의 서버 측 조건은 head SHA이며 base SHA는 최종 재조회만 가능하다. 보호 정책을 읽을 수 없으면 차단하며 Administration read는 자동 요청하지 않는다. 성공/timeout merge는 모의 transport로만 시험하고 실제 공급자에서는 승인 전 차단을 검증한다.
- 근거: 10/11 및 08 API·07 DB 보충, migration0005와 README 실제 검증 기록을 따른다. 추가 모델 API/유료 자원은 도입하지 않는다.

## ADR-014 — 근거 평가와 명시적 다중 프로젝트 예약 (2026-10-19, 구현)

- 결정: 기존 Hono/PostgreSQL/Codex/Phaser 경계를 유지한다. 평가 사실과 의견, 초안과 Owner 게시, 업무 결과 수락과 merge 승인을 분리한다. P4-01~04를 구현하되 운영 복구/경보/C 출시 gate는 별도로 둔다.
- 평가: AUTO/SELF/PEER/PM/USER, 고정 rubric1, 미산정 null, 불변 원문/근거/수정 이력, Owner CONFIRM/DISPUTE. 동일 모델/표본 부족/상호 고득점과 실측 실패 불일치를 검토 표시한다. AI 생성은 최초·수정 최대2회, 호출당 180초·50,000 완료 응답 토큰 정책이며 자동 인사/권한/예산 변경은 금지한다.
- 실행: 프로젝트별 repository/staffing/workspace/integration/evidence를 유지하고 workflow+AI 평가 공급자 슬롯은 1개다. 조직·프로젝트·직원 토큰 정책과 진행 예약을 함께 검사한다. 공급자 보고 전 사용량/청구액은 미확인으로 둔다.
- 예약: 같은 프로젝트 DAG, 선행 COMPLETED, Owner가 명시한 task intent만 실행한다. 우선순위 URGENT/HIGH/MEDIUM/LOW와 동순위 FIFO를 사용한다. 큐와 호출 직전에 권한·직원·프로젝트·의존성·예산을 재검사한다. 이미 생성된 run의 취소는 intent 해제와 별도다.
- 대안/한계: 병렬 슬롯 확대·새 모델 API·paid fallback·복잡한 관리자 역할·공정 할당·통계 순위는 추가하지 않는다. 3개 미만 평균 미표시는 제품 표시 규칙이며 통계적 유의성을 주장하지 않는다. 완료 응답 토큰 정책은 생성 중 강제 토큰 상한이 아니다.
- 안전 경계: provider 종료 확인 실패는 다른 중단 사유보다 우선해 UNKNOWN과 공유 슬롯 차단으로 남긴다. DB는 누락 JSON의 SQL NULL도 게시 근거로 통과시키지 않는다. 실제 merge/운영 배포는 수행하지 않는다.

## ADR-015 — 로컬 운영 경보·암호화 복원 검증과 분리된 C gate (2026-10-20)

- 상태/대체 관계: P4-05/06 로컬 구현·검증. ADR-011/014의 PostgreSQL/Codex 실행 구조를 유지하며 초기 Redis/Python Engine 복구 후보는 NOT_IN_ACTIVE_ARCHITECTURE로 표시한다. 원래 설계를 조용히 완료로 바꾸지 않는다.
- 결정: 신선한 worker/DB/provider/Sandbox/큐/API/SSE 계측, 불변 경보 이력과 고정 Slack outbox를 사용한다. 확인과 회복을 분리하고 결과 불명은 재전송하지 않는다. 수치 기준은 로컬 정책이며 운영 SLA가 아니다.
- 백업: 점검 fence와 MVCC snapshot·물리 코드 SHA를 연결하고 AES-256-GCM 파일/별도 키로 저장한다. 자체 백업만 새로운 UUID 소유 컨테이너·볼륨·파일에 복원한다. 세션·외부 통합·예약·이전 merge 승인/전송은 격리 처리한 뒤 실제 DB 중단·재시작과 내용 보존을 시험한다. 원본 business 데이터 교체/삭제는 없다.
- 실행 복구: 시작 뒤 늦게 만료되는 lease도 주기적으로 탐지한다. 이전 공급자 종료를 확인할 수 없으면 다른 프로젝트의 새 호출도 막는다. 실제 Codex native 고아 프로세스의 자동 판정/종료는 검증하지 않았으며 안전하게 차단하고 호스트 조정 대상으로 남긴다.
- C gate: 로컬 기술 근거가 모두 유효하면 READY_FOR_OWNER_REVIEW. 동일 source digest·실제 restore/알림 전송·계측 신선도·미해결 긴급 경보·점검 상태를 함께 검사한다. 클라이언트 PASS 제출/자동 merge/배포 API는 없다.
- 영향/한계: 새로운 유료 모델/인프라는 없다. 로컬 API 내부 supervisor는 고정 명령·대상·Owner 권한을 검사하지만 운영용 독립 OS 권한 broker가 아니다. off-host 복구/운영 환경·RPO/RTO·상시 ingress·범용 실행/언어 비교·host supervisor 분리가 남아 운영 C는 NO_GO다. 실제 merge/운영 배포는 사용자 지시로 미수행이다.
- 근거: migration0009, 07/08/14/15/16, README의 실행 ID·source digest·암호화 파일 SHA·검증 Artifact와 실제 브라우저 근거를 따른다.

## ADR-016 — 로컬 한국어 STT 후보 확인과 공통 task command (2026-10-20)

- 상태: Phase 5 로컬 음성 구현. ADR-011/015의 구독 실행·PG/Phaser·분리된 C gate를 유지한다. P5-03/04의 추가 모델·TTS·회의는 승인/검증된 구현 범위로 확대하지 않는다.
- 결정: 공식 배포/모델 해시를 검증하는 whisper.cpp b5454/tiny 다국어 로컬 CPU 전사, 명시적 동의, 최대30초/동시1/UTC일20회/timeout60초를 사용한다. 음성 모델 다운로드만 외부 공개 자원을 읽는다. 외부 STT 전송/유료 API fallback/자동 재시도는 없다.
- 권한: STT는 task가 아닌 별도 후보다. 확인/수정/만료/version·Owner/project/maintenance를 검사한 서버만 공통 task command로 TODO를 생성한다. source VOICE는 일반 task POST에서 거부하고 merge/운영 배포 승인이나 run을 자동 생성하지 않는다.
- 개인정보/복구: native close 뒤 임시 WAV 삭제, track 해제, 후보1시간 만료/30초 정리, 확인/취소 plaintext 폐기와 수정 감사 연결. restore는 후보 격리/폐기. 강제 종료 시 native identity/잔여 WAV 자동 조정은 미검증이며 후속 STT를 막고 운영자 확인으로 남긴다. metadata 장기 보관 정책은 운영 검토 대상이다.
- 대안/한계: 브라우저 원격 음성 인식의 공급자/보관 동작은 사용하지 않았다. tiny의 실제 시험은 조사/띄어쓰기 오류를 보여 정확도 일반화를 하지 않는다. 물리 마이크/다른 OS·브라우저·noise/장문·TTS·자동 최적화·운영 C는 미검증/미구현이다.
- 근거: 0010 migration, voice provider/routes/UI, T20 시험과 README의 실제 전사/취소·browser·회귀 근거, 20장 공식 링크. 실행 파일/모델/개인 음성·비밀은 Git에 넣지 않는다.
- 경계 보완: 취소 요청 중에는 PROCESSING/VOICE_CANCEL_REQUESTED로 native close/파일 정리를 기다리며 슬롯을 유지한다. error 이벤트만으로 종료를 가정하지 않는다. cleanup 불명은 PROCESSING/VOICE_CLEANUP_REQUIRED로 후속 전사와 cancel 초기화를 차단한다. 실제 native spawn 실패/close 정리와 두 경계 회귀를 포함해 최종 자동223·Chromium37을 검증한다.

## ADR-017 — 로컬 음성의 소유권 기반 강제 종료 복구 (2026-10-20, Windows 구현·검증)

- 대체: ADR-016의 강제 종료 뒤 자동 조정 미구현 항목을 이 Windows 로컬 범위에서 대체한다. 운영 C·물리 마이크·Codex worker supervisor 분리의 미검증 범위는 유지한다.
- 결정: PROCESSING 행과 host UUID/hostname·Owner PID/생성 FILETIME/SID/executable 영수증을 먼저 commit한다. 복구는 Windows process handle을 고정하고 소유자 생존 여부·native executable/SID/Windows 파싱 argv를 대조한 뒤 해당 native 종료/대기를 확인한다. 소유 UUID 폴더의 단일 regular audio.wav만 삭제하고 빈 디렉터리만 제거한다.
- 경계: PID/프로세스명만 보고 종료하거나 재귀 삭제하지 않는다. host/영수증 불명·junction/hardlink·추가 파일은 차단한다. DB advisory lock·행 잠금, 시작 시/30초 주기, 자동2회 제한·Owner 명시적 version 재확인을 적용한다. 복구는 CANCELLED/VOICE_RECOVERED_AFTER_CRASH로 닫고 전사/업무/run을 replay하지 않는다. maintenance/restore quarantine에서는 native를 건드리지 않는다.
- 검증: DB 경계11·Windows 실행 경계8·실제 API Owner 강제 종료2를 추가했다. Windows 시험은 살아 있는 소유자 보존·PID 재사용·정확한 native 종료1개·파일 삭제·잘못된 argv/host/link 보존을 확인한다. API 강제 종료 두 건은 종료 전 native 생존, 복구 시 이미 종료됨(stopped=0), WAV1개 삭제·남은 음성0·task/run0이다. 장시간 C# native 대역과 실제 whisper 모델 실행을 구분하며 미확인 고아 생존을 성공했다고 주장하지 않는다.
- 호환/한계: 기존 null 영수증·host 정체성 파일 유실/다른 host는 보수적으로 차단한다. 같은 소유자가 살아 있는 cleanup 실패는 소유자를 자동 종료하지 않는다. UI 입력 경로 선언/입력 신호는 물리 장치 인증/정확도 증거가 아니다. 실제 마이크 시험은 헴의 준비 통보까지 대기한다. 새 유료 API·다운로드·merge·운영 배포는 없다.
- 공식 확인: Microsoft [Process Handles and Identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers), [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes), [CommandLineToArgvW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw), 열람2026-10-20. API 정체성·생성 시각·인자 파싱의 공식 근거이며 앱의 복구 성공은 별도 실제 시험으로 확인한다.

## ADR-018 — 마이크의 same-origin 문서 정책과 실제 사용자 검증 (2026-10-20)

- 문제: Foundation의 `Permissions-Policy: microphone=()`가 남아 실제 getUserMedia 요청을 거부했다. 대역 입력 시험은 이 문서 정책을 통과하지 않아 기존 회귀만으로 발견하지 못했다. 초기 Chrome 설정 안내보다 서버 헤더 대조가 먼저였어야 한다.
- 결정: 마이크만 `(self)`로 허용한다. 카메라/위치/타 origin 위임은 계속 차단하며 브라우저/OS 권한·사용자 앱 동의·직접 버튼 입력을 대신하지 않는다. 고정 오류 이름으로 권한/장치/API/녹음기 실패를 구분하고 원시 장치 메시지를 표시하지 않는다.
- 검증: 실제 응답/문서 policy 검사와 오류 비노출/무업로드/track 해제5개를 추가해 Chromium45개를 완주했다. 사용자가 직접 녹음·전사·취소 후 원문 비워짐을 보고했고 서버 MIC9480ms/READY→CANCELLED·plaintext/task_id=null·새 task/run0·임시 파일0과 대조했다. 미사용으로 남은 새 빈 시험 프로젝트만 archive했다.
- 한계: 정해둔 문장과 “수정해”→“수상해” 차이가 있어 인식 정확도를 일반화하지 않는다. 단일 사용자 입력·서버 대조이며 장치 attestation/다른 OS·소음·장문·운영 개인정보 보관 정책은 별도다. 원시 음성은 검증 후 남기지 않으며 새 유료 API·모델 전환·merge·운영 배포는 없다.
- 근거: README/12/14/20장·실제 후보 ID·브라우저 회귀·웹 헤더. [W3C Permissions Policy](https://www.w3.org/TR/permissions-policy/) Working Draft 2026-09-22, 열람2026-10-20.

## ADR-019 — how-to-trash의 제한된 실제 저장소 실행 (2026-10-20)

- 배경/선택: 사용자 Phase5 수락 후 how-to-trash를 첫 실제 업무로 선택했다. 기존 PG/Node/Codex 구독/Phaser 구조를 유지하고 시험 fixture를 범용 셸로 확장하는 대신 저장소 URL·기준 commit·admission·이미지 ID·수정 가능 6경로·고정 명령만 허용한다.
- 결정: npm lock 의존성 준비는 ignore-scripts로 분리하고 후보 실행은 offline/non-root/read-only root/제한 Docker에서 수행한다. 이미지/데이터/지도/설정/lock/자산 변경을 차단하며 binary도 검사한다. 저장소 source는 DB 불변 필드이며 prompt에서 생략한 큰 데이터도 후보 SHA와 검사에 포함한다.
- 브라우저: 같은 후보의 network=none preview에 loopback GET/HEAD 중계로 접근한다. 호스트 credentials는 전달하지 않고 중계 외 브라우저 origin과 service worker를 차단한다. 실제 키 없는 경우와 비밀이 아닌 dummy key로 SDK 요청을 차단한 경우를 구분한다. remote Kakao의 실제 장애를 관측한 것으로 주장하지 않는다.
- 예산/상태: 기본15분·7turn·500k token·재작업2·구독 quota/유료 credits 차단을 유지한다. 같은 후보 재검증은 기존 usage/turn/rework/startedAt를 보존한다. 시간 종료 뒤 Owner가 명시적으로 요청하는 별도5분 창은 해당 SHA·QA1회에만 묶이며 code generation/rework/반복 연장을 허용하지 않는다. 실제 승인 전에는 활성화하지 않는다.
- 2026-10-20 검증/판정: 실제 PM/Developer·test/build와 브라우저 기능을 확인했다. QA 1차의 근거 부족 FAIL 및 중간 검사 오류는 보존한다. 원래 404 UI의 stylesheet Event도 별도 baseline으로 재현했다. 당시 최종 QA 승인 대기였으며 완료/수락/push/출시로 기록하지 않았다. 이전 Phase5의 실제 마이크 수락과 독립된 범위다.
- 2026-10-21 검증 후속: Owner가 추가5분·QA1회를 승인했다. 같은 후보 `ae2afa1c…`에서 test6·lint/tsc/build·브라우저4조건과 QA PASS를 확인했다. 창 승인08:18:11.543→관측완료08:20:06.790 KST, 115.247초≤300초다. 원래 startedAt·rework2·사용량을 보존했고 총turn6·추가QA잔여0이다. target `codex/region-search` commit `7b07edc`를 push했으며 DB는 WAITING_APPROVAL로 남겼다. 별도 앱 결과 수락·merge·운영 배포는 수행하지 않았다. 최초 FAIL 이력과 404 baseline 한계도 유지한다.
- 한계: 단일 승인 저장소/기준 commit/Next.js npm 잠금 파일·정해진 경로에 한정된다. GitHub App의 대상 저장소 권한/CI/merge 범위를 확장하지 않았다. 범용 저장소·언어 비교·운영 C·실제 merge/운영 배포는 여전히 별도다.

## ADR-020 — 결과 상세 패널과 검증된 전달 기록 (2026-10-21)

- 배경: 커밋 SHA·서버 ID 중심 보고와 아래쪽 상세 때문에 사용자가 실제 결과를 찾기 어려웠다.
- 결정: 선택 프로젝트·업무의 요약·검증·변경 파일·전달 링크를 우측에 표시한다. 모바일은 상단, 긴 직원 보고·원문·이력은 접어서 표시한다. 링크는 승인 action을 실행하지 않는다.
- 전달 신뢰 경계: 로컬 운영자 CLI가 고정 저장소/profile·QA PASS·후보 SHA·허용 경로·원격 head와 Git 파일 내용을 확인한다. 일치할 때만 checkpoint.delivery와 감사 이력을 저장한다. 기존 기록의 다른 commit 덮어쓰기는 거부하며 원본 결과 상태는 유지한다.
- URL 경계: 검증된 GitHub 저장소·commit·branch만 링크한다. 후보 SHA를 Git SHA로 추측하지 않는다. URL의 project/task는 로그인 뒤 실제 접근 가능한 목록에서만 선택한다. 이름 기반 검증 프로젝트 묶음·localStorage 선택 기억은 UI 선호이며 권한 정책이 아니다.
- 검증: 관련62개·전체 Chromium48개와 실제 how-to-trash 전달/화면 대조를 통과했다. 최초39PASS/9FAIL은 보존한다. 실제 run은 WAITING_APPROVAL·turn6 유지이며 새 모델 호출·Slack 시험 전송·수락·merge·운영 배포는 없다.

## ADR-021 — 공개 터널 없는 Slack 로컬 수신 (2026-10-21)

- 배경: 임시 HTTPS 주소 만료와 반복 설정 없이 이 PC에서 기존 Slack 명령을 수신해야 한다.
- 결정: 공식 Socket Mode SDK 3.1.0과 `connections:write` 앱 수준 토큰의 Git 제외 로컬 참조를 사용한다. 기존 bot 권한·명령·Owner/시험 채널 범위를 유지하며 HTTP 모드도 보존하되 Socket 연결의 HTTP ingress는 차단한다.
- 신뢰 경계: 고정 app/team/channel/current Owner·연결 버전·활성 상태를 검증한다. inbox 영속화 뒤 ACK, trigger 기반 중복 방지, 비활성 연결 중단을 적용한다. SDK 로그·자격 값·WebSocket URL은 공개하지 않는다. 업무는 TODO만 등록한다.
- 실제 근거: Slack 수신4회(상태·업무·API 재시작 뒤 상태·오류 수정 뒤 상태)와 채널 응답4회, 실제 UI 데스크톱/모바일·원문/hash·TODO1·실행0을 대조했다. SDK 내부 자동 재연결의 요청 오류가 API를 종료한 실패를 보존하고 앱에서 Promise를 처리하는 재연결로 수정했다. 자세한 근거는 docs/11을 따른다. 새 공개 터널·유료 서비스·모델 호출·merge·운영 배포는 없다.
- 한계: PC/로컬 API 가동과 인터넷 연결이 필요하다. OS 시작 등록·장기 단절·절전 복구 검증은 포함하지 않는다. HTTP 임시 터널 근거는 과거 이력으로 남긴다.

## 변경 규칙

기존 결정을 바꾸면 ID를 조용히 덮어쓰지 않고 변경 이유·새 ADR·대체 관계를 기록한다. 기술 기능 사실·사용자 지정 요구·실험 결과·설계 가정을 구분한다. 원문 26장의 날짜/대상/배경/대안/선택/근거/영향/한계/상태를 유지한다.
