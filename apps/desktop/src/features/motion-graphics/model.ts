export type CaptionWord = { text: string; startMs: number; endMs: number; translation?: string };

export type MotionGraphic = { id: string; visible?: boolean; locked?: boolean; isCaption?: boolean; captionSourceLanguage?: string; captionTranslationLanguage?: string; captionMode?: "source" | "bilingual" | "karaoke"; captionEnglish?: string; captionTranslation?: string; captionWords?: CaptionWord[]; captionBackgroundColor?: string; captionBackgroundOpacity?: number; captionWidth?: number; captionPaddingEm?: number; text: string; icon?: string; lucideIconName?: string; lucideIconAnchor?: "left" | "right" | "top" | "bottom"; lucideIconSize?: number; lucideIconColor?: string; elements?: Array<{ type: string; content: string }>; fontFamily?: string; fontWeight?: number; textAlign?: "left" | "center" | "right"; startMs: number; endMs: number; durationMs: number; preset: "pop" | "slide" | "zoom" | "typewriter" | "impact" | "composition"; typewriterDurationMs?: number; color: string; accent: string; fontSize: number; x: number; y: number; sound: "pop" | "whoosh" | "impact" | "click" | "none"; soundId?: string; soundVolume?: number };

export function motionAnimationTiming(item: Pick<MotionGraphic, "startMs" | "endMs" | "durationMs" | "typewriterDurationMs">) {
  const lifetime = Math.max(1, item.endMs - item.startMs);
  const configuredDuration = Number.isFinite(item.durationMs) && item.durationMs > 0 ? item.durationMs : lifetime;
  const durationMs = Math.max(1, Math.min(configuredDuration, lifetime));
  const typewriterDurationMs = Math.max(100, Math.min(durationMs, item.typewriterDurationMs ?? 1500));
  return { durationMs, typewriterDurationMs };
}

export function motionPreviewState(item: MotionGraphic, playheadMs: number) {
  if (item.isCaption) return { text: item.captionEnglish || item.text, transform: "none", opacity: 1 };
  const { durationMs: duration, typewriterDurationMs: writingDuration } = motionAnimationTiming(item);
  const progress = Math.max(0, Math.min(1, (playheadMs - item.startMs) / duration));
  const writingProgress = Math.max(0, Math.min(1, (playheadMs - item.startMs) / writingDuration));
  const eased = 1 - Math.pow(1 - progress, 3);
  let transform = "none";
  let opacity = 1;
  let text = (item.icon ? item.icon + " " : "") + item.text;

  switch (item.preset) {
    case "typewriter": {
      const characters = Array.from(text);
      const visible = characters.length ? Math.min(characters.length, Math.floor(writingProgress * characters.length) + 1) : 0;
      text = characters.slice(0, visible).join("");
      break;
    }
    case "pop":
      transform = `scale(${0.35 + 0.65 * eased})`;
      break;
    case "slide":
      transform = `translateX(${(1 - eased) * 100}%)`;
      break;
    case "zoom":
      transform = `scale(${2.4 - 1.4 * eased})`;
      opacity = Math.min(1, progress * 4);
      break;
    case "impact": {
      const scale = progress < 0.65
        ? 3 - 2.12 * (progress / 0.65)
        : 0.88 + 0.12 * ((progress - 0.65) / 0.35);
      transform = `scale(${scale})`;
      opacity = Math.min(1, progress * 4);
      break;
    }
  }
  return { text, transform, opacity };
}
