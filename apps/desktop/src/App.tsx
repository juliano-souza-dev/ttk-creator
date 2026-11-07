import { FormEvent, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { desktopApi, isDesktopRuntime } from "./services/desktop-api";
import EditorWorkspace from "./EditorWorkspace";
import type { DownloadProgress, MediaAsset, Project, YoutubeInspection } from "./shared/types";
import { Clapperboard, LayoutGrid, Film, GraduationCap, Settings2, Plus, Search, FolderOpen, FolderPlus, Clock3, Video, Sparkles, Play, X, ArrowUpRight, Upload, Youtube, CheckCircle2, LoaderCircle, Link2, Download } from "lucide-react"

const formatDuration = (n?:number|null) => !n ? "Duração não informada" : Math.floor(n/60000)+":"+String(Math.floor(n/1000)%60).padStart(2,"0");

export default function App() {
  const [projects,setProjects] = useState<Project[]>([]);
  const [name,setName] = useState("");
  const [search,setSearch] = useState("");
  const [creating,setCreating] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [activeProject,setActiveProject] = useState<Project|null>(null);
  const [view,setView] = useState<"workspace"|"project">("workspace");
  const [assets,setAssets] = useState<MediaAsset[]>([]);
  const [mediaModal,setMediaModal] = useState(false);
  const [mediaTab,setMediaTab] = useState<"local"|"youtube">("local");
  const [youtubeUrl,setYoutubeUrl] = useState("");
  const [youtubeInfo,setYoutubeInfo] = useState<YoutubeInspection|null>(null);
  const [quality,setQuality] = useState(1080);
  const [progress,setProgress] = useState<DownloadProgress|null>(null);
  const [notice,setNotice] = useState("");

  async function refresh() {
    if (!isDesktopRuntime) return;
    try { setProjects(await desktopApi.listProjects()); }
    catch (e) { setError(String(e)); }
  }
  useEffect(()=>{
    let cancelled=false;
    async function restoreLastProject(){
      if(!isDesktopRuntime){ await refresh(); return; }
      try {
        const loaded=await desktopApi.listProjects();
        if(cancelled) return;
        setProjects(loaded);
        const lastProjectId=window.localStorage.getItem("ttk-creator:last-open-project");
        const remembered=loaded.find(project=>project.id===lastProjectId);
        if(remembered){
          const opened=await desktopApi.openProject(remembered.id);
          const projectAssets=await desktopApi.listProjectAssets(opened.id);
          if(cancelled) return;
          setActiveProject(opened); setAssets(projectAssets); setView("project");
        }
      } catch(e){ if(!cancelled) setError(String(e)); }
    }
    void restoreLastProject();
    return ()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    let disposed=false;
    let unlisten:(()=>void)|undefined;
    void desktopApi.subscribeToYoutubeProgress(progressEvent=>{
      if(progressEvent.projectId===activeProject?.id) setProgress(progressEvent);
    }).then(fn=>{ if(disposed) fn(); else unlisten=fn; });
    return ()=>{disposed=true;unlisten?.();};
  },[activeProject?.id]);

  async function refreshAssets(project:Project) {
    if(!isDesktopRuntime) return;
    try { setAssets(await desktopApi.listProjectAssets(project.id)); }
    catch(e) { setError(String(e)); }
  }
  async function selectProject(project:Project) {
    setBusy(true); setError("");
    try {
      const opened=await desktopApi.openProject(project.id);
      setActiveProject(opened); setNotice("");
      window.localStorage.setItem("ttk-creator:last-open-project",opened.id);
      await refreshAssets(opened);
      setView("project");
    } catch(e){ setError(String(e)); }
    finally { setBusy(false); }
  }
  function returnToWorkspace(){ setView("workspace"); setMediaModal(false); setError(""); setNotice(""); }
  async function importLocalFiles() {
    if(!activeProject) return;
    setBusy(true); setError("");
    try {
      const selected=await open({multiple:true,directory:false,title:"Importar mídia",filters:[{name:"Arquivos de mídia",extensions:["mp4","mov","m4v","mkv","webm","avi","mp3","wav","m4a","aac","flac","ogg","opus","png","jpg","jpeg","webp","gif","bmp"]}]});
      if(!selected) return;
      const paths=Array.isArray(selected)?selected:[selected];
      const imported=await desktopApi.importMediaFiles(activeProject.id,paths);
      setAssets(current=>[...imported,...current]); setNotice(imported.length+" arquivo(s) importado(s)."); setMediaModal(false);
    } catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function inspectYoutube() {
    if(!youtubeUrl.trim()) return;
    setBusy(true); setError(""); setYoutubeInfo(null); setProgress(null);
    try {
      const info=await desktopApi.inspectYoutube(youtubeUrl.trim());
      setYoutubeInfo(info);
      const preferred=info.qualities.find(item=>item.height<=1080)??info.qualities[0];
      setQuality(preferred?.height??0);
    } catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function downloadYoutube() {
    if(!activeProject||!youtubeInfo) return;
    setBusy(true); setError(""); setProgress({projectId:activeProject.id,percent:0,status:"starting"});
    try {
      const asset=await desktopApi.downloadYoutube(activeProject.id,youtubeInfo.url,quality);
      setAssets(current=>[asset,...current]); setNotice("Vídeo do YouTube importado."); setMediaModal(false);
      setYoutubeUrl(""); setYoutubeInfo(null); setProgress(null);
    } catch(e) { setError(String(e)); setProgress(null); } finally { setBusy(false); }
  }

  async function createProject(e:FormEvent) {
    e.preventDefault();
    if (!name.trim() || !isDesktopRuntime) return;
    setBusy(true); setError("");
    try {
      const project = await desktopApi.createProject(name.trim());
      setProjects(p=>[project,...p]); setName(""); setCreating(false); setActiveProject(project); setAssets([]);
      window.localStorage.setItem("ttk-creator:last-open-project",project.id); setView("project");
    } catch(e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const visible = projects.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Clapperboard size={21}/></div><div><b>FRAME<span>LAB</span></b><small>CREATOR STUDIO</small></div></div>
      <label className="side-label">WORKSPACE</label>
      <button className={"nav "+(view==="workspace"?"active":"")} onClick={returnToWorkspace}><LayoutGrid size={17}/> Visão geral</button>
      <button className={"nav "+(view==="workspace"?"":"active")} onClick={returnToWorkspace}><Film size={17}/> Meus projetos</button>
      <div className="side-rule"/>
      <label className="side-label">COMECE POR AQUI</label>
      <div className="tip-card"><div className="tip-icon"><GraduationCap size={19}/></div><b>Conteúdo que ensina</b><p>Crie vídeos com cenas, narração e legendas sincronizadas.</p><button onClick={()=>setCreating(true)}>Criar projeto <ArrowUpRight size={14}/></button></div>
      <div className="profile"><div className="avatar">J</div><div><b>Seu estúdio</b><small>Ambiente local</small></div><Settings2 size={17}/></div>
    </aside>
    <section className="main">
      <header className="topbar"><div>Workspace <span>/</span> <b>{view==="project"&&activeProject?activeProject.name:"Visão geral"}</b></div><div className="top-right"><small><i/> Salvo neste dispositivo</small>{view==="project"&&<button className="secondary-action" onClick={returnToWorkspace}><LayoutGrid size={15}/> Voltar à workspace</button>}<button className="secondary-action" disabled={!activeProject||view!=="project"} onClick={()=>{setMediaTab("local");setMediaModal(true);}}><Upload size={15}/> Importar mídia</button><button className="primary" onClick={()=>setCreating(true)}><Plus size={16}/> Novo projeto</button></div></header>
      <div className="content">
        {view==="workspace" ? <>
        <section className="hero"><div><label className="eyebrow"><Sparkles size={13}/> SEU PRÓXIMO VÍDEO COMEÇA AQUI</label><h1>Boas ideias merecem<br/><em>uma boa edição.</em></h1><p>Seu espaço para transformar ideias em vídeos que prendem a atenção.</p></div><div className="hero-visual"><div className="preview-art"><div className="rec">REC <i/></div><div className="play"><Play size={22} fill="currentColor"/></div><strong>IDEIA <span>EM MOVIMENTO.</span></strong><div className="scrub">00:18 <div><i/><i/><i/><i/><i/></div> 00:55</div></div><div className="float-tag"><Sparkles size={13}/> MAKE IT MATTER</div></div></section>
        <section className="stats"><div><span className="stat-icon purple"><Film size={17}/></span><label>PROJETOS<strong>{String(projects.length).padStart(2,"0")}</strong></label></div><div><span className="stat-icon orange"><Clock3 size={17}/></span><label>FORMATO PADRÃO<strong>9:16 <small>VERTICAL</small></strong></label></div><div><span className="stat-icon green"><Video size={17}/></span><label>SEU ESTÚDIO<strong>LOCAL <small>WINDOWS</small></strong></label></div></section>
        <section className="projects"><div className="section-head"><div><label className="eyebrow muted">BIBLIOTECA</label><h2>Seus projetos</h2></div><label className="search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar projeto..."/></label></div>
          {error && !mediaModal && <div className="error">{error}</div>}
          {notice && !mediaModal && <div className="notice"><CheckCircle2 size={15}/>{notice}</div>}
          {visible.length ? <div className="project-grid">{visible.map(p=><article className={"project "+(activeProject?.id===p.id?"selected":"")} key={p.id} role="button" tabIndex={0} aria-disabled={busy} onClick={()=>{if(!busy)void selectProject(p);}} onKeyDown={e=>{if(!busy&&(e.key==="Enter"||e.key===" ")){e.preventDefault();void selectProject(p);}}}><div className="thumb"><div className="thumb-grid"/><div className="thumb-play"><Play size={16} fill="currentColor"/></div><small>9:16</small></div><div className="project-meta"><div><b>{p.name}</b><small>Atualizado em {new Date(Number(p.updatedAt)).toLocaleDateString("pt-BR")}</small></div><span className="project-open-label">Abrir projeto <ArrowUpRight size={13}/></span></div></article>)}</div> :
          <div className="empty"><div className="empty-icon"><FolderOpen size={27}/><i><Plus size={13}/></i></div><b>{search?"Nenhum projeto encontrado":"Seu primeiro projeto começa aqui"}</b><p>{search?"Tente buscar por outro nome.":"Crie um espaço para reunir vídeos, áudios, cenas e ideias."}</p>{!search&&<button className="primary" onClick={()=>setCreating(true)}><FolderPlus size={16}/> Criar meu primeiro projeto</button>}</div>}
        </section>
        </> : activeProject ? <>
        <section className="project-workspace-heading">
          <div className="project-workspace-copy"><label className="eyebrow muted">PROJETO ABERTO</label><h1>{activeProject.name}</h1><p>Importe suas mídias, organize os clipes e comece a montar seu vídeo.</p></div>
          <div className="project-workspace-actions"><span className="project-format">1080 × 1920 <i>·</i> 30 FPS</span><button className="primary" onClick={()=>{setMediaTab("local");setMediaModal(true);}}><Plus size={15}/> Adicionar mídia</button></div>
        </section>
        <section className="project-workspace-status"><div><span className="workspace-status-dot"/><b>Projeto aberto</b><small>As mídias são armazenadas neste dispositivo e vinculadas a este projeto.</small></div><button className="secondary-action" onClick={returnToWorkspace}><LayoutGrid size={14}/> Todos os projetos</button></section>
        {error&&!mediaModal&&<div className="error">{error}</div>}
        <EditorWorkspace projectId={activeProject.id} assets={assets} onAddMedia={()=>{setMediaTab("local");setMediaModal(true);}}/>
        </> : null}
        <footer>FRAME LAB · FEITO PARA IDEIAS EM MOVIMENTO <span>EARLY ACCESS · 0.2.0</span></footer>
      </div>
    </section>
    {creating&&<div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreating(false);}}><form className="modal" onSubmit={createProject}><button type="button" className="close" onClick={()=>setCreating(false)}><X size={18}/></button><div className="modal-icon"><FolderPlus size={21}/></div><label className="eyebrow muted">NOVO PROJETO</label><h2>Vamos dar forma à ideia?</h2><p>Seu projeto será salvo no computador e poderá ser aberto novamente quando quiser.</p><label className="field-label" htmlFor="project-name">Nome do projeto</label><input id="project-name" autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Inglês em 1 minuto"/><div className="canvas-info"><span>Canvas vertical</span><b>1080 × 1920 · 30 FPS</b></div><button className="primary submit" disabled={!name.trim()||busy}>{busy?"Criando...":"Criar projeto"} <ArrowUpRight size={16}/></button></form></div>}
    {mediaModal&&activeProject&&<div className="backdrop media-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setMediaModal(false);}}><section className="media-modal">
      <button type="button" className="close" onClick={()=>!busy&&setMediaModal(false)}><X size={18}/></button><label className="eyebrow muted">ADICIONAR À BIBLIOTECA</label><h2>Importar mídia</h2><p className="media-modal-subtitle">Destino: <strong>{activeProject.name}</strong></p>
      <div className="media-tabs"><button className={mediaTab==="local"?"active":""} onClick={()=>{setMediaTab("local");setError("");}}><FolderOpen size={15}/> Arquivos locais</button><button className={mediaTab==="youtube"?"active":""} onClick={()=>{setMediaTab("youtube");setError("");}}><Youtube size={15}/> YouTube</button></div>
      {mediaTab==="local" ? <div><div className="dropzone"><div className="dropzone-icon"><Upload size={23}/></div><b>Traga seus arquivos para o projeto</b><p>Selecione vídeos, imagens e áudios do computador.</p><button className="primary" disabled={busy} onClick={()=>void importLocalFiles()}>{busy?<LoaderCircle className="spin" size={15}/>:<FolderOpen size={15}/>} Selecionar arquivos</button><small>Até 100 arquivos por importação</small></div><div className="supported-formats"><b>FORMATOS ACEITOS</b><span>Vídeo: MP4, MOV, MKV, WebM, AVI</span><span>Áudio: MP3, WAV, M4A, AAC, FLAC, OGG</span><span>Imagem: PNG, JPG, WebP, GIF, BMP</span></div></div> :
      <div className="youtube-import"><label className="field-label" htmlFor="youtube-url">Link do vídeo</label><div className="youtube-input"><Link2 size={16}/><input id="youtube-url" value={youtubeUrl} onChange={e=>{setYoutubeUrl(e.target.value);setYoutubeInfo(null);}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void inspectYoutube();}}} placeholder="Cole aqui o link do YouTube"/></div><button className="inspect-button" disabled={!youtubeUrl.trim()||busy} onClick={()=>void inspectYoutube()}>{busy&&!progress?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>} Inspecionar vídeo</button>
      {youtubeInfo&&<div className="youtube-preview">{youtubeInfo.thumbnail?<img src={youtubeInfo.thumbnail} alt="Miniatura do vídeo"/>:<div className="youtube-thumb-placeholder"><Youtube size={28}/></div>}<div className="youtube-details"><b>{youtubeInfo.title}</b><span>{youtubeInfo.channel||"Canal não identificado"}</span><small>{formatDuration(youtubeInfo.durationMs)} · ID {youtubeInfo.videoId}</small></div></div>}
      {youtubeInfo&&<div className="quality-row"><label className="field-label" htmlFor="quality-select">Qualidade máxima</label><select id="quality-select" value={quality} onChange={e=>setQuality(Number(e.target.value))}><option value={0}>Melhor disponível</option>{youtubeInfo.qualities.map(q=><option key={q.height} value={q.height}>{q.label}</option>)}</select></div>}
      {progress&&<div className="download-progress"><div className="progress-heading"><b>Baixando vídeo...</b><span>{progress.percent==null?"Preparando":Math.round(progress.percent)+"%"}</span></div><div className="progress-track"><i style={{width:Math.max(0,Math.min(100,progress.percent??0))+"%"}}/></div><small>{progress.speed||"Aguardando dados"} {progress.eta?"· Restante: "+progress.eta:""}</small></div>}
      <div className="youtube-note"><Youtube size={13}/> Importe somente vídeos que você tenha autorização para baixar e reutilizar.</div></div>}
      {error&&<div className="error modal-error">{error}</div>}
      <div className="modal-footer"><button className="cancel-button" disabled={busy} onClick={()=>setMediaModal(false)}>Cancelar</button>{mediaTab==="youtube"&&youtubeInfo&&<button className="primary" disabled={busy} onClick={()=>void downloadYoutube()}>{busy?<><LoaderCircle className="spin" size={15}/> Baixando...</>:<><Download size={15}/> Baixar e importar</>}</button>}</div>
    </section></div>}
    {!isDesktopRuntime&&<div className="browser-warning">Prévia no navegador. Execute pelo Tauri para importar arquivos no computador.</div>}
  </main>;
}
