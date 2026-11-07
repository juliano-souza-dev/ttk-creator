import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "./services/desktop-api";
import type { MediaAsset } from "./shared/types";
import { AudioLines, Film, Image as ImageIcon, Plus, Play, Pause, Trash2, ChevronUp, ChevronDown, Scissors, Clock3, Copy, SkipBack, SkipForward, Volume2 } from "lucide-react";

type TimelineClip = { id: string; assetId: string; startMs: number; endMs: number; volume?: number };
type Props = { projectId: string; assets: MediaAsset[]; onAddMedia: () => void };
const defaultDuration = (asset: MediaAsset) => asset.durationMs && asset.durationMs > 0 ? asset.durationMs : asset.kind === "image" ? 5000 : 30000;
const timeLabel = (ms: number) => { const total = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"); };

export default function EditorWorkspace({ projectId, assets, onAddMedia }: Props) {
  const storageKey = `ttk-creator:timeline:${projectId}`;
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewTick, setPreviewTick] = useState(0);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const imageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      setSelectedId(null);
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as TimelineClip[] : [];
      setClips(Array.isArray(parsed) ? parsed.filter(c => c && typeof c.id === "string" && typeof c.assetId === "string" && Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs) : []);
      setPlayheadMs(0);
    } catch { setClips([]); } finally { setLoadedStorageKey(storageKey); }
  }, [storageKey]);
  useEffect(() => { if (loadedStorageKey === storageKey) window.localStorage.setItem(storageKey, JSON.stringify(clips)); }, [storageKey, clips, loadedStorageKey]);

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

  const totalDuration = clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0);
  const selectedIndex = clips.findIndex(clip => clip.id === selectedId);
  const selectedClip = clips[selectedIndex] ?? clips[0] ?? null;
  const selectedAsset = selectedClip ? assets.find(asset => asset.id === selectedClip.assetId) ?? null : null;
  const clipOffsets = useMemo(() => {
    let cursor = 0;
    return clips.map(clip => { const item = { id: clip.id, start: cursor, end: cursor + clip.endMs - clip.startMs }; cursor = item.end; return item; });
  }, [clips]);
  const activeIndex = clipOffsets.findIndex(item => playheadMs >= item.start && (playheadMs < item.end || item === clipOffsets[clipOffsets.length - 1] && playheadMs === item.end));
  const activeClip = clips[Math.max(0, activeIndex)] ?? null;
  const activeAsset = activeClip ? assets.find(asset => asset.id === activeClip.assetId) ?? null : null;
  const activeUrl = activeAsset ? mediaUrls[activeAsset.id] : "";
  const selectedClipDuration = selectedClip ? selectedClip.endMs - selectedClip.startMs : 0;
  const selectedSourceDuration = selectedAsset ? defaultDuration(selectedAsset) : 0;
  const localPlayhead = activeClip ? activeClip.startMs + Math.max(0, playheadMs - (clipOffsets[activeIndex]?.start ?? 0)) : 0;

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current);
    imageTimerRef.current = null;
    mediaRef.current?.pause();
  }, []);

  useEffect(() => () => { if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current); mediaRef.current?.pause(); }, []);
  useEffect(() => {
    if (!playing || !activeClip || !activeAsset) return;
    if (activeAsset.kind === "image") {
      imageTimerRef.current = window.setTimeout(() => {
        const next = clipOffsets[activeIndex]?.end ?? totalDuration;
        if (next >= totalDuration) { setPlayheadMs(totalDuration); stopPlayback(); }
        else setPlayheadMs(next + 1);
      }, Math.max(250, activeClip.endMs - activeClip.startMs));
      return () => { if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current); };
    }
    const element = mediaRef.current;
    if (!element || !activeUrl) return;
    element.currentTime = localPlayhead / 1000;
    element.volume = Math.max(0, Math.min(1, (activeClip.volume ?? 100) / 100));
    void element.play().catch(() => { setLoadError("Não foi possível reproduzir este formato de mídia."); setPlaying(false); });
    return () => element.pause();
  }, [playing, activeClip?.id, activeAsset?.id, activeUrl, activeIndex, totalDuration, clipOffsets, stopPlayback]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    element.currentTime = localPlayhead / 1000;
    if (playing) void element.play().catch(() => setPlaying(false));
  }, [previewTick]);

  function addToTimeline(asset: MediaAsset, targetIndex = clips.length) {
    const duration = defaultDuration(asset);
    const clip: TimelineClip = { id: crypto.randomUUID(), assetId: asset.id, startMs: 0, endMs: duration, volume: 100 };
    setClips(current => { const next = [...current]; next.splice(targetIndex, 0, clip); return next; });
    setSelectedId(clip.id);
    stopPlayback();
  }
  function updateClip(id: string, patch: Partial<TimelineClip>) {
    setClips(current => current.map(clip => clip.id === id ? { ...clip, ...patch } : clip));
  }
  function removeClip(id: string) {
    const offset = clipOffsets.find(item => item.id === id);
    setClips(current => current.filter(clip => clip.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (offset && playheadMs >= offset.start) setPlayheadMs(offset.start);
    stopPlayback();
  }
  function moveClip(index: number, direction: -1 | 1) {
    setClips(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
    });
    stopPlayback();
  }
  function duplicateClip(clip: TimelineClip) {
    const copy = { ...clip, id: crypto.randomUUID() };
    setClips(current => { const index = current.findIndex(item => item.id === clip.id); const next = [...current]; next.splice(index + 1, 0, copy); return next; });
    setSelectedId(copy.id);
    stopPlayback();
  }
  function splitAtPlayhead() {
    if (!activeClip || !activeAsset) return;
    const offset = clipOffsets[activeIndex];
    const splitSourceMs = activeClip.startMs + (playheadMs - offset.start);
    if (splitSourceMs <= activeClip.startMs + 250 || splitSourceMs >= activeClip.endMs - 250) return;
    const left = { ...activeClip, endMs: splitSourceMs };
    const right = { ...activeClip, id: crypto.randomUUID(), startMs: splitSourceMs };
    setClips(current => { const index = current.findIndex(item => item.id === activeClip.id); const next = [...current]; next.splice(index, 1, left, right); return next; });
    setSelectedId(right.id);
    stopPlayback();
  }
  function handleDrop(event: DragEvent, targetIndex?: number) {
    event.preventDefault(); event.stopPropagation();
    const assetId = event.dataTransfer.getData("text/asset-id");
    const asset = assets.find(item => item.id === assetId);
    if (asset) addToTimeline(asset, targetIndex ?? clips.length);
  }
  function seekTo(ms: number) {
    const bounded = Math.max(0, Math.min(totalDuration, ms));
    setPlayheadMs(bounded);
    const offset = clipOffsets.find(item => bounded >= item.start && bounded < item.end) ?? clipOffsets[clipOffsets.length - 1];
    if (offset) { setSelectedId(offset.id); setPreviewTick(value => value + 1); }
  }
  function togglePlayback() {
    if (playing) { stopPlayback(); return; }
    if (!clips.length) return;
    if (playheadMs >= totalDuration) setPlayheadMs(0);
    setPlaying(true);
  }
  function onMediaTimeUpdate() {
    const element = mediaRef.current;
    if (!element || !activeClip || activeIndex < 0) return;
    const sourceMs = element.currentTime * 1000;
    const clipOffset = clipOffsets[activeIndex];
    if (sourceMs >= activeClip.endMs) {
      const nextTime = clipOffset.end;
      if (nextTime >= totalDuration) { setPlayheadMs(totalDuration); stopPlayback(); }
      else { setPlayheadMs(nextTime + 1); }
    } else {
      setPlayheadMs(clipOffset.start + Math.max(0, sourceMs - activeClip.startMs));
    }
  }

  const previewClip = activeClip ?? selectedClip;
  const previewAsset = activeAsset ?? selectedAsset;
  const previewUrl = previewAsset ? mediaUrls[previewAsset.id] : "";

  return <section className="editor-workspace">
    <div className="editor-topline"><div><label className="eyebrow muted">EDIÇÃO</label><h2>Estúdio de edição</h2><p>Edite os trechos e monte a sequência do seu vídeo.</p></div><div className="editor-summary"><span><Film size={14}/> {clips.length} clipe(s)</span><span><Clock3 size={14}/> {timeLabel(totalDuration)}</span></div></div>
    <div className="editor-grid">
      <section className="editor-panel editor-bin"><div className="editor-panel-head"><div><b>Biblioteca</b><small>{assets.length} arquivo(s) disponíveis</small></div><button className="secondary-action" onClick={onAddMedia}><Plus size={14}/> Importar</button></div>
        {assets.length ? <div className="editor-assets">{assets.map(asset => <article key={asset.id} className="editor-asset" draggable onDragStart={event => event.dataTransfer.setData("text/asset-id", asset.id)}>
          <div className={`editor-asset-icon ${asset.kind}`}>{asset.kind === "video" ? <Film size={17}/> : asset.kind === "audio" ? <AudioLines size={17}/> : <ImageIcon size={17}/>}</div>
          <div className="editor-asset-info"><b title={asset.name}>{asset.name}</b><small>{asset.kind.toUpperCase()} · {timeLabel(defaultDuration(asset))}</small></div>
          <button className="icon-action" title="Adicionar à timeline" onClick={() => addToTimeline(asset)}><Plus size={16}/></button>
        </article>)}</div> : <div className="editor-empty"><Film size={24}/><b>Nenhuma mídia importada</b><p>Adicione vídeos, áudios ou imagens para começar.</p><button className="primary" onClick={onAddMedia}><Plus size={14}/> Importar mídia</button></div>}
      </section>
      <section className="editor-panel editor-preview"><div className="editor-panel-head"><div><b>Pré-visualização</b><small>{previewAsset?.name ?? "Selecione um clipe na timeline"}</small></div><span className="preview-live">{playing ? "REPRODUZINDO" : "PRÉVIA"}</span></div>
        <div className="preview-stage">
          {!previewAsset ? <div className="preview-placeholder"><Play size={27}/><span>Seu vídeo aparecerá aqui</span><small>Adicione uma mídia à timeline para visualizar</small></div> :
            !previewUrl ? <div className="preview-placeholder"><span>Não foi possível carregar esta mídia.</span><small>{loadError || "Verifique se o arquivo continua na pasta do projeto."}</small></div> :
            previewAsset.kind === "video" ? <video key={previewAsset.id + previewTick} ref={node => { mediaRef.current = node; }} src={previewUrl} controls={!playing} onTimeUpdate={onMediaTimeUpdate} onEnded={onMediaEnded} onError={() => setLoadError("Formato não suportado pelo preview do sistema.")} /> :
            previewAsset.kind === "audio" ? <div className="audio-preview"><AudioLines size={48}/><b>{previewAsset.name}</b><audio key={previewAsset.id + previewTick} ref={node => { mediaRef.current = node; }} src={previewUrl} controls={!playing} onTimeUpdate={onMediaTimeUpdate} onEnded={onMediaTimeUpdate}/></div> :
            <img src={previewUrl} alt={previewAsset.name} />
          }
        </div>
        <div className="editor-transport"><button className="transport-button" title="Voltar ao início" onClick={() => {stopPlayback();seekTo(0);}}><SkipBack size={15}/></button><button className="transport-play" onClick={togglePlayback} disabled={!clips.length}>{playing?<Pause size={17}/>:<Play size={17} fill="currentColor"/>}{playing?"Pausar":"Reproduzir"}</button><button className="transport-button" title="Avançar 5 segundos" onClick={() => seekTo(playheadMs+5000)}><SkipForward size={15}/></button><span className="transport-time">{timeLabel(playheadMs)} / {timeLabel(totalDuration)}</span></div>
        {selectedClip && selectedAsset && <div className="clip-trim"><div className="trim-heading"><b><Scissors size={14}/> Cortar clipe selecionado</b><span>{timeLabel(selectedClipDuration)}</span></div><label>Início <strong>{timeLabel(selectedClip.startMs)}</strong><input aria-label="Início do corte" type="range" min={0} max={Math.max(1000, selectedSourceDuration-1000)} step={100} value={selectedClip.startMs} onChange={event => updateClip(selectedClip.id,{startMs:Math.min(Number(event.target.value),selectedClip.endMs-250)})}/></label><label>Fim <strong>{timeLabel(selectedClip.endMs)}</strong><input aria-label="Fim do corte" type="range" min={1000} max={Math.max(1000,selectedSourceDuration)} step={100} value={Math.min(selectedClip.endMs,selectedSourceDuration)} onChange={event => updateClip(selectedClip.id,{endMs:Math.max(Number(event.target.value),selectedClip.startMs+250)})}/></label>{selectedAsset.kind==="audio"&&<label className="volume-control"><span><Volume2 size={13}/> Volume</span><strong>{selectedClip.volume??100}%</strong><input type="range" min={0} max={100} value={selectedClip.volume??100} onChange={event=>updateClip(selectedClip.id,{volume:Number(event.target.value)})}/></label>}</div>}
      </section>
    </div>
    <section className="editor-panel timeline-panel"><div className="editor-panel-head"><div><b>Timeline</b><small>Selecione um clipe, arraste mídias e use dividir para fazer cortes.</small></div><span className="timeline-duration">{timeLabel(totalDuration)}</span></div>
      <div className="timeline-playhead"><label>POSIÇÃO</label><input aria-label="Posição na timeline" type="range" min={0} max={Math.max(1,totalDuration)} value={Math.min(playheadMs,totalDuration)} onChange={event=>seekTo(Number(event.target.value))}/><strong>{timeLabel(playheadMs)}</strong></div>
      <div className="timeline-ruler"><span>00:00</span><span>{timeLabel(totalDuration/2)}</span><span>{timeLabel(totalDuration)}</span></div>
      <div className="timeline-track" onDragOver={event=>event.preventDefault()} onDrop={event=>handleDrop(event)}><div className="track-label">VÍDEO / IMAGEM</div><div className="track-clips">
        {clips.filter(clip=>assets.find(asset=>asset.id===clip.assetId)?.kind!=="audio").map(clip=>{const asset=assets.find(item=>item.id===clip.assetId)!;const index=clips.indexOf(clip);return <button key={clip.id} className={`timeline-clip ${selectedId===clip.id?"selected":""} ${asset.kind}`} onClick={()=>{stopPlayback();setSelectedId(clip.id);seekTo(clipOffsets[index]?.start??0);}} onDragOver={event=>event.preventDefault()} onDrop={event=>handleDrop(event,index)}><b>{asset.name}</b><small>{timeLabel(clip.endMs-clip.startMs)}</small><span className="clip-controls"><i title="Mover para esquerda" onClick={event=>{event.stopPropagation();moveClip(index,-1);}}><ChevronUp size={12}/></i><i title="Mover para direita" onClick={event=>{event.stopPropagation();moveClip(index,1);}}><ChevronDown size={12}/></i><i title="Duplicar" onClick={event=>{event.stopPropagation();duplicateClip(clip);}}><Copy size={12}/></i><i title="Excluir" onClick={event=>{event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></i></span></button>;})}
        {clips.filter(clip=>assets.find(asset=>asset.id===clip.assetId)?.kind!=="audio").length===0&&<span className="track-hint">Solte vídeos ou imagens aqui</span>}
      </div></div>
      <div className="timeline-track audio-track"><div className="track-label">ÁUDIO</div><div className="track-clips" onDragOver={event=>event.preventDefault()} onDrop={event=>handleDrop(event)}>{clips.filter(clip=>assets.find(asset=>asset.id===clip.assetId)?.kind==="audio").map(clip=>{const asset=assets.find(item=>item.id===clip.assetId)!;const index=clips.indexOf(clip);return <button key={clip.id} className={`timeline-clip audio ${selectedId===clip.id?"selected":""}`} onClick={()=>{stopPlayback();setSelectedId(clip.id);seekTo(clipOffsets[index]?.start??0);}}><b>{asset.name}</b><small>{timeLabel(clip.endMs-clip.startMs)}</small><span className="clip-controls"><i onClick={event=>{event.stopPropagation();moveClip(index,-1);}}><ChevronUp size={12}/></i><i onClick={event=>{event.stopPropagation();moveClip(index,1);}}><ChevronDown size={12}/></i><i onClick={event=>{event.stopPropagation();duplicateClip(clip);}}><Copy size={12}/></i><i onClick={event=>{event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></i></span></button>;})}{clips.filter(clip=>assets.find(asset=>asset.id===clip.assetId)?.kind==="audio").length===0&&<span className="track-hint">Solte áudios aqui</span>}</div></div>
      <div className="timeline-actions"><button className="secondary-action" onClick={splitAtPlayhead} disabled={!activeClip||playheadMs<=(clipOffsets[activeIndex]?.start??0)+250||playheadMs>=(clipOffsets[activeIndex]?.end??0)-250}><Scissors size={13}/> Dividir no cursor</button><button className="secondary-action" onClick={()=>selectedClip&&duplicateClip(selectedClip)} disabled={!selectedClip}><Copy size={13}/> Duplicar clipe</button><button className="secondary-action danger-action" onClick={()=>selectedClip&&removeClip(selectedClip.id)} disabled={!selectedClip}><Trash2 size={13}/> Excluir selecionado</button><button className="secondary-action" onClick={()=>{stopPlayback();setClips([]);setSelectedId(null);setPlayheadMs(0);}} disabled={!clips.length}><Trash2 size={13}/> Limpar timeline</button></div>
      <div className="timeline-footer"><span>O projeto original nunca é alterado. A edição fica salva automaticamente neste dispositivo.</span></div>
    </section>
  </section>;
}
