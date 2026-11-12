import type { MediaAsset } from "../../shared/types";

type TimelineClip = {
  id: string;
  assetId: string;
  sourceEndMs: number;
  sourceDurationMs?: number;
  timelineStartMs: number;
  volume: number;

const defaultDuration = (asset: MediaAsset) => asset.durationMs && asset.durationMs > 0 ? asset.durationMs : asset.kind === "image" ? 5000 : 30000;
const clipDuration = (clip: TimelineClip) => Math.max(0, clip.sourceEndMs - clip.sourceStartMs);
const clipEnd = (clip: TimelineClip) => clip.timelineStartMs + clipDuration(clip);
const timeLabel = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
};

function captionBackgroundRgba(color: string | undefined, opacity: number | undefined) {
  const safeOpacity = Math.max(0, Math.min(1, opacity ?? 0.76));
  const match = /^#?([0-9a-f]{6})$/i.exec(color || "000000");
  if (!match) return `rgba(0,0,0,${safeOpacity})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${safeOpacity})`;
}

function imageOverlayEntranceState(item: ImageOverlay, playheadMs: number) {
  const animation = item.entranceAnimation || "none";
  const duration = Math.max(100, Math.min(3000, item.entranceDurationMs ?? 600));
  const progress = Math.max(0, Math.min(1, (playheadMs - item.startMs) / duration));
  const eased = 1 - Math.pow(1 - progress, 3);
  let transform = "translate(-50%,-50%)";
  let opacity = 1;
  if (animation === "fade") opacity = progress;
  if (animation === "slide-left") transform += " translateX(-" + ((1 - eased) * 100) + "%)";
  if (animation === "slide-right") transform += " translateX(" + ((1 - eased) * 100) + "%)";
  if (animation === "slide-up") transform += " translateY(" + ((1 - eased) * 100) + "%)";
  if (animation === "slide-down") transform += " translateY(-" + ((1 - eased) * 100) + "%)";
  return { transform, opacity };
}
