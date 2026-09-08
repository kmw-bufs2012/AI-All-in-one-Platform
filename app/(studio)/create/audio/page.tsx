"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useStudioState } from "@/components/StudioState";
import { useModels } from "@/components/useModels";
import { ModelChip, ModelDetail, SelectChip, SendButton } from "@/components/studio-ui";
import { recordJob } from "@/lib/client-api";
import { resolveAudioAttachmentPolicy } from "@/lib/attachment-policy";

/*
 * 최대 입력 길이와 출력 형식은 모델마다 다릅니다. NanoGPT 공식 문서에 따르면
 * /api/v1/audio-models?type=tts&detailed=true 가 모델별 voices · formats ·
 * max_input_size 를 공개하므로, 화면 제한도 그 값을 따릅니다.
 */

interface AudioResult {
  url: string;
  text: string;
  voice: string;
}

export default function AudioPage() {
  const models = useModels("tts");
  const [input, setInput] = useStudioState<string>("audio:input", "");
  const [voice, setVoice] = useStudioState<string>("audio:voice", "");
  const [format, setFormat] = useStudioState<string>("audio:format", "");
  const [results, setResults] = useStudioState<AudioResult[]>("audio:results", []);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const voices = models.selected?.voices ?? [];
  const activeVoice = voice || models.selected?.defaultVoice || voices[0]?.id || "";
  // TTS 모델은 입력이 텍스트뿐이라 첨부를 지원하지 않습니다(첨부 개수 0).
  const policy = resolveAudioAttachmentPolicy(models.selected);
  const maxChars = policy.maxInputLength;
  const formats = models.selected?.supportedFormats ?? [];
  const activeFormat = formats.includes(format) ? format : models.selected?.defaultFormat || formats[0] || "mp3";

  async function generate() {
    const text = input.trim();
    if (generating || !text) return;
    const model = models.selected;
    if (!model) {
      setError("모델을 선택해 주세요.");
      return;
    }
    setError("");
    setGenerating(true);
    try {
      const response = await fetch("/api/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          voice: activeVoice || undefined,
          input: text,
          format: activeFormat,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "음성 생성에 실패했습니다.");
      const url = typeof body.url === "string" ? body.url : null;
      if (url) {
        const label = voices.find((item) => item.id === activeVoice)?.name ?? activeVoice;
        setResults((prev) => [{ url, text, voice: label }, ...prev]);
      }
      // TTS는 오디오 바이너리로 응답해 청구액이 응답 헤더로만 확인될 수 있어
      // (있으면 서버가 body.cost로 넘겨줍니다), 없을 때만 카탈로그 단가로 추정합니다.
      const actualCost = body.cost as { amount: number; currency: string | null } | null;
      const estimatedAmount = model.pricing?.perRequest ?? null;
      const finalAmount = actualCost?.amount ?? estimatedAmount;
      const finalCurrency = actualCost?.currency ?? model.pricing?.currency ?? null;
      recordJob({
        mode: "audio",
        model: model.id,
        prompt: text,
        attachments: [],
        usage: null,
        unitPrice: model.pricing,
        cost: finalAmount,
        currency: finalCurrency,
        costSource: actualCost ? "actual" : finalAmount !== null ? "estimated" : null,
        status: "completed",
        result: { kind: "audio", urls: url ? [url] : [] },
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "음성 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="studio">
      <div className="studio-scroll">
        <div className="studio-inner">
          <ModelDetail hook={models} />

          {results.length === 0 ? (
            <div className="studio-hero">
              <h1>음성 만들기</h1>
              <p>읽어 줄 문장을 적고 목소리를 고르세요. 잠시 뒤 바로 들어 볼 수 있습니다.</p>
            </div>
          ) : (
            <>
              <div className="section-head">
                <h2>생성 결과</h2>
                <span className="section-sub">{results.length}개</span>
              </div>
              <div className="stack">
                {results.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="audio-row">
                    <span className="audio-icon">
                      <Icon name="audio" size={18} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.text}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        목소리: {item.voice || "기본"}
                      </div>
                      <audio src={item.url} controls preload="metadata" style={{ width: "100%", marginTop: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {generating ? (
            <div className="progress-note" style={{ marginTop: 18 }}>
              <span className="spinner" /> 음성을 만들고 있습니다.
            </div>
          ) : null}
        </div>
      </div>

      <div className="dock">
        <div className="dock-inner">
          <textarea
            className="dock-textarea"
            value={input}
            onChange={(event) => setInput(event.target.value.slice(0, maxChars))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                generate();
              }
            }}
            placeholder="음성으로 들려줄 문장을 입력해 주세요."
            maxLength={maxChars}
            rows={1}
          />
          {error ? <div className="error-box dock-alert">{error}</div> : null}
          <div className="dock-row">
            <ModelChip hook={models} />
            {voices.length > 0 ? (
              <SelectChip
                icon="voice"
                title="목소리 선택"
                value={activeVoice}
                onChange={setVoice}
                options={voices.map((item) => ({ value: item.id, label: item.name }))}
              />
            ) : null}
            {formats.length > 1 ? (
              <SelectChip
                icon="audio"
                title="출력 형식"
                value={activeFormat}
                onChange={setFormat}
                options={formats.map((item) => ({ value: item, label: item }))}
              />
            ) : null}
            <span className="dock-spacer" />
            <span className="muted" style={{ fontSize: 11.5 }}>
              첨부 불가 · 이미지 {policy.image.max}/{policy.image.max} · 동영상 {policy.video.max}/{policy.video.max} · 파일 {policy.doc.max}/{policy.doc.max}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {input.length.toLocaleString()} / {maxChars.toLocaleString()}자
            </span>
            <SendButton disabled={generating || !input.trim()} onClick={generate} label="음성 생성" />
          </div>
        </div>
      </div>
    </div>
  );
}
