/*
 * NanoGPT 단가 계산기 — NanoGPT 공개 카탈로그(nano-gpt.com/api/v1/image-models·video-models
 * ?detailed=true)의 pricing 객체를 그대로 읽어, 지금 고른 설정(해상도·길이·모드·오디오·
 * 품질 등)에 해당하는 칸의 값을 찾습니다. 앱은 NanoGPT를 거쳐 호출하므로 실제 청구액은
 * 이 단가를 따릅니다(단, 참조 미디어 추가 요금·반올림 등으로 약간 다를 수 있어 최종
 * 청구액은 생성 후 응답의 cost 로 확인합니다).
 *
 * 카탈로그 요금표 형태는 모델마다 30가지가 넘어 모든 형태를 정확히 계산할 수는 없습니다.
 * 계산 규칙이 확실하지 않은 형태(메가픽셀·프레임 단위·최소 요금만 공개 등)는 계산하지 않고
 * 요금표 원문을 그대로 보여 줍니다(추측 금지).
 */

export interface NanoGptQuoteInput {
  kind: "image" | "video";
  params: Record<string, unknown>;
  /** 이미지: 결과 장수. 동영상: 1. */
  count: number;
  /** 동영상 입력 상황. */
  hasStartImage?: boolean;
  referenceImages?: number;
  referenceVideos?: number;
  hasSourceVideo?: boolean;
}

export interface NanoGptQuote {
  usd: number;
  basis: string;
  /** 최소 요금 등 하한만 알 때 true. */
  minimumOnly?: boolean;
}

type Leaf = { path: string[]; value: number };

const RES_KEY = /^(\d{3,4}p|\d(\.\d)?k|\d{3,4}[x*]\d{3,4}|auto|default|\d+:\d+|square(_hd)?|(landscape|portrait)_\d+_\d+)$/i;
const DUR_KEY = /^\d+$/;
/** 계산에서 빼는 부가 요금·설정 값. */
const ADDON = /fee|lora|extra_reference|included|minimum|multiplier|threshold|override|input_?price|source_video|reference_video_input|default|max|min|duration(?!.*price)|frames|megapixel|note|billing|includes|supports|variant|unit$|currency/i;

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function leaves(value: unknown, path: string[] = [], out: Leaf[] = []): Leaf[] {
  const n = asNum(value);
  if (n !== null && path.length) out.push({ path, value: n });
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) leaves(child, [...path, key], out);
  }
  return out;
}

function money(value: number): string {
  return `$${value < 0.1 ? value.toFixed(4) : value.toFixed(3)}`.replace(/(\.\d*?[1-9])0+$/, "$1");
}

function pickParam(params: Record<string, unknown>, ...keys: string[]): string | null {
  const lower = Object.fromEntries(Object.entries(params).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = lower[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return null;
}

function normRes(value: string): string {
  return value.toLowerCase().replace(/\*/g, "x").replace(/\s/g, "");
}

/** 표에서 해상도 키를 고릅니다. 정확히 같은 키 → 기본 해상도 → auto → 가장 싼 값. */
function pickByKey(table: Record<string, number>, wanted: Array<string | null>): { key: string; value: number } | null {
  const entries = Object.entries(table);
  if (!entries.length) return null;
  for (const want of wanted) {
    if (!want) continue;
    const hit = entries.find(([key]) => normRes(key) === normRes(want));
    if (hit) return { key: hit[0], value: hit[1] };
  }
  const auto = entries.find(([key]) => /^(auto|default)$/i.test(key));
  if (auto) return { key: auto[0], value: auto[1] };
  const cheapest = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { key: `${cheapest[0]}(최저)`, value: cheapest[1] };
}

function numericTable(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, child] of Object.entries(rec(value))) {
    const n = asNum(child);
    if (n !== null) out[key] = n;
  }
  return out;
}

/* ---------------------------------------------------------------- 이미지 */

function quoteImage(pricing: Record<string, unknown>, input: NanoGptQuoteInput): NanoGptQuote | null {
  const wanted = [
    pickParam(input.params, "resolution", "image_size", "size", "imageSize"),
    pickParam(input.params, "aspect_ratio", "aspectRatio"),
    pickParam(input.params, "quality"),
  ];
  const speed = pickParam(input.params, "rendering_speed", "renderingSpeed");
  const lora = Object.entries(input.params).some(([key, value]) => /lora/i.test(key) && value !== "" && value != null);
  let table = numericTable(pricing.per_image);
  let label = "";
  const bySpeed = rec(pricing.by_rendering_speed);
  if (speed && bySpeed[speed]) {
    table = numericTable(bySpeed[speed]);
    label = ` · ${speed}`;
  } else if (lora && rec(pricing.lora).per_image) {
    table = numericTable(rec(pricing.lora).per_image);
    label = " · LoRA";
  }
  const direct = asNum(pricing.per_image);
  const hit = direct !== null ? { key: "", value: direct } : pickByKey(table, wanted);
  if (!hit) return null;
  const count = Math.max(1, input.count);
  return {
    usd: hit.value * count,
    basis: `장당 ${money(hit.value)}${hit.key ? ` (${hit.key}${label})` : label}${count > 1 ? ` × ${count}장` : ""}`,
  };
}

/* ---------------------------------------------------------------- 동영상 */

function modeWanted(input: NanoGptQuoteInput): "edit" | "refvideo" | "ref" | "i2v" | "t2v" {
  if (input.hasSourceVideo) return "edit";
  if ((input.referenceVideos ?? 0) > 0) return "refvideo";
  if ((input.referenceImages ?? 0) > 0) return "ref";
  if (input.hasStartImage) return "i2v";
  return "t2v";
}

const MODE_WORDS: Record<ReturnType<typeof modeWanted>, RegExp> = {
  edit: /edit/i,
  refvideo: /reference.?video|video.?reference|reference_to_video_video|withreferencevideo/i,
  ref: /reference/i,
  i2v: /image.?to.?video|i2v|^image/i,
  t2v: /text.?to.?video|t2v|text_image|^text/i,
};

function scoreGroup(name: string, input: NanoGptQuoteInput, params: Record<string, unknown>): number {
  let score = 0;
  const mode = modeWanted(input);
  const mentionsMode = Object.values(MODE_WORDS).some((re) => re.test(name));
  if (mentionsMode) {
    if (MODE_WORDS[mode].test(name)) score += 10;
    else if (mode === "refvideo" && MODE_WORDS.ref.test(name) && !/image/i.test(name)) score += 6;
    else if (mode === "ref" && /reference/i.test(name) && !/video.?(input|reference)|withreferencevideo/i.test(name)) score += 8;
    else if ((mode === "i2v" || mode === "ref") && MODE_WORDS.t2v.test(name) && /image/i.test(name)) score += 7;
    else score -= 10;
  }
  // "with reference video" 표는 참조 동영상을 넣을 때만 씁니다.
  if (/withreferencevideo|reference_?video/i.test(name) && mode !== "refvideo") score -= 12;
  const audio = pickParam(params, "generate_audio", "generateAudio", "audio", "with_audio", "sound");
  const audioOn = audio === null ? null : /^(true|1|on|yes)$/i.test(audio);
  if (/without.?audio/i.test(name)) score += audioOn === false ? 5 : audioOn === null ? 1 : -5;
  else if (/with.?audio/i.test(name)) score += audioOn === true ? 5 : audioOn === null ? 0 : -5;
  const variantValue = Object.values(params).map((v) => String(v).toLowerCase()).join(" ");
  for (const word of ["pro", "standard", "turbo", "fast", "draft", "full", "quality", "speed"]) {
    const re = new RegExp(`(^|_|\\b)${word}`, "i");
    if (re.test(name)) score += variantValue.includes(word) ? 4 : word === "standard" || word === "full" || word === "speed" ? 1 : -2;
  }
  if (/high_resolution/i.test(name)) score -= 3;
  return score;
}

function videoSeconds(pricing: Record<string, unknown>, raw: Record<string, unknown>, params: Record<string, unknown>): number {
  const fromParam = asNum(pickParam(params, "duration", "seconds", "length", "video_length", "num_seconds"));
  return fromParam
    ?? asNum(pricing.fixed_duration_seconds)
    ?? asNum(pricing.default_duration)
    ?? asNum(raw.defaultDuration)
    ?? asNum(pricing.base_duration)
    ?? 5;
}

function quoteVideo(pricing: Record<string, unknown>, input: NanoGptQuoteInput): NanoGptQuote | null {
  const raw = rec(pricing.raw);
  const params = input.params;
  const seconds = videoSeconds(pricing, raw, params);
  const resolution = pickParam(params, "resolution", "size", "quality", "video_resolution");
  const defaultRes = (pricing.default_resolution as string) || (raw.defaultResolution as string) || null;
  const wantedRes = [resolution, defaultRes];
  const extras: string[] = [];
  let add = 0;
  const imageFee = asNum(pricing.image_input_fee);
  if (imageFee && (input.hasStartImage || (input.referenceImages ?? 0) > 0)) {
    add += imageFee;
    extras.push(`이미지 입력 ${money(imageFee)}`);
  }

  // 1) 고정 길이 한 건 요금
  const perVideo = asNum(pricing.per_video);
  if (perVideo !== null) return { usd: perVideo + add, basis: `건당 ${money(perVideo)}${pricing.fixed_duration_seconds ? ` (${pricing.fixed_duration_seconds}초 고정)` : ""}` };
  const withAudio = asNum(pricing.with_audio);
  const withoutAudio = asNum(pricing.without_audio);
  if (withAudio !== null && withoutAudio !== null) {
    const audio = pickParam(params, "generate_audio", "generateAudio", "audio");
    const on = audio === null ? true : /^(true|1|on)$/i.test(audio);
    return { usd: on ? withAudio : withoutAudio, basis: `건당 ${money(on ? withAudio : withoutAudio)} (오디오 ${on ? "포함" : "없음"}, ${pricing.fixed_duration_seconds ?? "?"}초)` };
  }
  // 길이별 건당 요금(예: Kling { "5": 0.25, "10": 0.5 }), 오디오 배수가 있을 수 있음.
  const perDuration = numericTable(pricing.per_duration);
  if (Object.keys(perDuration).length) {
    const durs = Object.keys(perDuration).map(Number).sort((a, b) => a - b);
    const dur = durs.find((d) => d >= seconds) ?? durs[durs.length - 1];
    const audio = pickParam(params, "generate_audio", "generateAudio", "audio", "sound");
    const audioMult = asNum(pricing.audio_multiplier);
    const mult = audioMult !== null && audio !== null && /^(true|1|on)$/i.test(audio) ? audioMult : 1;
    return { usd: perDuration[String(dur)] * mult + add, basis: `${dur}초 건당 ${money(perDuration[String(dur)])}${mult !== 1 ? ` × 오디오 ${mult}` : ""}` };
  }
  // 2) 기본 요금 + 초과 초
  const basePrice = asNum(pricing.base_price);
  if (basePrice !== null && asNum(pricing.per_extra_second) !== null) {
    const baseDur = asNum(pricing.base_duration) ?? 5;
    const extra = Math.max(0, seconds - baseDur) * (asNum(pricing.per_extra_second) ?? 0);
    return { usd: basePrice + extra, basis: `기본 ${money(basePrice)}(${baseDur}초) + 초과 초당 ${money(asNum(pricing.per_extra_second) ?? 0)} × ${Math.max(0, seconds - baseDur)}초` };
  }
  if (basePrice !== null && asNum(pricing.pro_multiplier) !== null) {
    const pro = /pro/i.test(Object.values(params).join(" "));
    return { usd: basePrice * (pro ? asNum(pricing.pro_multiplier)! : 1), basis: `건당 ${money(basePrice)}${pro ? ` × pro ${pricing.pro_multiplier}` : ""}` };
  }
  // 3) 해상도별 기본 요금 × 길이 배수
  const baseByRes = numericTable(pricing.base_prices_by_resolution);
  if (Object.keys(baseByRes).length) {
    const hit = pickByKey(baseByRes, wantedRes)!;
    const override = numericTable(rec(pricing.duration_overrides)[String(seconds)]);
    if (override[hit.key] !== undefined) return { usd: override[hit.key], basis: `${hit.key} · ${seconds}초 ${money(override[hit.key])}` };
    const multipliers = numericTable(pricing.duration_multipliers);
    const mult = multipliers[String(seconds)] ?? (asNum(pricing.duration_multiplier) !== null && seconds > 5 ? asNum(pricing.duration_multiplier)! : 1);
    return { usd: hit.value * mult, basis: `${hit.key} 기본 ${money(hit.value)}${mult !== 1 ? ` × 길이 배수 ${mult}` : ""} (${seconds}초)` };
  }
  const baseSecond = asNum(pricing.base_price_per_second);
  if (baseSecond !== null) {
    const mult = pickByKey(numericTable(pricing.resolution_multipliers), wantedRes)?.value ?? 1;
    return { usd: baseSecond * mult * seconds, basis: `초당 ${money(baseSecond)}${mult !== 1 ? ` × ${mult}` : ""} × ${seconds}초` };
  }

  // 4) 일반 규칙: 초당·건당 요금표 묶음 중 지금 상황에 가장 맞는 것을 고릅니다.
  const all = [...leaves(pricing), ...leaves(raw).map((leaf) => ({ ...leaf, path: ["raw", ...leaf.path] }))]
    .filter((leaf) => leaf.path[0] !== "raw" || leaf.path.length > 1)
    .filter((leaf) => !(leaf.path[0] === "raw" && leaf.path.length === 1));
  type Group = { name: string; perSecond: boolean; cells: Array<{ res: string | null; dur: string | null; value: number }> };
  const groups = new Map<string, Group>();
  for (const leaf of all) {
    const named = leaf.path.filter((part) => !RES_KEY.test(part) && !DUR_KEY.test(part) && part !== "raw");
    const name = named.join(".");
    if (!name || ADDON.test(named[named.length - 1] ?? "") || /lora|reference_mode\.per_reference|per_1000|input_?price|source_video|reference_video_input/i.test(name)) continue;
    if (!/price|per_|second|prices|output|generated|with.?audio|without.?audio|text_mode|reference_mode/i.test(name)) continue;
    const res = leaf.path.find((part) => RES_KEY.test(part)) ?? null;
    const dur = leaf.path.find((part, index) => DUR_KEY.test(part) && index > 0) ?? null;
    const perSecond = /second/i.test(name) && !/per_duration/i.test(name);
    const group = groups.get(name) ?? { name, perSecond, cells: [] };
    group.cells.push({ res, dur, value: leaf.value });
    groups.set(name, group);
  }
  if (groups.size === 0) {
    const minimum = asNum(pricing.minimum) ?? asNum(pricing.minimum_price);
    return minimum !== null ? { usd: minimum, basis: `최소 ${money(minimum)} (길이·해상도·참조 미디어에 따라 추가)`, minimumOnly: true } : null;
  }
  const ranked = [...groups.values()]
    .map((group) => ({ group, score: scoreGroup(group.name, input, params) }))
    .sort((a, b) => b.score - a.score);
  const { group } = ranked[0];
  const resTable: Record<string, number> = {};
  const durKey = group.cells.some((cell) => cell.dur)
    ? (() => {
        const durs = [...new Set(group.cells.map((cell) => cell.dur).filter(Boolean) as string[])].map(Number).sort((a, b) => a - b);
        return String(durs.find((d) => d >= seconds) ?? durs[durs.length - 1]);
      })()
    : null;
  for (const cell of group.cells) {
    if (durKey && cell.dur !== durKey) continue;
    resTable[cell.res ?? "기본"] = cell.value;
  }
  const hit = pickByKey(resTable, [...wantedRes, "기본"]);
  if (!hit) return null;
  const label = group.name.replace(/^raw\./, "");
  const resText = hit.key === "기본" ? "" : ` ${hit.key}`;
  if (group.perSecond) {
    const minBill = asNum(pricing.minimum_billable_duration) ?? asNum(raw.minDuration);
    const billed = minBill !== null ? Math.max(seconds, minBill) : seconds;
    return {
      usd: hit.value * billed + add,
      basis: `${label}${resText} · 초당 ${money(hit.value)} × ${billed}초${extras.length ? ` + ${extras.join(" + ")}` : ""}`,
    };
  }
  return { usd: hit.value + add, basis: `${label}${resText}${durKey ? ` · ${durKey}초` : ""} · 건당 ${money(hit.value)}${extras.length ? ` + ${extras.join(" + ")}` : ""}` };
}

export function quoteNanoGpt(pricing: Record<string, unknown> | null | undefined, input: NanoGptQuoteInput): NanoGptQuote | null {
  if (!pricing) return null;
  try {
    return input.kind === "image" ? quoteImage(pricing, input) : quoteVideo(pricing, input);
  } catch {
    return null;
  }
}

/** 카탈로그 요금표 원문을 "항목: 값" 줄로 풀어 보여 줍니다(최대 60줄). */
export function describeNanoGptPricing(pricing: Record<string, unknown> | null | undefined): string[] {
  if (!pricing) return [];
  const lines: string[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (lines.length >= 60) return;
    const n = asNum(value);
    if (n !== null) {
      const last = path[path.length - 1] ?? "";
      const isMoney = !/duration|seconds|multiplier|threshold|megapixels|frames|included|max|min(?!imum)|tokens/i.test(path.join("."));
      lines.push(`${path.filter((p) => p !== "raw").join(" · ")}: ${isMoney ? money(n) : n}${/second/i.test(path.join(".")) && isMoney && !/per_extra/i.test(last) ? "/초" : ""}`);
      return;
    }
    if (typeof value === "string") {
      if (!/^(USD|type)$/i.test(value) && path[path.length - 1] !== "currency" && path[path.length - 1] !== "type") lines.push(`${path.join(" · ")}: ${value}`);
      return;
    }
    if (Array.isArray(value)) {
      lines.push(`${path.join(" · ")}: ${value.join(", ")}`);
      return;
    }
    for (const [key, child] of Object.entries(rec(value))) walk(child, [...path, key]);
  };
  walk(pricing, []);
  return lines;
}
