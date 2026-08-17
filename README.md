# AI 올인원 플랫폼

채팅, 이미지, 영상, 음성 생성 기능을 하나의 작업 영역에서 제공하는 AI 플랫폼입니다. 모든 생성 기능은 Venice.ai API를 사용하며, 모델 목록은 Venice.ai 서버에서 실시간으로 불러옵니다.

## 주요 기능

- **아이디/비밀번호 로그인** — 비밀번호는 bcrypt로 해시되어 SQLite 데이터베이스에 저장되며, 인증 상태는 서명된 세션 쿠키로 유지됩니다.
- **채팅 모드** — 메시지 스트리밍, 이미지(최대 10개), 동영상(1개, 50MB 이하), 문서(1개) 첨부가 가능합니다. 시각 모델에는 동영상 프레임이 함께 전송됩니다.
- **이미지 모드** — 이미지 생성과 참조 이미지(스타일 참조) 전송을 지원합니다.
- **영상 모드** — 비동기 영상 생성과 진행 상태 폴링, 생성 전 비용 견적을 제공합니다.
- **음성 모드** — 텍스트 음성 변환(TTS)을 제공하며 모델별 음성 선택이 가능합니다.
- **모델 선택 UI** — 모델명 옆에 LMM 모델은 "LMM", 무검열 모델은 "무검열"로 표시됩니다.
- **모델 설명 표시** — 모델 선택창 바로 아래에 원문(영문)을 먼저 표시하고, Azure AI Translator 또는 DeepL 번역 결과를 아래 패널에 표시합니다.
- **작업 기록** — 수행한 작업(모드, 모델, 프롬프트, 첨부, 사용량, 비용, 결과, 시각)이 저장되며 모드/날짜/모델로 필터링하여 조회할 수 있습니다.
- **비용 계산** — 작업 시점의 단가 정보와 사용량을 기록하여 비용을 산출합니다. Venice.ai가 단가를 제공하지 않는 경우 "비용 정보 없음"으로 표시됩니다.
- **프롬프트 관리** — 프롬프트를 이름과 함께 저장·삭제하고, 채팅 입력창에 다시 불러올 수 있습니다.
- **모드 전환** — 채팅/이미지/영상/음성 탭 전환 시 페이지 이동 없이 작업 영역이 정적으로 교체됩니다.

## 기술 구성

- Next.js(App Router) + React + TypeScript
- SQLite(node:sqlite) — 작업 기록, 프롬프트, 사용자 정보 저장
- bcryptjs — 비밀번호 해시
- Web Crypto — 세션 토큰 서명(HMAC-SHA256)
- 서버 측 Venice.ai 프록시 — API 키는 서버 환경 변수로만 사용됩니다

## 환경 변수

`.env.example`을 참고하여 서버 환경 변수를 설정하세요.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `VENICE_API_KEY` | 예 | Venice.ai API 키. venice.ai 계정에서 발급합니다. |
| `AZURE_TRANSLATOR_KEY` | 아니요 | Azure AI Translator 구독 키. 설정하면 번역에 Azure가 우선 사용됩니다. |
| `AZURE_TRANSLATOR_REGION` | 아니요 | Azure AI Translator 리소스 리전(예: `koreacentral`). |
| `AZURE_TRANSLATOR_ENDPOINT` | 아니요 | Azure AI Translator 커스텀 엔드포인트. 기본값은 `https://api.cognitive.microsofttranslator.com`입니다. |
| `DEEPL_API_KEY` | 아니요 | DeepL 번역 API 키. Azure가 설정되지 않았을 때 사용됩니다. 무료 키는 `:fx` 접미사를 사용합니다. |
| `APP_USERNAME` / `APP_PASSWORD` | 아니요 | 최초 로그인 계정 생성에 사용됩니다. 설정하지 않으면 계정이 생성되지 않으며 로그인 페이지에서 안내가 표시됩니다. |
| `SESSION_SECRET` | 아니요 | 세션 쿠키 서명 키. 설정하지 않으면 `APP_PASSWORD`로 대체됩니다. |
| `DATABASE_PATH` | 아니요 | SQLite 파일 경로. 기본값은 `./data/app.db`입니다. |

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 에 접속합니다.

## 참고 사항

- 디자인과 색상은 [multi-video-studio](https://github.com/kmw-bufs2012/multi-video-studio), [multi-image-studio](https://github.com/kmw-bufs2012/multi-image-studio), [venice-allchat](https://github.com/kmw-bufs2012/venice-allchat) 프로젝트의 팔레트·폰트·카드 형태를 차용하여 작성되었습니다.
- 첨부 파일과 생성 결과는 `uploads/` 디렉터리에 저장되며, 데이터베이스 파일은 `data/` 디렉터리에 저장됩니다. 두 디렉터리는 버전 관리 대상에서 제외되어 있습니다.
- 모델 목록은 매 요청마다 Venice.ai API에서 실시간으로 불러오며, 목록이 하드코딩되어 있지 않습니다.
