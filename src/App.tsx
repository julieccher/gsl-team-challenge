import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Award, CalendarDays, Camera, Check, ChevronDown, ChevronRight,
  CircleUserRound, ClipboardList, Crown, Dumbbell, FileDown, Flag, Footprints, Home,
  LockKeyhole, LogOut, Medal, Pencil, Plus, Settings, ShieldCheck, Trash2,
  Trophy, Upload, Users, Wallet, X
} from "lucide-react";
import Tesseract from "tesseract.js";
import { supabase } from "./lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

type Player = { id: string; name: string; number: number; active: boolean };
type Run = { id: string; playerId: string; km: number; date: string; minutes: number; note: string; status: "pending" | "approved" | "rejected"; screenshot_path: string | null; rejection_reason?: string | null };
type Role = "player" | "coach";
type Tab = "dashboard" | "week" | "plan" | "private" | "team" | "runs" | "settings";
type WeeklyPlan = { id: string; week_number: number; title: string; content: string; created_at: string; };

const START = "2026-11-30";
const END = "2027-01-10";
const todayKey = () => dateKey(new Date());
const isWeekCompleted = (weekEnd: string) => todayKey() > weekEnd;
const WEEK_COUNT = 6;
const GOALS = [
  { km: 2300, reward: 100 }, { km: 2600, reward: 200 }, { km: 2850, reward: 300 },
  { km: 3100, reward: 400 }, { km: 3300, reward: 500 }
];
const initialPlayers: Player[] = Array.from({ length: 20 }, (_, i) => ({
  id: `player-${i+1}`, name: `Spieler ${String(i+1).padStart(2,"0")}`, number: i+1, active: true
}));

const readStore = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
};
// Safari auf lokalen HTTP-Adressen stellt crypto.randomUUID() teilweise nicht bereit.
const makeId = () => {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10,16).join("")}`;
  }
  // Fallback für ältere Browser / unsichere lokale Testumgebungen.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const kmText = (n: number) => n.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const parseDate = (s: string) => new Date(`${s}T12:00:00`);
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const addDays = (s: string, n: number) => { const d=parseDate(s); d.setDate(d.getDate()+n); return dateKey(d); };
const fmtDate = (s: string) => parseDate(s).toLocaleDateString("de-AT",{day:"2-digit",month:"2-digit",year:"numeric"});
const inChallenge = (date: string) => date >= START && date <= END;
const weekIndex = (date: string) => {
  if (!inChallenge(date)) return -1;
  const diff = Math.floor((parseDate(date).getTime()-parseDate(START).getTime())/86400000);
  return Math.min(5, Math.floor(diff/7));
};
const weeks = Array.from({length:WEEK_COUNT},(_,i)=>({
  index:i, start:addDays(START,i*7), end:addDays(START,i*7+6), label:`Woche ${i+1}`
}));
const initials = (s:string) => s.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "?";

function weeklyPoints(km:number, rankBonus:number) {
  return (km < 16 ? -1 : km > 20 ? 1 : 0) + rankBonus;
}
function rankBonuses(items:{id:string;km:number}[]) {
  const sorted=[...items].filter(p=>p.km>0).sort((a,b)=>b.km-a.km);
  const result:Record<string,number>={};
  let lastKm:number|undefined, rank=0;
  sorted.forEach((p,i)=>{
    if (lastKm === undefined || p.km !== lastKm) rank=i+1;
    lastKm=p.km;
    result[p.id] = rank===1?4:rank===2?3:rank===3?2:0;
  });
  return result;
}
function ChallengeApp({ user, profile, onSignOut }: { user: User; profile: any; onSignOut: () => void }) {
  const [players,setPlayers]=useState<Player[]>(()=>readStore("lc26_players",initialPlayers));
  const [runs,setRuns]=useState<Run[]>(()=>readStore("lc26_runs",[]));
  const [selectedId,setSelectedId]=useState(()=>readStore("lc26_selected",initialPlayers[0]?.id ?? ""));
  const [role,setRole]=useState<Role>(profile.role === "trainer" ? "coach" : "player");
  const [tab,setTab]=useState<Tab>("dashboard");
  const [goal,setGoal]=useState(()=>readStore("lc26_goal",3300));
  const [modal,setModal]=useState<"run"|"player"|"editRun"|null>(null);
  const [editRun,setEditRun]=useState<Run|null>(null);
  const [editPlayer,setEditPlayer]=useState<Player|null>(null);
  const [notice,setNotice]=useState("");
  const [week,setWeek]=useState(0);
  const [weeklyPlans,setWeeklyPlans]=useState<WeeklyPlan[]>([]);
  const [planWeek,setPlanWeek]=useState(1);
  const [planTitle,setPlanTitle]=useState("");
  const [planContent,setPlanContent]=useState("");
  const [editingPlan,setEditingPlan]=useState<string|null>(null);

  useEffect(() => {
    let live = true;
    async function loadCloudData() {
      const [{ data: profiles, error: profileError }, { data: cloudRuns, error: runsError }] = await Promise.all([
        supabase.from("profiles").select("id,name,number,active,role").order("name"),
        supabase.from("runs").select("id,player_id,distance_km,run_date,minutes,note,status,screenshot_path,rejection_reason")
      ]);
      if (!live) return;
      if (profileError || runsError) {
        flash("Daten konnten nicht geladen werden: " + (profileError?.message || runsError?.message));
        return;
      }
      setPlayers((profiles ?? []).map((p:any) => ({ id:p.id, name:p.name, number:p.number ?? 0, active:p.active ?? true })));
      setRuns((cloudRuns ?? []).map((r:any) => ({ id:r.id, playerId:r.player_id, km:Number(r.distance_km), date:r.run_date, minutes:r.minutes ?? 0, note:r.note ?? "", status:r.status ?? "approved", screenshot_path:r.screenshot_path ?? null, rejection_reason:r.rejection_reason ?? null })));
      setSelectedId(user.id);
      setRole(profile.role === "trainer" ? "coach" : "player");
      const { data: plans, error: plansError } = await supabase.from("weekly_plans").select("id,week_number,title,content,created_at").order("week_number");
      if (plansError) flash("Wochenplan konnte nicht geladen werden: " + plansError.message);
      else setWeeklyPlans(plans ?? []);
    }
    void loadCloudData();
    return () => { live = false; };
  }, [user.id, profile.role]);

  useEffect(()=>{localStorage.setItem("lc26_players",JSON.stringify(players));},[players]);
  useEffect(()=>{localStorage.setItem("lc26_runs",JSON.stringify(runs));},[runs]);
  useEffect(()=>{localStorage.setItem("lc26_selected",JSON.stringify(selectedId));},[selectedId]);
  useEffect(()=>{localStorage.setItem("lc26_goal",JSON.stringify(goal));},[goal]);
  const flash=(s:string)=>{setNotice(s);window.setTimeout(()=>setNotice(""),2600);};

  const activePlayers=players.filter(p=>p.active);
  const approvedRuns=runs.filter(r=>r.status === "approved");
  const challengeRuns=approvedRuns.filter(r=>inChallenge(r.date));
  const preRuns=approvedRuns.filter(r=>r.date<START);
  const allKm=challengeRuns.reduce((s,r)=>s+r.km,0);
  const preKm=preRuns.reduce((s,r)=>s+r.km,0);
  const allTimeKm=runs.reduce((s,r)=>s+r.km,0);
  const rewardKm=preKm+allKm;
  const teamReward=[...GOALS].reverse().find(g=>rewardKm>g.km)?.reward??0;
  const currentPlayer=players.find(p=>p.id===selectedId)??players[0];

  const playerStats=useMemo(()=>activePlayers.map(p=>{
    const playerRuns=challengeRuns.filter(r=>r.playerId===p.id);
    const weekly=weeks.map(w=>playerRuns.filter(r=>r.date>=w.start&&r.date<=w.end).reduce((s,r)=>s+r.km,0));
    const rankBonusByWeek=weeks.map((w,i)=>{
      if (!isWeekCompleted(w.end)) return 0;
      const totals=activePlayers.map(q=>({id:q.id,km:challengeRuns.filter(r=>r.playerId===q.id&&r.date>=w.start&&r.date<=w.end).reduce((s,r)=>s+r.km,0)}));
      return rankBonuses(totals)[p.id]??0;
    });
    const pointsByWeek=weekly.map((km,i)=>isWeekCompleted(weeks[i].end)?weeklyPoints(km,rankBonusByWeek[i]):0);
    return {...p,weekly,rankBonusByWeek,pointsByWeek,challengeKm:playerRuns.reduce((s,r)=>s+r.km,0),preKm:approvedRuns.filter(r=>r.playerId===p.id&&r.date<START).reduce((s,r)=>s+r.km,0),runsCount:runs.filter(r=>r.playerId===p.id).length};
  }),[activePlayers,challengeRuns,runs]);
  const finalBonuses=useMemo(()=>todayKey()>END?rankBonuses(playerStats.map(p=>({id:p.id,km:p.challengeKm+p.preKm}))):{},[playerStats]);
  const totalPoints=(p:typeof playerStats[number])=>p.pointsByWeek.reduce((s,n)=>s+n,0)+(finalBonuses[p.id]??0);
  const sortedStats=[...playerStats].sort((a,b)=>totalPoints(b)-totalPoints(a)||(b.challengeKm+b.preKm)-(a.challengeKm+a.preKm));
  const selectedStats=playerStats.find(p=>p.id===selectedId);
  const selectedRuns=runs.filter(r=>r.playerId===selectedId).sort((a,b)=>b.date.localeCompare(a.date));
  const rewardProgress=Math.min(100,rewardKm/3300*100);
  const currentWeek=week;
  const weekTotals=activePlayers.map(p=>({id:p.id,name:p.name,number:p.number,km:challengeRuns.filter(r=>r.playerId===p.id&&r.date>=weeks[currentWeek].start&&r.date<=weeks[currentWeek].end).reduce((s,r)=>s+r.km,0)})).sort((a,b)=>b.km-a.km);

  async function saveRun(run:Run, screenshot:File|null){
    if (role !== "coach" && !screenshot) { flash("Bitte zuerst einen Screenshot hochladen."); return; }
    let screenshotPath:string|null=null;
    if (screenshot) {
      const ext=(screenshot.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
      screenshotPath=`${user.id}/${run.id}.${ext}`;
      const {error:uploadError}=await supabase.storage.from("run-screenshots").upload(screenshotPath,screenshot,{upsert:false,contentType:screenshot.type||"image/jpeg"});
      if(uploadError){flash("Screenshot-Upload fehlgeschlagen: "+uploadError.message);return;}
    }
    const payload={player_id:role==="coach"?run.playerId:user.id,distance_km:run.km,run_date:run.date,minutes:run.minutes||null,note:run.note||null,status:role==="coach"?"approved":"pending",screenshot_path:screenshotPath};
    const {error}=await supabase.from("runs").insert(payload);
    if(error){flash("Einreichen fehlgeschlagen: "+error.message);return;}
    const {data,error:loadError}=await supabase.from("runs").select("id,player_id,distance_km,run_date,minutes,note,status,screenshot_path,rejection_reason");
    if(loadError){flash(loadError.message);return;}
    setRuns((data??[]).map((r:any)=>({id:r.id,playerId:r.player_id,km:Number(r.distance_km),date:r.run_date,minutes:r.minutes??0,note:r.note??"",status:r.status??"approved",screenshot_path:r.screenshot_path??null,rejection_reason:r.rejection_reason??null})));
    setModal(null);setEditRun(null);flash(role==="coach"?"Lauf als Trainer eingetragen":"Screenshot eingereicht – wartet auf Trainerfreigabe");
  }
  async function reviewRun(id:string,status:"approved"|"rejected"){
    if(role!=="coach")return;
    const {error}=await supabase.from("runs").update({status}).eq("id",id);
    if(error){flash("Prüfung fehlgeschlagen: "+error.message);return;}
    setRuns(prev=>prev.map(r=>r.id===id?{...r,status}:r));flash(status==="approved"?"Lauf freigegeben":"Lauf abgelehnt");
  }
  async function openScreenshot(path:string){
    const {data,error}=await supabase.storage.from("run-screenshots").createSignedUrl(path,300);
    if(error||!data?.signedUrl){flash("Screenshot konnte nicht geöffnet werden: "+(error?.message??"Unbekannter Fehler"));return;}
    window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }
  async function removeRun(id:string){if(confirm("Diesen Lauf wirklich löschen?")){const {error}=await supabase.from("runs").delete().eq("id",id);if(error){flash("Löschen fehlgeschlagen: "+error.message);return;}setRuns(prev=>prev.filter(r=>r.id!==id));flash("Lauf gelöscht");}}
  async function savePlayer(p:Player){
    if(!editPlayer){flash("Neue Spieler-Logins müssen zuerst sicher in Supabase angelegt werden.");return;}
    const {error}=await supabase.from("profiles").update({name:p.name,number:p.number,active:p.active}).eq("id",p.id);
    if(error){flash("Spieler konnte nicht gespeichert werden: "+error.message);return;}
    setPlayers(prev=>prev.map(x=>x.id===p.id?p:x));setModal(null);setEditPlayer(null);flash("Spielerprofil online gespeichert");
  }
  async function removePlayer(id:string){
    if(!confirm("Spieler deaktivieren? Die bisherigen Läufe bleiben erhalten."))return;
    const {error}=await supabase.from("profiles").update({active:false}).eq("id",id);
    if(error){flash("Spieler konnte nicht deaktiviert werden: "+error.message);return;}
    setPlayers(prev=>prev.map(p=>p.id===id?{...p,active:false}:p));flash("Spieler online deaktiviert");
  }

  const navItems:[Tab,string,React.ReactNode][]=[
    ["dashboard","Dashboard",<Home/>],["week","Wochenübersicht",<CalendarDays/>],["plan","Wochenplan",<ClipboardList/>],
    ["private","Meine Übersicht",<CircleUserRound/>],["team","Teamrangliste",<Users/>],
    ["runs","Läufe",<Activity/>],["settings","Verwaltung",<Settings/>]
  ];
  // Verwaltungsbereich ausschließlich für Trainer anzeigen und zugänglich machen.
  const visibleNavItems = role === "coach" ? navItems : navItems.filter(([key]) => key !== "settings");
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-logo"><Footprints size={23}/></div><div><b>Laufchallenge</b><small>GSL TEAM CHALLENGE</small></div></div>
      <div className="role-switch"><span>ANSICHT</span><div><button className="chosen" disabled>{role==="coach"?"Trainerkonto":"Spielerkonto"}</button></div></div>
      <nav>{visibleNavItems.map(([key,label,icon])=><button key={key} className={`nav-item ${tab===key?"active":""}`} onClick={()=>setTab(key)}>{icon}<span>{label}</span>{key==="team"&&<span className="tiny-lock"><LockKeyhole size={12}/></span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="profile-mini"><div className="avatar">{initials(currentPlayer?.name??"LC")}</div><div><b>{currentPlayer?.name??"Kein Spieler"}</b><small>{role==="coach"?"Traineransicht":"Persönlicher Bereich"}</small></div></div><small className="local-tag">ONLINE · SUPABASE</small></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="mobile-brand"><Footprints size={20}/> Laufchallenge</div><div className="topbar-right"><span className="status-dot"/> Challenge: 30.11.2026 – 10.01.2027 <span className="role-pill">{profile.name} · {role==="coach"?"Trainer":"Spieler"}</span><button className="role-pill" onClick={onSignOut}>Abmelden <LogOut size={13}/></button></div></header>
      <div className="content">
        {tab==="dashboard"&&<Dashboard allKm={allKm} rewardKm={rewardKm} allTimeKm={allTimeKm} preKm={preKm} reward={teamReward} rewardProgress={rewardProgress} goal={goal} setGoal={setGoal} players={activePlayers.length} challengeRuns={challengeRuns.length} stats={sortedStats} totalPoints={totalPoints} onRuns={()=>setTab("runs")} onTeam={()=>{setRole("coach");setTab("team");}}/>}
        {tab==="week"&&<WeekView week={week} setWeek={setWeek} totals={weekTotals} stats={playerStats} players={activePlayers.length}/>}
        {tab==="plan"&&<WeeklyPlanView plans={weeklyPlans} isCoach={role==="coach"} planWeek={planWeek} setPlanWeek={setPlanWeek} title={planTitle} setTitle={setPlanTitle} content={planContent} setContent={setPlanContent} editingPlan={editingPlan} onEdit={(p)=>{setEditingPlan(p.id);setPlanWeek(p.week_number);setPlanTitle(p.title);setPlanContent(p.content);}} onCancel={()=>{setEditingPlan(null);setPlanTitle("");setPlanContent("");}} onSave={async()=>{if(!planTitle.trim()||!planContent.trim()){flash("Bitte Titel und Wochenplan eintragen.");return;}const payload={week_number:planWeek,title:planTitle.trim(),content:planContent.trim(),created_by:user.id};const result=editingPlan?await supabase.from("weekly_plans").update(payload).eq("id",editingPlan):await supabase.from("weekly_plans").insert(payload);if(result.error){flash("Wochenplan konnte nicht gespeichert werden: "+result.error.message);return;}const {data,error}=await supabase.from("weekly_plans").select("id,week_number,title,content,created_at").order("week_number");if(error){flash(error.message);return;}setWeeklyPlans(data??[]);setEditingPlan(null);setPlanTitle("");setPlanContent("");flash("Wochenplan veröffentlicht");}} onDelete={async(id)=>{if(!confirm("Diesen Wochenplan wirklich löschen?"))return;const {error}=await supabase.from("weekly_plans").delete().eq("id",id);if(error){flash("Löschen fehlgeschlagen: "+error.message);return;}setWeeklyPlans(prev=>prev.filter(p=>p.id!==id));flash("Wochenplan gelöscht");}}/>}
        {tab==="private"&&<PrivateView player={currentPlayer} stats={selectedStats} runs={selectedRuns} players={role==="coach"?players:players.filter(p=>p.id===user.id)} selectedId={selectedId} setSelectedId={setSelectedId} finalBonus={finalBonuses[selectedId]??0} totalPoints={selectedStats?totalPoints(selectedStats):0} onAdd={()=>{setEditRun(null);setModal("run");}} onEdit={r=>{setEditRun(r);setModal("editRun");}} onDelete={removeRun}/>}
        {tab==="team"&&<TeamView stats={sortedStats} totalPoints={totalPoints} finalBonuses={finalBonuses} goal={goal} allKm={allKm} reward={teamReward} canManage={role==="coach"} onEditPlayer={p=>{setEditPlayer(p);setModal("player");}} onDeletePlayer={removePlayer}/>}
        {tab==="runs"&&<AllRuns runs={runs} players={players} role={role} selectedId={selectedId} onAdd={()=>{setEditRun(null);setModal("run");}} onEdit={r=>{setEditRun(r);setModal("editRun");}} onDelete={removeRun} onReview={reviewRun} onScreenshot={openScreenshot}/>}
        {tab==="settings"&&role==="coach"&&<SettingsView players={players} setPlayers={setPlayers} goal={goal} setGoal={setGoal} runs={runs} setRuns={setRuns} onExport={()=>exportBackup(players,runs,goal)} onImport={d=>{setPlayers(d.players);setRuns(d.runs);setGoal(d.goal);flash("Backup importiert");}}/>}
      </div>
      <footer className="footer"><span>Laufchallenge · GSL</span><span>Jeder Kilometer zählt.</span></footer>
    </main>
    <div className="mobile-nav">{navItems.filter(([k])=>["dashboard","week","plan","private","team","runs"].includes(k)).map(([k,label,icon])=><button key={k} className={tab===k?"active":""} onClick={()=>setTab(k)}>{icon}<small>{label==="Wochenübersicht"?"Woche":label==="Wochenplan"?"Plan":label==="Läufe"?"Läufe":label==="Meine Übersicht"?"Ich":label==="Trainerübersicht"?"Team":label==="Dashboard"?"Start":label}</small></button>)}</div>
    {modal&&<Modal mode={modal} run={editRun} player={editPlayer} players={players.filter(p=>p.active)} selectedId={selectedId} onClose={()=>{setModal(null);setEditRun(null);setEditPlayer(null);}} onSaveRun={saveRun} isCoach={role === "coach"} onSavePlayer={savePlayer}/>}
    {notice&&<div className="toast"><Check size={16}/>{notice}</div>}
  </div>;
}

function Title({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle:string;action?:React.ReactNode}){return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;}
function StatCard({label,value,sub,icon}:{label:string;value:string;sub:string;icon:React.ReactNode}){return <div className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><b>{value}</b><small>{sub}</small></div>;}
function Dashboard({allKm,rewardKm,allTimeKm,preKm,reward,rewardProgress,goal,setGoal,players,challengeRuns,stats,totalPoints,onRuns,onTeam}:{allKm:number;rewardKm:number;allTimeKm:number;preKm:number;reward:number;rewardProgress:number;goal:number;setGoal:(n:number)=>void;players:number;challengeRuns:number;stats:any[];totalPoints:(p:any)=>number;onRuns:()=>void;onTeam:()=>void}){
 const next=GOALS.find(g=>rewardKm<=g.km);
 return <><Title eyebrow="GSL TEAM CHALLENGE · 6 WOCHEN" title="Gemeinsam Kilometer sammeln." subtitle="30. November 2026 bis 10. Januar 2027" action={<button className="red-button" onClick={onRuns}><Plus size={17}/> Lauf einreichen</button>}/>
 <section className="hero"><div className="hero-content"><div className="hero-kicker"><span className="pulse"/> MANNSCHAFTSLEISTUNG</div><div className="hero-total">{kmText(rewardKm)} <span>KM</span></div><p>für die Mannschaftsprämie · inklusive Läufe vor Challenge-Start</p><div className="hero-bar"><div style={{width:`${rewardProgress}%`}}/></div><div className="hero-bar-label"><span>{rewardProgress.toFixed(1).replace(".",",")}% bis 3.300 km</span><b>{next?`${kmText(Math.max(0,next.km-rewardKm))} km bis ${next.reward} €`:"Höchste Prämie erreicht"}</b></div><div className="hero-reward"><Wallet size={18}/><span>Aktuelle Mannschaftskasse</span><strong>{reward} €</strong></div></div><div className="hero-art"><div className="ring ring-one"/><div className="ring ring-two"/><div className="hero-ball"><Footprints size={58}/></div><span>GSL<br/>2026/27</span></div></section>
 <div className="stat-grid"><StatCard label="Aktive Spieler" value={String(players)} sub="Mannschaftskader" icon={<Users/>}/><StatCard label="Läufe in der Challenge" value={String(challengeRuns)} sub="30.11.2026 – 10.01.2027" icon={<Activity/>}/><StatCard label="Kilometer vor Start" value={`${kmText(preKm)} km`} sub="Keine Wochenpunkte · zählt zur Prämie und Abschlusswertung" icon={<CalendarDays/>}/></div>
 <div className="section-head"><div><div className="eyebrow">PRÄMIENSTUFEN</div><h2>So füllt sich die Mannschaftskasse</h2></div></div><div className="reward-grid">{GOALS.map(g=><div className={`reward-card ${rewardKm>g.km?"reached":""}`} key={g.km}><div className="reward-icon">{rewardKm>g.km?<Check size={18}/>:<Wallet size={18}/>}</div><b>{g.reward} €</b><span>{g.km.toLocaleString("de-AT")} km</span><div className="mini-track"><div style={{width:`${Math.min(100,rewardKm/g.km*100)}%`}}/></div><small>{rewardKm>g.km?"Erreicht":`${Math.max(0,g.km-rewardKm)} km fehlen`}</small></div>)}</div>
 <div className="section-head top-gap"><div><div className="eyebrow">GSL-WERTUNG</div><h2>Aktuelle Top-Spieler</h2></div><button className="link-button" onClick={onTeam}>Trainerübersicht <ChevronRight size={15}/></button></div><div className="table-card"><div className="table-row table-head"><span>Spieler</span><span>Gesamt-km</span><span>GSL-Punkte</span></div>{stats.slice(0,5).map((p,i)=><div className="table-row" key={p.id}><span className="name-cell"><i className={`place place-${i+1}`}>{i+1}</i><b>{p.name}</b></span><strong>{kmText(p.challengeKm+p.preKm)} km</strong><strong className="points">{totalPoints(p)>0?"+":""}{totalPoints(p)}</strong></div>)}</div>
 <p className="fine-print">Gesamt seit Aufzeichnung: {kmText(allTimeKm)} km. Vor dem 30.11.2026 absolvierte, freigegebene Läufe zählen zur Mannschaftsprämie und zur Kilometerbasis des Abschlussbonus. Sie bringen keine Wochenpunkte und keine Wochen-Top-3-Boni.</p>
 </>;
}
function WeeklyPlanView({plans,isCoach,planWeek,setPlanWeek,title,setTitle,content,setContent,editingPlan,onEdit,onCancel,onSave,onDelete}:{plans:WeeklyPlan[];isCoach:boolean;planWeek:number;setPlanWeek:(n:number)=>void;title:string;setTitle:(s:string)=>void;content:string;setContent:(s:string)=>void;editingPlan:string|null;onEdit:(p:WeeklyPlan)=>void;onCancel:()=>void;onSave:()=>void;onDelete:(id:string)=>void}){
 return <><Title eyebrow="TRAININGSVORGABEN · GSL" title="Wochenplan" subtitle="Der Trainer veröffentlicht hier die Laufaufgaben für jede Challenge-Woche."/>{isCoach&&<section className="weekly-plan-editor"><div className="section-head"><div><div className="eyebrow">TRAINERBEREICH</div><h2>{editingPlan?"Wochenplan bearbeiten":"Neue Wochenaufgabe veröffentlichen"}</h2></div></div><div className="plan-form-row"><label>Challenge-Woche<select value={planWeek} onChange={e=>setPlanWeek(Number(e.target.value))}>{weeks.map(w=><option value={w.index+1} key={w.index}>Woche {w.index+1} · {fmtDate(w.start)} – {fmtDate(w.end)}</option>)}</select></label><label>Titel<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="z. B. Grundlagenausdauer"/></label></div><label className="plan-content-label">Laufaufgabe / Beschreibung<textarea value={content} onChange={e=>setContent(e.target.value)} rows={5} placeholder="Beschreibe die Laufaufgabe, Kilometerziele, Tempo oder Hinweise für die Mannschaft…"/></label><div className="plan-actions"><button className="red-button" onClick={onSave}><Check size={16}/>{editingPlan?"Änderungen speichern":"Wochenplan veröffentlichen"}</button>{editingPlan&&<button className="secondary-button" onClick={onCancel}>Abbrechen</button>}</div></section>}<div className="section-head top-gap"><div><div className="eyebrow">DIE 6 CHALLENGE-WOCHEN</div><h2>Aufgaben der Mannschaft</h2></div></div><div className="weekly-plan-list">{weeks.map(w=>{const p=plans.find(x=>x.week_number===w.index+1);return <article className="weekly-plan-card" key={w.index}><div className="plan-week-badge">W{w.index+1}</div><div className="plan-card-main"><small>{fmtDate(w.start)} – {fmtDate(w.end)}</small><h3>{p?.title??"Noch kein Wochenplan veröffentlicht"}</h3><p>{p?.content??(isCoach?"Veröffentliche hier die Laufaufgabe für diese Woche.":"Der Trainer hat für diese Woche noch keine Aufgabe veröffentlicht.")}</p>{p&&<small className="plan-published">Veröffentlicht am {new Date(p.created_at).toLocaleDateString("de-AT")}</small>}</div>{isCoach&&p&&<div className="plan-card-actions"><button className="icon-button" onClick={()=>onEdit(p)} title="Bearbeiten"><Pencil size={15}/></button><button className="icon-button delete" onClick={()=>onDelete(p.id)} title="Löschen"><Trash2 size={15}/></button></div>}</article>})}</div></>;
}

function WeekView({week,setWeek,totals,stats,players}:{week:number;setWeek:(n:number)=>void;totals:any[];stats:any[];players:number}){
 const w=weeks[week];const current=totals.reduce((s,p)=>s+p.km,0);const bonus=rankBonuses(totals);
 return <><Title eyebrow="WOCHEN-CHECK" title="Wochenübersicht" subtitle="Jede Woche zählt – Kilometer und GSL-Punkte im Überblick."/>
 <div className="week-picker"><button onClick={()=>setWeek(Math.max(0,week-1))} disabled={week===0}>‹</button><div><b>Woche {week+1} von 6</b><span>{fmtDate(w.start)} – {fmtDate(w.end)}</span></div><button onClick={()=>setWeek(Math.min(5,week+1))} disabled={week===5}>›</button></div>
 <div className="week-summary"><div><small>TEAMKILOMETER</small><strong>{kmText(current)} <em>km</em></strong></div><div><small>SPIELER IM KADER</small><strong>{players}</strong></div><div><small>TEAMZIEL PRO WOCHE</small><strong>–</strong></div></div>
 <div className="section-head"><div><div className="eyebrow">WOCHENLEISTUNG</div><h2>Kilometer pro Spieler</h2></div></div><div className="bars-card">{totals.map((p,i)=><div className="bar-line" key={p.id}><div className="bar-name"><span>{p.name}</span><b>{kmText(p.km)} km</b></div><div className="bar-track"><div className="bar-fill" style={{width:`${Math.min(100,p.km/30*100)}%`}}/></div><small className={p.km<16?"negative":p.km>20?"positive":"neutral"}>{!isWeekCompleted(w.end)?(todayKey()<w.start?"Noch nicht freigeschaltet":"Woche läuft · Wertung nach Sonntag"):(p.km<16?"−1 GSL · unter 16 km":p.km>20?"+1 GSL · über 20 km":"0 GSL · Zielbereich erreicht")}{isWeekCompleted(w.end)&&bonus[p.id]?` · +${bonus[p.id]} Podium`:""}</small></div>)}</div>
 <div className="rules-note"><b>GSL-Regeln pro Woche</b><span>Unter 16 km: −1 Punkt · 16 bis einschließlich 20 km: 0 Punkte · über 20 km: +1 Punkt.</span><span>Zusätzlicher Wochenbonus: Platz 1 +4, Platz 2 +3, Platz 3 +2 GSL-Punkte. Bei Gleichstand erhalten Spieler mit gleicher Kilometerzahl denselben Rangbonus.</span></div>
 </>;
}
function PrivateView({player,stats,runs,players,selectedId,setSelectedId,finalBonus,totalPoints,onAdd,onEdit,onDelete}:{player?:Player;stats:any;runs:Run[];players:Player[];selectedId:string;setSelectedId:(s:string)=>void;finalBonus:number;totalPoints:number;onAdd:()=>void;onEdit:(r:Run)=>void;onDelete:(id:string)=>void}){
 if(!player)return <><Title eyebrow="PERSÖNLICHER BEREICH" title="Meine Übersicht" subtitle="Wähle dein Spielerprofil."/></>;
 return <><Title eyebrow="NUR DEIN PROFIL" title={`Servus, ${player.name.split(" ")[0]}.`} subtitle="Deine persönlichen Kilometer und GSL-Punkte." action={<button className="red-button" onClick={onAdd}><Plus size={17}/> Lauf einreichen</button>}/>
 <div className="player-select"><label>Spielerprofil auswählen (lokale Vorschau)<select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>{players.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name} · #{p.number}</option>)}</select></label></div>
 <div className="private-score"><div className="private-avatar">{initials(player.name)}</div><div><small>DEIN GSL-KONTO</small><strong>{totalPoints>0?"+":""}{totalPoints}</strong><span>GSL-Punkte inkl. Abschlussbonus</span></div><div className="private-medal"><Medal size={32}/></div></div>
 <div className="stat-grid"><StatCard label="Challenge-Kilometer" value={`${kmText(stats?.challengeKm??0)} km`} sub="Im Zeitraum 6 Wochen" icon={<Footprints/>}/><StatCard label="Vor Challenge" value={`${kmText(stats?.preKm??0)} km`} sub="Keine Wochenpunkte · zählt zur Prämie und Abschlusswertung" icon={<CalendarDays/>}/><StatCard label="Abschlussbonus" value={`+${finalBonus}`} sub="Endrangliste" icon={<Trophy/>}/></div>
 <div className="section-head"><div><div className="eyebrow">DEIN WOCHENVERLAUF</div><h2>Sechs Wochen im Überblick</h2></div></div><div className="personal-weeks">{weeks.map((w,i)=>{const km=stats?.weekly[i]??0;const pts=stats?.pointsByWeek[i]??0;return <div className="personal-week" key={w.index}><div><b>W{i+1}</b><small>{fmtDate(w.start).slice(0,5)} – {fmtDate(w.end).slice(0,5)}</small></div><div className="personal-week-bar"><div style={{width:`${Math.min(100,km/25*100)}%`}}/></div><strong>{kmText(km)} km</strong><em className={!isWeekCompleted(w.end)?"locked":pts>0?"positive":pts<0?"negative":""}>{!isWeekCompleted(w.end)?(todayKey()<w.start?"Offen":"Läuft"):`${pts>0?"+":""}${pts} P.`}</em></div>;})}</div>
 <div className="rules-note"><b>Deine Punkte</b><span>Wochenpunkte: −1 bei unter 16 km, +1 bei über 20 km, dazu ein möglicher Top-3-Bonus.</span><span>Abschlussbonus: Die drei Spieler mit den meisten freigegebenen Gesamtkilometern (inklusive Läufe vor dem Challenge-Start) erhalten zusätzlich +4, +3 und +2 Punkte. Läufe vor dem Start bringen keine Wochenpunkte.</span></div>
 <div className="section-head top-gap"><div><div className="eyebrow">DEINE AKTIVITÄTEN</div><h2>Meine Läufe</h2></div></div><RunList runs={runs} onEdit={onEdit} onDelete={onDelete} showActions={false}/></>;
}
function TeamView({stats,totalPoints,finalBonuses,goal,allKm,reward,onEditPlayer,onDeletePlayer,canManage}:{stats:any[];totalPoints:(p:any)=>number;finalBonuses:Record<string,number>;goal:number;allKm:number;reward:number;onEditPlayer:(p:Player)=>void;onDeletePlayer:(id:string)=>void;canManage:boolean}){
 return <><Title eyebrow="GSL TEAM CHALLENGE · ALLE SPIELER" title="Teamrangliste" subtitle="Kilometer, Wochenwerte und GSL-Punkte der gesamten Mannschaft."/>
 <div className="coach-metrics"><div><small>TEAM-KM</small><b>{kmText(allKm)}</b></div><div><small>MANNSCHAFTSKASSE</small><b>{reward} €</b></div><div><small>AKTIVE SPIELER</small><b>{stats.length}</b></div></div>
 <div className="table-card coach-table"><div className="table-row coach-head"><span>Spieler</span><span>Gesamt-km</span>{weeks.map(w=><span key={w.index}>W{w.index+1}</span>)}<span>Abschluss</span><span>GSL</span>{canManage&&<span>Verwaltung</span>}</div>{stats.map((p,i)=><div className="table-row coach-row" key={p.id}><span className="name-cell"><i className={`place place-${i+1}`}>{i+1}</i><b>{p.name}</b></span><strong>{kmText(p.challengeKm+p.preKm)}</strong>{p.weekly.map((km:number,j:number)=><span key={j} className={!isWeekCompleted(weeks[j].end)?"locked":km<16?"negative":km>20?"positive":""}>{kmText(km)}</span>)}<strong className="points">+{finalBonuses[p.id]??0}</strong><strong className="points">{totalPoints(p)>0?"+":""}{totalPoints(p)}</strong>{canManage&&<span className="row-actions"><button onClick={()=>onEditPlayer(p)} title="Bearbeiten"><Pencil size={14}/></button><button onClick={()=>onDeletePlayer(p.id)} title="Deaktivieren"><Trash2 size={14}/></button></span>}</div>)}</div>
 <div className="rules-note"><b>Trainerhinweis</b><span>Die Wochenwerte sind nach dem festgelegten Zeitraum berechnet. Freigegebene Läufe vor dem 30.11.2026 zählen zur Mannschaftsprämie und zur Kilometerbasis des Abschlussbonus, aber nicht zu Wochenpunkten oder Wochenboni.</span><span>Die Teamrangliste ist für alle angemeldeten Mannschaftsmitglieder sichtbar.</span></div>
 </>;
}
function AllRuns({runs,players,role,selectedId,onAdd,onEdit,onDelete,onReview,onScreenshot}:{runs:Run[];players:Player[];role:Role;selectedId:string;onAdd:()=>void;onEdit:(r:Run)=>void;onDelete:(id:string)=>void;onReview:(id:string,s:"approved"|"rejected")=>void;onScreenshot:(p:string)=>void}) {
  const visible = role === "coach" ? runs : runs.filter(r => r.playerId === selectedId);
  const sorted = [...visible].sort((a,b) => b.date.localeCompare(a.date));
  const pending = role === "coach" ? sorted.filter(r => r.status === "pending") : [];
  return (
    <>
      <Title eyebrow="LAUFHISTORIE" title={role === "coach" ? "Laufprüfung & Historie" : "Meine Läufe"} subtitle={role === "coach" ? "Neue Einreichungen prüfen. Nur freigegebene Läufe zählen zur Wertung." : "Deine Einreichungen und deren Prüfstatus."} action={<button className="red-button" onClick={onAdd}><Plus size={17}/> Screenshot einreichen</button>} />
      {role === "coach" && (
        <>
          <div className="section-head"><div><div className="eyebrow">TRAINERFREIGABE</div><h2>Ausstehend · {pending.length}</h2></div></div>
          {pending.length === 0 ? <div className="empty-card">Aktuell keine Läufe zur Prüfung.</div> : (
            <div className="run-list">
              {pending.map(r => (
                <div className="review-row" key={r.id}>
                  <div className="run-info"><b>{players.find(p => p.id === r.playerId)?.name ?? "Spieler"} · {kmText(r.km)} km</b><small>{fmtDate(r.date)} · Eingereicht, wartet auf Prüfung</small></div>
                  {r.screenshot_path && <button className="secondary-button" onClick={() => onScreenshot(r.screenshot_path!)}>Screenshot ansehen</button>}
                  <button className="red-button" onClick={() => onReview(r.id,"approved")}>Freigeben</button>
                  <button className="secondary-button" onClick={() => onReview(r.id,"rejected")}>Ablehnen</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="section-head top-gap"><div><div className="eyebrow">ALLE EINREICHUNGEN</div><h2>{role === "coach" ? "Mannschaftsläufe" : "Deine Laufhistorie"}</h2></div></div>
      <div className="run-list">
        {sorted.map(r => (
          <div className="run-item" key={r.id}>
            <div className="run-icon"><Footprints size={18}/></div>
            <div className="run-info"><b>{players.find(p => p.id === r.playerId)?.name ?? "Lauf"} · {kmText(r.km)} km</b><small>{fmtDate(r.date)} · {r.minutes ? `${r.minutes} min` : "Zeit nicht angegeben"}</small></div>
            <strong className={`run-status ${r.status}`}>{r.status === "approved" ? "Freigegeben" : r.status === "rejected" ? "Abgelehnt" : "Wird geprüft"}</strong>
            {role === "coach" && r.screenshot_path && <button className="icon-button" onClick={() => onScreenshot(r.screenshot_path!)} title="Screenshot ansehen"><Camera size={15}/></button>}
          </div>
        ))}
      </div>
    </>
  );
}
function RunList({runs,players,onEdit,onDelete,showActions=true}:{runs:Run[];players?:Player[];onEdit:(r:Run)=>void;onDelete:(id:string)=>void;showActions?:boolean}){
 if(!runs.length)return <div className="empty-card">Noch keine Läufe gespeichert. Reiche deinen ersten Screenshot ein.</div>;
 return <div className="run-list">{runs.map(r=><div className="run-item" key={r.id}><div className="run-icon"><Footprints size={18}/></div><div className="run-info"><b>{players?.find(p=>p.id===r.playerId)?.name??(r.note||"Laufeinheit")}</b><small>{fmtDate(r.date)} · {r.minutes?`${r.minutes} min`:"Zeit nicht angegeben"} {inChallenge(r.date)?"· Challenge":"· Vor Challenge"}</small></div><strong>{kmText(r.km)} km</strong><strong className={`run-status ${r.status}`}>{r.status==="approved"?"Freigegeben":r.status==="rejected"?"Abgelehnt":"Wird geprüft"}</strong>{showActions&&r.status==="approved"&&<><button className="icon-button" onClick={()=>onEdit(r)}><Pencil size={15}/></button><button className="icon-button delete" onClick={()=>onDelete(r.id)}><Trash2 size={15}/></button></>}</div>)}</div>;
}
function SettingsView({players,setPlayers,goal,setGoal,runs,setRuns,onExport,onImport}:{players:Player[];setPlayers:(p:Player[])=>void;goal:number;setGoal:(n:number)=>void;runs:Run[];setRuns:(r:Run[])=>void;onExport:()=>void;onImport:(d:any)=>void}){
 const ref=useRef<HTMLInputElement>(null);
 return <><Title eyebrow="APP-EINSTELLUNGEN" title="Verwaltung" subtitle="Kader, Teamziel und Datensicherung verwalten."/><div className="settings-grid"><section className="settings-card"><h3><Flag/> Mannschaftsprämie</h3><p>Automatisch anhand der Teamkilometer im Challenge-Zeitraum.</p><label>Persönliches Anzeigeziel (km)<input type="number" min="1" value={goal} onChange={e=>setGoal(Number(e.target.value)||1)}/></label><small>Die Prämienstufen bleiben gemäß Vorgabe bei 2.300 bis 3.300 km.</small></section><section className="settings-card"><h3><Users/> Spielerverwaltung</h3><p>{players.filter(p=>p.active).length} aktive Spieler · {runs.length} Läufe</p>{players.map(p=><div className="admin-player" key={p.id}><span>#{p.number} · {p.name} {!p.active&&"(inaktiv)"}</span></div>)}</section><section className="settings-card"><h3><FileDown/> Backup</h3><p>Spieler und Läufe als JSON sichern oder wiederherstellen.</p><div className="button-line"><button className="secondary-button" onClick={onExport}>Exportieren</button><button className="secondary-button" onClick={()=>ref.current?.click()}>Importieren</button><input hidden ref={ref} type="file" accept="application/json" onChange={async e=>{const f=e.target.files?.[0];if(f){try{onImport(JSON.parse(await f.text()));}catch{alert("Backup-Datei ungültig.");}}}}/></div></section></div></>;
}
function Modal({mode,run,player,players,selectedId,onClose,onSaveRun,onSavePlayer,isCoach}:{mode:"run"|"player"|"editRun";run:Run|null;player:Player|null;players:Player[];selectedId:string;onClose:()=>void;onSaveRun:(r:Run,f:File|null)=>void;onSavePlayer:(p:Player)=>void;isCoach:boolean}){
 const isPlayer=mode==="player";const [playerId,setPlayerId]=useState(run?.playerId??selectedId??players[0]?.id??"");const [km,setKm]=useState(run?String(run.km):"");const [date,setDate]=useState(run?.date??dateKey(new Date()));const [minutes,setMinutes]=useState(run?String(run.minutes):"");const [note,setNote]=useState(run?.note??"");const [name,setName]=useState(player?.name??"");const [number,setNumber]=useState(player?String(player.number):"");const [err,setErr]=useState("");const [ocr,setOcr]=useState("");const [busy,setBusy]=useState(false);const [screenshot,setScreenshot]=useState<File|null>(null);const fileRef=useRef<HTMLInputElement>(null);
 async function readImage(file:File){setScreenshot(file);setBusy(true);setErr("");setOcr("Screenshot wird per Texterkennung analysiert …");try{const result=await Tesseract.recognize(file,"eng",{logger:m=>{if(m.status==="recognizing text")setOcr(`Texterkennung: ${Math.round((m.progress??0)*100)}%`);}});const text=result.data.text;const matches=[...text.matchAll(/(\d{1,3}[.,]\d{1,2})\s*(?:km|kms|kilometer)\b/gi)].map(m=>Number(m[1].replace(",","."))).filter(n=>n>0&&n<200);const dateMatch=text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);if(matches.length){setKm(String(Math.max(...matches)));}if(dateMatch){const [,d,m,y]=dateMatch;setDate(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);}setOcr(matches.length?"Distanz erkannt. Datum bitte auf Plausibilität prüfen; Trainer kontrolliert den Screenshot.":"Keine eindeutige Distanz erkannt. Bitte einen besser lesbaren Screenshot hochladen.");}catch{setErr("Screenshot konnte nicht automatisch gelesen werden. Bitte anderen Screenshot versuchen.");}finally{setBusy(false);}}
 async function submit(e:React.FormEvent){e.preventDefault();if(isPlayer){if(!name.trim()||!number.trim()){setErr("Name und Rückennummer sind erforderlich.");return;}onSavePlayer({id:player?.id??makeId(),name:name.trim(),number:Number(number),active:player?.active??true});return;}const dist=Number(km.replace(",","."));if(!playerId||!Number.isFinite(dist)||dist<=0||dist>200){setErr("Bitte Spieler und gültige Kilometer angeben.");return;}if(date>dateKey(new Date())){setErr("Das Laufdatum darf nicht in der Zukunft liegen.");return;}if(!isCoach&&!screenshot){setErr("Bitte zuerst den Original-Screenshot hochladen.");return;}await onSaveRun({id:run?.id??makeId(),playerId,km:dist,date,minutes:Number(minutes)||0,note:note.trim(),status:isCoach?"approved":"pending",screenshot_path:null},screenshot);}
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal"><div className="modal-header"><div><small>{isPlayer?"MANNSCHAFT":run?"LAUF BEARBEITEN":"LAUF EINREICHEN"}</small><h2>{isPlayer?(player?"Spieler bearbeiten":"Spieler hinzufügen"):(run?"Lauf bearbeiten":"Neuen Lauf erfassen")}</h2></div><button className="icon-button" onClick={onClose}><X/></button></div><form onSubmit={submit}>
 {isPlayer?<><label>Spielername<input value={name} onChange={e=>setName(e.target.value)} placeholder="Vor- und Nachname" required/></label><label>Rückennummer<input type="number" min="0" max="99" value={number} onChange={e=>setNumber(e.target.value)} required/></label></>:<>
 {isCoach&&<label>Spieler<select value={playerId} onChange={e=>setPlayerId(e.target.value)}>{players.map(p=><option key={p.id} value={p.id}>{p.name} · #{p.number}</option>)}</select></label>}
 <div className="upload-box" onClick={()=>fileRef.current?.click()}><input ref={fileRef} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void readImage(f);}}/><Camera size={23}/><b>Screenshot auswählen</b><span>Garmin, Strava, Apple Fitness und andere Lauf-Apps</span><span className="upload-action"><Upload size={14}/> Bild hochladen</span></div>{ocr&&<div className="ocr-message">{ocr}</div>}
 <div className="form-two"><label>Kilometer<input inputMode="decimal" value={km} onChange={e=>setKm(e.target.value)} placeholder="Wird aus Screenshot gelesen" required readOnly={!isCoach}/></label><label>Datum<input type="date" value={date} onChange={e=>setDate(e.target.value)} required readOnly={!isCoach}/></label></div>{isCoach&&<div className="form-two"><label>Laufzeit (Minuten)<input type="number" min="0" value={minutes} onChange={e=>setMinutes(e.target.value)} placeholder="z. B. 42"/></label><label>Notiz<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional"/></label></div>}{!isCoach&&<div className="ocr-message">Deine Werte sind nach dem Einreichen nicht mehr bearbeitbar. Sie zählen erst nach Trainerfreigabe.</div>}</>}
 {err&&<div className="form-error">{err}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="red-button" type="submit" disabled={busy}><Check size={16}/> {isCoach?"Speichern":"Zur Prüfung einreichen"}</button></div>
 </form></div></div>;
}
function exportBackup(players:Player[],runs:Run[],goal:number){const blob=new Blob([JSON.stringify({players,runs,goal},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="laufchallenge-backup.json";a.click();URL.revokeObjectURL(a.href);}
function LoginScreen() {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError(error.message);setBusy(false);}
  return <div className="app-shell" style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24}}>
    <form className="modal" onSubmit={submit} style={{width:"min(420px,100%)",padding:28}}>
      <div className="brand" style={{marginBottom:28}}><div className="brand-logo"><Footprints size={23}/></div><div><b>Laufchallenge</b><small>GSL TEAM CHALLENGE</small></div></div>
      <div className="eyebrow">MITGLIEDERBEREICH</div><h1 style={{marginTop:8}}>Willkommen zurück.</h1><p>Bitte mit deinem persönlichen Zugang anmelden.</p>
      <label>E-Mail-Adresse<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
      {error&&<div className="form-error">{error}</div>}
      <button className="red-button" type="submit" disabled={busy} style={{width:"100%",justifyContent:"center"}}>{busy?"Anmeldung läuft …":"Anmelden"}</button>
      <small style={{display:"block",marginTop:18,color:"#777"}}>Zugänge werden vom Trainer eingerichtet.</small>
    </form>
  </div>;
}

function App() {
  const [session,setSession]=useState<Session|null>(null);
  const [profile,setProfile]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let alive=true;
    supabase.auth.getSession().then(({data})=>{if(alive){setSession(data.session);setLoading(false);}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next)setProfile(null);});
    return ()=>{alive=false;subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    let alive=true;
    async function loadProfile(){
      if(!session?.user){setProfile(null);return;}
      const {data,error}=await supabase.from("profiles").select("id,name,number,active,role").eq("id",session.user.id).single();
      if(alive){if(error)setProfile({id:session.user.id,name:session.user.email?.split("@")[0]??"Mitglied",role:"player"});else setProfile(data);}
    }
    void loadProfile();return ()=>{alive=false;};
  },[session?.user.id]);
  if(loading)return <div className="app-shell" style={{padding:40}}>Laufchallenge wird geladen …</div>;
  if(!session)return <LoginScreen/>;
  if(!profile)return <div className="app-shell" style={{padding:40}}>Profil wird geladen …</div>;
  return <ChallengeApp user={session.user} profile={profile} onSignOut={()=>void supabase.auth.signOut()}/>;
}
export default App;
