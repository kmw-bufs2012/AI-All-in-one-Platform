import { translateToKoreanDeepL } from "@/lib/deepl";

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

export async function translateToKorean(texts: string[]): Promise<TranslationResult> {
  if (process.env.AZURE_TRANSLATOR_KEY) {
    return translateToKoreanAzure(texts);
  }
  if (process.env.DEEPL_API_KEY) {
    return translateToKoreanDeepL(texts);
  }
  return {
    available: false,
    translations: null,
    message:
      "번역 API가 설정되지 않았습니다. AZURE_TRANSLATOR_KEY 또는 DEEPL_API_KEY 환경 변수를 설정하면 모델 설명을 번역해 표시합니다.",
  };
}
