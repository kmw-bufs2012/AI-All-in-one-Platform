# 모델 기능 조사 기록

이 문서는 이미지 생성 모델의 스타일 지원 방식과 영상 생성 모델의 최대 길이·이미지
입력 역할을, **NanoGPT 공식 문서가 아닌** 원 모델 개발사(또는 신뢰할 수 있는 API
제공업체)의 공개 자료를 근거로 정리합니다. `lib/model-capability-overlay.ts`가 이
문서의 결론을 코드로 옮긴 것이며, 이 문서는 그 근거 기록입니다.

## 조사 방법과 한계 (반드시 읽어 주세요)

- 이 세션(Claude Code 샌드박스)의 네트워크 정책은 `docs.nano-gpt.com`뿐 아니라
  대부분의 일반 웹사이트(WebFetch를 통한 직접 접속)를 차단합니다. 시도한 도메인:
  `seed.bytedance.com`, `www.cined.com`, `replicate.com`, `ai.google.dev` — 전부
  `EGRESS_BLOCKED`로 실패했습니다.
- 그래서 이 조사는 **WebSearch(검색 스니펫)에 의존**했습니다. WebSearch 자체는
  동작하며, 여러 개의 독립된 결과가 같은 수치로 수렴하는지 교차 확인하는 방식을
  썼습니다. 이는 조사 원칙 문서(4번 항목, 우선순위 7)가 허용하는 "복수의 독립된
  신뢰 가능한 자료" 방식에 해당하지만, **원 개발사 공식 문서를 직접 열어 읽은
  것보다는 근거 수준이 낮습니다.** 아래 각 항목의 "근거 수준"에 이를 반영했습니다.
- NanoGPT 실시간 카탈로그(`/v1/video-models`, `/v1/image-models`)를 이 세션에서는
  실제 API 키로 조회하지 못했습니다(`NANOGPT_API_KEY` 미보유). 그래서 아래 조사
  결과가 NanoGPT가 실제로 노출하는 모델 ID·파라미터 이름과 정확히 일치하는지는
  **미검증**입니다. `lib/model-capability-overlay.ts`의 매칭 로직은 이름/설명
  텍스트에 느슨하게 매칭하도록 설계했고, 매칭되지 않으면 조용히 무시되어 기존
  (이번 세션에서 고친) 카탈로그 기반 로직으로 폴백합니다.
- **조사 대상은 카탈로그 전체(이미지 ~210개, 영상 ~155개)가 아니라, 사용자가
  요청한 예시와 시장에서 가장 널리 쓰이는 모델 계열로 제한된 우선순위 목록입니다.**
  아래 목록에 없는 모델은 전부 "미확인"이며, 앱은 그런 모델에 대해 임의의 값을
  지어내지 않고 카탈로그가 실제로 공개한 `supported_parameters`만 그대로 노출합니다.

## 영상 생성 — 최대 길이

### ByteDance Seedance 2.5

- **모델 ID/버전**: Seedance 2.5 (ByteDance/Seed팀, 2026년 출시)
- **단일 생성 요청 최대 길이**: **30초** (4~30초 범위, 기본 프롬프트 기반 자동 길이 옵션 있음)
- **연장(extend) 사용 시 누적 최대 길이**: **180초** (다회 연장, 최초 30초 생성 이후 이어붙임 — 새로 스티칭하는 게 아니라 캐릭터·장면 일관성을 유지한 채 연장)
- **참조 입력**: 최대 50개 멀티모달 참조(이미지 최대 30장 + 영상 최대 10개 + 오디오 최대 10개)를 한 요청에 조합 가능
- **비교(이전 버전 Seedance 2.0)**: 단일 생성 최대 15초, 영상 세그먼트 최대 3개까지만 연결 가능
- **이 앱에 적용되는 실제 의미**: 이 앱은 `/generate-video` 단일 생성 요청만 구현되어 있고(연장/스토리보드 API는 미구현) → **이 앱에서 실제로 보장 가능한 최대치는 30초**이며, 180초는 (구현되어 있지 않은) 별도 연장 워크플로 없이는 도달할 수 없습니다. 오버레이에는 `single_request: 30초`만 등록하고 `extend_cumulative: 180초`는 참고용으로만 기록합니다.
- **근거**:
  - [CineD — "ByteDance Seedance 2.5 API Goes Live – 30-Second Single-Shot Clips, 50 Reference Inputs"](https://www.cined.com/bytedance-seedance-2-5-api-goes-live-30-second-single-shot-clips-50-reference-inputs-and-3d-camera-blockouts/) (기술 매체, 확인일 2026-09-08)
  - [reapi.ai — "How Long Can Seedance Videos Be? 2.0 at 15s, 2.5 at 30s"](https://reapi.ai/blog/how-long-can-seedance-videos-be) (API 제공업체 블로그, 확인일 2026-09-08)
  - [Yotta Labs — "Seedance 2.5 vs Seedance 2.0"](https://www.yottalabs.ai/post/seedance-2-5-vs-seedance-2-0-differences-which-to-use-2026) (확인일 2026-09-08)
  - [MindStudio — "Seedance 2.5: 30-Second Video, 4K, and 50 Multimodal References Explained"](https://www.mindstudio.ai/blog/seedance-2-5-features-30-second-video-4k) (확인일 2026-09-08)
  - 위 4개 독립 출처 모두 "단일 생성 30초 / 연장 누적 180초"로 수렴. ByteDance 공식 블로그(seed.bytedance.com) 원문은 접속 차단으로 직접 확인하지 못함.
- **근거 수준**: 중간(복수의 독립된 2차 자료 수렴, 원 개발사 1차 문서 직접 확인은 못함)
- **충돌/모호한 부분**: 없음(모든 자료가 동일한 수치로 수렴)

### Kling AI (Kuaishou)

- **모델 ID/버전**: Kling 1.x~3.0 계열 공통(버전마다 화질·기능 차이는 있으나 길이 상한 값 자체는 동일하게 보고됨)
- **단일 생성 요청 최대 길이**: **10초** (duration 파라미터는 "5" 또는 "10" 두 값만 허용하는 enum, 5초가 기본값). 15초·30초 옵션은 어떤 요금제에서도 존재하지 않음.
- **연장 사용 시 누적 최대 길이**: 여러 번 연장 가능하나 **총합 3분(180초)을 넘을 수 없음**
- **이미지 입력 역할과 실제 요청 필드명**: 시작 프레임은 `image`, 끝 프레임(선택)은 `image_tail` — 즉 "시작+끝 프레임" 쌍을 명시적으로 지원하는 몇 안 되는 모델 계열
- **근거**:
  - [Atlas Cloud — "Kling AI Video Length Limit: Max Duration by Plan 2026"](https://www.atlascloud.ai/blog/tips/kling-ai-video-length-limit) (확인일 2026-09-08)
  - fal.ai의 Kling 관련 API 문서 페이지 다수(예: [Kling Start-End Frame to Video — ComfyUI 문서](https://docs.comfy.org/built-in-nodes/partner-node/video/kwai_vgi/kling-start-end-frame-to-video))가 `image`/`image_tail` 필드명을 일관되게 보고
- **근거 수준**: 중간(길이는 여러 API 리셀러 문서에서 일관되게 확인, 필드명은 ComfyUI 공식 노드 문서 + 여러 API 제공업체 문서에서 확인 — Kuaishou 자체 공식 문서 원문은 미확인)

### Google Veo 3 / 3.1

- **단일 생성 요청 최대 길이**: **8초** (4, 6, 8초 중 선택하는 enum, 8초가 최대). 4K 출력을 선택하면 자동으로 8초로 고정됨(4초·6초 + 4K 조합은 요청 자체가 거부됨)
- **연장 시 누적 최대 길이**: 프레임을 재주입하는 방식의 순차 연장으로 최대 148초까지 확장 가능(별도 파이프라인)
- **이미지 입력**: 이미지/영상으로 조건을 줄 때는 8초로 고정되며, 입력 이미지의 종횡비가 결과 종횡비(16:9 또는 9:16)와 일치해야 함(다르면 요청 실패)
- **근거**:
  - [Google — Gemini API "Generate videos with Veo 3.1" 공식 문서](https://ai.google.dev/gemini-api/docs/veo) (Google 공식 문서, URL은 확인했으나 접속 차단으로 직접 열람은 못하고 검색 스니펫으로만 확인 — **근거 수준 낮춤**)
  - [UlazAI — "How Long Are Veo 3 / Veo 3.1 Videos?"](https://ulazai.com/how-long-veo3-videos/) (확인일 2026-09-08)
- **근거 수준**: 중간(공식 문서 URL은 확인했으나 원문을 직접 열람하지 못해 검색 스니펫에 의존)

### Runway Gen-4

- **단일 생성 요청 최대 길이**: **10초** (5초 또는 10초 중 선택, 720p 기준)
- **근거**: [Apiframe — "Runway API Guide: Pricing & Code (2026)"](https://apiframe.ai/guides/runway-api-guide) 등 API 제공업체 문서(확인일 2026-09-08). Runway 공식 도움말(help.runwayml.com)은 검색 결과에 노출되었으나 직접 열람 못함.
- **근거 수준**: 낮음~중간(2차 자료만 확인, 원 개발사 공식 도움말 직접 열람 못함)

### MiniMax Hailuo 2.3

- **단일 생성 요청 최대 길이**: 해상도에 따라 다름 — **1080p 선택 시 최대 6초, 768p 선택 시 최대 10초** (10초 옵션은 1080p에서 지원 안 됨)
- **근거**: [Runware Docs — MiniMax Hailuo 2.3](https://runware.ai/docs/models/minimax-hailuo-2-3), [fal.ai Hailuo 2.3 API 문서](https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video/api) (확인일 2026-09-08)
- **근거 수준**: 중간(API 제공업체 문서, MiniMax 자체 공식 문서 직접 열람 못함)

### 미확인 (이번 조사 범위 밖)

Hunyuan Video, Wan(Alibaba), PixVerse, Luma Ray, Pika, Adobe Firefly Video 등은
이번 세션에서 시간·네트워크 제약상 조사하지 못했습니다. 오버레이에 포함하지
않았으며, 앱은 이들에 대해 카탈로그의 `supported_parameters`만 그대로 노출합니다
(임의의 최대 길이를 지어내지 않음).

## 이미지 생성 — 스타일

### 구조화된 style 파라미터가 있는 모델

**Ideogram** (Ideogram AI 공식 문서, `docs.ideogram.ai` — URL은 검색으로 확인,
직접 열람은 접속 차단으로 못하고 검색 스니펫에 의존 — 근거 수준: 중간):
- 파라미터명: `style_type`
- 허용값: `AUTO`, `GENERAL`, `REALISTIC`, `DESIGN`, `RENDER_3D`, `ANIME`
- 출처: [docs.ideogram.ai/using-ideogram/ideogram-features/style](https://docs.ideogram.ai/using-ideogram/ideogram-features/style) (확인일 2026-09-08)

**Recraft** (Recraft AI 공식 문서, `recraft.ai/docs` — URL은 검색으로 확인, 근거
수준: 중간):
- 파라미터명: `style`
- 기본 허용값: `realistic_image`(기본값), `digital_illustration`, `vector_illustration`, `icon`, `logo_raster`
- 세부 하위 스타일(하위 문자열 예시, 미확인 전체 목록): `realistic_image/b_and_w`, `realistic_image/hdr`, `digital_illustration/pixel_art`, `digital_illustration/hand_drawn` 등
- 출처: [Recraft — Styles](https://www.recraft.ai/docs/api-reference/styles) (확인일 2026-09-08)

### 구조화된 style 파라미터가 없는(프롬프트 기반) 모델

Flux(Black Forest Labs) 계열과 Stable Diffusion 계열은 별도의 `style` enum
파라미터를 공식 문서에서 확인하지 못했습니다. 이런 모델은 스타일을 프롬프트
문구로 유도하는 방식이 표준적인 사용법으로 알려져 있습니다(예: "in the style of
Japanese anime, cel-shaded" 같은 문구를 프롬프트에 덧붙임). 이번 세션에서는
Flux/Stable Diffusion 공식 문서를 직접 열람하지 못해 "구조화된 파라미터가 없다"는
것을 확정적으로 검증하지는 못했고, **미확인으로 분류**했습니다. 앱은 이 두
모델 계열에 대해 스타일 프리셋 UI를 표시하지 않으며(구조화 파라미터가 있다고
잘못 표시하지 않기 위함), 카탈로그가 실제로 `style` 계열 `supported_parameters`를
공개하면 기존 로직대로 그대로 노출합니다.

### 미확인 (이번 조사 범위 밖)

GPT Image(OpenAI), Grok Imagine, Hunyuan Image, Krea, Imagen(Google) 등 나머지
이미지 모델의 스타일 파라미터는 조사하지 못했습니다.

## 이미지 첨부 역할 (image-to-video)

확인된 역할 구분:
- **시작 프레임(start frame)**: 거의 모든 image-to-video 모델의 기본 입력. NanoGPT 요청에서는 `imageUrl`/`imageDataUrl` 필드로 통용(이 세션 앞선 조사에서 kling-v21-pro 요청 예시로 확인).
- **끝 프레임(end frame)**: Kling 계열이 `image_tail`로 명시 지원(위 근거 참조). 다른 계열은 미확인.
- **다중 참조 이미지(멀티 레퍼런스)**: Seedance 2.5가 최대 30장의 참조 이미지를 지원(위 근거 참조). 역할(캐릭터/스타일/구도 등)이 세분화되어 있는지는 미확인.

캐릭터 참조·스타일 참조·구도 참조·제품 참조·마스크 등 나머지 세분화된 역할은
이번 세션에서 원 개발사 문서로 확인하지 못해 **오버레이에 포함하지 않았습니다.**

## 조사 상태 요약

| 항목 | 상태 |
| --- | --- |
| Seedance 2.5 영상 길이 | 확인 완료(중간 근거 수준, 2차 자료 수렴) |
| Kling 영상 길이·프레임 역할 | 확인 완료(중간 근거 수준) |
| Veo 3 영상 길이 | 확인 완료(중간 근거 수준, 공식 문서 URL만 확인) |
| Runway Gen-4 영상 길이 | 부분 확인(낮은~중간 근거 수준) |
| Hailuo 2.3 영상 길이 | 확인 완료(중간 근거 수준) |
| Ideogram style_type | 확인 완료(중간 근거 수준) |
| Recraft style | 확인 완료(중간 근거 수준) |
| Flux/SD 스타일 파라미터 없음 | 미확인(추정이나 검증 안 됨) |
| 그 외 카탈로그 전체(이미지 ~200여개, 영상 ~150여개) | 미확인 |
| NanoGPT 카탈로그가 위 모델들을 실제로 어떤 ID·파라미터명으로 노출하는지 | 미확인(실 API 키 없음) |

## 재검증이 필요한 다음 단계

1. 실제 `NANOGPT_API_KEY`로 `/v1/video-models?detailed=true`, `/v1/image-models?detailed=true`를 호출해, 위에서 조사한 모델들이 실제로 카탈로그에 어떤 ID로 존재하는지, `supported_parameters`가 이 문서의 조사 결과와 일치하는지 확인.
2. `docs.nano-gpt.com`, `seed.bytedance.com`, `ai.google.dev` 등 이번 세션에서 접속이 막혔던 1차 문서를, 접속 가능한 환경에서 직접 열람해 근거 수준을 "중간"에서 "높음"으로 올리기.
3. 이 문서에 없는 나머지 카탈로그 모델(수백 개)에 대한 조사 확장.
