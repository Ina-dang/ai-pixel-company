# 보안·인증·권한·승인

## Phase 5 마이크 문서 정책 — 2026-10-20

웹 응답의 `Permissions-Policy`는 `camera=(), microphone=(self), geolocation=()`다. 마이크는 현재 origin에서만 요청할 수 있고 다른 origin에는 위임하지 않는다. 브라우저/OS의 사용자 허용을 대신하지 않으며 명시적 앱 동의·버튼 입력 전에는 요청하지 않는다. 실제 요청도 audio=true/video=false이고 음성은 loopback 서버의 기존 CPU STT로만 보낸다. 전체 브라우저의 권한/보호 기능을 끄거나 모든 사이트의 마이크를 허용하지 않는다.

Foundation의 `microphone=()`가 남아 실제 녹음 요청을 문서 정책에서 거부하던 문제를 실제 마이크 시험 중 발견했다. 사용자 사이트 설정을 먼저 확인하도록 안내한 것은 이 원인을 찾기 전의 진단 이력이다. 이제 응답 문자열뿐 아니라 실제 문서의 feature policy에서 자기 origin 마이크 허용·다른 origin 마이크/카메라/위치 차단을 검사한다. 권한/장치 없음/장치 사용 불가/녹음기 실패는 고정 코드로 구분하고 원시 오류 메시지·장치 이름은 UI/로그에 복제하지 않는다.

공식 확인 경로: [W3C Permissions Policy](https://www.w3.org/TR/permissions-policy/) Working Draft 2026-09-22, 열람2026-10-20. 빈 allowlist와 self-origin의 의미를 확인했으며, 이 초안을 최종 권고안으로 간주하지 않는다. 앱의 실제 동작 근거는 현재 응답 헤더·브라우저 문서 판정·사용자 직접 녹음 시험이다.

## 1. 목적

AI가 만든 코드와 외부 입력을 비신뢰 데이터로 취급하고, 도구 경계에서 실행 범위·승인·비용을 집행한다. 법률 준수나 완전한 격리를 검증 없이 보장하지 않는다.

## 2. 범위

로컬 Owner 인증, 조직/프로젝트 권한, 서버 간 인증, Sandbox, 비밀 관리, 고위험 승인, 감사·위협 시험을 포함한다. 외부 공개/다중 사용자 서비스는 별도 인증 심사 후 연다.

## 3. 요구사항

merge, 운영 배포, 운영 DB 삭제, 외부 결제, 유료 자원 증설, 민감 권한 변경, 고위험 직원 도구 부여는 Owner 명시 승인이 필요하다. 음성/Slack/LLM의 문장만으로 승인하지 않는다.

## 4. 설계 내용

### 인증과 권한

Phase 0은 loopback 로컬 Owner만 지원한다. 초기 비밀은 개발자가 별도 환경/secret store에서 생성·설정하고 저장소에 넣지 않는다. 검증된 인증 라이브러리로 고엔트로피 bootstrap secret을 확인해 hashed opaque session을 발급한다. 세션 쿠키·CSRF·로그인 rate limit·만료/로그아웃을 구현한다. 기본 비밀번호나 자동 로그인 우회를 두지 않는다. 외부 공개 전 OIDC와 계정 복구·MFA 정책을 별도 확정한다.

API는 현재 membership/project access를 확인한다. 내부 서비스는 외부 브라우저 세션을 쓰지 않고 별도 credential·audience/scope와 내부 네트워크를 사용한다. 운영 전 mTLS 또는 동등한 서비스 인증을 검토한다. credential rotation 시 실행 중 요청의 처리 정책을 명시한다.

| 행위 | PM | Developer | QA | Owner |
|---|---|---|---|---|
| task plan / assign | 허용 범위 | 조회 | 조회 | 관리 |
| sandbox file write | 거부 | 해당 run만 | 거부 | 정책 설정 |
| test/build | 거부 | 허용 명령 | 검증 snapshot만 | 정책 설정 |
| evidence read | 해당 project | 해당 project | 해당 project | 해당 org |
| PR/push | 거부 | adapter 요청 | 조회 | integration 정책 허용 |
| merge/deploy/delete/payment | 직접 거부 | 직접 거부 | 직접 거부 | scope 고정 승인 |
| profile/tool grant | 요청 | 요청 | 요청 | 고위험 별도 승인 |

### 승인 소비

approval은 action·purpose·target repo/env·candidate SHA·request hash·policy version·amount/currency·expiresAt·approver에 묶인다. 사용자가 읽을 수 있는 한국어 설명과 diff/영향을 보여준다. 실행 직전에 현재 권한/범위를 다시 확인하고 조건부 UPDATE로 한 번만 소비하며 같은 transaction에서 operation을 생성한다. 원격 응답 불명은 operation UNKNOWN으로 조정한다. 기존 승인으로 다른 target/action을 실행하지 않는다.

### Sandbox 정책

| 경계 | 기본 정책 | 검증 |
|---|---|---|
| 파일 | per-run 임시 clone/workspace만 RW, rootfs RO, host home/.git/비밀 mount 금지 | path traversal·symlink 탈출·다른 run 읽기 |
| 명령 | 명령 spec·argv로 실행, 임의 shell interpolation 금지, repo script도 비신뢰 | 명령 주입·설치 hook·무한 프로세스 |
| 네트워크 | 기본 deny, 허용 egress proxy만. localhost/private/metadata 차단 | SSRF·DNS 재바인딩·내부 DB/Redis 접근 |
| 자원 | non-root, capability drop, seccomp, CPU/memory/pids/disk/time cap | fork bomb·메모리/디스크 고갈·timeout |
| 서비스 | Docker socket·host PID/network·privileged 금지 | daemon/host 탈출 접근 |
| 비밀 | LLM·GitHub·Slack·운영 비밀 미주입 | 환경/로그/파일 secret scan |
| 종료 | process group 종료 후 workspace 격리, stale lease 쓰기 거부 | 취소 후 background process·부작용 |

dependency 설치는 원칙적으로 사전 구성 이미지/lockfile·허용 registry proxy로 처리하고 install script는 통제한다. 테스트 명령 허용 목록만으로 테스트 코드가 안전하다고 보지 않는다. host와 kernel 공유 위험은 남으므로 인터넷에서 받은 임의 저장소 실행 전 강화 런타임/별도 VM 필요성을 평가한다. Phase 1 초기에는 소유한 비밀 없는 fixture 저장소만 쓴다.

## 5. 기술적 근거

[Docker Engine security](https://docs.docker.com/engine/security/), 2026-10-18 열람. 컨테이너 구성과 daemon 권한이 위험 경계다. 이 문서의 통제 목록은 설계안이며 실제 차단 효과는 보안 테스트가 필요하다. 원격 격리 유료 도입은 별도 승인한다.

## 6. 데이터 흐름

인증 → 조직/프로젝트 권한 → action policy → 필요한 승인 검증/소비 → budget reserve → operation 등록 → Sandbox/adapter 수행 → 결과/사용량 정산 → 감사·이벤트. 모델은 이 gate를 건너뛰는 실행 채널을 갖지 않는다.

## 7. 예외 처리

권한/예산 부족은 BLOCKED로 기록하고 한국어로 필요한 판단을 보고한다. DB/정책 조회 실패는 fail-closed다. 비밀 노출 의심 시 해당 credential 폐기/rotation·노출 범위 조사·보존된 증거 접근 제한을 수행한다. 미확정 원격 부작용을 새 실행으로 무조건 반복하지 않는다.

## 8. 보안 고려사항

위협: prompt injection, 악성 저장소/패키지, SSRF/명령 주입, cross-tenant 접근, 승인 replay/TOCTOU, secret 유출, 예산 경합, 로그 변조. 각각 tool gateway·격리·복합 FK·scope hash·fencing·원장·최소 DB 권한으로 대응하고 [14](14-testing-strategy.md)에서 부정 시험한다. 외부 문서는 근거 자료이지 실행 정책이 아니다.

## 9. 구현 우선순위

Phase 0 인증/권한/감사 최소 → Phase 1 sandbox·승인·예산·중단 → Phase 3 webhook/설치 토큰 → Phase 4 운영 감시. 감사 기록과 권한 검사를 Phase 4까지 미루지 않는다.

## 10. 완료 기준

위협별 재현 시험, 권한 철회, stale SHA, 동시 승인 소비, 취소 후 쓰기, egress/secret/path/자원 통제가 통과해야 한다. 실패/미실행 항목이 있으면 해당 위험 범위 실행을 차단한다. 절대적 보안 보장은 하지 않는다.

## 11. 미확정 사항

auth 라이브러리·secret store·강화 Sandbox runtime·세션 TTL·부정 시험 환경·개인정보/감사 보관 근거는 확인 필요다. 운영 배포 전 실제 서비스 환경·데이터 범위에 맞게 검토한다.
