import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { desktopApi } from "./services/desktop-api";
import type { MediaAsset } from "./shared/types";
import { AudioLines, Film, Image as ImageIcon, Plus, Play, Pause, Trash2, ChevronUp, ChevronDown, Scissors, Clock3 } from "lucide-react";

type TimelineClip = { id: string; assetId: string; startMs: number; endMs: number };
type Props = { projectId: string; assets: MediaAsset[]; onAddMedia: () => void };

const defaultDuration = (asset: MediaAsset) => asset.durationMs && asset.durationMs > 0 ? asset.durationMs : asset.kind === "image" ? 5000 : 30000;
const timeLabel = (ms: number) => { const total = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"); };

export default function EditorWorkspace({ projectId, assets, onAddMedia }: Props) {
  const storageKey = `ttk-creator:timeline:${projectId}`;
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as TimelineClip[] : [];
      setClips(Array.isArray(parsed) ? parsed.filter(c => c && typeof c.id === "string" && typeof c.assetId === "string" && Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs) : []);
    } catch { setClips([]); }
  }, [storageKey]);

  useEffect(() => { window.localStorage.setItem(storageKey, JSON.stringify(clips)); }, [storageKey, clips]);

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
  }, [assets, projectId]);

  const selectedClip = clips.find(clip => clip.id === selectedId) ?? clips[0] ?? null;
  const selectedAsset = selectedClip ? assets.find(asset => asset.id === selectedClip.assetId) ?? null : null;
  const totalDuration = clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0);

  function addToTimeline(asset: MediaAsset) {
    const duration = defaultDuration(asset);
    const clip: TimelineClip = { id: crypto.randomUUID(), assetId: asset.id, startMs: 0, endMs: duration };
    setClips(current => [...current, clip]);
    setSelectedId(clip.id);
  }
  function updateClip(id: string, patch: Partial<TimelineClip>) {
    setClips(current => current.map(clip => clip.id === id ? { ...clip, ...patch } : clip));
  }
  function removeClip(id: string) {
    setClips(current => current.filter(clip => clip.id !== id));
    if (selectedId === id) setSelectedId(null);
  }
  function moveClip(index: number, direction: -1 | 1) {
    setClips(current => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next;
    });
  }
  function handleDrop(event: DragEvent, targetIndex?: number) {
    event.preventDefault();
    const assetId = event.dataTransfer.getData("text/asset-id");
    const asset = assets.find(item => item.id === assetId);
    if (!asset) return;
    const duration = defaultDuration(asset);
    const clip = { id: crypto.randomUUID(), assetId, startMs: 0, endMs: duration };
    setClips(current => { const next = [...current]; next.splice(targetIndex ?? next.length, 0, clip); return next; });
    setSelectedId(clip.id);
  }

  const previewUrl = selectedAsset ? mediaUrls[selectedAsset.id] : "";
  const trimStart = selectedClip?.startMs ?? 0;
  const trimEnd = selectedClip?.endMs ?? 0;
  const sourceDuration = selectedAsset ? defaultDuration(selectedAsset) : 0;

  return <section className="editor-workspace">
    <div className="editor-topline"><div><label className="eyebrow muted">EDIÇÃO</label><h2>Estúdio de edição</h2><p>Organize os arquivos e monte a sequência do seu vídeo.</p></div><div className="editor-summary"><span><Film size={14}/> {clips.length} clipe(s)</span><span><Clock3 size={14}/> {timeLabel(totalDuration)}</span></div></div>
    <div className="editor-grid">
      <section className="editor-panel editor-bin"><div className="editor-panel-head"><div><b>Biblioteca</b><small>{assets.length} arquivo(s) disponíveis</small></div><button className="secondary-action" onClick={onAddMedia}><Plus size={14}/> Importar</button></div>
        {assets.length ? <div className="editor-assets">{assets.map(asset => <article key={asset.id} className="editor-asset" draggable onDragStart={event => event.dataTransfer.setData("text/asset-id", asset.id)}>
          <div className={`editor-asset-icon ${asset.kind}`}>{asset.kind === "video" ? <Film size={17}/> : asset.kind === "audio" ? <AudioLines size={17}/> : <ImageIcon size={17}/>}</div>
          <div className="editor-asset-info"><b title={asset.name}>{asset.name}</b><small>{asset.kind.toUpperCase()} · {timeLabel(defaultDuration(asset))}</small></div>
          <button className="icon-action" title="Adicionar à timeline" onClick={() => addToTimeline(asset)}><Plus size={16}/></button>
        </article>)}</div> : <div className="editor-empty"><Film size={24}/><b>Nenhuma mídia importada</b><p>Adicione vídeos, áudios ou imagens para começar.</p><button className="primary" onClick={onAddMedia}><Plus size={14}/> Importar mídia</button></div>}
      </section>
      <section className="editor-panel editor-preview"><div className="editor-panel-head"><div><b>Pré-visualização</b><small>{selectedAsset?.name ?? "Selecione um clipe na timeline"}</small></div><span className="preview-live">PRÉVIA</span></div>
        <div className="preview-stage">
          {!selectedAsset ? <div className="preview-placeholder"><Play size={27}/><span>Seu vídeo aparecerá aqui</span><small>Adicione uma mídia à timeline para visualizar</small></div> :
            !previewUrl ? <div className="preview-placeholder"><span>Não foi possível carregar esta mídia.</span><small>{loadError || "Verifique se o arquivo continua na pasta do projeto."}</small></div> :
            selectedAsset.kind === "video" ? <video key={selectedAsset.id} src={previewUrl} controls onError={() => setLoadError("Formato não suportado pelo preview do sistema.")} /> :
            selectedAsset.kind === "audio" ? <div className="audio-preview"><AudioLines size={48}/><b>{selectedAsset.name}</b><audio key={selectedAsset.id} src={previewUrl} controls/></div> :
            <img src={previewUrl} alt={selectedAsset.name} />
          }
        </div>
        {selectedClip && selectedAsset && <div className="clip-trim"><div className="trim-heading"><b><Scissors size={14}/> Ajustar trecho</b><span>{timeLabel(trimEnd - trimStart)}</span></div><label>Início <strong>{timeLabel(trimStart)}</strong><input aria-label="Início do corte" type="range" min={0} max={Math.max(1000, sourceDuration - 1000)} step={100} value={trimStart} onChange={event => updateClip(selectedClip.id, { startMs: Math.min(Number(event.target.value), trimEnd - 1000) })}/></label><label>Fim <strong>{timeLabel(trimEnd)}</strong><input aria-label="Fim do corte" type="range" min={1000} max={Math.max(1000, sourceDuration)} step={100} value={Math.min(trimEnd, sourceDuration)} onChange={event => updateClip(selectedClip.id, { endMs: Math.max(Number(event.target.value), trimStart + 1000) })}/></label></div>}
      </section>
    </div>
    <section className="editor-panel timeline-panel"><div className="editor-panel-head"><div><b>Timeline</b><small>Arraste mídias da biblioteca ou use o botão +</small></div><span className="timeline-duration">{timeLabel(totalDuration)}</span></div>
      <div className="timeline-ruler"><span>00:00</span><span>{timeLabel(totalDuration / 2)}</span><span>{timeLabel(totalDuration)}</span></div>
      <div className="timeline-track" onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event)}><div className="track-label">VÍDEO / IMAGEM</div><div className="track-clips">
        {clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind !== "audio").map(clip => { const asset = assets.find(item => item.id === clip.assetId)!; const index = clips.indexOf(clip); return <button key={clip.id} className={`timeline-clip ${selectedId === clip.id ? "selected" : ""} ${asset.kind}`} onClick={() => { setSelectedId(clip.id); }} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, index)}><b>{asset.name}</b><small>{timeLabel(clip.endMs - clip.startMs)}</small><span className="clip-controls"><i onClick={event => {event.stopPropagation();moveClip(index,-1);}}><ChevronUp size={12}/></i><i onClick={event => {event.stopPropagation();moveClip(index,1);}}><ChevronDown size={12}/></i><i onClick={event => {event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></i></span></button>; })}
        {clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind !== "audio").length === 0 && <span className="track-hint">Solte vídeos ou imagens aqui</span>}
      </div></div>
      <div className="timeline-track audio-track"><div className="track-label">ÁUDIO</div><div className="track-clips" onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event)}>{clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind === "audio").map(clip => { const asset = assets.find(item => item.id === clip.assetId)!; const index = clips.indexOf(clip); return <button key={clip.id} className={`timeline-clip audio ${selectedId === clip.id ? "selected" : ""}`} onClick={() => setSelectedId(clip.id)}><b>{asset.name}</b><small>{timeLabel(clip.endMs - clip.startMs)}</small><span className="clip-controls"><i onClick={event => {event.stopPropagation();moveClip(index,-1);}}><ChevronUp size={12}/></i><i onClick={event => {event.stopPropagation();moveClip(index,1);}}><ChevronDown size={12}/></i><i onClick={event => {event.stopPropagation();removeClip(clip.id);}}><Trash2 size={12}/></i></span></button>; })}{clips.filter(clip => assets.find(asset => asset.id === clip.assetId)?.kind === "audio").length === 0 && <span className="track-hint">Solte áudios aqui</span>}</div></div>
      <div className="timeline-footer"><span>As alterações são salvas automaticamente neste dispositivo.</span><button className="secondary-action" onClick={() => {setClips([]);setSelectedId(null);}} disabled={!clips.length}><Trash2 size={13}/> Limpar timeline</button></div>
    </section>
  </section>;
}
