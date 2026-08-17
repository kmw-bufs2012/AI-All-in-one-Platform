const DEEPL_CHUNK_SIZE = 50;
const DEEPL_TIMEOUT_MS = 15000;

export interface TranslationResult {
  available: boolean;
  translations: string[] | null;
  message: string | null;
}

export async function translateToKoreanDeepL(texts: string[]): Promise<TranslationResult> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) {
    return {
      available: false,
      translations: null,
      message: "DEEPL_API_KEY 환경 변수가 설정되지 않아 번역을 제공할 수 없습니다.",
    };
  }
  const endpoint = key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const results: string[] = [];
  for (let i = 0; i < texts.length; i += DEEPL_CHUNK_SIZE) {
    const chunk = texts.slice(i, i + DEEPL_CHUNK_SIZE);
    const body = new URLSearchParams();
    chunk.forEach((text) => body.append("text", text));
    body.append("target_lang", "KO");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEEPL_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        return {
          available: false,
          translations: null,
          message: `DeepL 번역 요청에 실패했습니다. (HTTP ${response.status})`,
        };
      }
      const data = (await response.json()) as { translations?: { text?: string }[] };
      const translated = (data.translations ?? []).map((item) => item.text ?? "");
      results.push(...translated);
    } catch {
      return {
        available: false,
        translations: null,
        message: "DeepL 번역 요청 중 오류가 발생했습니다.",
      };
    }
  }
  return { available: true, translations: results, message: null };
}