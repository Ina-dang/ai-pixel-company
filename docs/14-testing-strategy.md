# 테스트·품질·에이전트 평가

## 실제 재부팅 실패와 복구 보강 · 2026-10-21

- 첫 실제 재부팅 자동 실행은 실패했다. 종료 코드·부팅/작업 시각과 수동 복구 후 HTTP200·실제 Slack HELP 수신은 구분한다. 당시 종료 주체는 확정할 수 없다.
- 신규 정책 테스트3개는 실제 Windows CIM 작업 설정과 지속 예산(최대4회·정상 중지·새 로그온·손상 차단)을 검사한다. 자식 관리13개·웹 IPC2개와 합쳐 관련18개 통과다. 신규 테스트는 최초 기능 부재로2FAIL, 이후 테스트 하네스 PowerShell 파이프 문법1FAIL을 수정했고 최종3개 모두 통과했다.
- 실제 시험에서 native RestartOnFailure만으로 래퍼 강제 종료 복구가 되지 않아 제거했다. 첫 ShellExecute 시범은 자식이 남았고, 수정한 부모 파이프는 두 서버를 정리했다. 최종 1분 점검+지속 예산은 차수3 안에서 새 감독/API/웹 PID로 복구했다. 차수2 종료 코드1의 직접 원인은 미확정이다. 검증기의 최초 JSON 변환 누락·CIM 생성 시각 정밀도 차이·차수2 고정 가정도 수정했으며 실패를 성공으로 계산하지 않는다.
- 정상 Stop 후 1분 점검을 지나도 blocked·두 포트 없음·STOPPED를 확인했다. 검증기는 업무/실행/merge/연동 작업의 상태·버전/turn 변경0을 대조한다. 실제 보강 후 재부팅은 사용자가 진행할 별도 시험이다.
- 회귀는 중복 없는26파일에서 **311 PASS / 1 FAIL = 312개**다. 비통합16파일124PASS + 통합5파일120PASS + 통합4파일66PASS + 음성 강제 종료1파일1PASS/1FAIL. 최초 단일 전체 실행은 시간 제한으로 중단돼 이 수치에 더하지 않는다.
- 남은 실패: `tests/voice-crash.integration.test.ts`의 real-whisper가 `CANCELLED / VOICE_RECOVERED_AFTER_CRASH` 대신 `FAILED` 상태여서 실패했다. controlled-native는 통과했고 실제 로컬 모델 readiness도 true였다. 단독 실행에서도 재현돼 이번 자동 실행 변경과 무관하다고 단정하지 않으며, 음성 구현/기대값을 임의로 바꾸지 않았다. **전체 회귀 PASS로 표시하지 않는다.**
- 최종 lint·typecheck·build·계약 검사와 관련18개는 통과했다. 중간 lint의 finally 내 명시적 throw1개는 ENOENT 처리 함수를 분리해 수정했다. 실제 정상 재시작 뒤 감독/API/웹 `37180/1056/31036`과 두 loopback 포트·HTTP200을 확인했다. 실제 데스크톱/390px 모바일에서 페이지 오류0·업무 쓰기0·가로 넘침 없음·기존 Slack 기록13개·Socket CONNECTED를 대조했다. 이 후속에서는 새 Slack 명령·직원 실행을 보내지 않았다.

## Windows 대시보드 동시 자동 실행 후속 — 2026-10-21

- 관련15개: 기존 관리 프로세스9 + 빌드/rewrite·서비스별 상태/복구4 + 실제 자식 IPC 종료2. IPC 테스트는 모의 Next 서버가 아닌 Node 자식의 종료 경계만 검증한다. 실제 Next 동작은 등록 작업/브라우저 검사로 분리한다.
- 최초13 PASS/2 FAIL은 preload 인수에 Windows 경로를 그대로 사용한 문제였다. `file:` URL로 수정 후15개가 통과했다. 해당 실패를 숨기거나 시간 제한만 늘리지 않는다.
- 실제 등록 작업에서 API·웹 동시 시작, 웹만 한 번 종료 후 API PID 유지·웹 PID 교체, 전체 정상 중지/재시작을 확인한다. 두 포트는127.0.0.1이고 실제 소유 PID가 작업 status와 일치해야 한다.
- `.local/windows-dashboard-live.json`은 업무·실행·merge·외부 작업·inbox 변경0을 대조한다. 새 Slack 명령이나 업무 실행을 발생시키지 않는다. 실제 브라우저는 로그인·프로젝트/업무 선택·상세·Slack 수신 중·원문/hash·실행0·업무 쓰기0을 데스크톱/390px 모바일에서 확인한다.
- 전체 회귀는 파일을 겹치지 않는13파일/12파일로 나눠 순차 실행한다. 실제 Windows 로그아웃·재로그인/재부팅은 미실행이며, 등록된 로그온 action을 직접 시작하는 시험과 구분한다.
- 최종 결과:13파일121개 +12파일188개 =25파일309개 PASS. related15개는 전체309개에 포함한다. lint·typecheck·build·계약 검사와 실제 데스크톱/모바일 smoke(페이지 오류0·업무 쓰기0·가로 넘침 없음·Socket CONNECTED)도 통과했다. 모델 호출·새 Slack 명령·실제 merge·운영 배포는 수행하지 않았다.

## Windows 로그인 자동 실행 후속 — 2026-10-21

- 관리 프로세스9개 테스트: Docker 준비 지연/시간 제한·중지·최대4회 시도·포트/설정 충돌 시 중단·자식 종료 복구·정상 종료·로그 자격 값 제거·PID 재사용 구분.
- 실제 현재 사용자 작업: Limited·Interactive·로그온20초 지연 등록을 읽어 확인한다. 같은 등록 action의 시작→정상 재시작→소유 API 한 번 강제 종료→동일 supervisor의 새 API 복구와 중복 실행 방지를 확인한다. 실제 로그아웃/PC 재부팅을 실행한 것으로 주장하지 않는다.
- 실제 Slack STATUS2·HELP1 수신/응답과 업무·실행·merge·외부 작업 변경0을 DB로 대조한다. 최종 HELP는 사용자가 직접 보낸 명령의 서버 분류다. `.local/windows-api-live.json`은 실제 근거이며 모의 테스트와 분리한다.
- 복구 후 실제 대시보드 데스크톱/모바일의 연결 상태·처리 이력·기존 업무 원문/hash·실행0·페이지 오류0·업무 쓰기0을 확인한다. 브라우저/빌드 실행 래퍼 시간 초과와 native batch 재검증 결과를 구분한다.
- 첫 전체 실행에서 기존 voice-native-recovery의 PowerShell 준비가 시간 초과해294 PASS/8 SKIP·suite1 FAIL이었다. 해당8개 단독 재실행은 통과했으며 최종 전체 검사 결과와 함께 기록한다.
- 최종 전체24파일/303개 PASS(249.35초). 배치 실행 도구의300초 제한으로 뒤에 묶은 lint/typecheck/build/contracts는 건너뛰어졌으며 각각 별도 실행해 모두 통과했다. 실제 브라우저 검사의 최초 실행 래퍼 시간 초과도 보존했고 최종 native batch 실행은 정상 종료했다. 미실행된 뒤 명령을 해당 배치에서 통과한 것으로 기록하지 않는다.

## Slack 명령 실제 수신 후속 — 2026-10-21

최종 관련49개 = 연동34 + 보고11 + 중계4, lint·typecheck·전체 build를 통과했다. 전체 Chromium 회귀를 새로 실행한 수치는 아니며 아래 실제 데스크톱/모바일 시나리오와 구분한다.

실제 Slack 작성기에서 상태·업무 등록 각1회만 보내고 서명 수신→durable 처리→같은 채널 결과 응답을 확인했다. 상태 직후 업무 증가0, 최종 TODO1·source SLACK·원문/공백2칸/SHA 보존, 기존 task/run/merge/연동 operation 불변을 사전 snapshot과 비교했다. 별도 connector가 실제 두 응답을 읽어 정확한 업무 링크를 대조했다. DB 검증기는 처음 postgres RowList prototype과 저장된 JSON 배열을 직접 비교해 실패했으나 값 정규화 후 성공했다. 재검증은 read-only이며 명령 재전송은 없었다.

실제 브라우저에서 등록 task의 원문 해시·run0·명령5건(이전3+이번2) PROCESSED/SENT·모바일 가로 넘침 없음·업무 변경0·페이지 오류0을 확인했다. 화면은 `test-results/phase3-slack-live-desktop.png`, `test-results/phase3-slack-live-mobile.png`다. 실제 수신 시험 뒤 터널과 relay를 닫아 process/listener 없음·외부530을 확인했다. 대시보드·Owner API·GitHub 경로404 및 unsigned Slack403도 실제 공개 주소에서 검사했다. Slack 설정의 원래 Request URL도 복원 후 재조회했다.

## Slack 업무 보고 후속 — 2026-10-21

최종 관련 55개 = 연동 34 + 보고 11 + 전달/링크 10을 통과했다. 업무명 출처·후보 일치·실패/미실행 구분·상태별 다음 행동·과거 개발 설명과 현재 검증의 구분·특수문자/비밀 패턴·길이 제한·안전한 커밋 링크·권한/중복·UNKNOWN 유지와 GitHub 권한 확장 금지를 확인한다. 새 repository fixture 시험은 immutable source와 active run 유일성 제약에 두 번 걸렸고, 원본을 변경하지 않는 수락 완료 시험 run을 생성하도록 수정한 뒤 통과했다. 제약을 완화하지 않았다.

실제 `how-to-trash` 보고 1건을 기존 비공개 시험 채널로 발신하고 별도 Slack 조회로 텍스트·정확한 task 링크·확인된 커밋을 대조했다. 동일 메시지 수정 후 최신 요약을 다시 조회했다. 모델 호출·업무 수락·merge·배포는 없고 실제 run은 이미 SUCCEEDED·version42·turn6이었다. 발신 전·후 동일 상태를 검사했다. 실제 slash command 외부 수신은 이번에 재실행하지 않았다.

정적 검사·전체 build를 통과했다. `scripts/verify-result-panel.ts`는 검토 대기와 이미 수락한 결과 모두 읽기 전용으로 확인하며 검사 전·후 상태/version/turn을 비교한다. 이전 48개 전체 Chromium 회귀 수치는 아래 결과 패널 시점 기록이다.

## 결과 상세·전달 근거 후속 — 2026-10-21

실행 20 + 연동 32 + 전달/링크 10 = 관련 62개를 통과했다.
원격 head·파일 내용·허용 경로·QA/SHA 불일치·다른 저장소·더러운 checkout은 전달 기록 전에 거부한다.
실제 how-to-trash의 push된 `7b07edc`와 전체 후보를 대조한 기록을 checkpoint·감사 이력에 연결했다.
전체 Chromium 48개는 우측 배치·딥링크/새로고침·모바일·기존 승인 경계를 포함한다.
첫 전체 실행은 39개 PASS·9개 FAIL이었다. 기본 프로젝트 선택 변화와 숨겨진 기준 정보를 수정하고 최종 소스에서 48개 완주했다.
첫 실패의 화면·오류는 Git 제외 `.local/browser-evidence/result-panel-first-failure`에 보존했다.
실제 결과 패널의 커밋 링크·6파일·QA PASS·WAITING_APPROVAL·모델 호출6회 유지, 업무 변경0·페이지 오류0을 확인했다.
`scripts/verify-result-panel.ts`는 읽기 전용 실제 UI 검사이며 데스크톱/모바일 화면을 `.local/browser-evidence/result-inspector-*.png`에 저장한다.
이 시범은 새로운 모델 실행·Slack 전송·결과 수락·merge·운영 배포를 포함하지 않는다.

## 실제 저장소 1차 검증 — 2026-10-20

how-to-trash는 기준 commit `e98a537cada650e64a29b5e25c5cf6e94f5ced0f`의 원래 빌드0/미구현 helper 시험 실패를 먼저 확인했다. 실제 Developer 후보에는 고정 외부 수용 검사와 Developer가 추가한 node:test를 별도로 실행했다. artifact의 같은 SHA에 테스트/build0, lint/tsc를 연결하며 UI·모델이 최종 상태를 결정하지 않는다. QA가 브라우저와 개별 명령 근거 부족을 FAIL로 남긴 뒤, 이를 보완하는 과정에서 원래15분 제한이 끝났다. 기존 token/turn/rework/startedAt·이전 FAIL은 보존한다.

2026-10-21 Owner 승인 뒤 추가 300초 창·QA 1회만 사용해 최종 PASS를 확인했다. 같은 SHA의 node:test 6개·고정 수용 검사·eslint·별도 tsc·Next build와 브라우저 네 조건을 연결했다. 입력/초기화/링크 높이는 각각 50px, 키보드 focus outline은 solid 2px였다. 총 turn6·rework2·원래 startedAt는 보존했고 추가 QA 잔여는 0회다. 실제 결과는 WAITING_APPROVAL, target branch commit `7b07edc` push이며 수락/merge/운영 배포는 미수행이다.

같은 날 사무실 레퍼런스 후속은 관련 단위·동기화 10개/브라우저 8개와 lint/typecheck/build를 확인했다. 직접 제작 그래픽의 대비·크기·HTML 라벨만 변경했으며 실제 서버 PM WAITING / Developer IDLE / QA IDLE과 대조했다. 이전 Chrome 번들을 새로고침한 뒤 `original-v4` 로드를 확인한다. 아래 전체 257개·Chromium47개는 앞선 시점의 전체 회귀 이력이다.

자동257개는 A(3파일/42), B(4파일/80), C(13파일/135)의 순차 검사다. 3+4+13=20파일, 42+80+135=257이다. source pin·경로/의존성/자산·JSONB 키 순서·다른 저장소/구독 우회·원본 예산을 유지한 재검증·만료/QA1회/실패 후 재작업 금지를 포함한다. 브라우저는 1440/375px × 키 없음/SDK 차단으로 실제 search/reset/focus/detail을 검사하고, 기존 404 UI stylesheet Event는 원래 commit에서도 재현해 범위 밖 한계로 보존한다. 기능 경로 오류0은 전체 사이트 오류0을 의미하지 않는다. UI 회귀의 초기 selector 중복과 인증429는 별도 실패 이력이며 운영 로그인 제한을 완화하지 않는다. 최종 회귀/QA/push 판정은 README를 따른다.

대시보드 Chromium47=기존45+실제 저장소 프로필 선택/같은 후보 재검증2가 완주했다. 인증429는 workflow UI 검사에서 매번 실제 로그인을 반복하던 test harness를 파일 내 session 재사용으로 수정해 해결했으며, 로그인·로그아웃 UI 자체는 dashboard 시험에서 계속 검사한다. 운영 max10/60초는 그대로다. 별도 검증 시간은 기본 재검증 버튼으로 자동 부여하지 않는 것도 확인했다.

## Phase 5 실제 마이크 후속 — 2026-10-20

사용자 직접 녹음/전사/취소 후 원문 비워짐 보고를 서버 후보 `c379521b-965a-4071-8ee6-eee5970eaef6`와 대조했다. MIC 선언9480ms=9.48초, READY/v2→CANCELLED/v3·transcript=null·task_id=null, 해당 녹음 이후 새 task/run0·임시 WAV0이다. 물리 장치 ID/원음을 따로 수집하지 않아 장치 attestation을 주장하지 않는다. “수정해”→“수상해” 차이가 있어 단일 시험의 연결 성공과 인식 정확도를 구분한다.

이 과정에서 웹의 microphone=() 문서 정책이 NotAllowedError를 유발하던 원인을 발견해 self로 고쳤다. 실제 header와 문서 feature policy의 자기 origin 허용·타 origin/카메라/위치 차단을 검사1개로 묶고 API 미지원·NotFound/NotReadable·녹음기 실패의 무업로드/track 해제·원시 오류 비노출4개를 추가했다. 전체 Chromium45=기존40+5가 완주했다. 중간 실행의 도구/110초/165초 제한은 PASS로 취급하지 않으며, 잔여 검증 프로세스 확인 후 기존240초 셸 실행에서45개(1.3분) 성공했다. 시점별 자동244·계약/lint/typecheck/build·source digest 근거는 README를 따른다. 아래 물리 마이크 미실행 표시는 앞선 수락 시점의 이력이다.

최종 자동244개는 원래19파일을 A(3파일/42개), B(4파일/78개), C(12파일/124개)로 순차 분할해 각 exit0을 확인했다. 3+4+12=19, 42+78+124=244이며 파일 집합 대조로 누락/중복0이다. 이 실행은 단일 pnpm verify 시간 제한을 성공으로 바꾼 것이 아니다. 앞선 Docker same-SHA 시험1회 실패(원인 미확정)·분리8개 성공·최종 세 묶음 성공을 구분한다. 코드·기대 결과·실제 Docker 실행/제한을 바꾸거나 시험을 건너뛰지 않았다. 최종 source digest는 `899fc0d8c0c23c44d5be9209637bec1c9d19c242f9cdb8028821b9e88b99171d`, PASS `43853b89-acb8-427c-b388-070d30ce762d` / 관측 FAIL `9d1610ad-8db0-45a4-886c-47c1591049eb` / browser `ee9450a9-d04d-411b-a808-1bcb56e28413`의 세 근거를 함께 보존한다. 계약/lint/typecheck/build도 최종 소스에서 통과했다.

## Phase 5 강제 종료 후속 검증 — 2026-10-20

최종 자동244=기존223+복구21, Chromium40=기존37+복구3, lint/typecheck·TS16/Python26 계약·build PASS다. source digest `74b9f1e099da86d833193f70f14f010221cfe017e25239d61ebf785dc992fecb`의 자동/브라우저 증거는 각각 `ece853e4-9719-460c-a432-025b35799aec` / `a1a032a1-0002-4bac-9787-7f0ab4235b5e`다. 아래223/37은 앞서 수락한1차 이력이다.

복구21개는 DB 조정/두 인스턴스 잠금/상한/Owner 확인/유지보수11개, 실제 Windows PID/생성 시각/argv/host/link·파일 경계8개, 실제 API parent 강제 종료2개다. API 시험은 별도 소유 marker가 있는 DB/폴더와 공개 합성 silence를 사용하고 실제 whisper 모델과 장시간 C# native 대역을 구분한다. 두 API 시험에서 native는 종료 전 살아 있었으나 복구 시 이미 종료되어 stopped=0이었다. 이후 WAV1개 삭제·잔여0·자동 task/run0을 확인했다. 별도 실행 경계 시험에서 살아 있는 정확한 native1개 종료를 검증하므로 두 관측을 혼동하지 않는다. 시험 DB/폴더는 소유 marker·실제 경로 확인 후 정리한다.

브라우저 추가3개는 복구 명시적 동의/current version·오류 시 차단 유지·탭 숨김 때 제어된 track 해제/무업로드다. 첫 숨김 대역 시험은 visibilityState만 변경해 실제 document.hidden 경로에 도달하지 못해 실패했고 올바른 속성 대역으로 수정 후 전체 통과했다. 실제 물리 마이크는 헴의 준비 통보까지 미실행이며 FILE/MICROPHONE 선언·신호 meter를 그 증거로 취급하지 않는다. 원래 구형 영수증/다른 host의 수동 확인·운영 개인정보/범용 환경 한계는 남는다.

## Phase 5 실제 검증 범위 — 2026-10-20

최종 자동223=기존206+T20 음성17, Chromium37=기존30+음성7, lint/typecheck·TS16/Python26 계약·build를 통과했다. 음성 동의/권한/CSRF·미준비/형식/한도·미확정 task0·수정/확인·source 위조/중복 거부·한도/점검·취소/만료/권한 철회·restore 격리·위험 승인/run0을 검사한다. 추가 경계 검증은 취소 중 전역 슬롯 유지, 파일 정리 불명 시 PROCESSING/차단, 실제 잘못된 native executable의 spawn 실패→close→임시 파일 삭제다. 브라우저는 명시적 동의·escaped 후보·수정 뒤 재확인·취소·거부된 마이크·mock track 해제·390px overflow0·30초 초과 무업로드를 검사한다. UI 대역은 실제 로그인 한도를 소비하지 않으며 실제 인증/STT/browser는 별도 opt-in live verifier에서 검사한다.

라이브 검증은 설치된 오프라인 한국어 합성기로 만든 공개 문장→실제 native whisper.cpp→Owner API/DB→실제 Chromium decode/upload/수정 확인을 사용한다. 원문과 전사 차이를 그대로 남겨 정확도를 일반화하지 않는다. native 강제 취소/close·임시 WAV0·확인된 TODO/자동 run0·중복 task 없음과 전체 새 schema 백업/복원을 함께 확인한다. 물리 microphone/다른 OS/browser/noise·서버 강제 종료 뒤 raw file 자동 조정·운영 개인정보/metadata 정책은 미검증/미구현이다. 세부 Artifact와 source digest는 README. 실제 merge/운영 배포는 수행하지 않는다.

## P4-05/06 실제 검증 — 2026-10-20

전체206=이전188+운영18, Chromium30=이전25+운영5, lint/typecheck·계약 TS16/Python26·build를 실행해 PASS를 기록했다. 계측/경보 dedupe·확인/회복·권한 철회·전송 UNKNOWN/429·점검/복원 격리·주기 lease recovery·SSE fanout/느린 소비자·기한/크기·암호 인증/경로 검사를 포함한다. 기본 테스트의 외부 공급자는 대역이며 실제 Slack 전송과 구분한다.

실제 opt-in은 암호화 파일449,791 bytes·테이블44/코드14의 복원 대조, 격리 PG 실제 중단/재시작 후 상태 보존, 별도 native worker의 강제 종료 후 자동 재호출 금지를 확인했다. worker의 공급자는 비과금 대역으로 실제 Codex 강제 종료 성공을 주장하지 않는다. 기존 실제 GitHub/Slack 인증과 시험 경보/회복2건 SENT, 실제 API100읽기/동시4/p95 11ms, 실제 운영 화면/키보드/390px/page error0을 확인했다. 첫 복원 실패와 알림 정책 복원 뒤 차단도 README에서 별도로 보고한다.

동일 source digest의 검증5종과 runtime/restore/전송 근거를 함께 검사해 로컬 gate는 READY_FOR_OWNER_REVIEW, 운영 gate는 NO_GO다. Redis/Python Engine은 활성 구조에 없어 NOT_IN_ACTIVE_ARCHITECTURE이며 시험 통과로 세지 않는다. off-host/clean host·운영 환경·supervisor 권한 분리·RPO/RTO·상시 ingress/범용 실행/언어 비교는 미검증이다. 실제 merge/운영 배포·새 유료 모델/인프라는 미수행이다.

## Phase 4 실제 검증 — 2026-10-19

전체 단위/통합188개(이전158+Phase4 30), Chromium25개(이전20+Phase4 5), lint/typecheck/계약 TS16·Python26/build를 실행했다. Phase4는 실제 PostgreSQL의 evidence/null/rubric/불변 이력·편향/loop·권한 철회/UNKNOWN·프로젝트 격리·DAG 순환·예산 경합·명시 예약·archive/부서/퇴사 이력을 검사한다. 선행 조건에 막힌 예약31건 뒤의 실행 가능한 업무 누락도 회귀 검증한다. 기본 테스트의 공급자는 제어된 대역이며 모델을 호출하지 않는다.

별도 opt-in `verify:company-live`에서 기존 Codex 구독으로 프로젝트2개의 PM/Developer/QA 코드 수정·Docker test/build0·QA PASS와 3종 AI 평가 각1회를 실행했다. 실제 5종은 DRAFT, 부족한 점수는 null, 결과 수락/merge 미실행이다. 선행 수락 전 후속 run0, 공유 실행 최대 관측1, 데스크톱/390px/page error0을 확인했다. 첫 시험의 QA 거절/NO_CODE_CHANGE와 취소·보관도 README에 남겼다. 운영 경보·완전한 장애 복구·backup restore·통계적 모델 비교·실제 구독 소진 시험은 미실행이다.

## 1. 목적

AI의 주장 대신 독립적으로 확인 가능한 증거로 기능과 Phase gate를 판정한다.

## 2. 범위

unit, integration, end-to-end, agent evaluation, security, recovery, performance 계층을 설계한다. 현재 구현·실행 범위는 위 실제 검증과 README를 따르며 아래 항목 전체가 검증 완료됐다는 뜻은 아니다.

## 3. 요구사항

테스트마다 ID·requirement/AC ID·candidate SHA·환경/이미지/lock hash·명령 spec·시작/종료·exit code·원문 stdout/stderr Artifact·판정을 기록한다. redaction본과 원본 접근 범위를 분리하고 checksum을 유지한다. 모델 응답은 테스트 결과를 대신하지 않는다.

## 4. 설계 내용

| ID | 계층·대상 | 시나리오 | 통과 기준 |
|---|---|---|---|
| T01 | Unit / R02 | task/agent/run 전이와 완료 gate | 불법 전이·미실행 테스트 완료 거부 |
| T02 | Unit / R09 | 토큰·가격·반올림·UNKNOWN 사용량 | cached 중복 계산 없음·음수 거부·추정/실청구 분리 |
| T03 | Integration / R01 | 로그인·조직 FK·task CRUD·version | 비인증/타 조직 거부·원문 보존·경합 409 |
| T04 | Integration / R03 | 상태+event+outbox transaction 실패 | 부분 commit 없음·유실 전달 복구 |
| T05 | Recovery / R03 | counter commit 경합·snapshot 동시 변경·SSE reconnect/reload | 이벤트 누락 없음·최종 snapshot 일치 |
| T06 | E2E / R04~R06 | fixture 저장소 작은 기능 수정·test/build·QA·수락 | 실제 파일/diff/SHA·독립 근거·정확한 완료 |
| T07 | Agent eval / R06 | 실패 유도 후 QA 재작업 2회 | 최대 3 candidate·초과 실행 없음 |
| T08 | Recovery / R07 | node 중단·HTTP ACK 유실·중복 queue·stale worker | 동일 operation 조정·중복 부작용 없음 |
| T09 | Security / R08 | 동시 승인·만료·SHA 변경·다른 action·권한 철회 | 승인 단일 소비·stale 거부 |
| T10 | Security / R05 | path/symlink·SSRF·DNS·secret·fork/memory/disk·timeout | Sandbox 정책 실차단, 근거 보존 |
| T11 | Integration / R09 | 병렬 호출 예산 예약·정산·provider timeout | 상한 초과 신규 호출 거부·미확정 예약 유지 |
| T12 | Agent eval / R10 | 동일 과제 한국어/영어 비교 | 품질·성공·재작업·비용·시간 원자료와 비교 보고 |
| T13 | E2E / R11 | 실제 Dev/QA/오류/승인 이벤트→Phaser·fallback | 상태/한국어 일치·reload·중복 완료 효과 없음 |
| T14 | Integration / R12 | App 설치·PR/CI·중복/역순 webhook·merge | 정확한 SHA·중복 PR 방지·승인 없는 merge 거부 |
| T15 | Security / R13 | Slack 변조·replay·타 team·미매핑 Owner·전송 장애 | 신원/서명/채널 거부·웹 상태 유지 |
| T16 | E2E / R14~R15 | 템플릿 채용→프로젝트 배정→실제 작업 | profile snapshot·도구 제한·칸반/비용 연결 |
| T17 | Security / R16~R17 | 근거 없는 평가·자동 권한/해고·DAG cycle·타 project | invalid 평가/loop/cycle·권한 우회 거부 |
| T18 | Recovery / R18 | DB/Redis/Engine 장애·승인 중 재시작·backup restore | 상태/증거 복원·중복 실행 없음 |
| T19 | Performance / R03/R18 | 동시 run·event fanout·slow SSE client | 합의한 지연/자원 목표 충족·backpressure로 DB 보호 |
| T20 | E2E / R19 | STT 오류·미확인 텍스트·위험 음성 명령·원시 음성 삭제 | 확인 후만 공통 command 생성·자동 위험 승인 금지 |
| T21 | Contract / R20 | TS/Python schema version·JSON fixture | major 불일치 거부·필수 필드/타입 동일 |

Unit 후보는 TS Vitest, Python pytest, E2E는 Playwright다. 정확한 버전/runner·실행 명령은 Phase 0에서 정한다. lint/typecheck/test/build를 각 workspace에 정의하고 CI와 같은 검증을 로컬에서 재현한다.

### 에이전트 평가

대표 과제는 작은 버그 수정, 저장 기능, 실패 테스트 수정, 요구사항 모호성, 악성 저장소 지시 거부를 포함한다. baseline SHA·도구/예산·수용 기준·채점 rubric을 고정하고 여러 번 반복한다. 개발자 자체 평가와 자동 테스트·QA 의견·Owner 평가를 따로 저장한다. 평가자가 candidate를 모르는 블라인드 품질 검토를 가능한 범위에서 적용한다.

지표 산식: 성공률=검증/승인 완료 run 수÷시작한 평가 run 수, 요구 충족률=PASS 필수 AC÷전체 필수 AC, 테스트 통과율=통과 수÷전체 대상 수(미실행 별도 표시), 오류 변경률=잘못된 변경 run÷전체 run. 재작업 횟수·토큰·추정/실청구 비용·시간·사용자 개입·재현 가능 여부를 함께 제공한다. 낮은 비용만으로 우수 모델을 정하지 않는다.

## 5. 기술적 근거

원문 23장의 계층과 지표를 gate로 구체화했다. LangGraph/BullMQ의 재시도 기능은 [03](03-technology-decisions.md)의 공식 근거를 따르되 프로젝트 복구 성공은 T08/T18로 별도 검증한다.

## 6. 데이터 흐름

격리 fixture/known SHA → task 실행 → worker command 출력 → hash Artifact → verification result → 독립 QA → Owner 결과 수락. 테스트 SHA가 바뀌면 기존 PASS는 새 candidate에 재사용하지 않는다. 로그의 “성공” 문장보다 exit code·검증 보고·기준 결과를 우선한다.

## 7. 예외 처리

PASS/FAIL/UNVERIFIABLE/NOT_RUN을 구분한다. 환경 미준비·명령 없음·timeout은 성공이 아니다. flaky 테스트는 숨기지 않고 재현과 원인을 기록하며 무한 반복해 우연한 PASS를 고르지 않는다. 보안 테스트 실패는 범위 제한/차단 사유다.

## 8. 보안 고려사항

보안·악성 코드 시험은 비밀 없는 전용 환경에서 수행한다. 외부 유료 API 평가에는 예산을 예약하고 사용자 데이터 대신 fixture를 사용한다. 테스트 로그에 secret canary가 노출되면 raw 증거 접근을 제한하고 redaction을 검증한다.

## 9. 구현 우선순위

Phase 0 T01/T03/T04/T05/T21, Phase 1 T02/T06~T12/T18 최소, Phase 2 T13, Phase 3 T14~T16, Phase 4 T17~T19 확장, Phase 5 T20이다. 최소 부하 smoke는 Phase 0부터 실시한다.

## 10. 완료 기준

각 Phase 필수 테스트가 실제 실행되고 Artifact/보고서로 연결된다. 테스트 없는 기능은 미검증으로 남긴다. 문서 링크·목차·enum 정합성 감사는 제품 동작 테스트로 세지 않는다.

## 11. 미확정 사항

평가 반복 수·허용 품질 기준·성능/SLA·baseline 과제·provider 비용 한도는 Phase 0에서 합의한다. 통계적 우월성은 표본/불확실성 없이 주장하지 않는다.
