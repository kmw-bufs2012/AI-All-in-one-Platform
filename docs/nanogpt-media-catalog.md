# NanoGPT 이미지·동영상 모델 입력 한도 (카탈로그 전수 조사)

- 조사 방법: NanoGPT 공개 카탈로그 API `https://nano-gpt.com/api/v1/image-models?detailed=true`(239개),
  `https://nano-gpt.com/api/v1/video-models?detailed=true`(175개)를 2026-09-29에 직접 내려받아 분석했습니다.
- 이미지: `supported_parameters.max_input_images` 와 `supported_parameters.input_image_constraints`
  (`max_items`, `route.max_bytes`, `route.formats`)가 NanoGPT가 실제로 받는 한도입니다. 앱은 이 값을 그대로 씁니다.
  값을 공개하지 않은 모델은 업스케일러·배경 제거·단일 이미지 편집기라 1장으로 둡니다.
- 동영상: 시작 이미지는 `capabilities.image_to_video`, 끝 프레임은 `last_image` 파라미터,
  여러 장 참조는 `reference_images`(이미지 URL 배열 텍스트)입니다. 참조 장수는 파라미터 설명의 "Up to N",
  없으면 원 개발사 공식 한도(Seedance 9장 등)를 씁니다. URL 입력에는 R2 서명 주소(1시간)를 보냅니다.
- 아래 표는 앱의 정규화 코드(`lib/models.ts`, `lib/attachment-policy.ts`)로 계산한 결과입니다.
  카탈로그가 공개한 한도와 앱 적용값의 불일치: 0건.

## 이미지 모델 (참조 이미지 입력을 받는 모델)

| 모델 ID | 이름 | 참조 이미지 최대 | 한 번에 생성 최대 | 이미지 1장 최대 용량 | 상세 설정 |
|---|---|---|---|---|---|
| `qwen-image-2.1/edit` | Qwen Image 2.1 Edit | 10 | 4 | 30MB | 해상도(1k/1.5k/2k), 비율, 프롬프트 자동 보강, 워터마크 |
| `qwen-image-2.1/edit-lora` | Qwen Image 2.1 Edit LoRA | 10 | 4 | 30MB | 해상도(1k/1.5k/2k), 비율, 프롬프트 자동 보강, 워터마크 |
| `anima/text-to-image` | Anima | 1 | 4 | 30MB | 해상도(1k/1.5k), 비율 |
| `anima/text-to-image-lora` | Anima LoRA | 1 | 4 | 30MB | 해상도(1k/1.5k), 비율 |
| `birefnet/v2` | BiRefNet V2 | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `sam3-image` | SAM 3 Image Segmentation | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `bernini-r/edit-image` | Bernini R Edit Image | 1 (미공개→1) | 1 | - | 해상도(auto/1024x1024) |
| `boogu-image/edit` | Boogu Image Edit | 1 | 4 | 30MB | 해상도(1024x1024/1536x1024/1024x1536/2048x2048) |
| `openai/gpt-image-2.5/flare/edit` | GPT Image 2.5 Flare Edit | 16 | 4 | 30MB | 해상도(1k/2k/4k), 비율, 품질, 배경, 파일 형식 |
| `openai/gpt-image-2.5/sunburst/edit` | GPT Image 2.5 Sunburst Edit | 16 | 4 | 30MB | 해상도(1k/2k/4k), 비율, 품질, 배경, 파일 형식 |
| `luma/agent/uni-1/v1` | Luma UNI-1 | 9 | 1 | 30MB | 해상도(3:1/2:1/16:9/3:2/1:1/2:3/9:16/1:2/1:3) |
| `luma/agent/uni-1/v1/max` | Luma UNI-1 Max | 9 | 1 | 30MB | 해상도(3:1/2:1/16:9/3:2/1:1/2:3/9:16/1:2/1:3) |
| `pruna-ai/p-image/edit` | P-Image Edit | 5 | 4 | 30MB | 해상도(auto), 비율 |
| `pruna-ai/p-image/upscale` | P-Image Upscale | 1 | 1 | 30MB | 해상도(1/2/3/4/5/6/7/8) |
| `pruna-ai/p-image/edit-lora` | P-Image Edit LoRA | 5 | 4 | 30MB | 해상도(auto), 비율 |
| `step-image-edit-2` | Step Image Edit 2 | 1 | 1 | 30MB | 해상도(1024x1024/768x1360/896x1184/1360x768/1184x896/auto) |
| `gpt-image-1.5` | GPT Image 1.5 | 16 (미공개→1) | 4 | - | 해상도(1024x1024/1536x1024/1024x1536/auto), 품질, 배경, 파일 형식 |
| `hidream-o1-image` | HiDream O1 Image | 3 | 4 | 30MB | 해상도(2048*2048/2560*1440/1440*2560/2304*1728/1728*2304/2560*1707/1707*2560) |
| `hidream-o1-image-dev` | HiDream O1 Image Dev | 3 | 4 | 30MB | 해상도(2048*2048/2560*1440/1440*2560/2304*1728/1728*2304/2560*1707/1707*2560) |
| `nano-banana-2` | Nano Banana 2 | 14 | 4 | 30MB | 해상도(1k/2k/4k), 비율, 출력 크기 |
| `nano-banana-2-lite` | Nano Banana 2 Lite | 14 | 4 | 30MB | 해상도(1k), 비율 |
| `nano-banana-2-fast` | Nano Banana 2 Fast | 14 | 4 | 30MB | 해상도(2k/4k), 비율, 출력 크기 |
| `nano-banana-pro` | Nano Banana Pro | 10 | 4 | 30MB | 해상도(1k/2k/4k), 비율, 출력 크기 |
| `Cropper` | Crop image | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `seedream-v4` | Seedream 4.0 | 10 | 4 | 30MB | 해상도(2048x2048/1024x1024/1536x1024/1024x1536/3072x2048/2048x3072/4096x2304/2304x4096/4096x4096) |
| `seedream-v4.5` | Seedream 4.5 | 10 | 4 | 30MB | 해상도(1920x1920/2048x2048/2496x1664/1664x2496/3072x2048/2048x3072/3072x2304/2304x3072/4096x2304/2304x4096/4096x4096) |
| `seedream-4.5-alternative` | Seedream 4.5 Alternative | 10 | 4 | 30MB | 해상도(1920x1920/2048x2048/2496x1664/1664x2496/3072x2048/2048x3072/3072x2304/2304x3072/4096x2304/2304x4096/4096x4096) |
| `seedream-v4.5-sequential` | Seedream 4.5 Sequential | 10 | 15 | 30MB | 해상도(2560x1440/1440x2560/1920x1920/3072x2048/2048x3072/4096x2304/2304x4096/4096x4096) |
| `seedream-v5.0-lite` | Seedream 5.0 Lite | 10 | 4 | 30MB | 해상도(2048x2048/2560x1440/1440x2560/3072x2048/2048x3072/4096x2304/2304x4096) |
| `seedream-v5.0-lite-sequential` | Seedream 5.0 Lite Sequential | 10 | 15 | 30MB | 해상도(2560x1440/1440x2560/1920x1920/3072x2048/2048x3072/4096x2304/2304x4096) |
| `bytedance/seedream-v5.0-pro` | Seedream 5.0 Pro | 10 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `bytedance/seedream-v5.0-pro/edit` | Seedream 5.0 Pro Edit | 10 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `seedream-5-alternative` | Seedream 5 Alternative | 3 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `seedream-5-alternative/edit` | Seedream 5 Alternative Edit | 3 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `hunyuan-image-3-instruct` | Hunyuan Image 3 Instruct | 2 | 4 | 30MB | 해상도(1024*1024/1024*1536/1536*1024/768*1024/1024*768/512*512/256*256/auto) |
| `qwen-image-2.0` | Qwen Image 2.0 | 3 | 6 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536/auto), 프롬프트 자동 보강, 워터마크 |
| `qwen-image-2.0-pro` | Qwen Image 2.0 Pro | 3 | 6 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536/auto), 프롬프트 자동 보강, 워터마크 |
| `qwen-image-2.0-pro-2026-03-03` | Qwen Image 2.0 Pro (2026-03-03) | 3 | 6 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536/auto), 프롬프트 자동 보강, 워터마크 |
| `ideogram-v3-remove-text` | Ideogram V3 Remove Text | 1 | 1 | 30MB | 해상도(auto), 스타일, 렌더링 속도, 매직 프롬프트 |
| `wan2.7-image` | WAN 2.7 Image | 9 | 4 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536/2k/auto) |
| `wan2.7-image-pro` | WAN 2.7 Image Pro | 9 | 4 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536/2k/4k/auto) |
| `qwen-image-max-edit` | Qwen Image Max Edit | 6 | 4 | 30MB | 해상도(auto/1024*1024/1280*720/720*1280/1536*1024/1024*1536) |
| `glm-image-edit` | GLM Image Edit | 4 | 4 | 30MB | 해상도(auto/1024*1024/1024*1536/1536*1024/768*1024/1024*768/512*512/256*256) |
| `nano-banana` | Nano Banana | 4 | 4 | 30MB | 해상도(auto), 비율, 출력 크기 |
| `nano-banana-edit` | Nano Banana Edit | 4 | 4 | 30MB | 해상도(auto), 비율, 출력 크기 |
| `riverflow-2-fast` | Riverflow 2 Fast | 4 | 8 | 30MB | 해상도(1024x1024/auto) |
| `riverflow-2-standard` | Riverflow 2 Standard | 4 | 8 | 30MB | 해상도(1024x1024/auto) |
| `prunaai:1@1` | P-Image | 1 (미공개→1) | 4 | - | 해상도(1024x1024/1376x768/1184x896/1248x832/896x1184/832x1248/768x1376/auto) |
| `gpt-image-1` | GPT 4o Image | 4 | 4 | 30MB | 해상도(1024x1024/1536x1024/1024x1536/auto), 품질, 배경, 파일 형식 |
| `microsoft/mai-image-2.6` | MAI-Image-2.6 | 1 | 4 | 30MB | 해상도(1024x1024/1152x864/864x1152/1536x1024/1024x1536/1536x864/864x1536/1536x1536) |
| `microsoft/mai-image-2.6-flash` | MAI-Image-2.6 Flash | 1 | 4 | 30MB | 해상도(1024x1024/1152x864/864x1152/1536x1024/1024x1536/1536x864/864x1536/1536x1536) |
| `microsoft/mai-image-2.5/edit` | MAI-Image-2.5 Edit | 1 | 1 | 30MB | 해상도(auto/1:1/16:9/9:16/4:3/3:4/3:2/2:3) |
| `gpt-image-2` | GPT Image 2 | 4 | 4 | 30MB | 해상도(1024x1024/1024x768/1024x1536/1536x1024/1152x2048/2048x1152/2560x1440), 품질, 배경, 파일 형식 |
| `riverflow-2.0-pro` | Riverflow 2.0 Pro | 10 | 4 | 30MB | 해상도(1k/2k/4k), 비율 |
| `vosr2/image` | VOSR2 Image Upscaler | 1 | 1 | 30MB | 해상도(2k/4k) |
| `seedvr2-image` | SeedVR2 Image Upscaler | 1 (미공개→1) | 1 | - | 해상도(2k/4k/8k) |
| `clarity-ai-crystal-upscaler` | Clarity AI Crystal Upscaler | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `clarity-ai-pro-upscaler` | Clarity AI Pro Upscaler | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `clarity-ai-flux-upscaler` | Clarity AI Flux Upscaler | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `clarity-ai-creative-upscaler` | Clarity AI Creative Upscaler | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `nano-banana-pro-edit` | Nano Banana Pro Edit | 10 | 10 | 30MB | 해상도(1k/2k/4k), 비율, 출력 크기 |
| `nano-banana-pro-edit-ultra` | Nano Banana Pro Ultra Edit | 10 | 10 | 30MB | 해상도(4k/8k), 비율, 출력 크기 |
| `reve-image-to-image` | ReVE Image-to-Image | 1 | 1 | 30MB | 해상도(auto) |
| `minimax-h3/image-edit` | MiniMax H3 Image Edit | 9 | 4 | 30MB | 해상도(1k/2k), 비율, 프롬프트 최적화 |
| `minimax-image-01` | MiniMax Image-01 | 1 (미공개→1) | 9 | - | 해상도(1024*1024/1280*720/1152*864/1248*832/832*1248/864*1152/720*1280/1344*576/auto), 프롬프트 최적화 |
| `bria-fibo` | Bria Fibo | 1 | 1 | 30MB | 해상도(1:1/16:9/9:16/4:5/3:2) |
| `bria-fibo-edit` | Bria Fibo Edit | 1 | 1 | 30MB | 해상도(auto) |
| `bria/fibo-generate-1.5/text-to-image` | Bria FIBO Generate 1.5 | 4 | 1 | 30MB | 해상도(1mp/4mp), 비율 |
| `bria/fibo-edit-1.5/edit` | Bria FIBO Edit 1.5 | 4 | 1 | 30MB | 해상도(auto/1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9), 비율 |
| `bria/product-holding` | Bria Product Holding | 4 | 1 | 30MB | 해상도(auto/1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9) |
| `bria/virtual-try-on` | Bria Virtual Try-On | 4 | 1 | 30MB | 해상도(auto/1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9) |
| `flux-2-turbo` | FLUX.2 [turbo] | 4 | 4 | 30MB | 해상도(1024*1024/1280*720/720*1280/1536*1024/1024*1536), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-turbo-image-to-image` | FLUX.2 [turbo] Edit | 4 | 4 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-flash-image-to-image` | FLUX.2 [flash] Edit | 4 | 4 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `krea-v2/turbo` | Krea 2 Turbo | 1 | 4 | 30MB | 해상도(1k/2k), 비율 |
| `krea-v2/turbo-lora` | Krea 2 Turbo LoRA | 1 | 4 | 30MB | 해상도(1k/2k), 비율 |
| `krea-v2-large/text-to-image` | Krea 2 Large | 10 | 4 | 30MB | 해상도(1:1/4:3/3:2/16:9/2.35:1/4:5/2:3/9:16) |
| `krea-v2-medium/text-to-image` | Krea 2 Medium | 10 | 4 | 30MB | 해상도(1:1/4:3/3:4/16:9/9:16) |
| `krea-v2-medium-turbo/text-to-image` | Krea 2 Medium Turbo | 10 | 4 | 30MB | 해상도(1:1/4:3/3:2/16:9/2.35:1/4:5/2:3/9:16) |
| `flux-2-klein-base-4b/edit` | FLUX.2 [klein] Base 4B Edit | 3 | 1 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-klein-base-4b/edit-lora` | FLUX.2 [klein] Base 4B Edit LoRA | 3 | 1 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-klein-base-9b/edit` | FLUX.2 [klein] Base 9B Edit | 3 | 1 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-klein-base-9b/edit-lora` | FLUX.2 [klein] Base 9B Edit LoRA | 3 | 1 | 30MB | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-dev-image-to-image` | FLUX.2 [dev] Edit | 8 (미공개→1) | 1 | - | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-dev-lora-image-to-image` | FLUX.2 [dev] LoRA Edit | 8 (미공개→1) | 1 | - | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-flex-image-to-image` | FLUX.2 [flex] Edit | 8 (미공개→1) | 1 | - | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-pro-image-to-image` | FLUX.2 [pro] Edit | 8 (미공개→1) | 1 | - | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `flux-2-max-image-to-image` | FLUX.2 [max] Edit | 8 (미공개→1) | 1 | - | 해상도(auto), 안전 필터 허용도, 파일 형식, 프롬프트 확장, 시드 |
| `z-image-base` | Z Image Base | 1 | 1 | 30MB | 해상도(1024*1024/1024*768/768*1024/1024*576/576*1024/768*768/512*512/256*256) |
| `z-image-turbo-image-to-image` | Z Image Turbo Image-to-Image | 1 (미공개→1) | 1 | - | 해상도(256*256/512*512/768*768/1024*1024/1280*720/720*1280/1536*1024/1024*1536/1536*1536) |
| `kling-image-o1` | Kling Image O1 | 10 | 10 | 30MB | 해상도(1k/2k), 비율 |
| `vidu-q2` | Vidu Q2 | 7 | 1 | 30MB | 해상도(1080p/2K/4K), 비율 |
| `vidu-q2-reference` | Vidu Q2 Reference | 7 | 7 | 30MB | 해상도(1080p/2K/4K), 비율 |
| `longcat-image-edit` | Longcat Image Edit | 1 (미공개→1) | 1 | - | 해상도(auto) |
| `wan-2.6-image-edit` | WAN 2.6 Image Edit | 3 | 3 | 30MB | 해상도(auto) |
| `meta/muse-image/text-to-image` | Muse Image | 10 | 10 | 30MB | 해상도(1:1/21:9/16:9/4:3/3:2/2:3/3:4/9:16/9:21) |
| `meta/muse-image/edit` | Muse Image Edit | 10 | 10 | 30MB | 해상도(auto/21:9/16:9/4:3/3:2/1:1/2:3/3:4/9:16/9:21) |
| `bytedance/seedream/v5/pro/text-to-image` | Seedream 5.0 Pro | 10 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `bytedance/seedream/v5/pro/edit` | Seedream 5.0 Pro Edit | 10 | 4 | 30MB | 해상도(1:1/16:9/9:16/3:2/2:3/4:3/3:4/1k/2k) |
| `bytedance/seedream-v5.0-flash` | Seedream 5.0 Flash | 10 | 4 | 30MB | 해상도(2k/1.5k/1k), 비율 |
| `bytedance/seedream-v5.0-flash/edit` | Seedream 5.0 Flash Edit | 10 | 4 | 30MB | 해상도(2k/1.5k/1k), 비율 |
| `bytedance/seedream/v5/flash/layerize` | Seedream 5.0 Flash Layerize | 1 | 1 | 30MB | 해상도(auto/auto_1K/auto_1.5K/auto_2K) |
| `qwen-image` | Qwen Image | 3 | 4 | 30MB | 해상도(auto/1024x1024/512x512/768x1024/576x1024/1024x768/1024x576) |
| `qwen-image-3` | Qwen Image 3 | 3 | 4 | 30MB | 해상도(1k/2k), 비율, 프롬프트 자동 보강, 워터마크 |
| `qwen-image-3-pro` | Qwen Image 3 Pro | 3 | 4 | 30MB | 해상도(1k/2k), 비율, 프롬프트 자동 보강, 워터마크 |
| `runwayml-gen4-image` | Runway Gen-4 Image | 3 | 3 | 30MB | 해상도(1080p/720p), 비율 |
| `flux-kontext` | Flux Kontext | 1 (미공개→1) | 4 | - | 해상도(auto/1344x640/1024x576/1024x768/1536x1024/1024x1024/1024x1536/768x1024/576x1024/640x1344) |
| `runware:106@1` | Flux Kontext Dev | 1 (미공개→1) | 20 | - | 해상도(auto/1024x1024/1568x672/1504x688/1456x720/1392x752/1328x800/1248x832/1184x880/1104x944/944x1104/880x1184/832x1248/800x1328/752x1392/720x1456/688x1504/672x1568) |
| `runware:107@1` | Flux 1 Krea Dev | 1 (미공개→1) | 20 | - | 해상도(auto/1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `Upscaler` | Upscaler | 1 (미공개→1) | 1 | - | 해상도(1024x1024) |
| `recraft-ai/recraft-v4-style-pro/text-to-image` | Recraft V4 Style Pro | 10 | 8 | 30MB | 해상도(2048x2048/2048x1536/2048x1152/1536x2048/1152x2048), 스타일 |
| `recraft-ai/recraft-v4-style-pro/text-to-vector` | Recraft V4 Style Pro Vector | 10 | 8 | 30MB | 해상도(2048x2048/2048x1536/2048x1152/1536x2048/1152x2048), 스타일 |
| `recraft-ai/recraft-v4-style/text-to-image` | Recraft V4 Style | 10 | 8 | 30MB | 해상도(1024x1024/1024x768/1024x576/768x1024/576x1024), 스타일 |
| `recraft-ai/recraft-v4-style/text-to-vector` | Recraft V4 Style Vector | 10 | 8 | 30MB | 해상도(1024x1024/1024x768/1024x576/768x1024/576x1024), 스타일 |
| `gemini-flash-edit` | Gemini Image Edit  | 14 (미공개→1) | 1 | - | 해상도(auto) |
| `SDXL-ArliMix-v1` | SDXL ArliMix V1 | 1 (미공개→1) | 2 | - | 해상도(512x512/768x768/1024x1024/1408x1408/576x1024/1024x576/768x1024/1024x768) |
| `bagel` | BAGEL | 1 (미공개→1) | 1 | - | 해상도(1024x1024) |
| `grok-imagine-image` | Grok Imagine Image | 3 | 4 | 30MB | 해상도(2:1/20:9/19.5:9/16:9/4:3/3:2/1:1/2:3/3:4/9:16/9:19.5/9:20/1:2), 비율 |
| `xai/grok-imagine-image/quality/text-to-image` | Grok Imagine Image Quality | 3 (미공개→1) | 4 | - | 해상도(2:1/20:9/19.5:9/16:9/4:3/3:2/1:1/2:3/3:4/9:16/9:19.5/9:20/1:2), 비율 |
| `xai/grok-imagine-image/quality/edit` | Grok Imagine Image Quality Edit | 1 | 4 | 30MB | 해상도(auto/2:1/20:9/19.5:9/16:9/4:3/3:2/1:1/2:3/3:4/9:16/9:19.5/9:20/1:2), 비율 |
| `xai/grok-imagine-image/v2.0/edit` | Grok Imagine Image 2.0 Edit | 3 | 4 | 30MB | 해상도(auto/2:1/20:9/19.5:9/16:9/4:3/3:2/1:1/2:3/3:4/9:16/9:19.5/9:20/1:2), 비율 |
| `imagineart/imagineart-2.0-edit-preview/image-to-image` | ImagineArt 2.0 Edit Preview | 4 | 1 | 30MB | 해상도(auto/1:1/9:16/16:9/3:2/2:3/4:3/3:4/4:5/5:4/3:1/1:3/21:9) |
| `flux-lora/inpainting` | Flux LoRA Inpainting | 1 (미공개→1) | 1 | - | 해상도(1024x1024/1024x768/1024x576/768x1024/576x1024/1344x640/640x1344/1536x512/512x1536) |
| `ghiblify` | Ghiblify | 1 (미공개→1) | 1 | - | 해상도(1024x1024) |
| `background-remover` | Background Remover | 1 (미공개→1) | 1 | - | 해상도(1024x1024) |
| `flux-pro/v1/vto` | FLUX Virtual Try-On | 2 | 1 | 30MB | 해상도(auto) |
| `hidream-e1-1` | HiDream Edit 1.1 | 1 (미공개→1) | 4 | - | 해상도(auto) |
| `flux-dev-image-to-image` | Flux Dev | 1 (미공개→1) | 1 | - | 해상도(1024x1024/1024x768/1024x576/768x1024/576x1024) |
| `juggernaut-z` | Juggernaut Z | 1 | 4 | 30MB | 해상도(1024x1024/1024x768/768x1024/1216x832/832x1216/1344x768/768x1344/1536x1024/1024x1536/auto) |
| `gpt-4o-image` | GPT 4o Image (old) | 8 | 8 | 30MB | 해상도(1024x1024) |
| `pixelwave` | PixelWave | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `atomix-xl` | Atomix XL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `cyberrealistic-pony-v9` | CyberRealistic Pony v9.0 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `cyberrealistic-xl` | CyberRealistic XL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `crystal-clear-xlightning` | Crystal Clear Lightning v1.0 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `2dn-pony-v2` | 2DN Pony v2 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `miusmius-xl` | Flux Artfusion | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `aniflatmix-anime` | RealVisXL V5.0 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `animagine-xl-31` | Crystal Clear XL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `aniflatmix-anime-sfwnsfw` | RealVisXL V4.0 Lightning | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `infinite-illustrious` | Prefect Pony XL V4.0 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `stable-diffusion-xl-turbo` | Fluently XL V3 Lightning | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `hassaku-hentai` | Moxie Diffusion XL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `nsfw-gen-illustrious` | Animagine XL 4.0 | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `artiwaifu-diffusion` | Juggernaut XL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `wai-illustrious-sdxl` | WAI Illustrious SDXL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `crystal-clear-xl` | Zuki Anime ILL | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `realpony-xl` | RealVisXL V5.0 BakedVae | 1 | 20 | 30MB | 해상도(1024x1024/1920x1088/1088x1920/768x1024/1024x768/1408x1024/1024x1408/512x512/2048x2048) |
| `custom-civitai` | Custom CivitAI | 1 | 4 | 30MB | 해상도(1024x1024/1024x768/768x1024/512x512/1920x1088/1088x1920) |
| `persona:376130@2456367` | Nova Anime XL | 1 | 20 | 30MB | 해상도(1024x1024/1216x832/832x1216/1920x1088/1088x1920/768x1024/1024x768/512x512) |

## 동영상 모델 (이미지 입력)

| 모델 ID | 이름 | 시작 이미지 | 끝 프레임 | 참조 이미지 최대 | 상세 설정 |
|---|---|---|---|---|---|
| `minimax/h3-max/multi-angle/image-to-video` | MiniMax H3 Max Multi Angle | 1장 | - | - | 해상도, 길이(초), camera_motion, prompt_expansion_mode |
| `minimax-h3-singularity/image-to-video` | MiniMax H3 Singularity Image-to-Video | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초) |
| `minimax-h3-singularity/image-to-video-lora` | MiniMax H3 Singularity Image-to-Video LoRA | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초) |
| `minimax-h3/reference-to-video` | MiniMax H3 Reference-to-Video | 1장 | - | 9장 | 해상도, 길이(초), 비율 |
| `infinitetalk` | InfiniteTalk | 1장 | - | - | people, 해상도, order |
| `minimax/h3-max/lip-sync/image-to-video` | MiniMax H3 Max Lip Sync | 1장 | - | - | 해상도, enable_transcription, 시드 |
| `bytedance/seedance-2.5/talking-avatar` | Seedance 2.5 Talking Avatar | 1장 | - | - | 해상도 |
| `bytedance/seedance-2.5` | Seedance 2.5 | 1장 | - | - | 생성 방식, 해상도, 길이(초), 비율, 오디오 생성 |
| `bytedance/seedance-2.5-turbo` | Seedance 2.5 Turbo | 1장 | - | - | 해상도, 길이(초), 비율, 오디오 생성 |
| `bytedance/seedance-2.5-spicy` | Seedance 2.5 Spicy | 1장 | - | - | 해상도, 길이(초), 오디오 생성, 시드 |
| `luma/agent/ray/v3.2` | Luma Ray 3.2 | 1장 | - | 4장 | 길이(초), 해상도, 비율, 반복 재생 |
| `google/gemini-omni-flash` | Gemini Omni Flash | 1장 | - | - | 길이(초), 비율 |
| `google/gemini-omni-flash/v1.1` | Gemini Omni Flash 1.1 | 1장 | - | - | 길이(초), 해상도, 비율 |
| `pruna-ai/p-video-2-pro/image-to-video` | P-Video 2 Pro Image-to-Video | 1장 | - | - | 생성 방식, prompt_upsampler, 길이(초), 해상도 |
| `pruna-ai/p-video-2/image-to-video` | P-Video 2 Image-to-Video | 1장 | - | - | draft, 프롬프트 확장, 길이(초), 해상도, save_audio |
| `pruna-ai/p-video/image-to-video` | P-Video Image-to-Video | 1장 | - | - | 길이(초), 해상도, save_audio |
| `pruna-ai/p-video/animate` | P-Video Animate | 1장 | - | - | 해상도, 프레임레이트, save_audio |
| `pruna-ai/p-video/avatar` | P-Video Avatar | 1장 | - | - | 해상도 |
| `pruna-ai/p-video/edit` | P-Video Edit | 1장 | - | - | draft, 프롬프트 확장, save_audio |
| `kling-v26-pro` | Kling 2.6 Pro | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, sound |
| `kling-v26-std` | Kling 2.6 Standard | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율 |
| `kling-v30-std` | Kling 3.0 Standard | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, sound, CFG 스케일(프롬프트 반영 강도) |
| `kling-v30-pro` | Kling 3.0 Pro | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, sound, CFG 스케일(프롬프트 반영 강도) |
| `kling-v26-std-motion-control` | Kling 2.6 Std Motion Control | 1장 | 1장 (`image_tail`) | - | 길이(초), character_orientation, 원본 소리 유지 |
| `kling-v30-std-motion-control` | Kling 3.0 Standard Motion Control | 1장 | 1장 (`image_tail`) | - | 길이(초), character_orientation, 원본 소리 유지 |
| `kling-v30-pro-motion-control` | Kling 3.0 Pro Motion Control | 1장 | 1장 (`image_tail`) | - | 길이(초), character_orientation, 원본 소리 유지 |
| `sora-2` | Sora 2 | 1장 | - | - | 프로 모드(고품질·2배 비용), 해상도, 화면 방향, 길이(초) |
| `grok-imagine-video` | Grok Imagine Video | 1장 | - | - | 길이(초), 비율, 해상도 |
| `xai/grok-imagine-video/v1.5/image-to-video` | Grok Imagine Video 1.5 | 1장 | - | 7장 | 생성 방식, 길이(초), 해상도, 비율 |
| `nvidia/cosmos-3-super/image-to-video` | Cosmos 3 Super Image-to-Video | 1장 | - | - | 길이(초), 해상도, 비율, 프롬프트 자동 확장, 안전 검사 |
| `grok-imagine-video-reference-to-video` | Grok Imagine Reference to Video | 1장 | - | - | 길이(초), 비율, 해상도 |
| `veo3-video` | Veo 3 | 1장 | - | - | 오디오 생성, 비율, 프롬프트 보강, 해상도 |
| `wan-25` | Wan 2.5 | 1장 | - | - | 해상도, 화면 방향, 길이(초), 프롬프트 자동 확장 |
| `wan-26` | Wan 2.6 | 1장 | - | - | 해상도, 화면 방향, 길이(초), shot_type, 프롬프트 자동 확장 |
| `wan-2.7-video` | Wan 2.7 Video | 1장 | - | - | 생성 방식, 해상도, 비율, 길이(초), 프롬프트 자동 확장 |
| `alibaba/wan-3.0-prime` | Wan 3.0 Prime | 1장 | - | - | 생성 방식, 해상도, 비율, 길이(초), thinking_mode, 오디오 생성, 시드 |
| `alibaba/wan-3.0/image-to-video` | Wan 3.0 Image-to-Video | 1장 | - | - | 해상도, 비율, 길이(초), thinking_mode, 오디오 생성, 시드 |
| `alibaba/wan-3.0/image-to-video-spicy` | Wan 3.0 Spicy Image-to-Video | 1장 | - | - | 해상도, 비율, 길이(초), 오디오 생성, 프롬프트 자동 확장, 시드 |
| `alibaba/wan-3.0-prime/image-to-video-spicy` | Wan 3.0 Prime Spicy Image-to-Video | 1장 | - | - | 해상도, 비율, 길이(초), 오디오 생성, 프롬프트 자동 확장, 시드 |
| `alibaba/wan-3.0/reference-to-video` | Wan 3.0 Reference-to-Video | 1장 | - | - | 해상도, 비율, 길이(초), thinking_mode, 오디오 생성, 시드 |
| `alibaba/wan-2.7/image-to-video-pro` | Wan 2.7 Image-to-Video Pro | 1장 | - | - | 해상도, 길이(초), shot_type, 프롬프트 자동 확장, 시드 |
| `alibaba/wan-2.7/image-to-video-spicy` | Wan 2.7 Image-to-Video Spicy | 1장 | - | - | 해상도, 길이(초), shot_type, 프롬프트 자동 확장, 시드 |
| `happyhorse-1.0` | HappyHorse 1.0 | 1장 | - | - | 생성 방식, 해상도, 비율, 길이(초), 프롬프트 자동 확장 |
| `happyhorse-1.1` | HappyHorse 1.1 | 1장 | - | - | 생성 방식, 해상도, 비율, 길이(초), 프롬프트 자동 확장 |
| `wan-26-flash` | Wan 2.6 Flash | 1장 | - | - | 해상도, 길이(초), shot_type, 오디오 생성, 프롬프트 자동 확장 |
| `wan-26-image-to-video-pro` | Wan 2.6 Image-to-Video Pro | 1장 | - | - | 해상도, 길이(초), shot_type, 프롬프트 자동 확장 |
| `wan-26-reference-to-video-flash` | Wan 2.6 Reference-to-Video Flash | 1장 | - | - | 해상도, 화면 방향, 길이(초), shot_type, 오디오 생성, 프롬프트 자동 확장 |
| `skywork-ai/skyreels-v4` | SkyReels V4 | 1장 | - | - | 해상도, 비율, 길이(초), 생성 방식, sound |
| `veo3-fast-video` | Veo 3 Fast | 1장 | - | - | 오디오 생성, 비율, 프롬프트 보강, 해상도 |
| `veo3-1-video` | Veo 3.1 | 1장 | - | - | 오디오 생성, 비율, 해상도, 길이(초) |
| `veo3-1-fast-video` | Veo 3.1 Fast | 1장 | - | - | 오디오 생성, 비율, 해상도, 길이(초) |
| `veo3-1-lite-video` | Veo 3.1 Lite | 1장 | - | - | 비율, 해상도, 길이(초) |
| `minimax-hailuo-02-pro` | MiniMax Hailuo 02 Pro | 1장 | - | - | 길이(초), 프롬프트 최적화 |
| `minimax-hailuo-23-standard` | MiniMax Hailuo 2.3 Standard | 1장 | - | - | 길이(초), 프롬프트 자동 확장 |
| `minimax-hailuo-23-pro` | MiniMax Hailuo 2.3 Pro | 1장 | - | - | 프롬프트 자동 확장 |
| `minimax/h3-max-turbo` | MiniMax H3 Max Turbo | 1장 | - | - | 길이(초), 해상도, 비율, prompt_expansion_mode, 안전 검사, 시드 |
| `minimax/h3-max` | MiniMax H3 Max | 1장 | - | 4장 | 생성 방식, 길이(초), 해상도, 비율, prompt_expansion_mode, 안전 검사 |
| `minimax-h3` | MiniMax H3 | 1장 | - | 4장 | 생성 방식, 길이(초), 비율, 해상도, 오디오 생성 |
| `minimax-h3/image-to-video-spicy` | MiniMax H3 Spicy Image-to-Video | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초) |
| `seedance-video` | Seedance 1.0 Pro | 1장 | - | - | 해상도, 길이(초), 비율, 카메라 고정 |
| `kling-v21-master` | Kling 2.1 Master | 1장 | 1장 (`image_tail`) | - | 길이(초), 해상도 |
| `wan-video-22` | Wan 2.2 14b | 1장 | - | - | 해상도, 화면 방향, 길이(초) |
| `wan-s2v` | Wan 2.2 S2V | 1장 | - | - | 해상도 |
| `kling-lipsync-t2v` | Kling Lipsync T2V | - | 1장 (`image_tail`) | - | voice_id, voice_language, voice_speed |
| `kling-lipsync-a2v` | Kling Lipsync A2V | - | 1장 (`image_tail`) | - | - |
| `kling-v2-avatar-standard` | Kling V2 Avatar (Standard) | 1장 | 1장 (`image_tail`) | - | - |
| `kling-v2-avatar-pro` | Kling V2 Avatar (Pro) | 1장 | 1장 (`image_tail`) | - | - |
| `veed-fabric-1.0` | VEED Fabric 1.0 | 1장 | - | - | 해상도 |
| `longcat-avatar` | LongCat Avatar | 1장 | - | - | 해상도 |
| `longcat-avatar-1.5` | LongCat Avatar 1.5 | 1장 | - | - | 해상도 |
| `longcat-avatar-1.5/multi` | LongCat Avatar 1.5 Multi | 1장 | - | - | 해상도, order |
| `music-video-generator` | Music Video Generator | 1장 | - | - | 해상도, 비율 |
| `bytedance-avatar-omni-human-1.5` | Avatar Omni Human 1.5 | 1장 | - | - | - |
| `wan-22-plus` | Wan 2.2 Plus | 1장 | - | - | 해상도, 화면 방향, 길이(초), 프롬프트 자동 확장 |
| `wan-22-spicy` | Wan 2.2 Spicy | 1장 | - | - | 해상도, 길이(초) |
| `bytedance-waver-1.0` | Bytedance Waver 1.0 | 1장 | - | - | 길이(초) |
| `bytedance-seedance-v1-pro-fast` | SeeDance V1 Pro Fast | 1장 | - | - | 해상도, 길이(초), 비율, 카메라 고정 |
| `bytedance-seedance-2-0` | Seedance 2.0 Turbo | 1장 | 1장 (`last_image`) | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-2-0-fast` | Seedance 2.0 Fast Turbo | 1장 | 1장 (`last_image`) | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance/seedance-2.0/image-to-video-spicy` | Seedance 2.0 Spicy Image-to-Video | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초), 비율, 오디오 생성, 시드 |
| `bytedance/seedance-2.0-fast/image-to-video-spicy` | Seedance 2.0 Fast Spicy Image-to-Video | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초), 비율, 오디오 생성, 시드 |
| `bytedance-seedance-2-0-video-extend` | Seedance 2.0 Video Extend | - | 1장 (`last_image`) | - | 해상도, 길이(초), 웹 검색 반영 |
| `bytedance-seedance-2-0-fast-video-extend` | Seedance 2.0 Fast Video Extend | - | 1장 (`last_image`) | - | 해상도, 길이(초), 웹 검색 반영 |
| `bytedance-seedance-2-0-video-edit` | Seedance 2.0 Video Edit | - | - | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-2-0-video-edit-turbo` | Seedance 2.0 Video Edit Turbo | - | - | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-2-0-fast-video-edit` | Seedance 2.0 Fast Video Edit | - | - | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-2-0-fast-video-edit-turbo` | Seedance 2.0 Fast Video Edit Turbo | - | - | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-2-0-mini` | Seedance 2.0 Mini | 1장 | 1장 (`last_image`) | 9장 | variant, 해상도, 길이(초), 비율, 오디오 생성, 웹 검색 반영 |
| `bytedance/seedance-2.0-mini/image-to-video-spicy` | Seedance 2.0 Mini Spicy Image-to-Video | 1장 | 1장 (`last_image`) | - | 해상도, 길이(초), 비율, 오디오 생성, 시드 |
| `bytedance-seedance-2-0-mini-video-extend` | Seedance 2.0 Mini Video Extend | - | 1장 (`last_image`) | - | 해상도, 길이(초), 웹 검색 반영 |
| `bytedance-seedance-2-0-mini-video-edit` | Seedance 2.0 Mini Video Edit | - | - | 9장 | variant, 해상도, 길이(초), 비율, 웹 검색 반영 |
| `doubao-seedance-2-0` | Seedance 2.0 | 1장 | 1장 (`last_image`) | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `doubao-seedance-2-0-fast` | Seedance 2.0 Fast | 1장 | 1장 (`last_image`) | 9장 | 해상도, 길이(초), 비율, 웹 검색 반영 |
| `bytedance-seedance-v1.5-pro` | Seedance 1.5 Pro | 1장 | - | - | 해상도, 길이(초), 비율, 오디오 생성, 카메라 고정 |
| `bytedance-seedance-v1.5-pro-fast` | Seedance 1.5 Pro Fast | 1장 | - | - | 해상도, 길이(초), 비율, 오디오 생성, 카메라 고정 |
| `kling-v25-turbo-pro` | Kling 2.5 Turbo Pro | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율 |
| `kling-v25-turbo-std` | Kling 2.5 Turbo Standard | 1장 | 1장 (`image_tail`) | - | 길이(초) |
| `wan-video-22-5b` | Wan 2.2 5b | 1장 | - | - | 해상도, 프레임 수, frames_per_second, 비율, 프롬프트 자동 확장, interpolator_model, 추론 스텝 수, 안전 검사, 가이던스 스케일(프롬프트 반영 강도), shift, num_interpolated_frames, adjust_fps_for_interpolation |
| `wan-video-22-turbo` | Wan 2.2 Turbo | 1장 | - | - | 해상도, 비율, 프롬프트 자동 확장, 안전 검사 |
| `ltx-2.3-quality` | LTX-2.3 Quality | 1장 | - | - | 생성 방식, 해상도, 길이(초), frames_per_second, 오디오 생성, lora_scale_1, lora_scale_2, lora_scale_3, extend_mode |
| `lightricks/ltx-2.5/fast` | LTX-2.5 Fast | 1장 | - | - | 오디오 생성, 해상도, 길이(초), 프레임레이트, 비율, camera_motion, 가이던스 스케일(프롬프트 반영 강도) |
| `lightricks/ltx-2.5/pro` | LTX-2.5 Pro | 1장 | - | - | 오디오 생성, 해상도, 길이(초), 프레임레이트, 비율, camera_motion, 가이던스 스케일(프롬프트 반영 강도) |
| `flux-3` | FLUX.3 | 1장 | - | - | 품질, 해상도, 길이(초), 비율, 오디오 생성 |
| `ltx-2.3-spicy/image-to-video` | LTX-2.3 Spicy Image-to-Video | 1장 | - | - | 해상도, 길이(초), 시드 |
| `ltx-2.3-spicy/image-to-video-lora` | LTX-2.3 Spicy LoRA Image-to-Video | 1장 | - | - | preset, 해상도, 길이(초), 시드 |
| `wan-22-animate` | Wan 2.2 Animate | 1장 | - | - | 해상도, 생성 방식 |
| `wan-22-animate-2` | Wan 2.2 Animate 2 | 1장 | - | - | 해상도 |
| `lightricks-ltx-2-fast` | Lightricks LTX-2 Fast | 1장 | - | - | 오디오 생성, 길이(초) |
| `lightricks-ltx-2-pro` | Lightricks LTX-2 Pro | 1장 | - | - | 오디오 생성, 길이(초) |
| `ltx-2-19b` | LTX-2 19B | 1장 | - | - | 해상도, 비율, 길이(초), lora_scale_1, lora_scale_2, lora_scale_3 |
| `vidu-video` | Vidu Q1 | 1장 | - | - | 스타일, 움직임 강도, 길이(초), 해상도·비율 |
| `vidu-q3` | Vidu Q3 | 1장 | - | - | 스타일, 해상도, 길이(초), 비율, 움직임 강도, 오디오 생성, bgm |
| `vidu-q3-pro` | Vidu Q3 Pro | 1장 | - | - | 스타일, 해상도, 길이(초), 움직임 강도, 오디오 생성, bgm |
| `pixverse-v45` | Pixverse v4.5 | 1장 | - | - | 해상도·비율, 길이(초), 특수 효과, 효과 종류, 카메라 움직임, 스타일, 움직임 속도, 효과음 생성 |
| `pixverse-v5` | Pixverse v5 | 1장 | - | - | 해상도·비율, 길이(초), 특수 효과 |
| `runway-gen-45` | Runway Gen-4.5 | 1장 | - | - | 해상도, 길이(초), publicFigureThreshold |
| `bernini-r-video` | Bernini R Video | 1장 | - | - | 길이(초) |
| `pixverse-c1` | PixVerse C1 | 1장 | - | - | 해상도, 비율, 길이(초), 오디오 생성 |
| `pixverse-v6` | Pixverse v6 | 1장 | - | - | 해상도, 비율, 길이(초), thinking_type, 오디오 생성 |
| `pixverse/motion-control/mimic` | PixVerse Motion Control Mimic | 1장 | - | - | 해상도 |
| `pixverse-v56` | Pixverse v5.6 | 1장 | - | - | 해상도, resolution_ratio, 길이(초), thinking_type, 오디오 생성 |
| `pixverse-v55` | Pixverse v5.5 | 1장 | - | - | 해상도, resolution_ratio, 길이(초), thinking_type, 오디오 생성 |
| `pixverse-v55-effects` | Pixverse v5.5 Effects | 1장 | - | - | 특수 효과, 해상도, 길이(초), thinking_type |
| `seedance-lite-video` | Seedance 1.0 Lite | 1장 | - | - | 해상도, 길이(초), 비율, 카메라 고정 |
| `kling-video-v2` | Kling 2.0 Master | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, CFG 스케일(프롬프트 반영 강도) |
| `kling-v21-standard` | Kling 2.1 Standard | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, CFG 스케일(프롬프트 반영 강도) |
| `kling-v21-pro` | Kling 2.1 Pro | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, CFG 스케일(프롬프트 반영 강도) |
| `minimax-hailuo-02` | MiniMax Hailuo 02 | 1장 | - | - | 길이(초), 프롬프트 최적화 |
| `veo2-video` | Veo 2 | 1장 | - | - | 길이(초), 비율 |
| `veo2-video-image-to-video` | Veo 2 Image-to-Video | 1장 | - | - | 비율, 길이(초) |
| `hunyuan-video-15` | Hunyuan Video 1.5 | 1장 | - | - | 해상도, 화면 방향, 길이(초) |
| `hunyuan-video-image-to-video` | Hunyuan Image to Video | 1장 | - | - | 비율, 해상도, 프레임 수 |
| `wan-video-image-to-video` | Wan 2.1 | 1장 | - | - | 해상도, 프레임 수, 안전 검사 |
| `davinci-magihuman` | DaVinci MagiHuman | 1장 | - | - | 길이(초), 해상도, 안전 검사, 추론 스텝 수, 가이던스 스케일(프롬프트 반영 강도) |
| `kling-video` | Kling 1.5 Pro | - | 1장 (`image_tail`) | - | 길이(초), 비율 |
| `kling-v3-turbo-standard` | Kling 3.0 Turbo Standard | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율 |
| `kling-v3-turbo-pro` | Kling 3.0 Turbo Pro | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율 |
| `kling-v3-4k` | Kling V3 4K | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, 오디오 생성 |
| `kling-o3-4k` | Kling O3 4K | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, 오디오 생성, source_video_mode, 원본 소리 유지 |
| `kling-video-o1` | Kling Video O1 | 1장 | 1장 (`image_tail`) | - | 길이(초), 비율, 원본 소리 유지, 생성 방식 |
| `kling-video-o1-standard` | Kling Video O1 Standard | 1장 | 1장 (`image_tail`) | - | 길이(초), 원본 소리 유지, 생성 방식 |
| `kandinsky5-pro` | Kandinsky 5 Pro | 1장 | - | - | 해상도, 비율 |
