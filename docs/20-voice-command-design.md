# 음성 명령 후속 설계

## Phase 5 로컬 구현 — 2026-10-20

P5-01과 P5-02의 정상 처리/취소 경로를 구현했다. 아래 초기 설계 중 provider 미선택/미구현이라는 표현은 초기 이력이며, 실제 구현 범위는 이 절과 ADR-016·README 검증 기록을 따른다. 운영 C 출시와 물리 마이크 정확도 검증은 별도다.

- 공급자: 공식 `ggml-org/whisper.cpp`의 Windows x64 CPU 배포 `b5454`, 다국어 `tiny`. `-ng`, CPU thread2, 한국어 `ko`, shell 없는 고정 executable/인자를 사용한다. 모델/실행 파일은 `.local/voice-runtime`에 설치하며 런타임이 자동 다운로드/업그레이드하지 않는다. 공식 archive SHA-256과 model SHA-1을 설치 때 확인하고 manifest의 개별 executable/DLL/model SHA-256을 서비스 준비 때 대조한다. MIT license 원문 두 개도 설치한다.
- 비용/전송: 외부 STT·TTS·유료 API fallback 경로가 없다. 모델 다운로드는 GitHub/Hugging Face, 실제 음성 처리는 이 컴퓨터에서 수행한다. 별도 서비스 요금은 예약하지 않으며 CPU/전력·통신 비용은 측정하지 않았다. 원격 공급자의 보관 정책을 로컬 처리에 적용한 것처럼 주장하지 않는다.
- 상한: canonical PCM WAV 16kHz/mono/16bit, 0.25~30초, 최대960044bytes=44byte header+30000ms×32bytes/ms. 브라우저 원본은 최대2MiB, decode 뒤 30초 초과를 조용히 자르지 않고 거부한다. 동시 native 전사1건, 조직당 UTC 일자20회(실패/취소도 소비), native60초 timeout. 자동 재시도/다른 모델 전환은 없다.
- 후보: Owner+Origin+CSRF+Idempotency-Key+`local-transcription-v1` 동의를 실제 API 경계에서 검사한다. `PROCESSING→READY→CONFIRMED`와 `CANCELLED/FAILED/EXPIRED`를 task/run과 분리한다. 원시 WAV는 비공개 UUID 임시 폴더에만 쓰고 native close 이후 finally에서 삭제한다. 브라우저 녹음은 stop/cancel/unmount에 모든 track을 중지한다. 사용자가 선택한 원본 파일은 앱 임시 파일과 별개다.
- 텍스트: 후보는 생성1시간 뒤 만료하며, 서버의30초 주기 및 조회 때 정리한다(DB 장애 때 정리 지연 가능). 확인/취소 때 후보 plaintext를 없앤다. 확인한 한국어 문장은 task 원문으로 보존하고 candidate ID·해시·수정 여부·actor·동의·confirmedAt을 연결한다. 해시는 익명화 보장이 아니다. 감사 metadata의 장기 보관/삭제 정책은 운영 개인정보 검토에 남긴다.
- 확인: 프로젝트·직원 이름/숫자/경로/수용 기준을 Owner가 확인한다. 문장 수정은 확인란을 해제한다. 확인 endpoint는 서버 candidate 상태/version/만료와 현재 Owner·project·maintenance를 재검사한 뒤 TEXT/SLACK과 같은 `createTaskCommand`를 호출한다. 일반 tasks endpoint로 VOICE source를 위조할 수 없다. 생성 상태는 TODO이며 run/merge/배포 승인 생성은 없다. 자연어 조회·중단 intent parser와 TTS·상시 청취/회의는 구현하지 않았다. 기존 UI 제어를 사용한다.
- 복구: 격리 restore는 READY/PROCESSING 후보 plaintext를 폐기하고 CANCELLED/RESTORE_QUARANTINE으로 처리한다. 이전 schema의 backup도 table 존재 검사로 호환한다. 강제 종료 후에는 durable owner receipt의 host/PID/생성 FILETIME/SID/executable과 Windows handle·정확한 argv를 확인해 해당 native 종료 후 UUID audio.wav만 삭제한다. 시작 시/30초 조정, DB 잠금, 최대 자동2회, 확인 불가 차단·Owner version 재확인을 적용한다. 영수증은 PROCESSING 저장 시점에 함께 commit하므로 native 실행 전의 crash도 추적한다. 구형 null 영수증·외부 host·junction/hardlink·알 수 없는 파일은 자동 삭제하지 않는다. 복구 뒤 CANCELLED로 닫으며 자동 전사/task/run replay는 없다.15장·ADR-017을 따른다.

API: `GET /api/v1/voice/status`, `POST /api/v1/projects/:id/voice/candidates`(audio/wav), `GET/DELETE /api/v1/voice/candidates/:id`, `POST /api/v1/voice/candidates/:id/confirm`(확인문·expectedVersion·task). raw audio나 transcript는 구조화 request 로그에 넣지 않는다.

취소 요청은 `PROCESSING/VOICE_CANCEL_REQUESTED`로 전역 슬롯을 유지한다. native `close`와 임시 파일 정리가 끝나야 CANCELLED로 바꾸며, 파일 정리 실패는 `PROCESSING/VOICE_CLEANUP_REQUIRED`로 남겨 cancel replay로도 슬롯을 열지 않는다. native error 이벤트를 종료 근거로 쓰지 않는다. [Node child_process close 계약](https://nodejs.org/docs/latest-v22.x/api/child_process.html#event-close)(2026-10-20 열람, 공개 v22.23.3 문서/실행22.20.0)을 대조했고 실제 spawn 실패→close→파일 정리와 취소 중 차단을 시험했다.

실행: `pnpm setup:voice`(이미 설치됐다면 hash 대조 후 재사용), `pnpm verify:voice-live`, `pnpm verify:voice-browser`. 실제 전사 시험은 Windows의 설치된 Microsoft Heami Desktop으로 만든 공개 시험 문장이다. 실제 마이크가 아니다. 브라우저 대역 시험의 마이크 거부/track 해제와 실제 STT 호출을 구분한다. 정확도/품질 일반화 근거가 부족해 P5-04 자동 모델 최적화는 도입하지 않는다. TTS·회의/추가 연동(P5-03)은 별도 요구가 없어 평가 후 보류한다.

마이크 UI는 경과 초·입력 신호 유무를 표시하며 신호 감지는 정확도/문장 인식의 증거가 아니다. 탭 숨김/취소/이탈 때 녹음·meter·track을 해제하고 그 녹음을 업로드하지 않는다. FILE/MICROPHONE 표시는 클라이언트의 경로 선언이다. 물리 마이크 시험은 헴이 준비됐다고 알린 뒤 직접 동의·녹음하며, 현재 요청에 따라 대기한다.

공식 확인 경로(2026-10-20 열람): [whisper.cpp README](https://github.com/ggml-org/whisper.cpp), [b5454 배포/해시](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454), [모델 파일·SHA](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md), [Whisper MIT License](https://github.com/openai/whisper/blob/main/LICENSE). 최신 release tag는 v1.9.5였지만 설치는 Windows CPU asset이 공개된 b5454에 고정했다. 원격 문서별 최종 수정일은 별도 확정하지 않았다.

## 1. 목적

안정된 텍스트 command 파이프라인에 음성을 추가한다. 음성 입력이 권한·승인을 우회하지 않게 한다.

## 2. 범위

Phase 5 후보: 마이크·STT·확인 UI·공통 업무 생성·선택적 음성 응답. Phase 0~4 출시 필수 범위에서 제외한다.

## 3. 요구사항

“모카한테 로그인 페이지 수정 맡겨줘”, “QA 결과 보여줘”, “작업 잠깐 중단해줘” 같은 입력을 지원할 수 있게 한다. 마이크 허용·오인식·녹음 저장/삭제·비용·개인정보를 처리한다. 고위험 행위는 음성만으로 자동 승인하지 않는다.

## 4. 설계 내용

command는 source=TEXT/SLACK/VOICE, commandOriginalKo, actorId, confirmedAt, metadata로 정규화한다. STT 결과는 task 아닌 transcription 후보로 먼저 저장한다. 사용자가 수정/확정한 텍스트를 commandOriginalKo에 보존하고 필요한 감사 범위에서 후보/수정 여부를 연결한다.

확인 UI는 직원/프로젝트 이름·숫자·경로를 강조한다. STT 신뢰도 수치를 보편적 정확도로 해석하지 않는다. TTS는 표시된 한국어 보고만 읽고 비밀/긴 내부 로그를 읽지 않는다.

## 5. 기술적 근거

원문 15/18장의 후속 확장·공통 명령 처리 요구를 따른다. provider·모델·가격·보관 정책은 미선택이며 Phase 5에서 공식 근거를 확인한다. 특정 서비스의 정확도/개인정보 정책을 현재 확정하지 않는다.

## 6. 데이터 흐름

```mermaid
flowchart LR
  Mic[마이크 권한 / 녹음] --> STT[STT / 비용 예약]
  STT --> Text[텍스트 후보]
  Text --> Confirm[사용자 수정 / 확인]
  Confirm --> Auth[공통 신원 / 권한 검사]
  Auth --> Task[한국어 원문 task]
  Task --> PM[PM workflow]
  PM --> Report[한국어 결과 / 선택적 TTS]
```

조회·중단도 같은 권한/controlVersion 검사를 사용한다. 목소리만으로 계정 신원을 증명하지 않는다.

## 7. 예외 처리

마이크 거부·단절·오인식은 텍스트 입력으로 복구한다. 중복 전사/업로드는 idempotency key로 제어한다. 확인 전 취소하면 task/run이 생기지 않는다. STT 사용량 불명확은 UNKNOWN으로 남기고 무한 재시도하지 않는다.

## 8. 보안 고려사항

기본은 원시 음성 비저장이다. 임시 업로드는 처리/취소 후 삭제한다. 장기 저장은 명시적 선택·기간·삭제 경로가 필요하다. 외부 전송 전 공급자/보관 범위를 알린다. 배포·결제·권한 상승·데이터 삭제는 별도 인증 승인 UI가 필요하다. 실제 서비스 환경의 개인정보 검토를 별도로 수행한다.

## 9. 구현 우선순위

텍스트 안정 → STT 후보/확인 → 공통 command → 취소/삭제/비용 → 선택적 TTS. 상시 청취·회의 녹음은 초기 범위가 아니다.

## 10. 완료 기준

전사 수정·확인 전 실행 없음·동일 권한·위험 자동 승인 거부·음성 삭제·비용 상한·텍스트 fallback을 실제 시험한다.

## 11. 미확정 사항

provider·브라우저·파일 크기/시간 한도·가격·전사 보관·TTS 필요성은 Phase 5에서 결정한다. 현재 미구현이다.
