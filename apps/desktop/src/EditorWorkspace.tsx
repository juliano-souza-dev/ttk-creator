import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { desktopApi, isDesktopRuntime } from "./services/desktop-api";
import type { MediaAsset } from "./shared/types";
import { AudioLines, Film, Plus, Play, Pause, Trash2, Scissors, Copy, SkipBack, SkipForward, Volume2, VolumeX, Music2, Type, WandSparkles, MousePointer2, ChevronLeft, ChevronRight, Download, LoaderCircle } from "lucide-react";

type TimelineClip = {
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
};
type Props = { projectId: string; assets: MediaAsset[]; onAddMedia: () => void };
type TrimDrag = { clipId: string; edge: "start" | "end"; startX: number; sourceStartMs: number; sourceEndMs: number; timelineStartMs: number; scaleMs: number };
type ClipMoveDrag = { clipId: string; startX: number; timelineStartMs: number };
type MotionTrimDrag = { id: string; edge: "start" | "end" | "move"; startX: number; startMs: number; endMs: number };
type MotionGraphic = { id: string; text: string; icon?: string; fontFamily?: string; fontWeight?: number; textAlign?: "left" | "center" | "right"; startMs: number; endMs: number; durationMs: number; preset: "pop" | "slide" | "zoom" | "typewriter" | "impact" | "composition"; color: string; accent: string; fontSize: number; x: number; y: number; sound: "pop" | "whoosh" | "impact" | "click" | "none" };
const motionPresets = [{id:"pop",label:"Pop Impact",sound:"pop"},{id:"slide",label:"Slide + Whoosh",sound:"whoosh"},{id:"zoom",label:"Zoom + Impact",sound:"impact"},{id:"typewriter",label:"Typewriter",sound:"click"},{id:"impact",label:"Big Impact",sound:"impact"}] as const;
const defaultDuration = (asset: MediaAsset) => asset.durationMs && asset.durationMs > 0 ? asset.durationMs : asset.kind === "image" ? 5000 : 30000;
const clipDuration = (clip: TimelineClip) => Math.max(0, clip.sourceEndMs - clip.sourceStartMs);
const clipEnd = (clip: TimelineClip) => clip.timelineStartMs + clipDuration(clip);
const timeLabel = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
};

export default function EditorWorkspace({ projectId, assets, onAddMedia }: Props) {
  const storageKey = `ttk-creator:timeline:${projectId}`;
  const sessionKey = `ttk-creator:session:${projectId}`;
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const motionKey = "ttk-creator:motion:" + projectId;
  const [motion, setMotion] = useState<MotionGraphic[]>([]);
  const [selectedMotionId, setSelectedMotionId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<"media" | "audio" | "text" | "effects">("media");
  const [timelineZoom, setTimelineZoom] = useState(100);
  const lastMotionSounds = useRef<Record<string, number>>({});
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  // Keep the real media duration independently from the editable clip end.
  // Local imports do not have duration metadata until the browser loads them.
  const [mediaDurations, setMediaDurations] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewTick, setPreviewTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const motionAudioContext = useRef<AudioContext | null>(null);
  const lastTickRef = useRef(0);
  const trimDragRef = useRef<TrimDrag | null>(null);
  const clipMoveDragRef = useRef<ClipMoveDrag | null>(null);
  const motionTrimDragRef = useRef<MotionTrimDrag | null>(null);

  useEffect(() => {
    try {
      setSelectedId(null);
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as Array<Record<string, unknown>> : [];
      let legacyCursor = 0;
      const restored: TimelineClip[] = [];
      for (const raw of Array.isArray(parsed) ? parsed : []) {
        if (!raw || typeof raw.id !== "string" || typeof raw.assetId !== "string") continue;
        const oldStart = Number(raw.startMs ?? raw.sourceStartMs ?? 0);
        const oldEnd = Number(raw.endMs ?? raw.sourceEndMs ?? 0);
        if (!Number.isFinite(oldStart) || !Number.isFinite(oldEnd) || oldEnd <= oldStart) continue;
        const isNew = Number.isFinite(raw.timelineStartMs) && Number.isFinite(raw.sourceStartMs) && Number.isFinite(raw.sourceEndMs);
        const clip: TimelineClip = {
          id: raw.id,
          assetId: raw.assetId,
          sourceStartMs: isNew ? Number(raw.sourceStartMs) : oldStart,
          sourceEndMs: isNew ? Number(raw.sourceEndMs) : oldEnd,
          sourceDurationMs: Number.isFinite(raw.sourceDurationMs) ? Math.max(0, Number(raw.sourceDurationMs)) : undefined,
          timelineStartMs: isNew ? Math.max(0, Number(raw.timelineStartMs)) : legacyCursor,
          volume: Number.isFinite(raw.volume) ? Math.max(0, Math.min(100, Number(raw.volume))) : 100,
          muted: raw.muted === true,
          cameraMotion: ["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down"].includes(String(raw.cameraMotion)) ? raw.cameraMotion as TimelineClip["cameraMotion"] : "none",
          transitionMs: Number.isFinite(raw.transitionMs) ? Math.max(0, Math.min(2000, Number(raw.transitionMs))) : 500
        };
        restored.push(clip);
        if (!isNew) legacyCursor += clipDuration(clip);
      }
      setClips(restored);
      const sessionRaw = window.localStorage.getItem(sessionKey);
      if (sessionRaw) {
        const session = JSON.parse(sessionRaw) as Record<string, unknown>;
        if (Number.isFinite(session.playheadMs)) setPlayheadMs(Math.max(0, Number(session.playheadMs)));
        if (Number.isFinite(session.timelineZoom)) setTimelineZoom(Math.max(50, Math.min(200, Number(session.timelineZoom))));
        if (typeof session.activeTool === "string" && ["media", "audio", "text", "effects"].includes(session.activeTool)) setActiveTool(session.activeTool as "media" | "audio" | "text" | "effects");
        if (typeof session.selectedId === "string") setSelectedId(session.selectedId);
        if (typeof session.selectedMotionId === "string") setSelectedMotionId(session.selectedMotionId);
      }
    } catch { setClips([]); }
    finally { setLoadedStorageKey(storageKey); }
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey === storageKey) window.localStorage.setItem(storageKey, JSON.stringify(clips));
  }, [storageKey, clips, loadedStorageKey]);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(motionKey); const value = raw ? JSON.parse(raw) : []; setMotion(Array.isArray(value) ? value.map((item: MotionGraphic) => { const startMs = Math.max(0, Number(item.startMs) || 0); const legacyDuration = Math.max(300, Number(item.durationMs) || 1800); const endMs = Number.isFinite(item.endMs) ? Math.max(startMs + 300, Number(item.endMs)) : startMs + legacyDuration; const legacyComposition = item.preset === "composition"; const legacyIcon = item.icon || (legacyComposition ? item.elements?.find(element => element.type === "icon")?.content : ""); return { ...item, preset: legacyComposition ? "pop" : item.preset, icon: legacyIcon || "", fontFamily: item.fontFamily || "Arial", fontWeight: item.fontWeight || 900, textAlign: item.textAlign || "center", startMs, endMs, durationMs: endMs - startMs, x: Number.isFinite(item.x) ? item.x : 50, y: Number.isFinite(item.y) ? item.y : 50 }; }) : []); }
    catch { setMotion([]); }
  }, [motionKey]);
  useEffect(() => { if (loadedStorageKey === storageKey) window.localStorage.setItem(motionKey, JSON.stringify(motion)); }, [motionKey, motion, loadedStorageKey, storageKey]);
  const lastSessionSaveAt = useRef(0);
  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    const now = Date.now();
    if (playing && now - lastSessionSaveAt.current < 1000) return;
    const session = { playheadMs, timelineZoom, activeTool, selectedId, selectedMotionId, savedAt: now };
    window.localStorage.setItem(sessionKey, JSON.stringify(session));
    lastSessionSaveAt.current = now;
  }, [sessionKey, storageKey, loadedStorageKey, playheadMs, timelineZoom, activeTool, selectedId, selectedMotionId, playing]);

  useEffect(() => {
    let cancelled = false;
    async function loadUrls() {
      const missing = assets.filter(asset => !mediaUrls[asset.id]);
      if (!missing.length) return;
      const entries = await Promise.all(missing.map(async asset => {
        try { return [asset.id, convertFileSrc(await desktopApi.getAssetPath(projectId, asset.id))] as const; }
        catch { return [asset.id, ""] as const; }
      }));
      if (!cancelled) setMediaUrls(current => ({ ...current, ...Object.fromEntries(entries) }));
    }
    void loadUrls();
    return () => { cancelled = true; };
  }, [assets, projectId, mediaUrls]);

  const totalDuration = Math.max(clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0), motion.reduce((max, item) => Math.max(max, item.endMs), 0));
  const selectedMotion = motion.find(item => item.id === selectedMotionId) ?? null;
  const activeMotion = motion.filter(item => playheadMs >= item.startMs && playheadMs < item.endMs);
  const selectedClip = clips.find(clip => clip.id === selectedId) ?? clips[0] ?? null;
  const selectedAsset = selectedClip ? assets.find(asset => asset.id === selectedClip.assetId) ?? null : null;
  const visualClips = useMemo(() => clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind !== "audio"), [clips, assets]);
  const audioClips = useMemo(() => clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind === "audio"), [clips, assets]);
  const activeVisualClip = visualClips.find(clip => playheadMs >= clip.timelineStartMs && playheadMs < clipEnd(clip)) ?? null;
  const activeVisualAsset = activeVisualClip ? assets.find(asset => asset.id === activeVisualClip.assetId) ?? null : null;
  const visualProgress = activeVisualClip ? Math.max(0, Math.min(1, (playheadMs - activeVisualClip.timelineStartMs) / Math.max(1, clipDuration(activeVisualClip)))) : 0;
  const transitionDuration = activeVisualClip?.transitionMs ?? 500;
  // Fade only on entrance. Fading both ends of a single clip created a black flash
  // at every cut because the next clip had not become active yet.
  const transitionProgress = activeVisualClip && transitionDuration > 0
    ? Math.max(0, Math.min(1, (playheadMs - activeVisualClip.timelineStartMs) / transitionDuration))
    : 1;
  const previewOpacity = activeVisualClip ? transitionProgress : 1;
  const cameraMotion = activeVisualClip?.cameraMotion ?? "none";
  const cameraTransform = cameraMotion === "zoom-in" ? `scale(${1 + visualProgress * 0.16})` : cameraMotion === "zoom-out" ? `scale(${1.16 - visualProgress * 0.16})` : cameraMotion === "pan-left" ? `scale(1.12) translateX(${-visualProgress * 7}%)` : cameraMotion === "pan-right" ? `scale(1.12) translateX(${visualProgress * 7}%)` : cameraMotion === "pan-up" ? `scale(1.12) translateY(${-visualProgress * 7}%)` : cameraMotion === "pan-down" ? `scale(1.12) translateY(${visualProgress * 7}%)` : "none";
  const previewClip = activeVisualClip ?? selectedClip;
  const previewAsset = activeVisualClip ? activeVisualAsset : selectedAsset;
  const previewUrl = previewAsset ? mediaUrls[previewAsset.id] : "";
  const selectedDuration = selectedClip ? clipDuration(selectedClip) : 0;
  const selectedSourceDuration = selectedAsset ? (selectedAsset.kind === "image" ? Math.max(10 * 60 * 1000, selectedClip?.sourceEndMs ?? 0) : Math.max(selectedClip?.sourceDurationMs ?? mediaDurations[selectedAsset.id] ?? defaultDuration(selectedAsset), selectedClip?.sourceEndMs ?? 0)) : 0;
  // Keep the timeline's time-to-pixel scale anchored to the full source duration.
  // If scale followed the trimmed clip end, a 60s clip would visually expand to fill
  // the canvas as soon as it was shortened, making the trim handle impossible to
  // drag back out past the new end.
  const sourceTimelineDuration = clips.reduce((max, clip) => {
    const asset = assets.find(item => item.id === clip.assetId);
    return Math.max(max, asset ? (clip.sourceDurationMs ?? mediaDurations[asset.id] ?? defaultDuration(asset)) : clip.sourceEndMs);
  }, 0);
  const scale = Math.max(totalDuration, sourceTimelineDuration, 10000);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    videoRef.current?.pause();
    Object.values(audioRefs.current).forEach(node => node?.pause());
  }, []);

  useEffect(() => () => {
    videoRef.current?.pause();
    Object.values(audioRefs.current).forEach(node => node?.pause());
  }, []);

  // A single timeline clock drives the preview and every audio lane, keeping them aligned.
  useEffect(() => {
    if (playing && totalDuration > 0 && playheadMs >= totalDuration) stopPlayback();
  }, [playing, playheadMs, totalDuration, stopPlayback]);

  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;
      setPlayheadMs(current => {
        const next = Math.min(totalDuration, current + elapsed);
        const visual = visualClips.find(clip => next >= clip.timelineStartMs && next < clipEnd(clip));
        if (visual) {
          const asset = assets.find(item => item.id === visual.assetId);
          if (asset?.kind === "video" && videoRef.current) {
            const expected = (visual.sourceStartMs + next - visual.timelineStartMs) / 1000;
            if (Math.abs(videoRef.current.currentTime - expected) > 0.22) videoRef.current.currentTime = expected;
            if (videoRef.current.paused) void videoRef.current.play().catch(() => setLoadError("Não foi possível reproduzir o vídeo."));
          }
        } else {
          videoRef.current?.pause();
        }
        for (const clip of audioClips) {
          const node = audioRefs.current[clip.id];
          if (!node) continue;
          if (next >= clip.timelineStartMs && next < clipEnd(clip)) {
            const expected = (clip.sourceStartMs + next - clip.timelineStartMs) / 1000;
            if (Math.abs(node.currentTime - expected) > 0.22) node.currentTime = expected;
            node.volume = Math.max(0, Math.min(1, clip.volume / 100));
            if (node.paused) void node.play().catch(() => setLoadError("Não foi possível reproduzir o áudio externo."));
          } else if (!node.paused) node.pause();
        }
        return next;
      });
    }, 40);
    return () => window.clearInterval(timer);
  }, [playing, totalDuration, visualClips, audioClips, assets, stopPlayback]);

  useEffect(() => {
    if (!videoRef.current || !previewClip || previewAsset?.kind !== "video") return;
    videoRef.current.volume = Math.max(0, Math.min(1, previewClip.volume / 100));
  }, [previewClip?.id, previewClip?.volume, previewAsset?.id]);

  useEffect(() => {
    if (playing) return;
    const visual = visualClips.find(clip => playheadMs >= clip.timelineStartMs && playheadMs < clipEnd(clip));
    const asset = visual ? assets.find(item => item.id === visual.assetId) : null;
    if (asset?.kind === "video" && videoRef.current) {
      const expected = (visual!.sourceStartMs + playheadMs - visual!.timelineStartMs) / 1000;
      if (Math.abs(videoRef.current.currentTime - expected) > 0.15) videoRef.current.currentTime = expected;
    }
    for (const clip of audioClips) {
      const node = audioRefs.current[clip.id];
      if (!node) continue;
      node.pause();
      if (playheadMs >= clip.timelineStartMs && playheadMs < clipEnd(clip)) {
        node.currentTime = (clip.sourceStartMs + playheadMs - clip.timelineStartMs) / 1000;
      }
    }
  }, [playheadMs, previewTick, playing, visualClips, audioClips, assets]);

  async function exportVideo() {
    if (!isDesktopRuntime || exporting) return;
    stopPlayback();
    setExporting(true);
    setExportMessage("Verificando FFmpeg...");
    try {
      const version = await desktopApi.checkFfmpeg();
      const destination = await save({
        title: "Exportar vídeo",
        defaultPath: "video.mp4",
        filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
      });
      if (!destination) {
        setExportMessage("");
        return;
      }
      setExportMessage("Renderizando com " + version + "...");
      const exportClips = clips.flatMap(clip => {
        const asset = assets.find(item => item.id === clip.assetId);
        return asset ? [{
          id: clip.id,
          assetId: clip.assetId,
          kind: asset.kind,
          sourceStartMs: clip.sourceStartMs,
          sourceEndMs: clip.sourceEndMs,
          timelineStartMs: clip.timelineStartMs,
          volume: clip.volume,
          muted: clip.muted,
        }] : [];
      });
      const result = await desktopApi.exportTimeline({
        projectId,
        destination,
        clips: exportClips,
        motion: motion.map(item => ({startMs:item.startMs,endMs:item.endMs,x:item.x,y:item.y,text:(item.icon ? item.icon + " " : "") + item.text,color:item.color,fontSize:item.fontSize,fontFamily:item.fontFamily || "Arial",fontWeight:item.fontWeight || 900})),
      });
      setExportMessage("Vídeo exportado: " + result);
    } catch (error) {
      setExportMessage("Não foi possível exportar: " + String(error));
    } finally {
      setExporting(false);
    }
  }

  function addMotion(preset: MotionGraphic["preset"]) {
    const definition = motionPresets.find(item => item.id === preset)!;
    const item: MotionGraphic = { id: crypto.randomUUID(), text: preset === "typewriter" ? "YOUR WORD" : "WATCH", icon: "", fontFamily: "Arial", fontWeight: 900, textAlign: "center", startMs: playheadMs, endMs: playheadMs + 3000, durationMs: 3000, preset, color: "#ffffff", accent: "#65d6c0", fontSize: 64, x: 50, y: 50, sound: definition.sound };
    setMotion(current => [...current, item]); setSelectedMotionId(item.id); stopPlayback();
  }
  function updateMotion(id: string, patch: Partial<MotionGraphic>) { setMotion(current => current.map(item => { if (item.id !== id) return item; const nextStart = patch.startMs !== undefined ? Math.max(0, patch.startMs) : item.startMs; let nextEnd = patch.endMs !== undefined ? patch.endMs : item.endMs; if (patch.durationMs !== undefined && patch.endMs === undefined) nextEnd = nextStart + Math.max(300, patch.durationMs); nextEnd = Math.max(nextStart + 300, nextEnd); return { ...item, ...patch, startMs: nextStart, endMs: nextEnd, durationMs: nextEnd - nextStart }; })); }
  function removeMotion(id: string) { setMotion(current => current.filter(item => item.id !== id)); if (selectedMotionId === id) setSelectedMotionId(null); }
  useEffect(() => {
    if (!playing) return;
    for (const item of motion) {
      if (playheadMs >= item.startMs && playheadMs < item.startMs + 80 && lastMotionSounds.current[item.id] !== item.startMs && item.sound !== "none") {
        lastMotionSounds.current[item.id] = item.startMs;
        try {
          const ctx = motionAudioContext.current;
          if (!ctx) continue;
          if (ctx.state === "suspended") void ctx.resume();
          const osc = ctx.createOscillator(); const gain = ctx.createGain(); const now = ctx.currentTime;
          const tones: Record<string, number[]> = { pop: [620,150], click: [1200,700], whoosh: [260,70], impact: [105,35] };
          const tone = tones[item.sound] || tones.pop; osc.type = item.sound === "impact" ? "triangle" : "sine";
          osc.frequency.setValueAtTime(tone[0], now); osc.frequency.exponentialRampToValueAtTime(tone[1], now + 0.18);
          gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
          osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.22);
        } catch { /* Sound effects are optional if audio is unavailable. */ }
      }
    }
  }, [playheadMs, playing, motion]);
  function updateClip(id: string, patch: Partial<TimelineClip>) {
    setClips(current => current.map(clip => clip.id === id ? { ...clip, ...patch } : clip));
  }
  function beginClipTrim(event: ReactPointerEvent<HTMLSpanElement>, clip: TimelineClip, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    trimDragRef.current = { clipId: clip.id, edge, startX: event.clientX, sourceStartMs: clip.sourceStartMs, sourceEndMs: clip.sourceEndMs, timelineStartMs: clip.timelineStartMs, scaleMs: scale };
  }
  function moveClipTrim(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = trimDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const canvas = event.currentTarget.closest(".timeline-canvas");
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const deltaMs = (event.clientX - drag.startX) / rect.width * drag.scaleMs;
    const clip = clips.find(item => item.id === drag.clipId);
    const asset = clip ? assets.find(item => item.id === clip.assetId) : null;
    if (!clip || !asset) return;
    if (drag.edge === "start") {
      const sourceStartMs = Math.max(0, Math.min(drag.sourceEndMs - 250, drag.sourceStartMs + deltaMs));
      const shift = sourceStartMs - drag.sourceStartMs;
      updateClip(drag.clipId, { sourceStartMs, timelineStartMs: Math.max(0, drag.timelineStartMs + shift) });
    } else {
      const maxSourceEndMs = asset.kind === "image" ? 10 * 60 * 1000 : (clip.sourceDurationMs ?? mediaDurations[asset.id] ?? defaultDuration(asset));
      const sourceEndMs = Math.max(drag.sourceStartMs + 250, Math.min(maxSourceEndMs, drag.sourceEndMs + deltaMs));
      updateClip(drag.clipId, { sourceEndMs });
    }
  }
  function endClipTrim(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    trimDragRef.current = null;
  }

  function beginClipMove(event: ReactPointerEvent<HTMLDivElement>, clip: TimelineClip) {
    if ((event.target as HTMLElement).closest(".clip-trim-edge,.clip-controls,button")) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    clipMoveDragRef.current = { clipId: clip.id, startX: event.clientX, timelineStartMs: clip.timelineStartMs };
    setSelectedId(clip.id); setSelectedMotionId(null); stopPlayback();
  }
  function moveClipOnTimeline(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = clipMoveDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.closest(".timeline-canvas")?.getBoundingClientRect();
    if (!rect?.width) return;
    const deltaMs = (event.clientX - drag.startX) / rect.width * scale;
    updateClip(drag.clipId, { timelineStartMs: Math.max(0, drag.timelineStartMs + deltaMs) });
  }
  function endClipMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clipMoveDragRef.current = null;
  }
  function beginMotionTrim(event: ReactPointerEvent<HTMLSpanElement>, item: MotionGraphic, edge: "start" | "end") {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    motionTrimDragRef.current = { id: item.id, edge, startX: event.clientX, startMs: item.startMs, endMs: item.endMs };
    setSelectedMotionId(item.id); setSelectedId(null);
  }
  function beginMotionMove(event: ReactPointerEvent<HTMLButtonElement>, item: MotionGraphic) {
    if ((event.target as HTMLElement).closest(".motion-trim-edge")) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    motionTrimDragRef.current = { id: item.id, edge: "move", startX: event.clientX, startMs: item.startMs, endMs: item.endMs };
    setSelectedMotionId(item.id); setSelectedId(null);
  }
  function moveMotionOnTimeline(event: ReactPointerEvent<HTMLElement>) {
    const drag = motionTrimDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.closest(".timeline-canvas")?.getBoundingClientRect();
    if (!rect?.width) return;
    const deltaMs = (event.clientX - drag.startX) / rect.width * scale;
    if (drag.edge === "move") {
      const startMs = Math.max(0, drag.startMs + deltaMs);
      updateMotion(drag.id, { startMs, endMs: startMs + (drag.endMs - drag.startMs) });
    } else if (drag.edge === "start") {
      updateMotion(drag.id, { startMs: Math.max(0, Math.min(drag.endMs - 300, drag.startMs + deltaMs)) });
    } else {
      updateMotion(drag.id, { endMs: Math.max(drag.startMs + 300, drag.endMs + deltaMs) });
    }
  }
  function endMotionTrim(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    motionTrimDragRef.current = null;
  }

  function addToTimeline(asset: MediaAsset, atMs?: number) {
    const duration = defaultDuration(asset);
    const clip: TimelineClip = {
      id: crypto.randomUUID(), assetId: asset.id, sourceStartMs: 0, sourceEndMs: duration,
      timelineStartMs: Math.max(0, atMs ?? (asset.kind === "audio" ? 0 : visualClips.reduce((max, item) => Math.max(max, clipEnd(item)), 0))),
      volume: 100, muted: false
    };
    setClips(current => [...current, clip]);
    setSelectedId(clip.id);
    stopPlayback();
  }

  function removeClip(id: string) {
    setClips(current => current.filter(clip => clip.id !== id));
    if (selectedId === id) setSelectedId(null);
    stopPlayback();
  }

  function moveVisualClip(id: string, direction: -1 | 1) {
    const ordered = [...visualClips].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    const index = ordered.findIndex(clip => clip.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    let cursor = ordered[0]?.timelineStartMs ?? 0;
    const repositioned = ordered.map(clip => {
      const next = { ...clip, timelineStartMs: cursor };
      cursor += clipDuration(clip);
      return next;
    });
    const byId = new Map(repositioned.map(clip => [clip.id, clip]));
    setClips(current => current.map(clip => byId.get(clip.id) ?? clip));
    setSelectedId(id);
    setSelectedMotionId(null);
    stopPlayback();
  }

  function duplicateClip(clip: TimelineClip) {
    const copy = { ...clip, id: crypto.randomUUID(), timelineStartMs: clipEnd(clip) };
    setClips(current => [...current, copy]);
    setSelectedId(copy.id);
    stopPlayback();
  }

  function splitAtPlayhead() {
    const clip = activeVisualClip ?? selectedClip;
    if (!clip || playheadMs <= clip.timelineStartMs + 250 || playheadMs >= clipEnd(clip) - 250) return;
    const sourceSplit = clip.sourceStartMs + playheadMs - clip.timelineStartMs;
    const left = { ...clip, sourceEndMs: sourceSplit };
    const right = { ...clip, id: crypto.randomUUID(), sourceStartMs: sourceSplit, timelineStartMs: playheadMs };
    setClips(current => current.flatMap(item => item.id === clip.id ? [left, right] : [item]));
    setSelectedId(right.id);
    stopPlayback();
  }

  function seekTo(ms: number) {
    const bounded = Math.max(0, Math.min(totalDuration, ms));
    setPlayheadMs(bounded);
    const visual = visualClips.find(clip => bounded >= clip.timelineStartMs && bounded < clipEnd(clip));
    const audio = audioClips.find(clip => bounded >= clip.timelineStartMs && bounded < clipEnd(clip));
    const found = visual ?? audio;
    if (found) setSelectedId(found.id);
    setPreviewTick(value => value + 1);
  }

  function togglePlayback() {
    if (playing) { stopPlayback(); return; }
    if (!clips.length) return;
    // Initialize/resume Web Audio directly from the user gesture so browser autoplay policies allow SFX.
    try {
      if (!motionAudioContext.current) {
        const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) motionAudioContext.current = new Ctx();
      }
      if (motionAudioContext.current?.state === "suspended") void motionAudioContext.current.resume();
    } catch { /* Motion sound is optional when Web Audio is unavailable. */ }
    if (playheadMs >= totalDuration) setPlayheadMs(0);
    setPlaying(true);
  }

  function handleAssetDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const atMs = ratio * scale;
    const assetId = event.dataTransfer.getData("text/asset-id");
    const clipId = event.dataTransfer.getData("text/timeline-clip-id");
    if (clipId) {
      updateClip(clipId, { timelineStartMs: atMs });
      stopPlayback();
    } else {
      const asset = assets.find(item => item.id === assetId);
      if (asset) addToTimeline(asset, atMs);
    }
  }

  const percentLeft = (clip: TimelineClip) => (clip.timelineStartMs / scale) * 100;
  const percentWidth = (clip: TimelineClip) => Math.max(1.2, (clipDuration(clip) / scale) * 100);


  return <section className="framelab-editor">
    <aside className="editor-tool-rail" aria-label="Ferramentas">
      <button className={activeTool === "media" ? "active" : ""} onClick={() => setActiveTool("media")}><Film size={19}/><small>Mídia</small></button>
      <button className={activeTool === "audio" ? "active" : ""} onClick={() => setActiveTool("audio")}><Music2 size={19}/><small>Áudio</small></button>
      <button className={activeTool === "text" ? "active" : ""} onClick={() => setActiveTool("text")}><Type size={19}/><small>Texto</small></button>
      <button className={activeTool === "effects" ? "active" : ""} onClick={() => setActiveTool("effects")}><WandSparkles size={19}/><small>Efeitos</small></button>
    </aside>
    <aside className="editor-content-panel">
      {activeTool === "media" && <>
        <div className="editor-panel-head"><div><b>Biblioteca</b><small>{assets.length} arquivo(s) disponíveis</small></div><button className="secondary-action" onClick={onAddMedia}><Plus size={14}/> Importar</button></div>
        {assets.length ? <div className="editor-media-grid">{assets.map(asset => <article key={asset.id} className="editor-media-card" draggable onDragStart={event => event.dataTransfer.setData("text/asset-id", asset.id)}>
          <div className={"editor-media-thumb " + asset.kind}>{asset.kind === "image" && mediaUrls[asset.id] ? <img src={mediaUrls[asset.id]} alt={asset.name}/> : asset.kind === "video" && mediaUrls[asset.id] ? <video src={mediaUrls[asset.id]} muted preload="auto" playsInline/> : asset.kind === "video" ? <Film size={22}/> : <AudioLines size={22}/>}<small>{timeLabel(defaultDuration(asset))}</small></div>
          <b title={asset.name}>{asset.name}</b><button className="icon-action" title="Adicionar à timeline" onClick={() => addToTimeline(asset)}><Plus size={15}/></button>
        </article>)}</div> : <div className="editor-empty"><Film size={24}/><b>Nenhuma mídia importada</b><p>Adicione vídeos, áudios ou imagens para começar.</p><button className="primary" onClick={onAddMedia}><Plus size={14}/> Importar mídia</button></div>}
      </>}
      {activeTool === "audio" && <>
        <div className="editor-panel-head"><div><b>Áudio</b><small>Arquivos de áudio da biblioteca</small></div><button className="secondary-action" onClick={onAddMedia}><Plus size={14}/> Importar</button></div>
        <div className="editor-media-grid">{assets.filter(asset => asset.kind === "audio").map(asset => <article key={asset.id} className="editor-media-card" draggable onDragStart={event => event.dataTransfer.setData("text/asset-id", asset.id)}><div className="editor-media-thumb audio"><AudioLines size={22}/><small>{timeLabel(defaultDuration(asset))}</small></div><b title={asset.name}>{asset.name}</b><button className="icon-action" title="Adicionar à timeline" onClick={() => addToTimeline(asset)}><Plus size={15}/></button></article>)}</div>
        {!assets.some(asset => asset.kind === "audio") && <div className="editor-empty"><AudioLines size={24}/><b>Nenhum áudio importado</b><p>Importe uma faixa para adicioná-la à timeline.</p><button className="primary" onClick={onAddMedia}><Plus size={14}/> Importar áudio</button></div>}
      </>}
      {activeTool === "text" && <>
        <div className="editor-panel-head"><div><b>Motion Graphics</b><small>Composições e textos animados com efeitos sonoros.</small></div><span className="preview-live">{motion.length} ELEMENTO(S)</span></div>
        <div className="motion-presets editor-preset-grid">{motionPresets.map(preset => <button key={preset.id} className="motion-preset" onClick={() => addMotion(preset.id)}><b>{preset.label}</b><small>Som: {preset.sound}</small><span>+ Adicionar</span></button>)}</div>
      </>}
      {activeTool === "effects" && <>
        <div className="editor-panel-head"><div><b>Efeitos</b><small>Recursos visuais e sonoros</small></div></div>
        <div className="editor-media-grid"><article className="editor-media-card"><div className="editor-media-thumb"><WandSparkles size={22}/></div><b>Efeitos visuais</b><small>Em preparação</small></article><article className="editor-media-card"><div className="editor-media-thumb audio"><AudioLines size={22}/></div><b>Efeitos sonoros</b><small>Disponíveis em Texto</small></article></div>
      </>}
    </aside>
    <section className="editor-center">
      <div className="preview-stage"><div className="preview-media-frame">
        {!previewAsset ? <div className="preview-placeholder"><Play size={27}/><span>Seu vídeo aparecerá aqui</span><small>Adicione uma mídia à timeline para visualizar</small></div> :
          !previewUrl ? <div className="preview-placeholder"><span>Não foi possível carregar esta mídia.</span><small>{loadError || "Verifique se o arquivo continua na pasta do projeto."}</small></div> :
          previewAsset.kind === "video" ? <video key={previewAsset.id} ref={videoRef} src={previewUrl} muted={!!previewClip?.muted} controls={!playing} style={{ opacity: previewOpacity, transition: "opacity 40ms linear" }} onError={() => setLoadError("Formato não suportado pelo preview do sistema.")}/> :
          previewAsset.kind === "audio" ? <div className="audio-preview"><AudioLines size={48}/><b>{previewAsset.name}</b><span>Áudio na timeline</span></div> :
          <img src={previewUrl} alt={previewAsset.name} style={{ opacity: previewOpacity, transform: cameraTransform, transition: "opacity 40ms linear" }}/>}
        {activeMotion.map(item => <div key={item.id} className={"motion-overlay motion-" + item.preset + (selectedMotionId === item.id ? " motion-selected" : "")} style={{ "--motion-color": item.color, "--motion-accent": item.accent, "--motion-size": item.fontSize + "px", "--motion-delay": "-" + Math.min(650, playheadMs - item.startMs) + "ms", "--motion-x": item.x + "%", "--motion-y": item.y + "%" } as CSSProperties}>
          <span className="motion-main-text" style={{fontFamily:item.fontFamily || "Arial",fontWeight:item.fontWeight || 900,textAlign:item.textAlign || "center"}} onPointerDown={event => { setSelectedId(null); setSelectedMotionId(item.id); event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.closest(".preview-media-frame")?.getBoundingClientRect(); if (!rect) return; updateMotion(item.id, { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) }); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>{item.icon && <i className="motion-inline-icon">{item.icon}</i>}{item.text}</span>
        </div>)}
      </div></div>
      <div className="editor-transport">
        <button className="transport-button" title="Voltar ao início" onClick={() => { stopPlayback(); seekTo(0); }}><SkipBack size={15}/></button>
        <button className="transport-play" onClick={togglePlayback} disabled={!clips.length}>{playing ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}{playing ? "Pausar" : "Reproduzir"}</button>
        <button className="transport-button" title="Avançar 5 segundos" onClick={() => seekTo(playheadMs + 5000)}><SkipForward size={15}/></button>
        <span className="transport-time">{timeLabel(playheadMs)} / {timeLabel(totalDuration)}</span><button className="primary export-inline" onClick={() => void exportVideo()} disabled={exporting || !visualClips.length}>{exporting ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>} {exporting ? "Exportando..." : "Exportar MP4"}</button>
      </div>
      {exportMessage && <div className="export-status" role="status">{exportMessage}</div>}
    </section>
    <aside className="editor-properties">
      {selectedMotion ? <>
        <div className="editor-panel-head"><div><b>Propriedades</b><small>Texto, tipografia e animação</small></div></div>
        <div className="properties-scroll">
          <details open className="property-section"><summary>Texto</summary>
            <label>Conteúdo<input value={selectedMotion.text} onChange={event => updateMotion(selectedMotion.id, { text: event.target.value })} maxLength={500} placeholder="Digite sua palavra ou frase"/></label>
            <label>Ícone ao lado da palavra<input value={selectedMotion.icon || ""} onChange={event => updateMotion(selectedMotion.id, { icon: event.target.value })} maxLength={12} placeholder="Ex.: 👁  ★  →  ✓"/></label>
            <small className="property-hint">Digite ou cole um emoji/símbolo. Deixe vazio para não exibir ícone.</small>
          </details>
          <details open className="property-section"><summary>Tempo</summary><div className="motion-fields two"><label>Início (s)<input type="number" min="0" step="0.1" value={(selectedMotion.startMs / 1000).toFixed(1)} onChange={event => updateMotion(selectedMotion.id, { startMs: Math.max(0, Number(event.target.value) * 1000) })}/></label><label>Saída (s)<input type="number" min={(selectedMotion.startMs / 1000 + 0.3).toFixed(1)} step="0.1" value={(selectedMotion.endMs / 1000).toFixed(1)} onChange={event => updateMotion(selectedMotion.id, { endMs: Math.max(selectedMotion.startMs + 300, Number(event.target.value) * 1000) })}/></label><label>Duração calculada (s)<input type="number" value={(selectedMotion.durationMs / 1000).toFixed(1)} readOnly title="Calculada automaticamente pelo início e pelo horário de saída"/></label></div></details>
          <details open className="property-section"><summary>Estilo</summary>
            <label>Fonte<select value={selectedMotion.fontFamily || "Arial"} onChange={event => updateMotion(selectedMotion.id, { fontFamily: event.target.value })}>
              <option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Impact">Impact</option><option value="Trebuchet MS">Trebuchet MS</option><option value="Verdana">Verdana</option><option value="Courier New">Courier New</option>
            </select></label>
            <label>Tamanho<input type="number" min="18" max="180" value={selectedMotion.fontSize} onChange={event => updateMotion(selectedMotion.id, { fontSize: Math.max(18, Math.min(180, Number(event.target.value))) })}/></label>
            <label>Peso<select value={selectedMotion.fontWeight || 900} onChange={event => updateMotion(selectedMotion.id, { fontWeight: Number(event.target.value) })}><option value={400}>Normal</option><option value={600}>Semibold</option><option value={700}>Negrito</option><option value={900}>Extra negrito</option></select></label>
            <label>Alinhamento<select value={selectedMotion.textAlign || "center"} onChange={event => updateMotion(selectedMotion.id, { textAlign: event.target.value as MotionGraphic["textAlign"] })}><option value="left">Esquerda</option><option value="center">Centralizado</option><option value="right">Direita</option></select></label>
            <label>Animação<select value={selectedMotion.preset} onChange={event => updateMotion(selectedMotion.id, { preset: event.target.value as MotionGraphic["preset"] })}>{motionPresets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <label>Efeito sonoro<select value={selectedMotion.sound} onChange={event => updateMotion(selectedMotion.id, { sound: event.target.value as MotionGraphic["sound"] })}><option value="pop">Pop</option><option value="whoosh">Whoosh</option><option value="impact">Impacto</option><option value="click">Click</option><option value="none">Sem som</option></select></label>
            <div className="motion-colors"><label>Texto<input type="color" value={selectedMotion.color} onChange={event => updateMotion(selectedMotion.id, { color: event.target.value })}/></label><label>Destaque<input type="color" value={selectedMotion.accent} onChange={event => updateMotion(selectedMotion.id, { accent: event.target.value })}/></label></div>
          </details>
          <details open className="property-section"><summary>Posição</summary><div className="motion-position-controls"><label>Horizontal <strong>{Math.round(selectedMotion.x)}%</strong><input type="range" min="0" max="100" value={selectedMotion.x} onChange={event => updateMotion(selectedMotion.id, { x: Number(event.target.value) })}/></label><label>Vertical <strong>{Math.round(selectedMotion.y)}%</strong><input type="range" min="0" max="100" value={selectedMotion.y} onChange={event => updateMotion(selectedMotion.id, { y: Number(event.target.value) })}/></label><button className="secondary-action" onClick={() => updateMotion(selectedMotion.id, { x: 50, y: 50 })}>Centralizar</button></div></details>
          <button className="danger-action property-delete" onClick={() => removeMotion(selectedMotion.id)}>Excluir elemento</button>
        </div>
      </> : <>
        <div className="editor-panel-head"><div><b>Ajustes do clipe</b><small>{selectedAsset?.name ?? "Selecione um clipe na timeline"}</small></div></div>
        <div className="properties-scroll">
          {selectedClip && selectedAsset ? <>
            <div className="trim-heading"><b><Scissors size={14}/> Ajustes do clipe</b><span>{timeLabel(selectedDuration)}</span></div>
            <label className="property-control">Início do arquivo <strong>{timeLabel(selectedClip.sourceStartMs)}</strong><input type="range" min={0} max={Math.max(1000, selectedSourceDuration - 250)} step={100} value={selectedClip.sourceStartMs} onChange={event => updateClip(selectedClip.id, { sourceStartMs: Math.min(Number(event.target.value), selectedClip.sourceEndMs - 250) })}/><input className="numeric-time-input" type="number" min="0" max={Math.max(0, selectedClip.sourceEndMs-250)} step="0.1" value={(selectedClip.sourceStartMs/1000).toFixed(1)} aria-label="Início do arquivo em segundos" onChange={event=>{const value=Number(event.target.value);if(event.target.value!==""&&Number.isFinite(value))updateClip(selectedClip.id,{sourceStartMs:Math.max(0,Math.min(value*1000,selectedClip.sourceEndMs-250))});}}/></label>
            <label className="property-control">Fim do arquivo <strong>{timeLabel(selectedClip.sourceEndMs)}</strong><input type="range" min={250} max={Math.max(250, selectedSourceDuration)} step={100} value={Math.min(selectedClip.sourceEndMs, selectedSourceDuration)} onChange={event => updateClip(selectedClip.id, { sourceEndMs: Math.max(Number(event.target.value), selectedClip.sourceStartMs + 250) })}/><input className="numeric-time-input" type="number" min={(selectedClip.sourceStartMs+250)/1000} max={selectedSourceDuration/1000} step="0.1" value={(selectedClip.sourceEndMs/1000).toFixed(1)} aria-label="Fim do arquivo em segundos" onChange={event=>{const value=Number(event.target.value);if(event.target.value!==""&&Number.isFinite(value))updateClip(selectedClip.id,{sourceEndMs:Math.max(selectedClip.sourceStartMs+250,Math.min(value*1000,selectedSourceDuration))});}}/></label>
            <div className="clip-order-controls"><span>Ordem de exibição</span><div><button className="secondary-action" onClick={() => moveVisualClip(selectedClip.id, -1)} disabled={visualClips.slice().sort((a,b)=>a.timelineStartMs-b.timelineStartMs)[0]?.id === selectedClip.id}><ChevronLeft size={14}/> Antes</button><button className="secondary-action" onClick={() => moveVisualClip(selectedClip.id, 1)} disabled={visualClips.slice().sort((a,b)=>a.timelineStartMs-b.timelineStartMs)[visualClips.length - 1]?.id === selectedClip.id}>Depois <ChevronRight size={14}/></button></div></div>
            {selectedAsset.kind === "video" && <div className="clip-toggle-row"><span><Volume2 size={14}/> Áudio original do vídeo</span><button className={selectedClip.muted ? "mute-toggle muted" : "mute-toggle"} onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted })}>{selectedClip.muted ? <><VolumeX size={14}/> Silenciado</> : <><Volume2 size={14}/> Com som</>}</button></div>}
            {(selectedAsset.kind === "audio" || selectedAsset.kind === "video") && <label className="volume-control">Volume {selectedAsset.kind === "audio" ? "do áudio" : "do vídeo"} <strong>{selectedClip.volume}%</strong><input type="range" min={0} max={100} value={selectedClip.volume} onChange={event => updateClip(selectedClip.id, { volume: Number(event.target.value) })}/></label>}
            {selectedAsset.kind === "image" && <div className="property-section"><b>Movimento da imagem</b><label className="property-control">Movimento de câmera<select value={selectedClip.cameraMotion ?? "none"} onChange={event => updateClip(selectedClip.id, { cameraMotion: event.target.value as TimelineClip["cameraMotion"] })}><option value="none">Sem movimento</option><option value="zoom-in">Zoom lento de aproximação</option><option value="zoom-out">Zoom lento de afastamento</option><option value="pan-left">Câmera para a esquerda</option><option value="pan-right">Câmera para a direita</option><option value="pan-up">Câmera para cima</option><option value="pan-down">Câmera para baixo</option></select></label></div>}
            {selectedAsset.kind !== "audio" && <label className="property-control">Transição suave <strong>{(selectedClip.transitionMs ?? 500)} ms</strong><input type="range" min={0} max={2000} step={100} value={selectedClip.transitionMs ?? 500} onChange={event => updateClip(selectedClip.id, { transitionMs: Number(event.target.value) })}/></label>}
            <label className="property-control">Posição na timeline <strong>{timeLabel(selectedClip.timelineStartMs)}</strong><input type="range" min={0} max={Math.max(1000, totalDuration + 10000)} step={100} value={selectedClip.timelineStartMs} onChange={event => updateClip(selectedClip.id, { timelineStartMs: Number(event.target.value) })}/><input className="numeric-time-input" type="number" min="0" step="0.1" value={(selectedClip.timelineStartMs/1000).toFixed(1)} aria-label="Posição na timeline em segundos" onChange={event=>{const value=Number(event.target.value);if(event.target.value!==""&&Number.isFinite(value))updateClip(selectedClip.id,{timelineStartMs:Math.max(0,value*1000)});}}/></label>
          </> : <div className="editor-empty"><MousePointer2 size={24}/><b>Nenhum clipe selecionado</b><p>Adicione uma mídia à timeline para ajustar seus parâmetros.</p></div>}
        </div>
      </>}
    </aside>
    <section className="editor-timeline">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-actions">
          <button className="secondary-action" onClick={splitAtPlayhead} disabled={!activeVisualClip || playheadMs <= activeVisualClip.timelineStartMs + 250 || playheadMs >= clipEnd(activeVisualClip) - 250}><Scissors size={13}/> Dividir no cursor</button>
          <button className="secondary-action" onClick={() => selectedClip && duplicateClip(selectedClip)} disabled={!selectedClip}><Copy size={13}/> Duplicar</button>
          <button className="secondary-action danger-action" onClick={() => selectedClip && removeClip(selectedClip.id)} disabled={!selectedClip}><Trash2 size={13}/> Excluir selecionado</button>
          <button className="secondary-action" onClick={() => { stopPlayback(); setClips([]); setSelectedId(null); setPlayheadMs(0); }} disabled={!clips.length}><Trash2 size={13}/> Limpar timeline</button>
        </div>
        <label className="timeline-zoom">Zoom <input type="range" min="50" max="200" step="10" value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))}/></label>
      </div>
      
      <div className="timeline-lanes"><div className="timeline-ruler timeline-grid-ruler"><div className="timeline-track-label-spacer"/><div className="timeline-ruler-canvas" style={{width:Math.max(100,timelineZoom)+"%"}}>{Array.from({length:Math.ceil(scale/1000)+1},(_,second)=>second).map(second=><span key={second} className={second%5===0?"major":""} style={{left:(second*1000/scale*100)+"%"}}>{second%5===0?timeLabel(second*1000):""}</span>)}</div></div>
        <div className="timeline-track timeline-positioned-track"><div className="track-label">VÍDEO / IMAGEM</div><div className="track-clips timeline-canvas" style={{width:Math.max(100,timelineZoom)+"%"}} onDragOver={event=>event.preventDefault()} onDrop={handleAssetDrop}>
          {visualClips.map(clip=>{const asset=assets.find(item=>item.id===clip.assetId);if(!asset)return null;return <div key={clip.id} role="button" tabIndex={0} className={"timeline-clip positioned-clip "+asset.kind+(selectedId===clip.id?" selected":"")} style={{left:percentLeft(clip)+"%",width:percentWidth(clip)+"%",touchAction:"none"}} onPointerDown={event=>beginClipMove(event,clip)} onPointerMove={moveClipOnTimeline} onPointerUp={endClipMove} onPointerCancel={endClipMove} onClick={()=>{setSelectedId(clip.id);setSelectedMotionId(null);seekTo(clip.timelineStartMs);}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelectedId(clip.id);setSelectedMotionId(null);seekTo(clip.timelineStartMs);}}}><span className="clip-trim-edge left" onPointerDown={event => beginClipTrim(event, clip, "start")} onPointerMove={moveClipTrim} onPointerUp={endClipTrim} onPointerCancel={endClipTrim}/><span className="clip-trim-edge right" onPointerDown={event => beginClipTrim(event, clip, "end")} onPointerMove={moveClipTrim} onPointerUp={endClipTrim} onPointerCancel={endClipTrim}/>{asset.kind === "video" && mediaUrls[asset.id] && <video className="timeline-thumb-video" src={mediaUrls[asset.id]} muted preload="auto" playsInline/>}{asset.kind === "image" && mediaUrls[asset.id] && <img className="timeline-thumb-video" src={mediaUrls[asset.id]} alt="" /> }<b>{asset.name}</b><small>{timeLabel(clipDuration(clip))}</small><span className="clip-controls"><button type="button" title="Duplicar" onClick={event=>{event.stopPropagation();duplicateClip(clip);}}><Copy size={12}/></button><button type="button" title="Excluir" onClick={event=>{event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></button></span></div>;})}
          {!visualClips.length&&<span className="track-hint">Arraste vídeos ou imagens da biblioteca para cá</span>}<div className="timeline-cursor" style={{left:playheadMs/scale*100+"%"}}/>
        </div></div>
        <div className="timeline-track timeline-positioned-track audio-track"><div className="track-label">ÁUDIO</div><div className="track-clips timeline-canvas" style={{width:Math.max(100,timelineZoom)+"%"}} onDragOver={event=>event.preventDefault()} onDrop={handleAssetDrop}>
          {audioClips.map(clip=>{const asset=assets.find(item=>item.id===clip.assetId);if(!asset)return null;return <div key={clip.id} role="button" tabIndex={0} className={"timeline-clip audio positioned-clip"+(selectedId===clip.id?" selected":"")} style={{left:percentLeft(clip)+"%",width:percentWidth(clip)+"%",touchAction:"none"}} onPointerDown={event=>beginClipMove(event,clip)} onPointerMove={moveClipOnTimeline} onPointerUp={endClipMove} onPointerCancel={endClipMove} onClick={()=>{setSelectedId(clip.id);setSelectedMotionId(null);seekTo(clip.timelineStartMs);}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelectedId(clip.id);setSelectedMotionId(null);seekTo(clip.timelineStartMs);}}}><span className="clip-trim-edge left" onPointerDown={event => beginClipTrim(event, clip, "start")} onPointerMove={moveClipTrim} onPointerUp={endClipTrim} onPointerCancel={endClipTrim}/><span className="clip-trim-edge right" onPointerDown={event => beginClipTrim(event, clip, "end")} onPointerMove={moveClipTrim} onPointerUp={endClipTrim} onPointerCancel={endClipTrim}/><b>{asset.name}</b><small>{timeLabel(clipDuration(clip))} · {timeLabel(clip.timelineStartMs)}</small><span className="audio-waveform" aria-hidden="true">{Array.from({length:36},(_,index)=><i key={index} style={{height:(18+((index*17+clip.id.length*13)%66))+"%"}}/>)}</span><span className="clip-controls"><button type="button" title="Duplicar" onClick={event=>{event.stopPropagation();duplicateClip(clip);}}><Copy size={12}/></button><button type="button" title="Excluir" onClick={event=>{event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></button></span></div>;})}
          {!audioClips.length&&<span className="track-hint">Arraste um áudio para cá. Ele tocará junto com o vídeo</span>}<div className="timeline-cursor" style={{left:playheadMs/scale*100+"%"}}/>
        </div></div>
        <div className="motion-track-row timeline-motion-row"><div className="track-label">COMPOSIÇÕES</div><div className="track-clips timeline-canvas motion-timeline" style={{width:Math.max(100,timelineZoom)+"%"}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData("text/motion-graphic-id");if(!id)return;const rect=event.currentTarget.getBoundingClientRect();updateMotion(id,{startMs:Math.max(0,(event.clientX-rect.left)/rect.width*scale)});}}>
          {motion.map(item=><button key={item.id} className={"motion-timeline-clip"+(selectedMotionId===item.id?" selected":"")} style={{left:item.startMs/scale*100+"%",width:Math.max(3,(item.endMs-item.startMs)/scale*100)+"%",touchAction:"none"}} onPointerDown={event=>beginMotionMove(event,item)} onPointerMove={moveMotionOnTimeline} onPointerUp={endMotionTrim} onPointerCancel={endMotionTrim} onClick={()=>{setSelectedMotionId(item.id);setSelectedId(null);seekTo(item.startMs);}}><span className="motion-trim-edge left" onPointerDown={event=>beginMotionTrim(event,item,"start")} onPointerMove={moveMotionOnTimeline} onPointerUp={endMotionTrim} onPointerCancel={endMotionTrim}/><b>{item.icon ? item.icon + " " : ""}{item.text}</b><small>{item.preset}</small><span className="motion-trim-edge right" onPointerDown={event=>beginMotionTrim(event,item,"end")} onPointerMove={moveMotionOnTimeline} onPointerUp={endMotionTrim} onPointerCancel={endMotionTrim}/></button>)}
          <div className="timeline-cursor" style={{left:playheadMs/scale*100+"%"}}/>
        </div></div>
      </div>
      {audioClips.map(clip=>{const asset=assets.find(item=>item.id===clip.assetId);const url=mediaUrls[clip.assetId];return asset&&url?<audio key={clip.id} ref={node=>{audioRefs.current[clip.id]=node;}} src={url} preload="metadata" onLoadedMetadata={event=>{const durationMs=event.currentTarget.duration*1000;if(!Number.isFinite(durationMs)||durationMs<=0)return;const measuredDurationMs=Math.round(durationMs);setMediaDurations(current=>({...current,[asset.id]:measuredDurationMs}));setClips(current=>current.map(item=>{if(item.assetId!==asset.id)return item;const shouldExpandDefault=item.sourceDurationMs==null&&item.sourceEndMs===30000;const shouldClamp=item.sourceEndMs>durationMs;return {...item,sourceDurationMs:measuredDurationMs,sourceEndMs:shouldExpandDefault||shouldClamp?measuredDurationMs:item.sourceEndMs};}));}}/>:null;})}
    </section>
  </section>;
}
