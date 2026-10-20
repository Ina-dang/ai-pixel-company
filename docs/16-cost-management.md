# 토큰·비용·예산 관리

## Phase 5 로컬 음성 비용 경계 — 2026-10-20

STT는 공식 MIT 배포/모델을 내려받아 이 컴퓨터의 CPU로 실행한다. 외부 STT/TTS·유료 API fallback/자동 모델 전환·계정 결제/증설 코드는 없다. 파일당30초, 동시1건, 조직당 UTC일20회(실패/취소 포함), native60초 제한을 집행한다. 모델/실행 파일의 저장 공간·CPU/전력·다운로드 통신 비용은 측정하지 않았으므로 총 경제 비용0이나 계정 청구0으로 환산하지 않는다. TTS/회의·자동 모델 비용 최적화는 별도 요구·품질/rollback 근거 전 보류한다. 실제 모델 API 호출 여부와 로컬 STT invocation은 README에서 구분한다.

## P4-05/06 운영 검증 비용 경계 — 2026-10-20

기존 PG18 image ID·로컬 Docker·Node crypto·기존 고정 Slack/GitHub 연결을 사용했다. 새 유료 모델/공급자·클라우드 저장/호스팅/터널·Actions job·유료 runner를 생성하지 않았다. 이번 운영 검증의 실제 모델 호출은0이며 native worker 장애 시험은 명시적인 비과금 대역이다. 계정 전체 실청구액은 확인하지 않아 `null/미확인`을 유지한다.

백업/복원은 로컬 CPU/메모리/디스크를 사용한다. 일시적인 시험 컨테이너는 CPU1/메모리768MiB로 제한하고 소유 label을 확인해 컨테이너/네트워크/볼륨을 정리했다. 암호화 백업/별도 키/복원 파일/검증 Artifact는 로컬에 남는다. 자동 구매/확대/삭제 보관 정책은 없다. off-host 저장소·운영 환경·상시 경보 서비스·RPO/RTO/보관을 정하면 비용/권한/대상을 먼저 확인하고 별도 범위를 받아야 한다.

## Phase 4 구독 공유 실행 정책 — 2026-10-19

새 유료 모델 API·공급자 fallback·유료 인프라는 추가하지 않았다. 기존 Codex 구독의 readiness/한도 검사를 workflow와 AI 평가 호출 직전에 수행한다. 공유 슬롯은 1개이며 평가가 코드 실행과 동시에 구독을 점유하지 않는다. AI 평가 최초/수정은 각각 호출 1회, 총 2회 한도다.

초기 앱 정책은 조직 월 2,000,000·프로젝트 월 1,000,000, workflow 실행당 최대 500,000, AI 평가당 최대 50,000 완료 응답 토큰·180초다. 이는 구현상의 실행 정책으로 구독 제공량·잔여량·요금 한도가 아니다. 실제 적용은 조직/프로젝트/직원/평가 정책 중 가장 작은 한도다. UTC 월 경계에서 완료 input+output을 정산하고 진행 작업은 잔여 한도를 예약한다. 미보고/종료 불명 사용량은 미확정 예약으로 남긴다.

완료 응답 보고 후에는 이미 사용한 토큰을 되돌릴 수 없으므로 앱 토큰 한도는 공급자 생성 중의 강제 토큰 상한을 보장하지 않는다. 시간·구독 한도는 별도로 중단하고 종료 확인 실패는 UNKNOWN으로 새 공급자 작업을 차단한다. 현금 환산·공급자 확인 청구액은 `null/미확인`으로 표시한다. 과거 완료 role의 보고 토큰을 migration으로 반영해 새 정책이 이전 사용량을 0으로 취급하지 않도록 했다.

## Phase 3 비용 경계 — 2026-10-19

사용자는 학생 GitHub Pro 이용을 알렸다. GitHub Pro와 Codex/Copilot 구독은 별도 제품이므로 서로의 포함량으로 환산하지 않는다. 직원 실행은 기존 Codex 구독만 사용한다. GitHub Actions의 비공개 저장소 초과분·대형 runner·저장 공간, Slack 유료 기능·플랜 업그레이드, 유료 호스팅/터널/도메인은 자동 구매하지 않는다. 추가 비용이 필요한 설정은 금액·대상·한도를 확인해 실행 전에 알리고 사용자 판단을 받는다.

이번 adapter는 Actions 조회만 지원하며 hosted workflow 생성/dispatch·유료 runner 생성 API는 제공하지 않는다. 로컬 test/build와 외부 CI 결과는 별도 근거다. [GitHub Actions 과금 문서](https://docs.github.com/en/billing/concepts/product-billing/github-actions)(열람 2026-10-19, 변경일 미공개)는 비공개 저장소 포함량 초과 과금과 larger runner 별도 과금을 설명한다. 계정 전체의 실제 사용/결제 설정은 별도 확인 대상이며 추정 무료액을 청구 확인액으로 표시하지 않는다.

## Phase 1 구독 전용 구현 보충 — 2026-10-19

현재는 [ADR-011](17-decision-log.md)의 ChatGPT 구독 전용 경로다. 아래 API 단가/금액 예약 ledger는 확장 설계이며 현재 실행에 적용하지 않는다. API 키·다른 공급자 fallback·크레딧 구매/자동 충전 API는 미지원이다. 세 역할과 다른 Codex 사용이 같은 구독 한도를 공유한다.

실행 전과 실행 중 5초 간격으로 공식 app-server 한도를 조회한다. ChatGPT 인증·ordinaryUsageAllowed·관련 Codex window·명시적인 비유료 크레딧 상태를 확인할 수 있어야 한다. 90% 이상에서 중단하고 수동 재개만 지원한다. quota 오류에는 자동 retry가 없다. 계정 설정을 변경하거나 반영 지연을 제거하는 결제 보장은 하지 않는다.

완료된 응답의 input/cached-input/output 토큰, 호출 횟수, 시작 시각·재작업을 checkpoint에 기록한다. 최대 7회 모델 호출·2회 재작업·호출180초·실행15분을 적용한다. 합계 input+output>=500,000이면 신규 호출/승인을 막는다. 처리 중 토큰 증가나 응답 없는 중단 호출 사용량은 미확정이므로 청구 상한이 아니다. API 단가×토큰을 구독 청구액으로 표시하지 않는다. 현재 앱은 청구서 조회를 수행하지 않는다. 한국어/영어 품질·효율 비교는 미실행이다.

## 1. 목적

호출별 비용을 측정하고 동시 실행과 재시도로 예산을 초과하는 신규 실행을 막는다. 추정액과 확인된 청구액을 구분한다.

## 2. 범위

Phase 1 호출/직원/task/run 계측, Phase 4 프로젝트·조직 예산과 성과 비교, Phase 5 자동 모델 선택을 다룬다. 가격 숫자나 특정 모델 최저가를 현재 확정하지 않는다.

## 3. 요구사항

agentId/taskId/runId/model/inputTokens/outputTokens/cachedInputTokens/estimatedCost/actualCost(nullable)/executionTime/retryCount/taskSuccess/communicationLanguage를 매 호출 저장한다. providerRequestId·priceVersion·currency·usageStatus도 저장한다. taskSuccess는 최종 task 판정 후 집계하며 완료 전 null이다. workflow run과 agent run을 별도 ID로 유지한다.

## 4. 설계 내용

가격 단위가 백만 토큰일 때 다음을 사용한다:

`비캐시 입력 = 총 inputTokens - cachedInputTokens`

`estimatedCost = 비캐시 입력 × inputPrice / 1,000,000 + cachedInputTokens × cachedInputPrice / 1,000,000 + outputTokens × outputPrice / 1,000,000`

총 inputTokens에 cache가 포함되도록 provider adapter가 정규화한다. cache가 별도로 보고되는 provider는 원자료와 정규화 방식을 함께 보존한다. unsupported/unknown cache는 0으로 확정하지 않고 해당 토큰 필드를 null로 저장하며 usageStatus에 불명확성을 표시한다. 토큰 미확인 동안 estimatedCost는 예약한 보수적 상한 추정값으로 표시하고 확정 사용량 기반 계산과 구분한다. 공급자가 추가 과금하는 tool/audio/reasoning 항목은 별도 component로 기록하고 위 토큰식만으로 총 청구액이라 부르지 않는다.

계산 예시는 실제 단가가 아닌 가상값이다: input 10,000, cache 2,000, output 1,000, 가상 단가 입력 2·cache 1·출력 8 USD/백만 토큰이면 `(8,000×2+2,000×1+1,000×8)/1,000,000 = 0.026 USD`다. 실제 모델 비용 추정으로 재사용하지 않는다. 내부 계산은 decimal로 하고 표시만 통화 규칙에 맞게 반올림한다.

actualCost는 공급자 request 단위 청구가 확인될 때만 저장한다. 월 단위 총액만 있으면 개별 호출 actualCost는 null이며 임의 배분을 확정 청구로 표시하지 않는다. 환산 원화가 필요하면 환율 출처·시점·산식을 별도 표시한다.

## 5. 기술적 근거

영어가 모든 모델에서 한국어보다 저렴하다는 가정은 하지 않는다. 원문 2장의 실측 원칙을 따른다. 실제 모델·과금 구조·지원 usage 필드는 구현 시 [OpenAI 공식 가격](https://openai.com/api/pricing/)·[Anthropic 공식 가격](https://platform.claude.com/docs/en/about-claude/pricing)에서 재확인한다. 이 두 가격 페이지는 이번 작성에서 가격 내용을 검증하지 않았으므로 단가 인용에 사용하지 않았다.

## 6. 데이터 흐름

호출 계획/모델/output cap → 남은 context/token 상한 확인 → org/project/agent 계정을 고정 순서로 lock → 예상 최악 비용 reservation → 호출 → usage 원자료 수집 → normalized usage/추정액 기록 → 정산/잔여 예약 해제 → event/보고. event transaction이 필요한 경우 조직 event counter lock을 먼저 얻은 뒤 account lock 순서를 따른다.

provider timeout 후 사용량이 불명확하면 예약을 UNKNOWN으로 유지하고 request ID로 조정한다. 무조건 0원 처리하거나 즉시 전액 해제하지 않는다. retry도 과금 가능성이 있으므로 각 실제 provider 호출을 기록하고 예산을 다시 확인한다. 동일 HTTP 재전송과 새 LLM 호출을 구분한다.

## 7. 예외 처리

최대 입력/출력 비용을 산정할 수 없거나 가격을 확인할 수 없으면 자동 호출을 막고 사용자가 확인할 수 있는 예산/모델 결정을 요청한다. 공급자 실제 사용량이 예측을 넘으면 실제 추정액을 그대로 기록하고 추가 호출을 차단한다. 상한은 신규 실행 통제이며 이미 발생한 청구를 소급 취소하는 보장이 아니다.

직원/task/run/project/org의 남은 예산 중 가장 제한적인 값으로 실행한다. budget approval은 새 금액·통화·기간에 묶어 한 번 적용한다. 재작업·transport retry 제한은 비용 상한과 별개로 동시에 적용한다.

## 8. 보안 고려사항

모델이 usage/가격·상한을 직접 수정할 수 없다. provider key는 서버 secret store에 두고 클라이언트/Sandbox로 전달하지 않는다. 청구 자료·프로젝트 비용의 조회도 조직 권한을 검사한다. 높은 평가 점수로 상한/권한을 자동 확대하지 않는다.

## 9. 구현 우선순위

Phase 1부터 계측·가격 snapshot·예약/정산·최소 상한을 구현한다. Phase 4는 기간/프로젝트 예산·대시보드·조직 합계를 확장한다. prompt caching·context 축약은 provider 지원과 품질 평가를 확인한 뒤 사용한다.

### 언어 효율 평가

같은 baseline/과제/수용 기준·모델·도구·출력 한도·가격 버전으로 한국어/영어 내부 협업을 비교한다. 실행 순서를 교차하고 cache warm/cold를 분리한다. 한국어 원문은 두 조건 모두 보존한다. 영어 조건의 번역/요약 비용도 포함한다. 성공률·품질·재작업·시간·입출력 토큰·비용과 표본 수를 함께 보고한다.

비용 차이율 = `(영어 평균 비용 - 한국어 평균 비용) / 한국어 평균 비용 × 100`. 분모가 0이면 비율 대신 절대 차이를 쓴다. 성공 작업당 비용 = 전체 평가 비용 / 성공 작업 수. 성공 0이면 산출 불가다. 적은 표본으로 일반화하지 않는다.

## 10. 완료 기준

캐시 중복 계산·누락 usage·동시 예약·provider timeout·retry·가격 변경·예산 승인 재사용·추정/실청구 혼용을 시험한다. 대시보드 합계는 호출 원장과 같은 통화/기간으로 재계산 가능해야 한다.

## 11. 미확정 사항

provider/model/실제 단가·context cap·task/프로젝트 예산·가격 갱신 주기·청구 조정 방법은 확인 필요다. 언어 비용 절감은 아직 측정하지 않았으며 효과를 확정하지 않는다.
