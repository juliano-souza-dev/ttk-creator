import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "./services/desktop-api";
import type { MediaAsset } from "./shared/types";
import { AudioLines, Film, Image as ImageIcon, Plus, Play, Pause, Trash2, Scissors, Clock3, Copy, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";

type TimelineClip = {
  id: string;
  assetId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  volume: number;
  muted?: boolean;
};
type Props = { projectId: string; assets: MediaAsset[]; onAddMedia: () => void };
type MotionGraphic = { id: string; text: string; startMs: number; durationMs: number; preset: "pop" | "slide" | "zoom" | "typewriter" | "impact"; color: string; accent: string; fontSize: number; x: number; y: number; sound: "pop" | "whoosh" | "impact" | "click" | "none" };
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
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const motionKey = "ttk-creator:motion:" + projectId;
  const [motion, setMotion] = useState<MotionGraphic[]>([]);
  const [selectedMotionId, setSelectedMotionId] = useState<string | null>(null);
  const lastMotionSounds = useRef<Record<string, number>>({});
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewTick, setPreviewTick] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const lastTickRef = useRef(0);

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
          timelineStartMs: isNew ? Math.max(0, Number(raw.timelineStartMs)) : legacyCursor,
          volume: Number.isFinite(raw.volume) ? Math.max(0, Math.min(100, Number(raw.volume))) : 100,
          muted: raw.muted === true
        };
        restored.push(clip);
        if (!isNew) legacyCursor += clipDuration(clip);
      }
      setClips(restored);
      setPlayheadMs(0);
    } catch { setClips([]); }
    finally { setLoadedStorageKey(storageKey); }
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey === storageKey) window.localStorage.setItem(storageKey, JSON.stringify(clips));
  }, [storageKey, clips, loadedStorageKey]);
  useEffect(() => {
    try { const raw = window.localStorage.getItem(motionKey); const value = raw ? JSON.parse(raw) : []; setMotion(Array.isArray(value) ? value : []); }
    catch { setMotion([]); }
  }, [motionKey]);
  useEffect(() => { window.localStorage.setItem(motionKey, JSON.stringify(motion)); }, [motionKey, motion]);

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

  const totalDuration = Math.max(clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0), motion.reduce((max, item) => Math.max(max, item.startMs + item.durationMs), 0));
  const selectedMotion = motion.find(item => item.id === selectedMotionId) ?? null;
  const activeMotion = motion.filter(item => playheadMs >= item.startMs && playheadMs < item.startMs + item.durationMs);
  const selectedClip = clips.find(clip => clip.id === selectedId) ?? clips[0] ?? null;
  const selectedAsset = selectedClip ? assets.find(asset => asset.id === selectedClip.assetId) ?? null : null;
  const visualClips = useMemo(() => clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind !== "audio"), [clips, assets]);
  const audioClips = useMemo(() => clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind === "audio"), [clips, assets]);
  const activeVisualClip = visualClips.find(clip => playheadMs >= clip.timelineStartMs && playheadMs < clipEnd(clip)) ?? null;
  const activeVisualAsset = activeVisualClip ? assets.find(asset => asset.id === activeVisualClip.assetId) ?? null : null;
  const previewClip = activeVisualClip ?? selectedClip;
  const previewAsset = activeVisualClip ? activeVisualAsset : selectedAsset;
  const previewUrl = previewAsset ? mediaUrls[previewAsset.id] : "";
  const previewSourceMs = previewClip ? previewClip.sourceStartMs + Math.max(0, playheadMs - previewClip.timelineStartMs) : 0;
  const selectedDuration = selectedClip ? clipDuration(selectedClip) : 0;
  const selectedSourceDuration = selectedAsset ? defaultDuration(selectedAsset) : 0;
  const scale = Math.max(totalDuration, 10000);

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

  function addMotion(preset: MotionGraphic["preset"]) {
    const definition = motionPresets.find(item => item.id === preset)!;
    const item: MotionGraphic = { id: crypto.randomUUID(), text: preset === "typewriter" ? "YOUR WORD" : "WATCH", startMs: playheadMs, durationMs: 1800, preset, color: "#ffffff", accent: "#c4a5ff", fontSize: 64, x: 50, y: 50, sound: definition.sound };
    setMotion(current => [...current, item]); setSelectedMotionId(item.id); stopPlayback();
  }
  function updateMotion(id: string, patch: Partial<MotionGraphic>) { setMotion(current => current.map(item => item.id === id ? { ...item, ...patch } : item)); }
  function removeMotion(id: string) { setMotion(current => current.filter(item => item.id !== id)); if (selectedMotionId === id) setSelectedMotionId(null); }
  useEffect(() => {
    if (!playing) return;
    for (const item of motion) {
      if (playheadMs >= item.startMs && playheadMs < item.startMs + 80 && lastMotionSounds.current[item.id] !== item.startMs && item.sound !== "none") {
        lastMotionSounds.current[item.id] = item.startMs;
        try {
          const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) continue;
          const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); const now = ctx.currentTime;
          const tones: Record<string, number[]> = { pop: [620,150], click: [1200,700], whoosh: [260,70], impact: [105,35] };
          const tone = tones[item.sound] || tones.pop; osc.type = item.sound === "impact" ? "triangle" : "sine";
          osc.frequency.setValueAtTime(tone[0], now); osc.frequency.exponentialRampToValueAtTime(tone[1], now + 0.18);
          gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
          osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.22); window.setTimeout(() => void ctx.close(), 500);
        } catch { /* Sound effects are optional if audio is unavailable. */ }
      }
    }
  }, [playheadMs, playing, motion]);
  function updateClip(id: string, patch: Partial<TimelineClip>) {
    setClips(current => current.map(clip => clip.id === id ? { ...clip, ...patch } : clip));
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

  function handleClipDragStart(event: DragEvent<HTMLButtonElement>, clip: TimelineClip) {
    event.dataTransfer.setData("text/timeline-clip-id", clip.id);
    event.dataTransfer.effectAllowed = "move";
  }

  const percentLeft = (clip: TimelineClip) => (clip.timelineStartMs / scale) * 100;
  const percentWidth = (clip: TimelineClip) => Math.max(1.2, (clipDuration(clip) / scale) * 100);

  return <section className="editor-workspace">
    <div className="editor-topline">
      <div><label className="eyebrow muted">EDIÇÃO</label><h2>Estúdio de edição</h2><p>Organize vídeo, imagem e áudio em faixas independentes.</p></div>
      <div className="editor-summary"><span><Film size={14}/> {clips.length} clipe(s)</span><span><Clock3 size={14}/> {timeLabel(totalDuration)}</span></div>
    </div>

    <div className="editor-grid">
      <section className="editor-panel editor-bin">
        <div className="editor-panel-head"><div><b>Biblioteca</b><small>{assets.length} arquivo(s) disponíveis</small></div><button className="secondary-action" onClick={onAddMedia}><Plus size={14}/> Importar</button></div>
        {assets.length ? <div className="editor-assets">{assets.map(asset => <article key={asset.id} className="editor-asset" draggable onDragStart={event => event.dataTransfer.setData("text/asset-id", asset.id)}>
          <div className={`editor-asset-icon ${asset.kind}`}>{asset.kind === "video" ? <Film size={17}/> : asset.kind === "audio" ? <AudioLines size={17}/> : <ImageIcon size={17}/>}</div>
          <div className="editor-asset-info"><b title={asset.name}>{asset.name}</b><small>{asset.kind.toUpperCase()} · {timeLabel(defaultDuration(asset))}</small></div>
          <button className="icon-action" title="Adicionar à timeline" onClick={() => addToTimeline(asset)}><Plus size={16}/></button>
        </article>)}</div> : <div className="editor-empty"><Film size={24}/><b>Nenhuma mídia importada</b><p>Adicione vídeos, áudios ou imagens para começar.</p><button className="primary" onClick={onAddMedia}><Plus size={14}/> Importar mídia</button></div>}
      </section>

      <section className="editor-panel editor-preview">
        <div className="editor-panel-head"><div><b>Pré-visualização</b><small>{previewAsset?.name ?? "Selecione um clipe na timeline"}</small></div><span className="preview-live">{playing ? "REPRODUZINDO" : "PRÉVIA"}</span></div>
        <div className="preview-stage">
          <div className="preview-media-frame">
          {!previewAsset ? <div className="preview-placeholder"><Play size={27}/><span>Seu vídeo aparecerá aqui</span><small>Adicione uma mídia à timeline para visualizar</small></div> :
            !previewUrl ? <div className="preview-placeholder"><span>Não foi possível carregar esta mídia.</span><small>{loadError || "Verifique se o arquivo continua na pasta do projeto."}</small></div> :
            previewAsset.kind === "video" ? <video key={previewAsset.id} ref={videoRef} src={previewUrl} muted={!!previewClip?.muted} controls={!playing} onError={() => setLoadError("Formato não suportado pelo preview do sistema.")} /> :
            previewAsset.kind === "audio" ? <div className="audio-preview"><AudioLines size={48}/><b>{previewAsset.name}</b><span>Áudio na timeline</span></div> :
            <img src={previewUrl} alt={previewAsset.name} />}
          {activeMotion.map(item => <div key={item.id} className={"motion-overlay motion-" + item.preset + (selectedMotionId === item.id ? " motion-selected" : "")} style={{ "--motion-color": item.color, "--motion-accent": item.accent, "--motion-size": item.fontSize + "px", "--motion-delay": "-" + Math.min(650, playheadMs - item.startMs) + "ms", "--motion-x": item.x + "%", "--motion-y": item.y + "%" } as CSSProperties}>
            <span onPointerDown={event => { if (selectedMotionId !== item.id) setSelectedMotionId(item.id); event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.parentElement?.getBoundingClientRect(); if (!rect) return; updateMotion(item.id, { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) }); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>{item.text}</span>
          </div>)}
          </div>
        </div>
        <div className="editor-transport">
          <button className="transport-button" title="Voltar ao início" onClick={() => { stopPlayback(); seekTo(0); }}><SkipBack size={15}/></button>
          <button className="transport-play" onClick={togglePlayback} disabled={!clips.length}>{playing ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}{playing ? "Pausar" : "Reproduzir"}</button>
          <button className="transport-button" title="Avançar 5 segundos" onClick={() => seekTo(playheadMs + 5000)}><SkipForward size={15}/></button>
          <span className="transport-time">{timeLabel(playheadMs)} / {timeLabel(totalDuration)}</span>
        </div>
        {selectedClip && selectedAsset && <div className="clip-trim">
          <div className="trim-heading"><b><Scissors size={14}/> Ajustes do clipe</b><span>{timeLabel(selectedDuration)}</span></div>
          <label>Início do arquivo <strong>{timeLabel(selectedClip.sourceStartMs)}</strong><input aria-label="Início do corte" type="range" min={0} max={Math.max(1000, selectedSourceDuration - 250)} step={100} value={selectedClip.sourceStartMs} onChange={event => updateClip(selectedClip.id, { sourceStartMs: Math.min(Number(event.target.value), selectedClip.sourceEndMs - 250) })}/></label>
          <label>Fim do arquivo <strong>{timeLabel(selectedClip.sourceEndMs)}</strong><input aria-label="Fim do corte" type="range" min={250} max={Math.max(250, selectedSourceDuration)} step={100} value={Math.min(selectedClip.sourceEndMs, selectedSourceDuration)} onChange={event => updateClip(selectedClip.id, { sourceEndMs: Math.max(Number(event.target.value), selectedClip.sourceStartMs + 250) })}/></label>
          {selectedAsset.kind === "video" && <div className="clip-toggle-row"><span><Volume2 size={14}/> Áudio original do vídeo</span><button className={selectedClip.muted ? "mute-toggle muted" : "mute-toggle"} onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted })}>{selectedClip.muted ? <><VolumeX size={14}/> Silenciado</> : <><Volume2 size={14}/> Com som</>}</button></div>}
          {(selectedAsset.kind === "audio" || selectedAsset.kind === "video") && <label className="volume-control"><span><Volume2 size={13}/> Volume {selectedAsset.kind === "audio" ? "do áudio" : "do vídeo"}</span><strong>{selectedClip.volume}%</strong><input type="range" min={0} max={100} value={selectedClip.volume} onChange={event => updateClip(selectedClip.id, { volume: Number(event.target.value) })}/></label>}
          <label className="timeline-position-control">Posição na timeline <strong>{timeLabel(selectedClip.timelineStartMs)}</strong><input type="range" min={0} max={Math.max(1000, totalDuration + 10000)} step={100} value={selectedClip.timelineStartMs} onChange={event => updateClip(selectedClip.id, { timelineStartMs: Number(event.target.value) })}/></label>
        </div>}
      </section>
    </div>

    <section className="editor-panel motion-panel">
      <div className="editor-panel-head"><div><b>✦ Motion Graphics</b><small>Textos animados com efeitos sonoros sincronizados.</small></div><span className="preview-live">{motion.length} ELEMENTO(S)</span></div>
      <div className="motion-presets">{motionPresets.map(preset => <button key={preset.id} className="motion-preset" onClick={() => addMotion(preset.id)}><b>{preset.label}</b><small>Som: {preset.sound}</small><span>+ Adicionar</span></button>)}</div>
      {selectedMotion && <div className="motion-inspector">
        <label>Texto<input value={selectedMotion.text} onChange={event => updateMotion(selectedMotion.id, { text: event.target.value })} maxLength={32}/></label>
        <div className="motion-fields">
          <label>Início (s)<input type="number" min="0" step="0.1" value={(selectedMotion.startMs / 1000).toFixed(1)} onChange={event => updateMotion(selectedMotion.id, { startMs: Math.max(0, Number(event.target.value) * 1000) })}/></label>
          <label>Duração (s)<input type="number" min="0.3" step="0.1" value={(selectedMotion.durationMs / 1000).toFixed(1)} onChange={event => updateMotion(selectedMotion.id, { durationMs: Math.max(300, Number(event.target.value) * 1000) })}/></label>
          <label>Tamanho<input type="number" min="18" max="140" value={selectedMotion.fontSize} onChange={event => updateMotion(selectedMotion.id, { fontSize: Math.max(18, Math.min(140, Number(event.target.value))) })}/></label>
        </div>
        <div className="motion-fields">
          <label>Animação<select value={selectedMotion.preset} onChange={event => updateMotion(selectedMotion.id, { preset: event.target.value as MotionGraphic["preset"] })}>{motionPresets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label>Efeito sonoro<select value={selectedMotion.sound} onChange={event => updateMotion(selectedMotion.id, { sound: event.target.value as MotionGraphic["sound"] })}><option value="pop">Pop</option><option value="whoosh">Whoosh</option><option value="impact">Impacto</option><option value="click">Click</option><option value="none">Sem som</option></select></label>
        </div>
        <div className="motion-position-controls">
          <label>Horizontal <strong>{Math.round(selectedMotion.x)}%</strong><input type="range" min="0" max="100" value={selectedMotion.x} onChange={event => updateMotion(selectedMotion.id, { x: Number(event.target.value) })}/></label>
          <label>Vertical <strong>{Math.round(selectedMotion.y)}%</strong><input type="range" min="0" max="100" value={selectedMotion.y} onChange={event => updateMotion(selectedMotion.id, { y: Number(event.target.value) })}/></label>
          <button className="secondary-action" onClick={() => updateMotion(selectedMotion.id, { x: 50, y: 50 })}>Centralizar</button>
        </div>
        <div className="motion-colors"><label>Texto<input type="color" value={selectedMotion.color} onChange={event => updateMotion(selectedMotion.id, { color: event.target.value })}/></label><label>Destaque<input type="color" value={selectedMotion.accent} onChange={event => updateMotion(selectedMotion.id, { accent: event.target.value })}/></label><button className="danger-action" onClick={() => removeMotion(selectedMotion.id)}>Excluir elemento</button></div>
      </div>}
      <div className="motion-track-row"><div className="track-label">ANIMAÇÕES</div><div className="track-clips timeline-canvas motion-timeline" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/motion-graphic-id"); if (!id) return; const rect = event.currentTarget.getBoundingClientRect(); updateMotion(id, { startMs: Math.max(0, ((event.clientX - rect.left) / rect.width) * scale) }); }}>
        {motion.map(item => <button key={item.id} draggable onDragStart={event => { event.dataTransfer.setData("text/motion-graphic-id", item.id); event.dataTransfer.effectAllowed = "move"; }} className={"motion-timeline-clip " + (selectedMotionId === item.id ? "selected" : "")} style={{ left: (item.startMs / scale * 100) + "%", width: Math.max(3, item.durationMs / scale * 100) + "%" }} onClick={() => { setSelectedMotionId(item.id); seekTo(item.startMs); }}><b>{item.text}</b><small>{item.preset}</small></button>)}
        {!motion.length && <span className="track-hint">Adicione um preset para criar textos animados.</span>}
        <div className="timeline-cursor" style={{ left: (playheadMs / scale * 100) + "%" }}/>
      </div></div>
    </section>

    <section className="editor-panel timeline-panel">
      <div className="editor-panel-head"><div><b>Timeline</b><small>Arraste os clipes horizontalmente para sincronizar áudio e vídeo.</small></div><span className="timeline-duration">{timeLabel(totalDuration)}</span></div>
      <div className="timeline-playhead"><label>POSIÇÃO</label><input aria-label="Posição na timeline" type="range" min={0} max={Math.max(1, totalDuration)} value={Math.min(playheadMs, totalDuration)} onChange={event => seekTo(Number(event.target.value))}/><strong>{timeLabel(playheadMs)}</strong></div>
      <div className="timeline-ruler"><span>00:00</span><span>{timeLabel(scale / 2)}</span><span>{timeLabel(scale)}</span></div>
      <div className="timeline-track timeline-positioned-track">
        <div className="track-label">VÍDEO / IMAGEM</div>
        <div className="track-clips timeline-canvas" onDragOver={event => event.preventDefault()} onDrop={handleAssetDrop}>
          {visualClips.map(clip => {
            const asset = assets.find(item => item.id === clip.assetId);
            if (!asset) return null;
            return <button key={clip.id} draggable className={`timeline-clip positioned-clip ${asset.kind} ${selectedId === clip.id ? "selected" : ""}`} style={{ left: `${percentLeft(clip)}%`, width: `${percentWidth(clip)}%` }} onDragStart={event => handleClipDragStart(event, clip)} onClick={() => { stopPlayback(); setSelectedId(clip.id); seekTo(clip.timelineStartMs); }}>
              <b>{asset.name}</b><small>{timeLabel(clipDuration(clip))}</small>
              <span className="clip-controls"><i title="Duplicar" onClick={event => { event.stopPropagation(); duplicateClip(clip); }}><Copy size={12}/></i><i title="Excluir" onClick={event => { event.stopPropagation(); removeClip(clip.id); }}><Trash2 size={12}/></i></span>
            </button>;
          })}
          {!visualClips.length && <span className="track-hint">Arraste vídeos ou imagens da biblioteca para cá</span>}
          <div className="timeline-cursor" style={{ left: `${(playheadMs / scale) * 100}%` }}/>
        </div>
      </div>
      <div className="timeline-track timeline-positioned-track audio-track">
        <div className="track-label">ÁUDIO</div>
        <div className="track-clips timeline-canvas" onDragOver={event => event.preventDefault()} onDrop={handleAssetDrop}>
          {audioClips.map(clip => {
            const asset = assets.find(item => item.id === clip.assetId);
            if (!asset) return null;
            return <button key={clip.id} draggable className={`timeline-clip audio positioned-clip ${selectedId === clip.id ? "selected" : ""}`} style={{ left: `${percentLeft(clip)}%`, width: `${percentWidth(clip)}%` }} onDragStart={event => handleClipDragStart(event, clip)} onClick={() => { stopPlayback(); setSelectedId(clip.id); seekTo(clip.timelineStartMs); }}>
              <b>{asset.name}</b><small>{timeLabel(clipDuration(clip))} · {timeLabel(clip.timelineStartMs)}</small>
              <span className="clip-controls"><i title="Duplicar" onClick={event => { event.stopPropagation(); duplicateClip(clip); }}><Copy size={12}/></i><i title="Excluir" onClick={event => { event.stopPropagation(); removeClip(clip.id); }}><Trash2 size={12}/></i></span>
            </button>;
          })}
          {!audioClips.length && <span className="track-hint">Arraste um áudio para cá. Ele tocará junto com o vídeo.</span>}
          <div className="timeline-cursor" style={{ left: `${(playheadMs / scale) * 100}%` }}/>
        </div>
      </div>
      {audioClips.map(clip => {
        const asset = assets.find(item => item.id === clip.assetId);
        const url = mediaUrls[clip.assetId];
        return asset && url ? <audio key={clip.id} ref={node => { audioRefs.current[clip.id] = node; }} src={url} preload="auto" /> : null;
      })}
      <div className="timeline-actions">
        <button className="secondary-action" onClick={splitAtPlayhead} disabled={!activeVisualClip || playheadMs <= activeVisualClip.timelineStartMs + 250 || playheadMs >= clipEnd(activeVisualClip) - 250}><Scissors size={13}/> Dividir no cursor</button>
        <button className="secondary-action" onClick={() => selectedClip && duplicateClip(selectedClip)} disabled={!selectedClip}><Copy size={13}/> Duplicar clipe</button>
        <button className="secondary-action danger-action" onClick={() => selectedClip && removeClip(selectedClip.id)} disabled={!selectedClip}><Trash2 size={13}/> Excluir selecionado</button>
        <button className="secondary-action" onClick={() => { stopPlayback(); setClips([]); setSelectedId(null); setPlayheadMs(0); }} disabled={!clips.length}><Trash2 size={13}/> Limpar timeline</button>
      </div>
      <div className="timeline-footer"><span>As alterações são salvas automaticamente neste dispositivo. Arraste os blocos para ajustar a sincronização.</span></div>
    </section>
  </section>;
}
