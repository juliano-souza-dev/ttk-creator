import type { MediaAsset } from "../../shared/types";

export type TimelineClip = {
  id: string;
  assetId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs?: number;
  timelineStartMs: number;
  volume: number;
  muted?: boolean;
  cameraMotion?: "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down";
  transitionMs?: number;
  transitionType?: "fade-black" | "fade-white" | "flash";
};

export type TimelineGroup = { id: string; name: string; members: string[] };

export type ImageOverlay = { id:string; assetId:string; startMs:number; endMs:number; x:number; y:number; width:number; height:number; soundId?:string; soundVolume:number; visible?:boolean; locked?:boolean; entranceAnimation?: "none" | "fade" | "slide-left" | "slide-right" | "slide-up" | "slide-down"; entranceDurationMs?:number };

export type TrimDrag = { clipId: string; edge: "start" | "end"; startX: number; sourceStartMs: number; sourceEndMs: number; timelineStartMs: number; scaleMs: number; didMove?: boolean };

export type ClipMoveDrag = { clipId: string; startX: number; lastX: number; timelineStartMs: number; memberKeys: string[]; didMove?: boolean };

export type MotionTrimDrag = { id: string; edge: "start" | "end" | "move"; startX: number; lastX: number; startMs: number; endMs: number; memberKeys: string[]; didMove?: boolean };

export const defaultDuration = (asset: MediaAsset) => asset.durationMs && asset.durationMs > 0 ? asset.durationMs : asset.kind === "image" ? 5000 : 30000;

export const clipDuration = (clip: TimelineClip) => Math.max(0, clip.sourceEndMs - clip.sourceStartMs);

export const clipEnd = (clip: TimelineClip) => clip.timelineStartMs + clipDuration(clip);

export const timeLabel = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
};

export function captionBackgroundRgba(color: string | undefined, opacity: number | undefined) {
  const safeOpacity = Math.max(0, Math.min(1, opacity ?? 0.76));
  const match = /^#?([0-9a-f]{6})$/i.exec(color || "000000");
  if (!match) return `rgba(0,0,0,${safeOpacity})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${safeOpacity})`;
}

export function imageOverlayEntranceState(item: ImageOverlay, playheadMs: number) {
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
