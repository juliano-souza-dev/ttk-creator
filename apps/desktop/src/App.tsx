import { FormEvent, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clapperboard, LayoutGrid, Film, GraduationCap, Settings2, Plus, Search, FolderOpen, FolderPlus, Clock3, Video, Sparkles, Play, X, ArrowUpRight } from "lucide-react";

type Project = { id:string; name:string; createdAt:string; updatedAt:string; width:number; height:number };
const desktop = "__TAURI_INTERNALS__" in window;

export default function App() {
  const [projects,setProjects] = useState<Project[]>([]);
  const [name,setName] = useState("");
  const [search,setSearch] = useState("");
  const [creating,setCreating] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");

  async function refresh() {
    if (!desktop) return;
    try { setProjects(await invoke<Project[]>("list_projects")); }
    catch (e) { setError(String(e)); }
  }
  useEffect(()=>{ void refresh(); },[]);

  async function createProject(e:FormEvent) {
    e.preventDefault();
    if (!name.trim() || !desktop) return;
    setBusy(true); setError("");
    try {
      const project = await invoke<Project>("create_project",{name:name.trim()});
      setProjects(p=>[project,...p]); setName(""); setCreating(false);
    } catch(e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const visible = projects.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Clapperboard size={21}/></div><div><b>FRAME<span>LAB</span></b><small>CREATOR STUDIO</small></div></div>
      <label className="side-label">WORKSPACE</label>
      <button className="nav active"><LayoutGrid size={17}/> Visão geral</button>
      <button className="nav" onClick={()=>setCreating(true)}><Film size={17}/> Meus projetos</button>
      <div className="side-rule"/>
      <label className="side-label">COMECE POR AQUI</label>
      <div className="tip-card"><div className="tip-icon"><GraduationCap size={19}/></div><b>Conteúdo que ensina</b><p>Crie vídeos com cenas, narração e legendas sincronizadas.</p><button onClick={()=>setCreating(true)}>Criar projeto <ArrowUpRight size={14}/></button></div>
      <div className="profile"><div className="avatar">J</div><div><b>Seu estúdio</b><small>Ambiente local</small></div><Settings2 size={17}/></div>
    </aside>
    <section className="main">
      <header className="topbar"><div>Workspace <span>/</span> <b>Visão geral</b></div><div className="top-right"><small><i/> Salvo neste dispositivo</small><button className="primary" onClick={()=>setCreating(true)}><Plus size={16}/> Novo projeto</button></div></header>
      <div className="content">
        <section className="hero"><div><label className="eyebrow"><Sparkles size={13}/> SEU PRÓXIMO VÍDEO COMEÇA AQUI</label><h1>Boas ideias merecem<br/><em>uma boa edição.</em></h1><p>Seu espaço para transformar ideias em vídeos que prendem a atenção.</p></div><div className="hero-visual"><div className="preview-art"><div className="rec">REC <i/></div><div className="play"><Play size={22} fill="currentColor"/></div><strong>IDEIA <span>EM MOVIMENTO.</span></strong><div className="scrub">00:18 <div><i/><i/><i/><i/><i/></div> 00:55</div></div><div className="float-tag"><Sparkles size={13}/> MAKE IT MATTER</div></div></section>
        <section className="stats"><div><span className="stat-icon purple"><Film size={17}/></span><label>PROJETOS<strong>{String(projects.length).padStart(2,"0")}</strong></label></div><div><span className="stat-icon orange"><Clock3 size={17}/></span><label>FORMATO PADRÃO<strong>9:16 <small>VERTICAL</small></strong></label></div><div><span className="stat-icon green"><Video size={17}/></span><label>SEU ESTÚDIO<strong>LOCAL <small>WINDOWS</small></strong></label></div></section>
        <section className="projects"><div className="section-head"><div><label className="eyebrow muted">BIBLIOTECA</label><h2>Seus projetos</h2></div><label className="search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar projeto..."/></label></div>
          {error && <div className="error">{error}</div>}
          {visible.length ? <div className="project-grid">{visible.map(p=><article className="project" key={p.id}><div className="thumb"><div className="thumb-grid"/><div className="thumb-play"><Play size={16} fill="currentColor"/></div><small>9:16</small></div><div className="project-meta"><div><b>{p.name}</b><small>Atualizado em {new Date(Number(p.updatedAt)).toLocaleDateString("pt-BR")}</small></div></div></article>)}</div> :
          <div className="empty"><div className="empty-icon"><FolderOpen size={27}/><i><Plus size={13}/></i></div><b>{search?"Nenhum projeto encontrado":"Seu primeiro projeto começa aqui"}</b><p>{search?"Tente buscar por outro nome.":"Crie um espaço para reunir vídeos, áudios, cenas e ideias."}</p>{!search&&<button className="primary" onClick={()=>setCreating(true)}><FolderPlus size={16}/> Criar meu primeiro projeto</button>}</div>}
        </section>
        <footer>FRAME LAB · FEITO PARA IDEIAS EM MOVIMENTO <span>EARLY ACCESS · 0.1.0</span></footer>
      </div>
    </section>
    {creating&&<div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCreating(false);}}><form className="modal" onSubmit={createProject}><button type="button" className="close" onClick={()=>setCreating(false)}><X size={18}/></button><div className="modal-icon"><FolderPlus size={21}/></div><label className="eyebrow muted">NOVO PROJETO</label><h2>Vamos dar forma à ideia?</h2><p>Seu projeto será salvo no computador e poderá ser aberto novamente quando quiser.</p><label className="field-label" htmlFor="project-name">Nome do projeto</label><input id="project-name" autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Inglês em 1 minuto"/><div className="canvas-info"><span>Canvas vertical</span><b>1080 × 1920 · 30 FPS</b></div><button className="primary submit" disabled={!name.trim()||busy}>{busy?"Criando...":"Criar projeto"} <ArrowUpRight size={16}/></button></form></div>}
    {!desktop&&<div className="browser-warning">Prévia no navegador. Execute pelo Tauri para salvar projetos no computador.</div>}
  </main>;
}
