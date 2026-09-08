# AI 올인원 플랫폼

채팅, 이미지, 영상, 음성 생성 기능을 하나의 스튜디오에서 제공하는 AI 플랫폼입니다. 모든 생성 기능은 NanoGPT API를 사용하며, 모델 목록은 NanoGPT 서버에서 실시간으로 불러옵니다.

## 화면 구성

좌측 고정 사이드바에서 화면을 옮겨 다니는 라우트 기반 구조입니다. 예전처럼 한 페이지 안에서 모드를 토글하지 않고, 메뉴를 누르면 실제로 페이지가 바뀝니다.

| 경로 | 화면 |
| --- | --- |
| `/` | 홈 — 생성 도구 카드와 자산 바로가기 |
| `/create/chat` | 채팅 생성 |
| `/create/image` | 이미지 생성 |
| `/create/video` | 영상 생성 |
| `/create/audio` | 음성 생성 |
| `/library` | 라이브러리 — 생성물을 날짜별로 모아 보기 |
| `/history` | 작업 기록 — 사용량·비용 조회 |
| `/prompts` | 프롬프트 저장·관리 |
| `/login` | 로그인 |

- 화면 하단에는 프롬프트 입력 바가 고정되어 있고, 모델·비율·목소리 같은 옵션은 페이지별 칩으로 나뉘어 있습니다.
- 페이지를 옮겼다 돌아와도 입력하던 프롬프트와 고른 모델은 그대로 남습니다.
- 테마는 시스템 설정 / 라이트 / 다크 세 가지이며, 헤더 오른쪽에서 바꿉니다. 기본값은 다크입니다.

## 주요 기능

- **아이디/비밀번호 로그인** — 비밀번호는 bcrypt로 해시되어 SQLite 데이터베이스에 저장되며, 인증 상태는 서명된 세션 쿠키로 유지됩니다.
- **채팅** — 메시지 스트리밍과 이미지·동영상·오디오·문서 첨부가 가능합니다. 어떤 종류를 첨부할 수 있는지는 선택한 모델이 NanoGPT 카탈로그에 공개한 `capabilities`(`vision`, `video_input`, `audio_input`, `pdf_upload`)로 자동 결정됩니다. 동영상을 직접 받지 못하는 비전 모델에는 프레임을 뽑아 이미지로 전달하고, `pdf_upload`가 없는 모델에는 PDF 대신 텍스트 문서(txt·md)만 첨부할 수 있게 막습니다. 스트리밍은 `[DONE]` 수신 시 즉시 종료되며, 장시간 응답이 없으면 자동으로 중단되어 무한 로딩을 방지합니다.
- **이미지** — 이미지 생성과 참조 이미지 전송(`input_references`)을 지원합니다. 참조 이미지의 최대 장수·최대 용량·허용 형식은 모델이 공개한 `input_reference_constraints`(`max_items`, `max_bytes`, `formats`)를 그대로 따르며, 해상도 선택지도 `supported_parameters.resolution`에서 읽어 옵니다. 고르지 않으면 모델 기본값으로 생성됩니다.
- **영상** — 비동기 영상 생성과 진행 상태 폴링을 제공합니다. 시작 이미지(`imageDataUrl`)와 원본 영상(`videoUrl`) 첨부 가능 여부는 모델의 `supported_parameters`로 자동 판정되어, 받지 않는 모델에서는 첨부 버튼이 비활성화됩니다.
- **음성** — 텍스트 음성 변환(TTS)을 제공합니다. 목소리 목록·출력 형식·최대 입력 글자 수(`max_input_size`)를 모델 카탈로그에서 읽어 적용하며, TTS는 입력이 텍스트뿐이라 첨부 영역이 비활성화됩니다.
- **서버리스 업로드 폴백** — 업로드 디렉터리를 만들 수 없는 환경(서버리스 등)에서는 임시 디렉터리로 자동 폴백하며, 모든 후보가 실패하면 죽은 경로 대신 이해하기 쉬운 오류를 반환합니다.
- **라이브러리** — 완료된 이미지·영상·음성 생성물을 종류별로 걸러 날짜 그룹으로 모아 봅니다. 작업 기록과 데이터를 공유하되, 기록이 사용량·비용 확인용이라면 라이브러리는 결과물 자체를 보는 화면입니다.
- **모델 선택 UI** — 모델명 옆에 첨부 가능 종류(비전·영상·오디오·PDF), 이미지 모델의 참조 장수, 영상 모델의 입력 방식(이미지→영상·영상 확장), 무검열 여부가 배지로 표시됩니다.
- **모델 설명 표시** — 모델 선택창 바로 아래에 원문(영문)을 먼저 표시하고, Azure AI Translator 또는 DeepL 번역 결과를 아래 패널에 표시합니다. 주요 이미지·영상·TTS 모델은 공식 문서 기반의 정적 한글 설명이 우선 표시됩니다.
- **작업 기록** — 수행한 작업(모드, 모델, 프롬프트, 첨부, 사용량, 비용, 결과, 시각)이 저장되며 모드/날짜/모델로 필터링하여 조회할 수 있습니다.
- **비용 계산** — NanoGPT 공식 문서에 따르면 대부분의 응답에 그 요청에 실제로 청구된 금액(`cost` 필드)이 함께 실립니다. 이 값이 있으면 그대로 쓰고("청구된 비용"), 없을 때만 모델 카탈로그 단가로 추정합니다("추정 비용"). 작업 기록 화면에는 조회된 작업들의 비용 총 합계가 실제 청구액과 추정치를 구분해서 표시됩니다. NanoGPT가 단가 정보를 전혀 제공하지 않는 모델은 "비용 정보 없음"으로 표시됩니다.
- **프롬프트 관리** — 프롬프트를 이름과 함께 저장·삭제하고, 채팅 입력창에 다시 불러올 수 있습니다.

## 기술 구성

- Next.js(App Router) + React + TypeScript — 라우트 그룹 `app/(studio)` 가 사이드바 셸을 공유하고, `/login` 만 셸 밖에 있습니다.
- 스타일은 `app/globals.css` 한 곳의 CSS 변수 토큰으로 관리합니다. CSS 프레임워크나 CSS-in-JS를 쓰지 않습니다.
- 화면 간 입력 상태는 React Context + `sessionStorage`(`components/StudioState.tsx`)로 유지하며, 상태관리 라이브러리를 추가하지 않았습니다.
- SQLite(node:sqlite) — 작업 기록, 프롬프트, 사용자 정보 저장
- bcryptjs — 비밀번호 해시
- Web Crypto — 세션 토큰 서명(HMAC-SHA256)
- 서버 측 NanoGPT 프록시 — API 키는 서버 환경 변수로만 사용됩니다

## 환경 변수

`.env.example`을 참고하여 서버 환경 변수를 설정하세요.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `NANOGPT_API_KEY` | 예 | NanoGPT API 키. nano-gpt.com 계정에서 발급합니다. |
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
- 첨부 파일과 생성 결과는 기본적으로 `uploads/` 디렉터리에 저장되며, 데이터베이스 파일은 `data/` 디렉터리에 저장됩니다. 두 디렉터리는 버전 관리 대상에서 제외되어 있습니다.
- **서버리스 배포(Vercel 등) 유의 사항**: 배포 디렉터리는 읽기 전용이라 `uploads/`에 쓸 수 없습니다. `lib/attachments.ts`가 이를 감지해 자동으로 OS 임시 디렉터리(`/tmp`)로 대체하므로 오류 없이 동작하지만, `/tmp`는 함수 인스턴스가 재활용될 때만 유지되는 임시 공간이라 항상 보장되지는 않습니다. 업로드한 파일이 이후 요청(예: 참조 이미지로 이미지 생성)에서 간헐적으로 사라질 수 있다는 뜻입니다. 안정적인 첨부 보관이 필요하면 `UPLOAD_DIR`을 외부 스토리지(예: Vercel Blob, S3)를 가리키도록 확장하는 것을 권장합니다. `UPLOAD_DIR`은 상대·절대 경로 모두 안전하게 처리됩니다(내부적으로 절대 경로로 정규화). `DATABASE_PATH`도 같은 이유로 서버리스에서는 기본값이 메모리 DB로 대체되어(재시작 시 초기화) 영속되지 않으니, 운영 배포라면 외부 SQLite 파일 경로나 별도 DB를 지정하세요.
- **Vercel의 4.5MB 요청 본문 제한과 첨부 업로드**: Vercel Serverless Function은 요청 본문을 4.5MB로 강제 제한합니다(인프라 레벨이라 `next.config.ts` 설정으로는 우회할 수 없습니다 — [Vercel 공식 문서](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)). 동영상·오디오·큰 문서는 이 한도를 쉽게 넘기므로, 3MB보다 작은 조각으로 나눠 `/api/attachments/chunk`로 순차 전송한 뒤 서버에서 이어 붙입니다(`lib/client-api.ts`의 `uploadFileChunked`). 다운스케일된 이미지처럼 작은 파일은 기존과 동일하게 한 번에 전송합니다.
- 모델 목록은 매 요청마다 NanoGPT API에서 실시간으로 불러오며, 목록이 하드코딩되어 있지 않습니다. 채팅은 `/api/v1/models?detailed=true`, 이미지·영상·음성은 각각 `/api/v1/image-models`·`/api/v1/video-models`·`/api/v1/audio-models?type=tts` 전용 카탈로그를 씁니다(모두 `detailed=true`).
- 첨부 가능 여부와 개수는 위 카탈로그가 공개한 값에서 계산합니다. 단, NanoGPT는 모델마다 메타데이터 수록 정도가 달라서 능력 표시를 **3-상태(지원/미지원/미공개)**로 다룹니다. 카탈로그가 아무 말도 하지 않은 항목(미공개)은 막지 않고 허용합니다 — 미공개를 미지원으로 단정하면 실제로는 첨부가 되는 모델까지 버튼이 잠기기 때문입니다. 지원하지 않는 모델에 첨부를 보내면 API가 오류로 알려 줍니다.
- 무검열 모델은 NanoGPT가 별도 불리언을 주지 않고 모델 이름에 표기하는 경우가 많아(예: `DeepSeek V4 Flash Vision Exp Uncensored`), 플래그가 있으면 플래그를, 없으면 이름·설명·태그에서 판별해 "무검열" 배지를 붙입니다.
- 카탈로그 응답이 기대와 다를 때는 `/api/models?type=text&debug=1`로 원본 응답 샘플과 정규화 결과를 함께 확인할 수 있습니다(`type`은 `text`·`image`·`video`·`tts`). 단, NanoGPT는 채팅 요청당 첨부 "개수" 상한은 공개하지 않고 종류별 가능 여부만 공개하므로, 채팅의 개수 상한만 앱 안전 상한(이미지 10·동영상 3·오디오 3·문서 5)을 씁니다. 이미지 생성의 참조 이미지 장수처럼 문서가 값을 공개하는 항목은 모델 값을 그대로 적용합니다. 자세한 근거는 `lib/attachment-policy.ts` 주석을 참고하세요.
- NanoGPT에는 생성 전 비용을 조회하는 별도의 견적 엔드포인트가 없어, 영상 예상 비용은 모델 카탈로그의 단가를 사용하며 단가를 공개하지 않는 모델에서는 표시되지 않습니다.
