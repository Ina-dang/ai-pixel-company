# AI Pixel Company

Windows 로그인 작업은 Docker·DB 준비 후 로컬 API와 웹 대시보드를 실행하도록 구성돼 있습니다. 첫 실제 재부팅 시험은 작업 종료로 실패했으며, 복구 보강 후 재부팅 재시험이 남았습니다. 현재는 래퍼 강제 종료 뒤 자동 복구와 정상 중지 유지가 검증됐습니다. 대시보드는 [이 PC에서 열기](http://127.0.0.1:3000/)로 접속하고 Slack은 Socket Mode로 수신합니다. PC가 깨어 있어야 합니다. [Windows 로그인 자동 실행](docs/11-slack-integration.md#windows-로그인-자동-실행)에서 범위·관리 명령·남은 검증을 확인하세요.

최신성 체크: 2026-10-21 Slack 상태·업무 등록 실제 수신 검증. 이전 사무실·결과 패널·보고 형식 검증과 구분한다.

자연어 업무 지시를 PM·Developer·QA AI의 실제 개발 작업으로 연결하고, 검증된 실행 상태를 픽셀 사무실에 표시하는 AI 회사 운영 플랫폼이다.

## 현재 상태

**첫 실제 업무: how-to-trash의 지역 목록·검색 개선 — 최종 QA PASS · 앱 결과 수락 완료**

| 구분 | 확인된 상태 |
|---|---|
| 수락된 범위 | Phase 5 로컬 음성·Windows 복구·실제 마이크 검증 |
| 현재 업무 | 고정 저장소 프로필에서 실제 PM·Developer 코드 수정, 오프라인 검사·브라우저 네 조건 확인 |
| 최종 QA | 사용자 승인 추가 5분 창에서 같은 후보 QA 1회 PASS. 1차 FAIL 이력 보존 |
| 직전 전체 회귀 (2026-10-20) | 자동 **257개 통과** = 42 + 80 + 135 · Chromium **47개 통과** |
| 사무실 후속 검사 (2026-10-21) | 관련 단위·동기화 **10개**, 사무실 Chromium **8개** 통과. 전체 회귀 재실행 수치와 구분 |
| 결과 패널 후속 검사 (2026-10-21) | 관련 **62개** = 실행 20 + 연동 32 + 전달/링크 10 · 전체 Chromium **48개** 통과 |
| Slack 보고 후속 검사 (2026-10-21) | 관련 **55개** = 연동 34 + 보고 11 + 전달/링크 10. 실제 시험 채널에 결과 1건 전달·별도 조회 확인 |
| Slack 명령 실제 후속 (2026-10-21) | 관련 **49개** = 연동34 + 보고11 + 중계4 통과. 실제 상태·업무 등록 각1회 → 처리/전송2건·TODO1·원문/공백2칸 보존·실행0. 이전 명령3건과 구분 |
| 정적 검사·빌드 | 계약 검사·lint·typecheck·build 통과 |
| 전달 상태 | how-to-trash `codex/region-search`에 `7b07edc` push 확인. Slack 시험 전 조회에서 앱 결과 SUCCEEDED·version42 확인 |
| 출시 상태 | 운영 C **NO_GO**. 실제 merge·운영 배포·새 유료 API 미수행 |

다음 순서: **후속 업무 선정**. 앱 결과 수락은 실제 merge·운영 배포 승인이 아니며 별도 승인 전 실행하지 않는다.
상세 근거와 미완료 항목은 [구현 체크리스트](docs/IMPLEMENTATION_CHECKLIST.md)에서 확인한다.

## 문서 안내

Slack 결과 보고와 `/ai-pixel 상태`는 업무명·변경 요약·검증 결과·다음 할 일·업무 상세 링크를 표시한다.
변경 설명은 같은 후보의 Developer 보고에서, 테스트·빌드·QA는 서버의 현재 후보 근거에서 읽는다. 상태 명령은 최근 업무 최대 3건이다.
[실제 how-to-trash Slack 보고 확인](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792541692107489).
상세 링크는 서버가 실행 중인 이 PC의 `127.0.0.1:3000` 주소다. 다른 PC나 모바일에서 원격 접속되는 운영 주소는 아니다.
실제 보고는 기존 비공개 `#ai-pixel-test`·기존 봇 권한으로만 보냈다. 새 프로젝트 연결의 명령 매핑은 비어 있으며 Slack 명령 실행 권한을 추가하지 않았다.
명시적 실제 발신 검사는 `node --import tsx scripts/verify-slack-report.ts <projectId> <verifiedRunId> --send`이며, 기존 보고가 있으면 재발행을 거부한다.

실제 slash 명령도 `내손비/#ai-pixel-test`에서 검증했다. 상태 조회는 업무를 만들지 않았고 업무 등록만 시험 제목의 TODO 1건을 만들었다.
시험 대상은 기존 명령이 연결된 `채용 실행 검증 e5993975` 프로젝트다. how-to-trash의 발신 전용 연결에 명령 권한을 추가하지 않았다.
[실제 상태 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792542921422889) · [실제 업무 등록 응답](https://w1787572331-9ym425019.slack.com/archives/C0CAEGXQ5LL/p1792542952597479) · [등록된 시험 업무 상세 — 이 PC](http://127.0.0.1:3000/?project=56c54d8a-de76-4400-8308-a63b1bd2adaa&task=852c6d52-0749-4584-bf5b-b0e1e87e3470#task-inspector).
시험 업무는 자동 실행하지 않고 할 일로 남겼다. 서버 기준 새 run·merge 상태 변경·연동 operation 추가는 각각0이다.
30분 공개에 대한 별도 Owner 승인 후 Slack POST 경로 한 개만 임시 공개했고, 시험 직후 터널/중계 프로세스·3002 포트를 닫았다. Slack의 Request URL도 시험 전 주소로 복원한 뒤 다시 열어 확인했다.
상시 수신 서비스가 아니므로 현재는 외부 slash 명령을 받을 수 없다. 대시보드·Owner API·GitHub 경로는 시험 중에도404, 서명 없는 Slack POST는403이었다.

[현재 how-to-trash 결과 바로 보기 — 이 PC의 대시보드](http://127.0.0.1:3000/?project=c50bedb0-29e8-4582-a3ff-f04168aff93a&task=2db930ba-577c-4394-ab13-b9c8556b8c44#task-inspector)

프로젝트·업무 선택 시 넓은 화면의 우측에 결과 패널을 표시한다. 작은 화면에서는 상단에 표시한다.
요약·테스트/빌드/QA·변경 파일·확인된 커밋/브랜치를 먼저 보고, 직원별 보고와 요청·이력은 펼쳐서 읽는다.
프로젝트 목록은 이름에 ‘검증/시험’이 있는 항목을 별도로 묶고 마지막 선택을 기억한다. 이름 기반 표시이며 권한·실행 범위를 바꾸지 않는다.
업무가 하나면 결과를 바로 표시하며, 바로가기 URL은 Owner 로그인과 프로젝트·업무 권한 검사를 그대로 요구한다.

원격 전달 기록은 `node --import tsx scripts/record-repository-delivery.ts <runId>`로 확인한다.
지정 저장소·허용 브랜치·원격 head·변경 허용 경로·전체 후보 파일 일치와 QA PASS를 검사한 뒤 DB checkpoint·감사 이력에 기록한다.
현재 how-to-trash의 `7b07edc`와 6파일을 확인했으며 수락/merge/배포 상태는 바꾸지 않았다. 이 CLI는 임의 저장소 지원이 아니다.
Slack 후속 안내에는 해당 프로젝트/업무의 로컬 대시보드 바로가기를 넣었다. 이번 검증은 새 Slack 시험 메시지를 전송하지 않았다.

| 찾는 내용 | 바로가기 |
|---|---|
| 설치·시작 | [로컬 실행](#로컬-실행) |
| 구독 실행·한도 | [Codex 구독 직원 실행](#codex-구독-직원-실행) |
| 현재 실제 업무 | [how-to-trash 시범](#실제-저장소-첫-적용-how-to-trash--2026-10-20) |
| 남은 작업·완료 조건 | [구현 체크리스트](docs/IMPLEMENTATION_CHECKLIST.md) · [로드맵](docs/13-development-roadmap.md) |
| 설계·개발 규칙 | [전체 목차](docs/INDEX.md) · [프로젝트 지침](docs/PROJECT_INSTRUCTIONS.md) · [AGENTS.md](AGENTS.md) |

## 구현 단계

- B단계: Phase 0 기반 → Phase 1 실제 AI 실행 → Phase 2 픽셀 사무실.
- C단계: Phase 3 GitHub·Slack·채용 → Phase 4 평가·다중 프로젝트·운영.
- Phase 5: 로컬 음성 후보·확인 입력 구현. TTS·회의/추가 연동·자동 모델 최적화는 보류하며 초기 출시 필수 범위가 아니다.

## 실제 저장소 첫 적용: how-to-trash — 2026-10-20

지도 없이 25개 지원 지역을 목록·검색으로 찾고 상세 페이지로 이동하는 시범이다.
실제 PM·Developer 변경, 같은 후보 테스트·빌드·브라우저 근거를 최종 QA가 확인해 **PASS**했다.
[작업 브랜치](https://github.com/Ina-dang/how-to-trash/tree/codex/region-search)에 push했으며, 앱의 결과 수락은 수행하지 않았다.

| 2026-10-21 최종 검증 | 결과 |
|---|---|
| 허용 범위 | 추가 300초·QA 1회만 실행. 기존 시작 시각·재작업 2회·사용량 보존 |
| 실제 테스트 | node:test 6개·고정 외부 수용 검사 통과 |
| 실제 빌드·정적 검사 | eslint·Next build·별도 tsc 모두 exit 0 |
| 브라우저 | 1440/375px × 지도 키 없음/SDK 요청 차단, 총 2 × 2 = 4조건 통과 |
| 접근성 동작 | 검색·초기화·입력 포커스·키보드 상세 이동, 조작 높이 50px·포커스 외곽선 2px 확인 |
| 최종 상태 | 같은 manifest SHA의 QA PASS, `WAITING_APPROVAL`, 총 모델 호출 6회·최종 QA 허용 잔여 0회 |
| 원격 변경 | `7b07edc348864f1135c5716d43ef04719b188d41`, 허용된 6파일만 변경 |

추가 창 승인 08:18:11.543 → 관측 완료 08:20:06.790 KST이며 차이는 115.247초로 300초 이내다.
완료 응답 사용량 합계는 입력 233,200 + 출력 6,875 = 240,075 토큰이다. 구독 청구액으로 환산하지 않는다.
기존 404 UI stylesheet `Event`는 baseline에서도 재현한 별도 한계로 보존한다.

<details>
<summary>대상·실행 방법·후보 SHA·실패 이력·검증 근거 보기</summary>

- 대상: `https://github.com/Ina-dang/how-to-trash.git`, 기준 커밋 `e98a537cada650e64a29b5e25c5cf6e94f5ced0f`, 프로필 `how-to-trash-v1`. 범용 저장소/임의 명령 실행 지원을 의미하지 않는다.
- 허용 변경: 홈 페이지, 지역 목록 컴포넌트/별도 스타일, 순수 검색 helper, 회귀 테스트, package.json의 고정 test 스크립트 추가만이다. 데이터·지도·설정·의존성·lockfile·기존 자산은 변경하지 않는다. binary 자산도 비교하며 전체 후보 SHA는 admission과 텍스트 파일을 함께 묶는다.
- 준비: `.local/repositories/how-to-trash`에 선택 저장소를 복제한 뒤 `pnpm setup:repository --baseline`. 고정 Node 이미지에서 lockfile로 `npm ci --ignore-scripts --no-audit --no-fund`를 수행하고 이미지 ID·기준 commit·manifest digest를 고정한다. 기존 admission은 재사용하며 조용히 덮어쓰지 않는다. 저장소 키/호스트 설정/daemon socket을 후보 컨테이너에 전달하지 않는다.
- 실행/검증: `pnpm verify:repository-live`는 실제 대시보드 버튼→PG 큐→Codex 구독 PM/Developer/QA를 관측한다. `--observe`는 기존 run을 관측하고 `--reverify`는 같은 후보를 다시 검사한다. 이미 run이 있으면 새 모델 작업을 자동 생성하지 않는다. 토큰·turn·재작업·시작 시각은 보존한다. 별도 Owner 승인 전에는 `--approve-5min`을 사용하지 않는다.
- 검사: candidate는 network=none/read-only root/non-root/cap-drop/no-new-privileges/cgroup/time 제한에서 테스트·Next build·eslint·tsc를 수행한다. 브라우저도 network=none 컨테이너의 같은 후보를 사용한다. 호스트 loopback3002의 GET/HEAD 전용 중계에는 인증 헤더/비밀을 넘기지 않으며, 브라우저의 중계 외 origin·service worker를 차단한다.
- 실제 후보 `ae2afa1c1f6eebec7471c0cffc7ee7319c94e7c147873f940beaa0f99e2e2e28`, run `76c33b20-14a6-48b4-a491-7038e7a2918c`, project `c50bedb0-29e8-4582-a3ff-f04168aff93a`, task `2db930ba-577c-4394-ab13-b9c8556b8c44`. PM/Developer 완료와 실제 테스트/build0 뒤 QA가 근거 부족으로 FAIL했다. 이 결과와 두 번의 빈 Developer 응답은 삭제하지 않았고 최종 PASS로 바꾸지 않았다.
- 브라우저: 1440px/375px × 지도 키 없음/실제 SDK 요청 차단의 네 경우에서 25개 목록·부분/공백 검색·없음·초기화/입력 포커스·키보드 상세 이동·HTTP404·가로 넘침을 확인했다. `Event`는 기존 404 UI stylesheet에서도 재현돼 별도 baseline 근거로 보존한다. 기능 경로 오류0과 404 UI 한계를 구분하며 이를 해결한 것으로 표시하지 않는다. 후속 실제 치수/포커스 측정은 최종 재검증 근거에 포함한다.
- 이전 실패: 웹 재시작 디렉터리 오류·로그인 시 준비 대기/선택 누락·기존 native STOP_UNVERIFIABLE·브라우저의 외부 폰트 분류/404 범위 오류를 분리했다. PID53548/자식/전용 worker·DB 미확정 실행0을 확인하고 native 원본 latch를 보존한 후 수동 조정했다. 무한 재시도/비밀 출력/불명 모델 작업의 자동 replay는 없다.
- 근거: Git 제외 `.local/how-to-trash-live-attempts.json`, `how-to-trash-browser.json`, `how-to-trash-baseline404.json`, `browser-evidence/how-to-trash-*.png`와 DB checkpoint. 원문·PM spec/AC·Developer 파일·QA 의견·사용량·후보 SHA가 같은 run에 연결된다. 최종 QA PASS·동일 SHA 검사 전에는 `pnpm export:repository`가 거부된다. export는 Owner 결과 수락/merge/배포를 수행하지 않는다.

</details>

## 수락된 Phase 5 검증 이력

과거 수치와 당시의 대기 상태를 보존한 기록이다. 현재 상태는 문서 맨 위를 기준으로 읽는다.

<details>
<summary>실제 마이크 — 녹음·전사·취소·삭제 확인 (2026-10-20)</summary>

### Phase 5 실제 마이크 후속 — 2026-10-20 (수락된 이전 검증)

✅ 사용자가 직접 마이크 녹음·전사·취소 후 원문 비워짐을 확인했고 서버 DB와 대조했다. 녹음 후보 `c379521b-965a-4071-8ee6-eee5970eaef6`는 source=MICROPHONE, duration=9480ms이며 9480÷1000=9.48초다. READY/version2 → CANCELLED/version3, transcript=null, task_id=null을 확인했다. 실제로 선택된 시험 프로젝트는 `da360b7c-8d0e-4bbb-9f2b-4f767dddab55`이며, 녹음 생성 시각 이후 새 task/run은0이다. 기존 프로젝트 업무를 삭제하지 않았다. 원시 임시 음성은0개다. 별도로 준비했으나 사용하지 않은 빈 시험 프로젝트 `e0163ab5-a7dc-4997-9611-1a6f46dd2ff2`만 범위 확인 후 ARCHIVED로 정리했다.

원인/수정: 초기 웹 응답의 `Permissions-Policy: camera=(), microphone=(), geolocation=()`가 마이크 요청을 문서 정책에서 거부해 NotAllowedError가 발생했다. Chrome 사이트 설정부터 안내한 것은 서버 헤더를 먼저 확인하지 못한 진단 오류였다. `camera=(), microphone=(self), geolocation=()`로 수정하고 실제 응답·문서 판정에서 자기 origin 마이크만 허용하는 것을 확인했다. 브라우저/OS 사용자 허용과 앱의 명시적 동의는 계속 필요하다. 카메라·위치·다른 origin 마이크는 허용하지 않는다. 새 UI는 권한/장치 없음/장치 읽기·API/녹음기 실패를 고정 진단으로 구분하고 원시 장치 오류 메시지를 노출하지 않는다.

⚠️ 품질: 정해둔 시험 문장의 “제목을 수정해 주세요”가 “제목을 수상해 주세요”로 전사됐다. 연결/정리 성공을 정확도 성공으로 간주하지 않는다. 1회의 사용자 직접 녹음과 서버 metadata 대조 범위이며 장치 정체성 attestation·다른 장치/소음/이름·숫자·장문 정확도는 검증하지 않았다. 실제 마이크 원음을 재생하지 않았고 native 처리 중의 임시 WAV와 후보 텍스트는 취소/정리 후 남기지 않았다. 공개 시험 문장의 차이만 기록한다. 새 유료 API·모델 전환·merge·운영 배포는 없다.

검증 범위: 진단 변경의 lint/typecheck/build와 자동244개를 통과했고, 헤더 수정 뒤 lint/typecheck/build도 다시 통과했다. 대역만으로 마이크 성공을 판단한 기존 검증의 빈틈을 보완해 실제 응답/문서 policy 검사1개와 API 미지원·장치 없음/읽기 실패·녹음기 실패의 비밀 비노출/track 해제4개를 추가했다. 최종 Chromium45=기존40+추가5가 전체 완주했다. 중간 전체 검사 묶음의300초 도구 제한과 개별110/165초 제한에 걸린 시도는 PASS가 아니다. 종료하지 않은 검증 작업이 없음을 확인하고 기존240초 상한의 셸 실행기로 재실행해45개(1.3분) 통과를 확인했다. 앱 코드 오류와 검사 실행 제한을 구분한다. 앞선244/40과 물리 마이크 대기 표시는 당시 수락 이력이다.

공식 확인: [W3C Permissions Policy](https://www.w3.org/TR/permissions-policy/) Working Draft 2026-09-22·열람2026-10-20. 구현 근거는 [웹 헤더](apps/web/next.config.ts)·[마이크 UI](apps/web/app/ui/voice-input.tsx)·[실제 문서 policy 회귀](tests/e2e/voice.spec.ts)다.

마이크 후속의 최종 source digest는 `899fc0d8c0c23c44d5be9209637bec1c9d19c242f9cdb8028821b9e88b99171d`다. 완주한 브라우저45개 근거는 `ee9450a9-d04d-411b-a808-1bcb56e28413` / SHA `955f3d7dec89879b95ea22f5b0a2121998af4f40e1a8adfeccd184f5fe274fc3`이며 Git 제외 `.local/operations-evidence`에 보관한다. 전체 재검사 도중 기존 Docker Sandbox의 same-SHA test/build 시험1건이 실패했고, 같은 코드/제한의 분리 재실행에서는8개 모두 통과했다. 첫 실패의 원인은 확정하지 않았으며, 이 이력을 이후 전체 재실행 성공으로 삭제하거나 PASS로 바꾸지 않는다.

최종 자동 검사는 단일 호출의 실행 제한을 피하기 위해 같은 소스·기대 결과·Sandbox 제한을 유지한 채 순차3묶음으로 실행했다. A=3파일/42개(99.24초), B=4파일/78개(36.70초), C=12파일/124개(32.33초), 합계3+4+12=19파일·42+78+124=244개, 각 exitCode=0이다. 발견한 전체 시험 파일 집합과 세 묶음의 합집합이 같고 중복/누락은0이다. lint/typecheck·TS16/Python26 계약·build도 최종 소스에서 통과했다. 이 결과는 단일 `pnpm verify` 완주 성공을 뜻하지 않는다. 최종 PASS Artifact `43853b89-acb8-427c-b388-070d30ce762d` / SHA `a13dc3d357907fc956a4fc8d575fdb58650fad6860bffb535acaf70152f02758`, 앞선 관측 실패 Artifact `9d1610ad-8db0-45a4-886c-47c1591049eb` / SHA `fb18aaa06d9f4b9c012dd794d5e4bced4011081d41deed97c9906008a903327c`를 함께 보존했다. 원래 운영 C 미승인/미검증 범위를 이 검증으로 해제하지 않는다.

</details>

<details>
<summary>강제 종료 복구 — Windows 소유권·잔여 음성 정리 (2026-10-20)</summary>

### Phase 5 강제 종료 복구 수락 이력 — 2026-10-20

✅ PROCESSING과 실행 소유권을 먼저 DB에 commit하고, 재시작/30초 조정에서 host UUID·PID/생성 FILETIME·SID·executable·Windows handle/정확한 argv를 확인한다. 소유 native 종료·대기 후 UUID의 단일 regular audio.wav만 삭제한다. 살아 있는 소유자·구형 영수증·외부 host·junction/hardlink·추가 파일은 보존/차단한다. 자동 최대2회 뒤 Owner의 현재 version·동의로 복구만 재확인하며 전사/업무/run을 replay하지 않는다. UI 복구 이력·차단 사유, 마이크 경과 시간/신호, 숨김/취소 track 해제를 추가했다. 상세는 [ADR-017](docs/17-decision-log.md)·[운영 경계](docs/15-deployment-and-operations.md)다.

| 후속 검증 | 확정 결과 |
|---|---|
| 전체 검사 | `pnpm verify:release` PASS. 자동244=기존223+복구21, Chromium40=기존37+복구3. lint/typecheck/build·TS16/Python26 계약 PASS |
| DB/Windows | 복구 조정11개 + 실제 Windows 실행 경계8개. 살아 있는 소유자·PID 재사용·잘못된 argv/host/link 보호, 정확한 잔여 native1개 종료·파일 삭제 |
| API 실제 강제 종료 | 격리 DB/폴더의 실제 whisper와 장시간 C# 대역2건. 종료 전 native 생존, 복구 시 이미 종료(stopped=0), WAV1개 삭제·잔여0·task/run0. 대역은 음성 정확도 시험이 아님 |
| 브라우저 추가3개 | 복구 동의/version, 실패 시 차단 유지·텍스트 사용, 숨김 녹음 폐기/track 해제·무업로드 |
| 실제 로컬 STT 회귀 | 공개 SAPI 문장 “로그인 화면의 제목을 수정해 주세요.” → “로그인 화면에 제목을 수정해 주세요.”. 실제 native 처리/취소·임시 음성0·수정 확인 후 TODO·자동 run0. live SHA `b5127455953447258643b19ec51c01c82d2501c15b48f4a973598471467a8c9d` |
| 실제 브라우저 회귀 | 실제 decode/upload·수정 확인·390px/desktop·overflow0·pageErrors0·source=VOICE/TODO·자동 run0. 시험 프로젝트 `3c7a4c4d-6f08-48f2-98ce-6f5a269007d8`는 증거 보존 후 ARCHIVED. browser SHA `fe85bf6e62fb8202b6bc28bbf39aefbd569d2e53d1bdfa18fe8edaff237344df` |
| 운영·기존 연결 | backup `b89baf05-0381-49a0-9148-4cc250cb38ae` / restore `89d70ef4-c604-4119-b3fd-883aa46b60ef`: 테이블45/workspace14 digest 일치·격리 대상 정리·원본 domain 변경0. GitHub/Slack 읽기 재확인, 새 메시지/터널/모델 API0 |
| 최종 상태 | LOCAL_FIXTURE READY_FOR_OWNER_REVIEW/blocker0. 운영 C NO_GO/기존7개 blocker 유지. 활성 음성/실행·native whisper·잔여 WAV·시험 DB/폴더 모두0 |
| 물리 마이크 | **미실행·헴의 준비 통보까지 대기**. UI meter/FILE·MICROPHONE 선언은 물리 장치/정확도 인증이 아님 |

최종 source digest: `74b9f1e099da86d833193f70f14f010221cfe017e25239d61ebf785dc992fecb`. 자동 근거 `ece853e4-9719-460c-a432-025b35799aec` / SHA `dfac64ba86092f46bad7f71d3bf417dc6f7466d7ff2148b82910b49b30ca37a8`, 브라우저 근거 `a1a032a1-0002-4bac-9787-7f0ab4235b5e` / SHA `e12fa325547ccc71b389203138cf630862b8d7729332b0d764e32cf00ec7aebb`는 Git 제외 `.local/operations-evidence`에 보관한다.

같은 digest의 RECOVERY `7b3b60d7-f781-4a13-9e0a-0f032dcd6831` / EXTERNAL_PROBE `c2cd26a6-3dfb-4945-9320-18b76f733b71`도 PASS다. PERFORMANCE `45816213-4f0e-4e8a-b21a-239eb8837b72`의 loopback100읽기/동시4 p95=정렬한100개 중 ceil(100×0.95)=95번째=22ms는 로컬 관측이며 운영 SLA가 아니다. 실제 음성/브라우저 proof·화면은 `.local/voice-evidence/live.json`, `browser.json`, `voice-live-desktop.png`, `voice-live-mobile.png`다. 물리 마이크는 준비 통보 뒤 직접 동의·녹음하고 전사 후보를 취소·삭제하는 시험으로 이어간다.

실패 이력: 첫 Windows 대역 실행은 PowerShell JSON 배열이 한 항목으로 감싸져 안전 차단됐고 parser 수정 후 통과했다. API 시험의 native 생존 여부는 별도 Windows 조회로 대조해 종료 전/후 결과를 구분했다. 첫 숨김 브라우저 대역은 document.hidden 대신 다른 속성을 바꿔 실패했고 수정 후 전체 통과했다. 첫 전체 테스트의110초 도구 상한은 완료로 기록하지 않았으며 이후 전체 검증을 완료했다. 전체 브라우저 직후 live 로그인429는 전사 전에 차단됐고60초 제한을 유지해 창 만료 뒤 한 차례 재시도로 성공했다. 기존 모델/로컬 CPU를 재사용하며 추가 유료 API·새 유료 자원·공개 터널·실제 merge·운영 배포는 없다.

</details>

<details>
<summary>로컬 음성 1차 — STT·후보 수정·업무 등록 (2026-10-20)</summary>

### Phase 5 로컬 음성 1차 수락 이력 — 2026-10-20

✅ P5-01/02-L: `whisper.cpp b5454` Windows x64 CPU + 다국어 tiny 모델을 공식 hash 검증 후 Git 제외 로컬 폴더에 설치했다. 마이크/음성 파일의 로컬 전사 후보를 수정·확인한 뒤 TEXT/SLACK과 같은 서버 task command로 TODO를 생성한다. 원시 음성의 외부 STT 전송·유료 API fallback·자동 retry/모델 전환은 없다. 0.25~30초 canonical WAV(최대960044byte), 동시1, 조직당 UTC일20회, native60초 제한·Owner/CSRF/Origin/동의·중복/version·취소/만료·restore 격리를 적용했다. 상세 설계·공식 배포/라이선스 링크는 [20장](docs/20-voice-command-design.md)·ADR-016이다.

| 실제 검증 | 결과/근거 |
|---|---|
| 최종 전체 검증 | `pnpm verify:release`: lint/typecheck·TS16/Python26 계약·자동223=기존206+음성17·build PASS, Chromium37=기존30+음성7 PASS. 취소 중 슬롯 유지·정리 실패 차단·실제 native spawn 실패/close 후 삭제 회귀 포함 |
| 로컬 STT·API/DB | 공개 한국어 문장을 설치된 오프라인 Microsoft Heami로 합성→실제 native 모델→후보→한국어 수정/확인. task `bee32001-f751-4364-a53c-c54268398ef5`, 수정 감사·확인 원문·source VOICE·TODO·중복 task 없음·run0 |
| 실제 오인식 | 입력 “로그인 화면의 제목을 수정해 주세요.” → API 전사 “로그인 화면에 제목을 수정해 주세요.”, browser 전사 “로그인 화면에 제 목을 수정해 주세요.”. exact match는 false이며 정확도로 일반화하지 않음 |
| native 취소·삭제 | 후보 `0b06dba9-91d0-4550-9893-7698970794ab`: 실제30초 합성 WAV 처리 중 취소→native close/VOICE_NATIVE_CANCELLED·CANCELLED·후보 plaintext null·임시 음성 폴더0. 요청 중에는 PROCESSING 슬롯 유지, cleanup 불명은 후속 전사 차단 |
| 실제 Chromium 연동 | 실제 decode/upload→전사 후보 표시→수정·확인. task `31ad0c6f-28ce-465a-99e6-eef082990ea3`, source VOICE/TODO/run0. desktop1440·mobile390, 가로 overflow0·pageErrors0. 최종 시험 project `91940f99-6121-4c7d-9575-12125efca823`와 앞선 두 시험 project는 archive하여 활성 목록에서 제외 |
| 새 schema 백업·복원 | backup `343eb89a-8fbb-4735-8218-b054e7c84a87`, AES-256-GCM513234byte, SHA-256 `bf0ebef04813310e3ebb392439439386450952e2047b97103b80edf537a365fe`. restore `713a9324-80ac-4989-b65a-7fbd98f31bc7`: **45table·14workspace 내용/해시 일치**, 실제 시험 PG 재시작·state 보존·quarantine·외부 dispatch0, 측정6953ms. 원본 DB 교체/중단 없음 |
| 운영 회귀·외부 연결 | 실제 비과금 fixture native worker 강제 종료→lease 만료→BLOCKED/RECOVERY_REQUIRED, replay0. loopback100읽기/동시4 p95=정렬95번째=9ms(로컬 조건). GitHub 시험 저장소/Slack 기존 identity 읽기 전용 재확인, 새 Slack 메시지/공개 tunnel/모델 API 호출0 |
| 최종 판정·정리 | 같은 source digest의5검증 PASS, runtime digest 재확인 후 LOCAL_FIXTURE=READY_FOR_OWNER_REVIEW/blocker0, 운영 C=NO_GO. API 재시작 때 SSE/me의 일시적 reset/refused 로그를 보존했고 실제 Owner browser/SSE200/pageErrors0 재접속을 확인. 임시 복구 container/network/volume·test DB·원시 음성 폴더 잔여0, active operations/voice/run0 |

최종 source digest: `a56212c0fe373aa2961dea876b84ad2d21dfe234bd536f50abadb45607f5c5da`. 불변 검증 Artifact는 `.local/operations-evidence/<id>.json`에 보관한다: 자동 `726b1907-dbc0-4ff9-b0da-08621ea22dd3`, browser `9db109b8-e895-49d8-b600-3a6af4ae9c94`, 복구 `07a2eef6-0df3-4324-9639-50eca92e07d8`, 부하 `086bfc8b-d4b0-4ff6-a9df-810795a9235c`, 외부 `581d0d41-a8d5-45a8-96d0-d50d7dc023ce`.

실제 STT proof `.local/voice-evidence/live.json`/SHA `7f74a52e9259e9565be79ad7ae966c42a722dbe173994ff96889ec2be4b1b822`, browser proof `browser.json`/SHA `b72ba407eb6cc0bb939fd50a6561f7db4dbdfaa875fd98b31307eb6e566a6819`, 실제 화면 `voice-live-desktop.png`/`voice-live-mobile.png`도 같은 폴더다. 실행 파일/모델/라이선스/음성 fixture와 비밀·encrypted backup/key는 Git 제외다. 보관한 음성 fixture는 공개 합성 문장이고 실제 사용자 녹음이 아니다.

⚠️ 실패/한계: 첫 전체 browser는 기존 승인 checkbox 선택자와 실제 로그인 횟수 의존성 때문에 실패했다(`803cfa89-36d6-436d-ada1-816cf9bf3d32` FAIL 이력 유지). 선택자를 범위화하고 음성 UI 읽기를 대역화한 두 차례 QA 수정 뒤 전체37개 PASS다. 직후 live 로그인429는 전사 시작 전에 차단됐으며 제한을 완화하지 않고60초 대기 후 한 차례 이어서 성공했다. 이후 경계 리뷰에서 취소 중 슬롯 유지·정리 불명 차단·error/close 구분을 보완했고 finally 내 throw lint 실패(`bc37934e-c152-4c69-a359-ef3d8d73e696`)도 보존했다. 최종223/37과 실제 연동을 같은 최종 digest로 다시 통과했다. 물리 마이크/다른 OS·브라우저/noise/장문, 강제 서버 종료 뒤 native/잔여 WAV 자동 조정, 운영 개인정보/metadata 정책은 미검증이다. 정상 처리/취소/정상 종료와 강제 종료를 같은 보장으로 취급하지 않는다. TTS/회의·자동 모델 최적화는 별도 요구/품질 근거 전 보류한다. 새 유료 자원·추가 모델 API 호출·실제 merge·운영 배포는 없으며 CPU/전력/통신 총 비용과 계정 청구액은 측정하지 않았다.

</details>

## 설계의 기준

PostgreSQL이 업무 상태의 기준이다. AI의 완료 선언, 큐의 처리 완료, 캐릭터 애니메이션만으로 업무를 완료 처리하지 않는다. 테스트·빌드·QA·승인 근거가 연결되어야 한다. 서버는 상태 변경과 이벤트·전달 의도를 함께 기록하며, 중복 전달은 실행 식별자와 부작용 기록으로 제어한다.

내부 협업은 영어, 사용자 명령·보고·상태·승인은 한국어다. 한국어 원문을 보존하고 영어 명세에 수용 기준과 고유명사를 추적한다. 영어 비용 절감은 가설이며 실측한다.

## 로컬 실행

검증한 로컬 환경이다. 최신 버전 권장을 의미하지 않는다.

| 구성 | 검증 버전·방식 |
|---|---|
| Node.js / pnpm | 22.20.0 / 10.15.1 |
| DB / Sandbox | Docker Compose, PostgreSQL 18.6·Node 이미지 digest 고정 |
| Python 계약 검사 | 3.12.4 |
| 직원 인증·실행 | Codex CLI 0.162.1, ChatGPT 로그인 |
| 의존성 | lockfile 고정 |

```text
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:migrate
pnpm db:test:prepare
pnpm dev
```

| 접속·인증 | 위치 |
|---|---|
| 대시보드 | <http://127.0.0.1:3000> |
| API 상태 | <http://127.0.0.1:3001/health> |
| Owner 로그인 키 | `.local/owner-key`에서 로컬로 확인 |

`pnpm setup:local`은 임의 고엔트로피 Owner 키와 DB 자격 증명을 `.local/`에 생성하며 기존 설정을 덮어쓰지 않는다.
이 디렉터리와 환경 파일은 Git에서 제외한다. 키를 메시지·로그·커밋에 붙여 넣지 않는다.
Windows에서는 해당 폴더 접근 권한도 관리한다.

실행 중단은 개발 터미널에서 종료하고, DB는 `pnpm db:down`으로 중지한다. 이 명령은 볼륨을 삭제하지 않는다. 포트 3000/3001/55432는 loopback에만 바인딩한다. 공개 배포용 인증·격리 구성이 아니다.

## Codex 구독 직원 실행

`codex login`으로 기존 ChatGPT 계정에 로그인한다. API 키를 입력하지 않는다. 무료 공식 컨테이너 이미지를 최초 한 번 준비한다. 프로그램은 이미지를 자동 다운로드하거나 유료 자원을 생성하지 않는다.

| 제한 | 적용 범위 |
|---|---|
| 인증·비용 | ChatGPT 구독 인증만 사용. 유료 API·모델 전환·크레딧 구매 fallback 없음 |
| 한도 확인 | 사용률 90% 이상 또는 한도 조회 불가 시 차단. 실행 중 5초마다 재확인 |
| 실행 시간 | 호출별 180초 · 실행별 15분 |
| 호출·재작업 | 최대 7회 호출 · 2회 재작업 · 최대 3개 후보 |
| 토큰 차단선 | 완료된 응답 합계 500,000 토큰. 처리 중 청구 상한 보장은 아님 |
| 결과 확정 | 동일 SHA 테스트·빌드·QA 근거 뒤 Owner가 별도 수락 |

아래 `verify:agents`는 **실제 구독 한도를 사용**한다. 기본 `pnpm test`는 모델을 호출하지 않는다.

```text
docker pull node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af
pnpm verify:agents
```

<details>
<summary>실행 흐름·공유 한도·사용량 해석·종료 실패 처리 보기</summary>

위 마지막 명령은 서버가 실행 중일 때 실제 구독 한도를 사용해 검증 프로젝트·업무를 만들고 PM→Developer→격리 test/build→QA를 수행한다. 기본 `pnpm test`는 모델을 호출하지 않는다. 대시보드의 업무 상세에서도 `검증 프로젝트 실행`으로 같은 제한 fixture를 시작할 수 있다. PM은 영어 명세/AC를 만들고, Developer의 구조화 파일 결과를 capability broker가 실제 파일에 적용한다. QA는 같은 파일 SHA256과 실제 테스트/빌드 근거를 검토한다. AI에 호스트 셸·임의 저장소 경로를 주지 않는다. 결과 수락은 Owner가 별도로 수행한다.

ChatGPT 인증을 강제하고 API 키·공급자 URL·DB 비밀정보 환경변수를 자식 프로세스에 전달하지 않는다. 유료/무제한 크레딧 계정·조회 불가·불명확한 quota·사용률 90% 이상은 차단한다. 실제 한도 소진을 기다리지 않고 보수적으로 미리 멈춘다. 실행 중 5초마다 다시 확인하고 한도 오류에는 재시도/다른 모델/API 전환/크레딧 구매를 하지 않는다. 세 역할과 다른 Codex 사용은 구독 한도를 공유한다.

호출별 180초, 실행별 15분, 최대 7회 모델 호출·2회 재작업(최대 3 candidate)을 제한한다. 500,000 토큰은 완료된 응답 사용량의 다음 호출/승인 차단선이며 공급자 처리 중 토큰 증가를 선제적으로 보장하는 청구 상한은 아니다. 중단되어 공급자가 사용량을 반환하지 않은 호출은 합계에 포함할 수 없으므로 표시된 토큰은 **완료된 응답 합계**다. API 토큰 단가를 구독 청구액으로 환산하지 않는다. 계정의 자동 충전/외부 결제 설정을 변경하지 않으며, 외부에서 변경된 계정 상태의 반영 지연까지 막는 결제 보장은 하지 않는다.

종료 확인 실패 시 전체 worker를 차단하며 DB와 `.local/codex-worker/unsafe-stop.json`에 재시작 후에도 유지되는 interlock을 남긴다. 이 경우 자동 재개/초기화하지 않는다. 기록된 프로세스 트리와 컨테이너의 실제 종료를 운영자가 확인한 후 별도 복구해야 한다. 만료된 lease의 실행도 `RECOVERY_REQUIRED`로 중단해 알 수 없는 모델 호출을 자동 재실행하지 않는다.

</details>

## 픽셀 사무실

2026-10-21 레퍼런스 후속: 사용자 제공 이미지의 나무 바닥·짙은 벽·청록색 작업 가구·자주색 소파·캐릭터 비율을 참고해 직접 제작 그래픽을 수정했다.
이미지·타사 스프라이트·유료 자산은 복제/구매하지 않았다. 캐릭터는 1.25배, HTML 글자와 기존 충돌/상태 계약은 유지한다.
실제 Chrome 탭이 이전 `visual-pilot-v1` 화면을 유지한 것을 확인하고 새 빌드로 갱신했다.
현재 `original-v4`의 관련 테스트 10개·사무실 Chromium 8개, lint/typecheck/build가 통과했다.
서버의 PM WAITING / Developer IDLE / QA IDLE을 대조했으며 업무 변경·외부 요청·페이지 오류는 각각 0건이다.
최종 화면은 Git 제외 `.local/browser-evidence/office-reference-live-{desktop,mobile}.png`다.

아래는 앞선 단순화 검증 이력이다.

2026-10-21: `pixel-agents` 차용 팔레트 함수를 제거하고 역할별 고정 색상을 사용한다.
세로 벽의 반복 무늬·장식 레이어·확대되는 Canvas 글자를 덜어냈다.
방·직원 이름과 현재 활동은 HTML로 표시하며, 그림은 최대 896px로 제한한다.
직접 제작한 그래픽과 기존 Phaser·서버 상태 연동을 유지한다.
실제 프로젝트의 PM IDLE / Developer BLOCKED / QA IDLE을 서버와 대조했다.
데스크톱·390px, 그래픽 토글·키보드·재접속·권한 철회를 검사했으며 페이지 오류·업무 변경·외부 요청은 각각 0건이다.
검증 화면은 Git 제외 `test-results/office-original-live-{desktop,mobile}.png`에 보관한다.
최종 재시작 직후 검사 1회는 웹 미기동으로 `ECONNREFUSED`가 발생해 1개 실패·7개 미실행이었다.
서버 HTTP 200 확인 뒤 같은 최종 소스로 8개와 실제 서버 대조를 다시 통과했다.

PM·Developer·QA의 실제 서버 실행 상태를 Phaser 사무실과 한국어 말풍선으로 보여준다.
직원 선택으로 업무·실행·검증 근거를 확인하며, 그래픽을 꺼도 DOM 목록을 사용할 수 있다.

<details>
<summary>렌더링·snapshot/SSE 동기화·접근성·실제 검증 명령 보기</summary>

대시보드의 사무실은 대표실·개발실·회의실·QA실·공용 공간과 PM/Developer/QA 세 직원을 보여준다. Phaser3.90.0은 client-only로 로드하고, 896×512 Tiled JSON 및 직접 작성한 CC0 픽셀 타일/스프라이트를 사용한다. 외부 이미지·폰트·원격 코드를 로드하지 않는다. 직원 클릭이나 키보드 선택으로 실제 업무/실행/검증 SHA/완료된 응답 토큰을 확인한다. 승인 action은 별도 업무 상세에 유지한다.

서버는 같은 repeatable-read snapshot에서 업무·직원·승인·이벤트 cursor를 읽는다. 직원 상태는 실제 run 단계·제어 상태·역할별 결과에서 계산하며, 말풍선은 고정 한국어 문구다. SSE는 서버 snapshot을 새로 조회하게 할 뿐 직접 상태를 결정하지 않는다. 중복/역순·다른 프로젝트·동일 실행 version 역행을 거르고, 재접속/탭 복귀/명시적 reset에서 복원한다. 연결 단절 시 마지막 확인 시각을 표시하고 움직임을 멈춘다. 그래픽 오류·그래픽 끄기 상태에도 DOM 직원 목록과 상세가 동작한다. 장면 해제 시 canvas/listener/timer를 정리한다.

`pnpm test:e2e`는 모델을 호출하지 않는 브라우저 회귀 검증이다. `pnpm verify:office-live`는 기존 구독 한도를 사용하는 명시적 실험으로 실제 PM→Developer→QA 실행과 브라우저 사무실의 SSE 상태 전환·새로고침·모바일 화면을 확인한다. 포함 한도/차단 정책은 Phase 1과 같으며 결과를 자동 수락하지 않는다.

</details>

## Phase 3 채용·배정·협업

`협업·직원`에서 칸반·채용·역할 배정·고용 이력·외부 작업 기록을 확인한다.
GitHub와 Slack은 설정된 저장소·채널 범위에서 동작한다.

<details>
<summary>직원 프로필·통합 설정·외부 쓰기·승인 경계 보기</summary>

대시보드의 `협업·직원` 영역에서 서버 상태 기반 칸반, PM/Developer/QA 채용·프로필 이력·역할 배정·휴직/퇴사/재채용, 외부 작업 기록을 확인한다. 칸반 카드는 업무 상세를 열며 승인 조건을 건너뛰는 상태 변경을 만들지 않는다. 프로필과 실행 당시 직원 설정은 불변 버전으로 저장한다. 배정 변경·권한 철회는 실행을 fence하고 모델·파일 적용·검증 경계에서 다시 검사한다. 사무실은 교체 전 직원의 근거를 새 직원에게 표시하지 않는다.

현재 직원 provider/model은 기존 구독의 `CHATGPT_SUBSCRIPTION`/`codex-default`만 지원한다. turn/token/time 상한은 전역과 각 프로필 중 가장 낮은 값으로 전체 실행에 보수적으로 적용한다. 새로운 API 모델·결제·한도 구매 경로는 없다. `pnpm verify:staffing-live`는 실제 새 Developer를 채용·배정하여 기존 Codex 구독과 브라우저로 검증하는 명시적 opt-in 명령이며 결과를 자동 수락하지 않는다.

GitHub App의 저장소 범위와 Slack의 workspace/channel/Owner 매핑은 서버의 무시된 로컬 설정으로 지정한다. [GitHub 설정](docs/10-github-integration.md)·[Slack 설정](docs/11-slack-integration.md)을 따른다. 비밀값은 UI·채팅·Git에 넣지 않는다. `pnpm verify:integrations-live`는 설정된 실제 자격 증명을 읽기 전용으로 확인한다. 자격 증명이 없으면 실패로 종료한다. `gh` 로그인이나 Slack에 설치된 공식 GitHub/Copilot 앱을 전용 App 인증으로 재사용하지 않는다.

원격 작업은 실제 test/build0·동일 후보 QA PASS 뒤에만 요청하며 DB 작업 기록과 현재 connection/run/project version을 검사한다. 후보 manifest SHA256과 원격 Git commit SHA는 구분한다. 불명확한 원격 효과는 UNKNOWN으로 남겨 자동 재전송을 막고, 기존 외부 operation의 429는 제한된 횟수와 Retry-After를 따른다. merge는 별도 범위 승인과 명시적 실행 요청을 요구하며 Slack 명령은 TODO 등록/상태/도움말만 지원한다. Slack interactive 승인과 자동 업무 실행은 제공하지 않는다.

</details>

## 실제 검증 결과 — 2026-10-20 (과거 실행은 항목별 기록)

아래는 Phase 0~5의 시점별 기록이다. **현재 실제 저장소 업무의 최종 QA 통과를 뜻하지 않는다.**
직전 전체 회귀 합계는 맨 위의 257개·Chromium 47개이며, 사무실 후속의 관련 검사 10개·8개와 구분한다.

<details>
<summary>과거 명령별 결과·실행 ID·GitHub/Slack 실제 연동 근거 보기</summary>

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 오류·경고 없음 |
| `pnpm typecheck` | 7개 workspace 및 테스트/스크립트 통과 |
| `pnpm test` | 244개 = 기존223 + 복구21. 실제 PostgreSQL·Windows 실행 경계/API 강제 종료·대역과 실제 opt-in STT/기존 연동을 구분 |
| `pnpm verify:contracts` | TypeScript fixture 16개·Python JSON Schema fixture 26개 통과 |
| `pnpm build` | Next 프로덕션 빌드·API/공유 패키지 타입 빌드 통과 |
| `pnpm test:e2e` | Chromium45개 = 기존40 + 마이크 진단/정책5. 실제 same-origin 문서 정책·권한/장치/API/녹음기 구분·비밀 비노출·track 해제와 기존 전체 회귀 |
| `pnpm verify:agents` | Phase 1 실제 구독 PM/Developer/QA, 코드·추가 테스트 파일 수정, test/build exit0, QA PASS. 저장된 실행 수동 재개 성공, 아래 최종 결과는 사용자 지시로 수락 |
| `pnpm verify:office-live` | 실제 Codex→브라우저 PM 작업/Developer 작업/QA 검토 관측, 동일 SHA test/build0·QA PASS, reload/390px·page error0. 새 결과는 수락 대기 |
| `pnpm verify:staffing-live` | 실제 신규 Developer 채용/배정·Codex 코드 수정·Docker test/build0·동일 SHA QA PASS, 이름/reload/390px/page error0 확인. Owner 수락 대기 |
| `pnpm verify:integrations-live` | 실제 GitHub App JWT/제한 installation token의 시험 저장소·fixture-base head 및 Slack auth.test의 내손비 team/bot identity 조회 성공 |
| `pnpm verify:github-live <projectId> <runId>` | 시험 저장소만 허용하는 opt-in 외부 쓰기. Issue1개·작업 branch/push·draft PR1개·현재 head 로컬 검사 상태 PASS 확인. 모델/merge/Actions 실행 없음 |
| `pnpm audit` (2026-10-19) | 당시 패키지 취약점 보고 0개. 이번 변경은 의존성을 추가하지 않았으며 2026-10-20 재audit/런타임 전체 안전성 검증으로 간주하지 않음 |
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

</details>

## 검증 범위와 확인 경로

✅ 파일 작성 전 작업 폴더가 비어 있고 Git 저장소가 아님을 확인했다. 기존 파일을 덮어쓰지 않았다. 사용자가 전달한 마스터 프롬프트의 추가 첨부에서 18~21장과 지정 파일 목록을 확인했다.

✅ Phase 0은 실제 PostgreSQL·Hono·Next와 브라우저를 연결해 검증했다. 세션 hash 저장/만료/철회, CSRF/Origin, tenant FK/조회, idempotency, version 경합, 원문 보존, 상태 이력, SSE replay/reset/권한 철회가 테스트 대상이다.

⚠️ Sandbox는 소유한 고정 fixture와 위의 `how-to-trash-v1` 시범 프로필만 지원한다.
임의 저장소·후보 실행 중 의존성 설치·외부 네트워크 실행은 지원하지 않는다.
일반 CI webhook의 원격 역순/철회 시험과 실제 merge 성공 검증은 미수행이다.
임시 공개 연결은 닫았으며 상시 ingress는 없다.
Redis/Python LangGraph는 PostgreSQL 큐/Node worker로 대체했다(ADR-011).
한국어/영어 비교 실험은 미실행이다.
사무실은 프로젝트별 세 역할 투영이며 회의 시뮬레이션·대규모 조직은 후속 범위다.

## 사무실 화면 시범 개선 — 2026-10-19

Phaser·서버 상태 계약을 유지하며 팔레트·직접 제작 그래픽·가구·말풍선을 개선했다.

<details>
<summary>라이선스·적용 범위·당시 검증 결과 보기</summary>

기존 Phaser 3·실행 엔진·snapshot/SSE 계약을 유지했다. `pixel-agents`의 [MIT 라이선스](https://github.com/pixel-agents-hq/pixel-agents/blob/b1bafd02896d90d83457266575a1e8e5011ce997/LICENSE)를 확인하고 해당 commit의 `core/src/paletteUtils.ts`에서 균형 팔레트 선택 함수만 출처·저작권 고지와 함께 수정 사용했다. 고정 역할별 의상, 직접 그린 커피 머신·서버 선반, 영역별 러그·좌석 표식, 선택 직원의 전체 활동 말풍선과 다른 활동 직원의 작은 상태 배지를 적용했다. 외부 이미지·유료 자산·이미지 생성 API는 사용하지 않았다. MIT 코드와 직접 제작한 CC0 그래픽의 범위는 `/office-licenses.txt`에 구분했다.

충돌 맵·직원 목표 좌표·서버 상태 판정은 변경하지 않았다. 모바일에서는 선택 직원의 실제 활동을 DOM 텍스트로 읽을 수 있다. 레이아웃 편집기·회의 시뮬레이션·대규모 직원 표시는 이번 시범에 포함하지 않는다.

검증: `pnpm verify` 성공(테스트141개, lint·typecheck·TS16/Python26 계약 fixture·build), `pnpm test:e2e` Chromium17개 성공. `pnpm verify:office-visual 56c54d8a-de76-4400-8308-a63b1bd2adaa`로 실제 서버 PM WAITING·Developer/QA IDLE을 화면과 대조했다. 390px·키보드 선택·그래픽 토글·새로고침을 확인했고 페이지 오류/업무 변경 요청/외부 요청은 각각0건이었다. 모델 호출 없이 기존 승인 대기 기록만 읽었다. 스크린샷은 Git 제외 `test-results/office-pilot-desktop.png`, `test-results/office-pilot-mobile.png`에 저장된다.

</details>

## Phase 3 Slack 명령·merge 승인 실행기 — 2026-10-19

Slack 명령은 도움말·상태·TODO 등록을 지원한다. merge는 별도 Owner 승인·실행 요청을 요구한다.

<details>
<summary>명령 처리·merge 차단·실제 연동 근거와 한계 보기</summary>

✅ `/ai-pixel 도움말`, `상태`, `업무 <원문>`을 raw 서명·5분 timestamp·고정 team/channel/현재 Owner 매핑으로 검증하고 durable inbox에 접수한다. ACK 후 공통 task command가 TODO만 생성한다. 원문/해시를 보존하며 task/receipt 결과를 한 transaction으로 저장한다. 모델 호출·결과 수락·merge는 자동 시작하지 않는다. 처리 결과와 알림의 SENT/FAILED/UNKNOWN은 별도로 표시하고 response_url/토큰은 저장하지 않는다.

✅ merge는 재검증→범위 승인→별도 실행 요청→서버 큐 순서다. 승인 세션·만료·connection/run version·검증 후보, installation/repo/PR/head/base SHA·squash·정책·CI 검사 식별자·보호/ruleset 해시를 다시 확인한다. Draft/미수락/변경된 권한·SHA·CI·정책은 차단한다. timeout/재시작 중단은 UNKNOWN이며 재PUT하지 않는다. 명시적 원격 조회 조정은 동일 PR head와 squash commit 부모(base)를 확인한다. 실제 merge 성공·timeout은 모의 transport에서 검증했고 실제 저장소에는 승인·실행 요청을 보내지 않았다.

| 실제 검증 | 결과 |
|---|---|
| 전체 회귀 | lint·typecheck·TS16/Python26 계약 fixture·테스트158개·build 성공 |
| 브라우저 | Chromium20개 통과; 실제 GitHub 승인 차단/Slack 기록의 데스크톱·390px·키보드 검증, 페이지 오류0건 |
| 실제 Slack | 내손비 비공개 #ai-pixel-test에서 TASK/STATUS/HELP 3건 모두 PROCESSED·SENT |
| 생성 업무 | `e19da44f-1d78-434d-8760-f520b91f25af`, source SLACK·TODO 1건, 원문 SHA256 `533c329f6997ef3e2fc6da89b14f71b0490af664bcb118bb69bf5474dd6d0801`, 해당 업무 run0건 |
| Slack 근거 | [실제 등록 결과](https://app.slack.com/archives/C0CAEGXQ5LL/p1792412579650249), [상태](https://app.slack.com/archives/C0CAEGXQ5LL/p1792412608343039), [도움말](https://app.slack.com/archives/C0CAEGXQ5LL/p1792412624616329) |
| 실제 GitHub | 시험 PR #2 head `4e9d9ac099cfe97a2b9d68e6777a0a85253cec5d`, base `df3711dc90545e7f08dfebfad675dd6e745aa767`, 필수 로컬 Docker CI PASS, 보호/ruleset 조회 성공 |
| 실제 승인 차단 | request `c2d81460-9e76-4f08-a62c-6c69d67a5b34`, scope `2dc646dee068ab6b5953813849cf51ce893067793c5e03e743024e2339a61948`, RESULT_ACCEPTANCE_REQUIRED + DRAFT_PULL_REQUEST, 승인/실행 요청0건, run WAITING_APPROVAL 유지 |

실제 재현: `pnpm verify:slack-command-live <projectId> <existingSlackTaskId>`는 읽기 전용으로 기존 명령/업무/화면을 검사한다. `pnpm verify:approval-live <projectId> <verifiedRunId>`는 로컬 merge 승인 요청을 만들고 원격 읽기·브라우저 재검증만 수행한다. 승인/실행 경로는 스크립트에서 금지했다. Git 제외 `test-results/phase3-slack-live-{desktop,mobile}.png`, `phase3-merge-preview-{desktop,mobile}.png`를 직접 확인했다.

⚠️ 사용자 승인으로 commands scope를 추가하고 최종 Slack 재설치는 사용자가 직접 허용했다. 무료 Cloudflare 터널은 시험 후 종료했고 port3002 listener0을 확인했다. 등록된 Slash Command URL은 종료된 임시 주소이므로 현재 상시 명령 수신은 불가하다. 새 제한 시험 또는 별도 상시 ingress 승인이 필요하다. 검증용 TODO 업무1건은 자동 실행하지 않고 남겼다. 추가 모델 API·유료 자원·운영 배포·실제 merge는 수행하지 않았다.

⚠️ 보호 브랜치 정책 읽기 권한이 없으면 차단한다. Administration read는 자동 확대하지 않으며 별도 승인과 로컬 protectionRead 설정이 필요하다. GitHub REST merge는 head SHA 조건을 지원하지만 최종 조회와 PUT 사이 base 변경 경합을 원자적으로 제거하지 못한다. 세부 계약은 docs10/11·ADR-013을 따른다.

</details>

## 구현 범위 판정

| 범위 | 판정 |
|---|---|
| 기반·제한 fixture 실행·사무실·협업 | 각 시점의 로컬 검증 근거 보존 |
| 평가·다중 프로젝트·로컬 운영/복원 | 로컬 기술 gate 통과, 당시 Owner 검토 대기 기록 보존 |
| 현재 how-to-trash 시범 | 최종 QA PASS·작업 브랜치 push 완료, 앱 결과 수락 대기 |
| 운영 C | off-host 복구·host supervisor 권한 분리·상시 ingress·원격 CI 역순/철회·범용 저장소/언어 비교 등이 남아 **NO_GO** |
| 외부 실행 | 운영 배포·실제 merge·새 유료 자원 생성 미수행 |

공식 계약 확인 경로: [OpenAI 인증](https://learn.chatgpt.com/docs/auth) · [Phaser 3.90 Tilemap](https://docs.phaser.io/api-documentation/3.90.0/class/tilemaps-tilemap) · [Tiled JSON](https://doc.mapeditor.org/en/stable/reference/json-map-format/).
열람일은 2026-10-19이며 개별 변경일은 미공개다.

## Phase 4 직원 평가·다중 프로젝트 — 2026-10-19

직원 평가·프로젝트 격리·의존 업무 예약을 구현했다. 평가 게시와 결과 수락은 Owner 검토를 거친다.

<details>
<summary>기능 경계·실제 실행 SHA·사용량·실패 이력 보기</summary>

`회사 운영`은 프로젝트 현황·완료 토큰/미확정 예약·조직/프로젝트 정책·DAG·명시 예약·부서 이력을 제공한다. `직원 평가`는 AUTO 사실과 SELF/PEER/PM/USER 의견·원문·불변 근거/수정본·Owner 검토를 분리한다. 필수 점수가 없으면 종합 점수는 null이며, 결과 수락 전/오래된 근거는 게시할 수 없다. 자동 게시·고용/권한/예산 변경은 없다.

공유 Codex 공급자 슬롯은 **1개**다. 예약한 업무만 URGENT/HIGH/MEDIUM/LOW, 동순위 FIFO로 검사하며 선행 COMPLETED·권한·예산을 호출 직전 재검사한다. 새 프로젝트에 기존 GitHub/Slack 비밀을 복제하지 않는다. 한도/사용량 확인 실패 시 중단하고 API 키·유료 모델 fallback은 없다. 앱 토큰 정책은 구독 제공량·현금 청구 한도를 보장하지 않는다([상세](docs/16-cost-management.md)).

| 실제 검증 | 결과 |
|---|---|
| 프로젝트 A | `9fdadab6-2d4e-4185-b41d-737a1475c702`, run `3881e145-be67-42f6-ab6d-b8d05f080a66`, manifest `0340fae6f286ef8e0414993539c2adc497e86f70fa0c463727043502bcfb35d8` |
| 프로젝트 B | `86712e0c-2e13-4bfa-a6a2-1de409171968`, run `de550d7b-08e6-4a73-8232-e8470f26e1c1`, manifest `09aa1d597dd368c93e153a848f87a28a7dcaa057f4cd761ce0483b02e52d2d1a` |
| 코드·격리 | 각 PM/Developer/QA 3응답, 실제 파일 수정·Docker test/build exit0·동일 후보 QA PASS; 서로 다른 workspace, 모두 WAITING_APPROVAL |
| 큐·DAG | 실행 중 동시 관측 최대1. 후속 task `1d3c6283-5871-4c38-88eb-7b0305d7345a`는 DEPENDENCY/run0. 시험 후 intent 해제 |
| 평가 | A의 AUTO/USER/SELF/PEER/PM 5종 DRAFT. AI 3종 각 생성1회·SUCCEEDED, 동일 모델/작은 표본/결과 미확정 표시. 필수 항목 미산정으로 종합 점수 null |
| 토큰 | 성공 시험 프로젝트 완료 보고 A140,621+B70,866=211,487 토큰. A workflow69,744+1,173=70,917, AI3회69,704. B69,703+1,163=70,866. 청구액 미확인 |
| 실패 포함 사용량 | 첫 시험 A95,973+B95,894=191,867. 전체 Phase4 시험 보고 토큰은 211,487+191,867=403,354이며 구독 제공량/청구액 환산값이 아니다 |
| 실제 브라우저 | 데스크톱·390px·프로젝트 전환·5유형/게시 차단·페이지 오류0. 로컬 `test-results/phase4-company-live.png`, `phase4-reviews-live.png`, `phase4-reviews-mobile.png` |
| 외부 안전 경계 | 기존 PR2를 read-only 재조회: draft/open/merged=false, head/base 그대로. 새 Slack/GitHub 전송·공개 터널·실제 merge 없음 |

첫 시험 프로젝트 A/B(`3ae9214d-ca5c-41b5-b69c-f8d3f9d70c0b`, `891a9138-d17b-464a-b41d-c595879e9f41`)는 요청의 “실제 Codex 구독”을 PM이 소프트웨어 AC로 확장해 QA가 구독 증거 부족으로 거절했다. test/build0 뒤 재작업은 NO_CODE_CHANGE로 중단됐다. 둘 다 취소·보관했고 이력/사용량을 삭제하지 않았다. 함수 동작 요건으로 좁힌 두 번째 시험은 통과했다. 검증 스크립트의 목록/상세 snapshot 조회 오류도 수정했으며, 이미 완료된 실행으로 평가·브라우저 단계를 재개해 코드 생성을 반복하지 않았다. 위 211,487은 성공 프로젝트 소계이며 첫 실패 시험 사용량을 제외한 값이다.

새 실제 실행은 `pnpm verify:company-live`로 명시 실행한다. 기본 테스트는 모델을 호출하지 않는다. `--review-existing <projectA> <projectB> <runA> <runB> <childTask>`는 이 스크립트가 만든 WAITING_APPROVAL fixture만 재조회하며 이미 있는 5종 평가를 재생성하지 않는다. 이 명령도 결과 수락·게시·merge를 수행하지 않는다.

</details>

## P4-05/06 로컬 운영·복원·C 판정 — 2026-10-20

로컬 경보·암호화 백업·격리 복원을 검증했다. **운영 C 출시는 NO_GO**다.

<details>
<summary>복원·장애·경보 시험과 출시 차단 조건 보기</summary>

`운영·복구` 탭은 신선한 계측/경보·Owner 확인·고정 Slack 정책·암호화 백업/격리 복원 job·C 검증 근거를 보여준다. 확인과 해결, queued와 성공, 완료 토큰과 미확정 예약을 분리한다. 새 경보/회복만 전송하며 UNKNOWN은 자동 반복하지 않는다. 로컬 Owner/CSRF/version/idempotency·단일 조직 설치 범위를 적용한다. 운영 절차·키 보관·한계는 [15장](docs/15-deployment-and-operations.md), 결정은 ADR-015를 따른다.

| 실제 검사 | 결과·근거 |
|---|---|
| 전체 회귀 | lint/typecheck·TS16/Python26 계약·테스트206개·build 통과; Chromium30개 통과 |
| 암호화 백업 | job `42a0d2b5-54f5-4008-a7b2-4422e8c5d442`, 449,791 bytes, table44/workspace14, 파일 SHA256 `1b953fadd0b5e0d8610cbdbecb249a4d38bbc54630cda12d5e9ee09252de2363` |
| 최종 격리 복원 | job `f2b28f0e-a26e-4e07-a579-f982415cdfe0`, table44 행 수/digest·workspace14 물리 SHA 일치, quarantine·세션 폐기/연결·예약·이전 승인/전송 차단, 측정6,951ms |
| 실제 DB 장애 | 복원용 PG만 실제 중단/재시작; live200/ready503 unavailable 확인 후 재접속·quarantine 유지·전체 내용 보존. 원본 PG는 중단/교체하지 않음 |
| 실제 worker 장애 | 별도 `pixel_recovery_test_*` DB와 native Node worker를 생성해 강제 종료/exit 확인. 늦게 만료된 lease→BLOCKED/RECOVERY_REQUIRED·자동 재호출0·중복 event sequence0. 공급자는 명시적인 비과금 대역이며 실제 Codex 강제 종료 시험과 구분 |
| 로컬 부하/SSE | 실제 Owner 읽기100회/동시4/p95 11ms/총225ms. p95는 정렬100개 중 `ceil(100×0.95)=95번째`. 3소비자 fanout/느린 소비자5초 종료/연결10 상한은 전용 PG 통합 시험. 운영 SLA 아님 |
| 실제 외부 연동 | GitHub App repository/base head와 Slack team/bot identity read-only 조회. 내손비 비공개 고정 채널의 synthetic OPEN/RESOLVE 2건 SENT. 시험 뒤 알림 정책을 원래 disabled로 복원 |
| 알림 안전 경계 | 뒤늦게 대기하던 RESTORE_NOT_VERIFIED 회복1건은 정책 복원 후 NOTIFICATION_PERMISSION_CHANGED/FAILED로 차단됐다. 실제 전송2건과 구분하며 재전송하지 않음 |
| 실제 화면 | 최종 LOCAL_FIXTURE=READY_FOR_OWNER_REVIEW/blocker0, 운영=NO_GO를 실제 API/화면에서 확인. 키보드·390px·page error0; `test-results/operations-dashboard-desktop.png`, `operations-release-desktop.png`, `operations-release-mobile.png` |
| 원본·정리 | 기존 workflow 수락 대기6건·성공2건·취소4건·BLOCKED2건 유지, 새 모델 호출0. 시험 소유 컨테이너/네트워크/볼륨/별도 DB 정리. 원본 business 데이터 교체/삭제·실제 merge/운영 배포 없음 |

첫 복원 job `ffc1bba2-f31e-4a6a-b156-258e1effb8e0`은 Docker Desktop 준비 probe3초와 internal network의 host port 부재를 확인해 RESTORE_DATABASE_NOT_READY로 실패했다. 제한 시간을 늘리고 전용 bridge/고정 loopback port를 사용한 뒤 같은 암호화 백업으로 성공했다(`86a0c084-6a71-4040-b62e-6676b31e98bc`, 7,361ms). 이후 최종 C 판정·backoff 가드를 포함한 동일 source digest에서 위 최종 job과 검증을 다시 통과했다. 실패 이력을 삭제하지 않았다.

최종 source digest는 `820287776d0aec10afc35919a004c8cb8639504abf867b449c096b3708adcdfe`다. `AUTOMATED_SUITE` proof `2a1bcab5-0c6f-4199-8fb1-e281c8e1dcf5`, `BROWSER` `93394f97-db62-4e6c-bae5-db41bbc83c5f`, `RECOVERY` `339bcea9-5d47-4899-ba45-8f2b77839736`, `PERFORMANCE` `5ed6604a-43f9-483f-8bb2-d8d02d37ba0a`, `EXTERNAL_PROBE` `19007f4e-0d0f-414b-8e3d-657d15524d19`를 DB와 `.local/operations-evidence/<id>.json`에 연결했다. dump/복원/검증 시간은 이번 소규모 측정값이며 RPO/RTO 약속이 아니다.

로컬 gate는 같은 source digest의 최근 검증5종·실제 백업/복원·실제 경보/회복 전달·신선한 계측/worker·구독/Sandbox·긴급 경보 없음·점검 해제를 요구한다. 운영 C는 Owner 승인·운영 환경/off-host 복구·상시 ingress·범용 실행/언어 비교·native 고아 프로세스 조정·독립 host supervisor 분리가 남아 **NO_GO**다. 새 유료 모델/인프라는 추가하지 않았으며 이 판정은 자동 merge/배포 승인이 아니다.

</details>
