import { translateToKoreanDeepL } from "@/lib/deepl";
import { nanoFetch } from "@/lib/nanogpt";

const AZURE_CHUNK_SIZE = 50;
const AZURE_TIMEOUT_MS = 15000;

export interface TranslationResult {
  available: boolean;
  translations: string[] | null;
  message: string | null;
}

async function translateToKoreanAzure(texts: string[]): Promise<TranslationResult> {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  if (!key) {
    return {
      available: false,
      translations: null,
      message: "AZURE_TRANSLATOR_KEY 환경 변수가 설정되지 않아 번역을 제공할 수 없습니다.",
    };
  }
  const baseEndpoint = (process.env.AZURE_TRANSLATOR_ENDPOINT || "https://api.cognitive.microsofttranslator.com").replace(/\/+$/, "");
  const endpoint = `${baseEndpoint}/translate?api-version=3.0&to=ko`;

  const results: string[] = [];
  for (let i = 0; i < texts.length; i += AZURE_CHUNK_SIZE) {
    const chunk = texts.slice(i, i + AZURE_CHUNK_SIZE);
    const body = JSON.stringify(chunk.map((text) => ({ text })));
    const headers: Record<string, string> = {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    };
    const region = process.env.AZURE_TRANSLATOR_REGION;
    if (region) {
      headers["Ocp-Apim-Subscription-Region"] = region;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AZURE_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        return {
          available: false,
          translations: null,
          message: `Azure Translator 번역 요청에 실패했습니다. (HTTP ${response.status})`,
        };
      }
      const data = (await response.json()) as { translations?: { text?: string }[] }[];
      const translated = data.map((item) => item.translations?.[0]?.text ?? "");
      results.push(...translated);
    } catch {
      return {
        available: false,
        translations: null,
        message: "Azure Translator 번역 요청 중 오류가 발생했습니다.",
      };
    }
  }
  return { available: true, translations: results, message: null };
}

/*
 * 번역 API 키가 없거나 호출이 실패하면 NanoGPT 채팅 모델로 번역합니다.
 * NANOGPT_API_KEY 는 앱 필수 값이라 별도 설정 없이도 번역이 동작합니다.
 * 모델은 NANOGPT_TRANSLATE_MODEL 로 바꿀 수 있습니다.
 */
async function translateToKoreanNanoGpt(texts: string[]): Promise<TranslationResult> {
  if (!process.env.NANOGPT_API_KEY) {
    return {
      available: false,
      translations: null,
      message:
        "번역 API가 설정되지 않았습니다. AZURE_TRANSLATOR_KEY, DEEPL_API_KEY 또는 NANOGPT_API_KEY 환경 변수를 설정하면 모델 설명을 번역해 표시합니다.",
    };
  }
  const model = process.env.NANOGPT_TRANSLATE_MODEL || "gpt-4o-mini";
  try {
    const results: string[] = [];
    for (const text of texts) {
      const response = await nanoFetch(
        "/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "You are a translator. Translate the user's text into natural Korean. Keep model names, product names and technical identifiers as-is. Output only the translation.",
              },
              { role: "user", content: text },
            ],
          }),
        },
        30000,
      );
      if (!response.ok) {
        return {
          available: false,
          translations: null,
          message: `NanoGPT 번역 요청에 실패했습니다. (HTTP ${response.status})`,
        };
      }
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      results.push((data.choices?.[0]?.message?.content ?? "").trim());
    }
    return { available: true, translations: results, message: null };
  } catch {
    return { available: false, translations: null, message: "NanoGPT 번역 요청 중 오류가 발생했습니다." };
  }
}

export async function translateToKorean(texts: string[]): Promise<TranslationResult> {
  if (process.env.AZURE_TRANSLATOR_KEY) {
    const result = await translateToKoreanAzure(texts);
    if (result.available) return result;
  }
  if (process.env.DEEPL_API_KEY) {
    const result = await translateToKoreanDeepL(texts);
    if (result.available) return result;
  }
  return translateToKoreanNanoGpt(texts);
}
