import type { CaptionWord, MotionGraphic } from "./model";

export function parseSuperJsonCues(rawCues: unknown[], playheadMs: number): MotionGraphic[] {
  return rawCues.flatMap(rawCue => {
    if (!rawCue || typeof rawCue !== "object") return [];
    const cue = rawCue as Record<string, unknown>;
    const asNumber = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const editorialWords = Array.isArray(cue.word_translations) ? cue.word_translations : null;
    const rawWords = editorialWords ?? (Array.isArray(cue.words) ? cue.words : []);
    const semanticUnits = Array.isArray(cue.semantic_units) ? cue.semantic_units : [];
    const semanticText = new Map<string, string>();
    for (const rawUnit of semanticUnits) {
      if (!rawUnit || typeof rawUnit !== "object") continue;
      const unit = rawUnit as Record<string, unknown>;
      const id = String(unit.semantic_group_id ?? unit.id ?? "").trim();
      const pt = String(unit.pt ?? unit.translation ?? "").trim();
      if (id && pt) semanticText.set(id, pt);
    }

    const parsedWords = rawWords.flatMap(rawWord => {
      if (!rawWord || typeof rawWord !== "object") return [];
      const word = rawWord as Record<string, unknown>;
      const wordText = String(word.surface ?? word.text ?? word.word_text ?? "").trim();
      if (!wordText) return [];
      const start = asNumber(word.start_ms ?? word.startMs, Number.NaN);
      const end = asNumber(word.end_ms ?? word.endMs, Number.NaN);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const groupId = String(word.semantic_group_id ?? word.pt_group ?? word.ptGroup ?? "").trim();
      const role = String(word.semantic_group_role ?? word.pt_group_role ?? word.ptGroupRole ?? "");
      const wordPt = String(word.pt ?? word.translation ?? "").trim();
      return [{
        text: wordText,
        startMs: start,
        endMs: end,
        translation: groupId && semanticText.has(groupId) ? semanticText.get(groupId)! : wordPt,
        pt: groupId && role === "lead" && semanticText.has(groupId) ? semanticText.get(groupId)! : wordPt,
        ptGroup: groupId || undefined,
        ptGroupRole: (["lead", "member"].includes(role) ? role : "") as CaptionWord["ptGroupRole"],
      } satisfies CaptionWord];
    }).sort((a, b) => a.startMs - b.startMs);

    const explicitStart = cue.start_ms !== undefined ? asNumber(cue.start_ms, Number.NaN) : asNumber(cue.start, Number.NaN) * 1000;
    const explicitEnd = cue.end_ms !== undefined ? asNumber(cue.end_ms, Number.NaN) : asNumber(cue.end, Number.NaN) * 1000;
    const cueStart = Number.isFinite(explicitStart) ? explicitStart : parsedWords[0]?.startMs ?? 0;
    const cueEnd = Number.isFinite(explicitEnd) && explicitEnd > cueStart
      ? explicitEnd
      : parsedWords.length ? Math.max(...parsedWords.map(word => word.endMs)) : cueStart + 1500;
    if (cueEnd <= cueStart) return [];

    const english = String(cue.approved_en ?? cue.en ?? cue.text_en ?? cue.text ?? "").trim();
    const portuguese = String(cue.approved_pt ?? cue.pt ?? cue.translation_pt ?? cue.text_pt ?? "").trim();
    if (!english && !portuguese) return [];

    const words = parsedWords.flatMap(word => {
      const start = Math.max(cueStart, word.startMs);
      const end = Math.min(cueEnd, Math.max(start + 50, word.endMs));
      return end > start ? [{ ...word, startMs: start, endMs: end }] : [];
    });
    const startMs = playheadMs + cueStart;
    const endMs = playheadMs + cueEnd;
    return [{
      id: crypto.randomUUID(),
      isCaption: true,
      captionMode: words.length ? "karaoke" as const : portuguese ? "bilingual" as const : "source" as const,
      captionEnglish: english,
      captionTranslation: portuguese,
      captionWords: words.map(word => ({ ...word, startMs: playheadMs + word.startMs, endMs: playheadMs + word.endMs })),
      captionBackgroundColor: "#000000",
      captionBackgroundOpacity: 0.76,
      captionWidth: 90,
      captionPaddingEm: 0.32,
      text: portuguese ? english + "\n" + portuguese : english || portuguese,
      icon: "",
      fontFamily: "Arial",
      fontWeight: 900,
      textAlign: "center",
      startMs,
      endMs,
      durationMs: endMs - startMs,
      preset: "pop" as const,
      color: "#ffffff",
      accent: "#65d6c0",
      fontSize: 48,
      x: 50,
      y: 82,
      sound: "none" as const,
      soundId: "",
      soundVolume: 80,
    }];
  });
}


import type { SceneSpec } from "../../shared/scene-spec";

export function sceneSpecToMotionGraphics(parsed: SceneSpec, playheadMs: number): MotionGraphic[] {
  return parsed.scenes.flatMap(scene =>
        scene.blocks.map(block => {
          const startMs = playheadMs + (block.startOffsetMs ?? 0);
          const endMs = startMs + (block.durationMs ?? scene.durationMs);
          return {
            id: crypto.randomUUID(),
            text: block.text,
            icon: block.icon ?? "",
            lucideIconName: block.iconName ?? "",
            lucideIconAnchor: block.iconAnchor ?? "left",
            lucideIconSize: block.iconSize,
            lucideIconColor: block.iconColor,
            fontFamily: "Arial",
            fontWeight: 900,
            textAlign: block.align ?? "center",
            startMs,
            endMs,
            durationMs: endMs - startMs,
            preset: "pop" as const,
            color: block.color,
            accent: block.accent ?? "#65d6c0",
            fontSize: block.fontSize,
            x: block.x,
            y: block.y,
            sound: "none" as const,
            soundId: "",
            soundVolume: 80,
          };
        }),
  );
}


export function sceneTemplateToMotionGraphics(
  scene: SceneSpec["scenes"][number],
  playheadMs: number,
): MotionGraphic[] {
  return scene.blocks.map(block => {
    const startMs = playheadMs + (block.startOffsetMs ?? 0);
    const endMs = startMs + (block.durationMs ?? scene.durationMs);
    return {
      id: crypto.randomUUID(),
      text: block.text,
      icon: block.icon ?? "",
      fontFamily: "Arial",
      fontWeight: 900,
      textAlign: block.align ?? "center",
      startMs,
      endMs,
      durationMs: endMs - startMs,
      preset: "pop" as const,
      color: block.color,
      accent: block.accent ?? "#65d6c0",
      fontSize: block.fontSize,
      x: block.x,
      y: block.y,
      sound: "none" as const,
      soundId: "",
      soundVolume: 80,
    };
  });
}
