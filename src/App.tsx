import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Award, CalendarDays, Camera, Check, ChevronDown, ChevronRight,
  CircleUserRound, ClipboardList, Crown, Dumbbell, FileDown, Flag, Footprints, Home,
  LockKeyhole, LogOut, Medal, Pencil, Plus, Settings, ShieldCheck, Trash2,
  Trophy, Upload, Users, Wallet, X
} from "lucide-react";
import { readRunScreenshot, type KmCheck } from "./lib/ocr";
import { supabase } from "./lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

type Player = { id: string; name: string; number: number; active: boolean; avatar_url?: string | null; avatarDisplayUrl?: string | null; position?: string | null; bio?: string | null };
type Run = { id: string; playerId: string; km: number; kmMissing?: boolean; kmCheck?: KmCheck | null; date: string; minutes: number; note: string; status: "pending" | "approved" | "rejected"; screenshot_path: string | null; rejection_reason?: string | null };
const RUN_COLUMNS = "id,player_id,distance_km,km_check,run_date,minutes,note,status,screenshot_path,rejection_reason";
const mapRun = (r: any): Run => ({ id: r.id, playerId: r.player_id, km: r.distance_km == null ? 0 : Number(r.distance_km), kmMissing: r.distance_km == null, kmCheck: r.km_check ?? null, date: r.run_date, minutes: r.minutes ?? 0, note: r.note ?? "", status: r.status ?? "approved", screenshot_path: r.screenshot_path ?? null, rejection_reason: r.rejection_reason ?? null });
// Fällt auf die alten Spalten zurück, falls SUPABASE-KM-PRUEFUNG.sql noch nicht ausgeführt wurde.
async function fetchRuns() {
  const res = await supabase.from("runs").select(RUN_COLUMNS);
  if (!res.error) return res;
  return supabase.from("runs").select(RUN_COLUMNS.replace(",km_check", ""));
}
const runKmText = (r: Run) => r.kmMissing ? "km fehlt" : `${kmText(r.km)} km`;
type Role = "player" | "coach";
const isTrainerRole = (value: unknown) => ["trainer", "coach"].includes(String(value ?? "").trim().toLowerCase());
type Tab = "dashboard" | "week" | "plan" | "private" | "team" | "runs" | "messages" | "audit" | "settings";
type WeeklyPlan = { id: string; week_number: number; title: string; content: string; created_at: string; };
type WeeklyExcuse = { id: string; player_id: string; week_number: number; reason: string | null };
type Announcement = { id:string; title:string; message:string; created_at:string; author_id:string };
type RunAudit = { id:string; run_id:string|null; action:string; changed_at:string; actor_id:string|null; old_data:any; new_data:any };

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

// In der Datenbank steht nur der Storage-Pfad. Für die Anzeige wird eine
// zeitlich begrenzte URL aus dem privaten Bucket erzeugt.
function avatarStoragePath(value:string|null|undefined):string|null {
  if (!value) return null;
  const publicMarker = "/storage/v1/object/public/player-avatars/";
  const signedMarker = "/storage/v1/object/sign/player-avatars/";
  for (const marker of [publicMarker, signedMarker]) {
    const index = value.indexOf(marker);
    if (index >= 0) {
      const rawPath = value.slice(index + marker.length).split("?")[0];
      try { return decodeURIComponent(rawPath); } catch { return rawPath; }
    }
  }
  return value.startsWith("http://") || value.startsWith("https://") ? null : value;
}

async function createAvatarDisplayUrl(value:string|null|undefined):Promise<string|null> {
  if (!value) return null;
  const path = avatarStoragePath(value);
  // Externe Bild-URLs bleiben aus Kompatibilitätsgründen verwendbar.
  if (!path) return value;
  const { data, error } = await supabase.storage.from("player-avatars").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    console.error("ATUSRUN: Profilbild konnte nicht geladen werden:", error?.message);
    return null;
  }
  return data.signedUrl;
}

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
  const [role,setRole]=useState<Role>(isTrainerRole(profile.role) ? "coach" : "player");
  const [tab,setTab]=useState<Tab>("dashboard");
  const [goal,setGoal]=useState(()=>readStore("lc26_goal",3300));
  const [modal,setModal]=useState<"run"|"player"|"editRun"|null>(null);
  const [editRun,setEditRun]=useState<Run|null>(null);
  const [editPlayer,setEditPlayer]=useState<Player|null>(null);
  const [notice,setNotice]=useState("");
  const [week,setWeek]=useState(0);
  const [weeklyPlans,setWeeklyPlans]=useState<WeeklyPlan[]>([]);
  const [weeklyExcuses,setWeeklyExcuses]=useState<WeeklyExcuse[]>([]);
  const [planWeek,setPlanWeek]=useState(1);
  const [planTitle,setPlanTitle]=useState("");
  const [planContent,setPlanContent]=useState("");
  const [editingPlan,setEditingPlan]=useState<string|null>(null);
  const [announcements,setAnnouncements]=useState<Announcement[]>([]);
  const [announcementTitle,setAnnouncementTitle]=useState("");
  const [announcementMessage,setAnnouncementMessage]=useState("");
  const [auditRows,setAuditRows]=useState<RunAudit[]>([]);

  useEffect(() => {
    let live = true;
    async function loadCloudData() {
      const [{ data: profiles, error: profileError }, { data: cloudRuns, error: runsError }, { data: excuses, error: excusesError }, { data: posts, error: postsError }] = await Promise.all([
        supabase.from("profiles").select("id,name,number,active,role,avatar_url,position,bio").order("name"),
        fetchRuns(),
        supabase.from("weekly_excuses").select("id,player_id,week_number,reason"),
        supabase.from("team_announcements").select("id,title,message,created_at,author_id").order("created_at",{ascending:false}).limit(50)
      ]);
      if (!live) return;
      if (profileError || runsError) {
        flash("Daten konnten nicht geladen werden: " + (profileError?.message || runsError?.message));
        return;
      }

      const mappedProfiles = await Promise.all((profiles ?? []).map(async (p:any) => {
        const avatarPath = avatarStoragePath(p.avatar_url ?? null);
        return {
          id:p.id,
          name:p.name,
          number:p.number ?? 0,
          active:p.active ?? true,
          avatar_url:avatarPath,
          avatarDisplayUrl:await createAvatarDisplayUrl(p.avatar_url ?? null),
          position:p.position ?? null,
          bio:p.bio ?? null
        };
      }));
      if (!live) return;

      setPlayers(mappedProfiles);
      setRuns((cloudRuns ?? []).map(mapRun));
      setWeeklyExcuses(excusesError ? [] : (excuses ?? []));
      setAnnouncements(postsError ? [] : (posts ?? []));
      if (isTrainerRole(profile.role)) {
        const {data: audit}=await supabase.from("run_audit_log").select("id,run_id,action,changed_at,actor_id,old_data,new_data").order("changed_at",{ascending:false}).limit(100);
        if(live) setAuditRows(audit ?? []);
      }
      setSelectedId(user.id);
      setRole(isTrainerRole(profile.role) ? "coach" : "player");
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

  async function saveOwnProfile(values:{position:string;bio:string;avatar:File|null}){
    const current=players.find(p=>p.id===user.id); if(!current)return;
    let avatar_url=current.avatar_url??null;
    let avatarDisplayUrl=current.avatarDisplayUrl??null;
    if(values.avatar){
      if(values.avatar.size>5*1024*1024){flash("Profilbild maximal 5 MB.");return;}
      const ext=values.avatar.name.split(".").pop()?.toLowerCase()||"jpg";
      const path=`${user.id}/avatar.${ext}`;
      const {error:uploadError}=await supabase.storage.from("player-avatars").upload(path,values.avatar,{upsert:true,contentType:values.avatar.type||"image/jpeg"});
      if(uploadError){flash("Profilbild-Upload: "+uploadError.message);return;}
      avatar_url=path;
      const {data:signedData,error:signedError}=await supabase.storage.from("player-avatars").createSignedUrl(path,3600);
      if(signedError||!signedData?.signedUrl){flash("Profilbild gespeichert, konnte aber nicht angezeigt werden.");return;}
      avatarDisplayUrl=signedData.signedUrl;
    }
    const {error}=await supabase.from("profiles").update({position:values.position.trim()||null,bio:values.bio.trim()||null,avatar_url}).eq("id",user.id);
    if(error){flash("Profil speichern: "+error.message);return;}
    setPlayers(prev=>prev.map(p=>p.id===user.id?{...p,position:values.position.trim()||null,bio:values.bio.trim()||null,avatar_url,avatarDisplayUrl}:p));
    flash("Profil gespeichert");
  }

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
    const pointsByWeek=weekly.map((km,i)=>{ if(!isWeekCompleted(weeks[i].end)) return 0; const excused=weeklyExcuses.some(e=>e.player_id===p.id&&e.week_number===i+1); return (excused ? (km>20?1:0) : (km<16?-1:km>20?1:0)) + rankBonusByWeek[i]; });
    return {...p,weekly,rankBonusByWeek,pointsByWeek,challengeKm:playerRuns.reduce((s,r)=>s+r.km,0),preKm:approvedRuns.filter(r=>r.playerId===p.id&&r.date<START).reduce((s,r)=>s+r.km,0),runsCount:runs.filter(r=>r.playerId===p.id).length};
  }),[activePlayers,challengeRuns,runs,weeklyExcuses]);

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
    const existing = runs.find(r=>r.id===run.id);
    const kmCheck:KmCheck|null=role==="coach"?(existing&&!existing.kmMissing&&existing.km===run.km?existing.kmCheck??null:"manual"):(run.kmCheck??(run.kmMissing?"missing":"unsure"));
    const payload={player_id:role==="coach"?run.playerId:user.id,distance_km:run.kmMissing?null:run.km,km_check:kmCheck,run_date:run.date,minutes:run.minutes||null,note:run.note||null,...(existing?{}:{status:role==="coach"?"approved":"pending"}),...(screenshotPath?{screenshot_path:screenshotPath}:{})};
    const write=(body:Record<string,unknown>)=>existing ? supabase.from("runs").update(body).eq("id",run.id) : supabase.from("runs").insert({...body,screenshot_path:screenshotPath});
    let result = await write(payload);
    if(result.error&&/km_check/.test(result.error.message)){const {km_check:_,...legacy}=payload;result=await write(legacy);}
    if(result.error){flash((existing?"Bearbeiten":"Einreichen")+" fehlgeschlagen: "+result.error.message);return;}
    const {data,error:loadError}=await fetchRuns();
    if(loadError){flash(loadError.message);return;}
    setRuns((data??[]).map(mapRun));
    setModal(null);setEditRun(null);flash(existing?"Lauf erfolgreich aktualisiert":role==="coach"?"Lauf als Trainer eingetragen":"Screenshot eingereicht – wartet auf Trainerfreigabe");
  }
  async function reviewRun(id:string,status:"approved"|"rejected",km?:number){
    if(role!=="coach")return;
    const target=runs.find(r=>r.id===id);
    const update:Record<string,unknown>={status};
    if(status==="approved"){
      const value=km??(target?.kmMissing?NaN:target?.km);
      if(!value||!Number.isFinite(value)||value<=0||value>200){flash("Bitte vor der Freigabe gültige Kilometer eintragen.");return;}
      update.distance_km=value;
      if(target&&(target.kmMissing||Math.abs(target.km-value)>0.001))update.km_check="manual";
    }
    let {error}=await supabase.from("runs").update(update).eq("id",id);
    if(error&&/km_check/.test(error.message)){delete update.km_check;({error}=await supabase.from("runs").update(update).eq("id",id));}
    if(error){flash("Prüfung fehlgeschlagen: "+error.message);return;}
    setRuns(prev=>prev.map(r=>r.id===id?{...r,status,...(status==="approved"?{km:update.distance_km as number,kmMissing:false,kmCheck:(update.km_check as KmCheck|undefined)??r.kmCheck}:{})}:r));flash(status==="approved"?"Lauf freigegeben":"Lauf abgelehnt");
  }

  async function openScreenshot(path:string){
    const {data,error}=await supabase.storage.from("run-screenshots").createSignedUrl(path,300);
    if(error||!data?.signedUrl){flash("Screenshot konnte nicht geöffnet werden: "+(error?.message??"Unbekannter Fehler"));return;}
    window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }

  async function removeRun(id:string){
    if(role!=="coach")return;
    if(confirm("Diesen Lauf wirklich löschen? Der zugehörige Screenshot wird ebenfalls entfernt.")){
      const target=runs.find(r=>r.id===id);
      const {error}=await supabase.from("runs").delete().eq("id",id);
      if(error){flash("Löschen fehlgeschlagen: "+error.message);return;}
      if(target?.screenshot_path){
        const {error:storageError}=await supabase.storage.from("run-screenshots").remove([target.screenshot_path]);
        if(storageError)flash("Lauf gelöscht; Screenshot konnte nicht entfernt werden: "+storageError.message);
      }
      setRuns(prev=>prev.filter(r=>r.id!==id));flash("Lauf gelöscht");
    }
  }

  async function setExcused(playerId:string,weekNumber:number,excused:boolean){
    if(role!=="coach")return;
    const existing=weeklyExcuses.find(e=>e.player_id===playerId&&e.week_number===weekNumber);
    if(excused){
      if(existing)return;
      const {data,error}=await supabase.from("weekly_excuses").insert({player_id:playerId,week_number:weekNumber,reason:"Entschuldigt durch Trainer",created_by:user.id}).select("id,player_id,week_number,reason").single();
      if(error){flash("Entschuldigung konnte nicht gespeichert werden: "+error.message);return;}
      setWeeklyExcuses(prev=>[...prev,data]);flash("Woche als entschuldigt markiert");
    }else if(existing){
      const {error}=await supabase.from("weekly_excuses").delete().eq("id",existing.id);
      if(error){flash("Entschuldigung konnte nicht entfernt werden: "+error.message);return;}
      setWeeklyExcuses(prev=>prev.filter(e=>e.id!==existing.id));flash("Entschuldigung aufgehoben");
    }
  }

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
    ["runs","Läufe",<Activity/>],["messages","Mitteilungen",<ClipboardList/>],
    ...(role==="coach"?[["audit","Änderungsprotokoll",<ShieldCheck/>] as [Tab,string,React.ReactNode]]:[]),
    ["settings","Verwaltung",<Settings/>]
  ];

  // Verwaltungsbereich ausschließlich für Trainer anzeigen und zugänglich machen.
  const visibleNavItems = role === "coach" ? navItems : navItems.filter(([key]) => key !== "settings");

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-logo"><Footprints size={23}/></div><div><b>ATUSRUN</b><small>GSL TEAM CHALLENGE</small></div></div>
      <div className="role-switch"><span>ANSICHT</span><div><button className="chosen" disabled>{role==="coach"?"Trainerkonto":"Spielerkonto"}</button></div></div>
      <nav>{visibleNavItems.map(([key,label,icon])=><button key={key} className={`nav-item ${tab===key?"active":""}`} onClick={()=>setTab(key)}>{icon}<span>{label}</span>{key==="team"&&<span className="tiny-lock"><LockKeyhole size={12}/></span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="profile-mini"><div className="avatar">{initials(currentPlayer?.name??"LC")}</div><div><b>{currentPlayer?.name??"Kein Spieler"}</b><small>{role==="coach"?"Traineransicht":"Persönlicher Bereich"}</small></div></div><small className="local-tag">ONLINE · SUPABASE</small></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="mobile-brand"><Footprints size={20}/> ATUSRUN</div><div className="topbar-right"><span className="status-dot"/> Challenge: 30.11.2026 – 10.01.2027 <span className="role-pill">{profile.name} · {role==="coach"?"Trainer":"Spieler"}</span><button className="role-pill" onClick={onSignOut}>Abmelden <LogOut size={13}/></button></div></header>
      <div className="content">
        {tab==="dashboard"&&<Dashboard allKm={allKm} rewardKm={rewardKm} allTimeKm={allTimeKm} preKm={preKm} reward={teamReward} rewardProgress={rewardProgress} goal={goal} setGoal={setGoal} players={activePlayers.length} challengeRuns={challengeRuns.length} stats={sortedStats} totalPoints={totalPoints} onRuns={()=>setTab("runs")} onTeam={()=>{setRole("coach");setTab("team");}}/>}

        {tab==="week"&&<WeekView week={week} setWeek={setWeek} totals={weekTotals} stats={playerStats} players={activePlayers.length} isCoach={role==="coach"} allPlayers={activePlayers} excuses={weeklyExcuses} onExcuse={setExcused}/>}

        {tab==="plan"&&<WeeklyPlanView plans={weeklyPlans} isCoach={role==="coach"} planWeek={planWeek} setPlanWeek={setPlanWeek} title={planTitle} setTitle={setPlanTitle} content={planContent} setContent={setPlanContent} editingPlan={editingPlan} onEdit={(p)=>{setEditingPlan(p.id);setPlanWeek(p.week_number);setPlanTitle(p.title);setPlanContent(p.content);}} onCancel={()=>{setEditingPlan(null);setPlanTitle("");setPlanContent("");}} onSave={async()=>{
          if(!planTitle.trim()||!planContent.trim()){flash("Bitte Titel und Wochenplan eintragen.");return;}
          const payload={week_number:planWeek,title:planTitle.trim(),content:planContent.trim(),created_by:user.id};
          const result=editingPlan?await supabase.from("weekly_plans").update(payload).eq("id",editingPlan):await supabase.from("weekly_plans").insert(payload);
          if(result.error){flash("Wochenplan konnte nicht gespeichert werden: "+result.error.message);return;}
          const {data,error}=await supabase.from("weekly_plans").select("id,week_number,title,content,created_at").order("week_number");
          if(error){flash(error.message);return;}
          setWeeklyPlans(data??[]);setEditingPlan(null);setPlanTitle("");setPlanContent("");flash("Wochenplan veröffentlicht");
        }} onDelete={async(id)=>{
          if(!confirm("Diesen Wochenplan wirklich löschen?"))return;
          const {error}=await supabase.from("weekly_plans").delete().eq("id",id);
          if(error){flash("Löschen fehlgeschlagen: "+error.message);return;}
          setWeeklyPlans(prev=>prev.filter(p=>p.id!==id));flash("Wochenplan gelöscht");
        }}/>}

        {tab==="private"&&<PrivateView player={currentPlayer} stats={selectedStats} runs={selectedRuns} players={role==="coach"?players:players.filter(p=>p.id===user.id)} selectedId={selectedId} setSelectedId={setSelectedId} finalBonus={finalBonuses[selectedId]??0} totalPoints={selectedStats?totalPoints(selectedStats):0} onAdd={()=>{setEditRun(null);setModal("run");}} onEdit={r=>{if(role==="coach"){setEditRun(r);setModal("editRun");}}} onDelete={removeRun} showActions={role==="coach"} canEditProfile={selectedId===user.id} onSaveProfile={saveOwnProfile}/>}

        {tab==="team"&&<TeamView stats={sortedStats} totalPoints={totalPoints} finalBonuses={finalBonuses} goal={goal} allKm={allKm} reward={teamReward} canManage={role==="coach"} onEditPlayer={p=>{setEditPlayer(p);setModal("player");}} onDeletePlayer={removePlayer} onOpenProfile={(id)=>{setSelectedId(id);setTab("private");}}/>}

        {tab==="runs"&&<AllRuns runs={runs} players={players} role={role} selectedId={selectedId} onAdd={()=>{setEditRun(null);setModal("run");}} onEdit={r=>{setEditRun(r);setModal("editRun");}} onDelete={removeRun} onReview={reviewRun} onScreenshot={openScreenshot}/>}

        {tab==="messages"&&<AnnouncementsView posts={announcements} isCoach={role==="coach"} title={announcementTitle} setTitle={setAnnouncementTitle} message={announcementMessage} setMessage={setAnnouncementMessage} onPublish={async()=>{
          if(role!=="coach")return;
          if(!announcementTitle.trim()||!announcementMessage.trim()){flash("Bitte Titel und Nachricht ausfüllen.");return;}
          const {data,error}=await supabase.from("team_announcements").insert({title:announcementTitle.trim(),message:announcementMessage.trim(),author_id:user.id}).select("id,title,message,created_at,author_id").single();
          if(error){flash("Mitteilung konnte nicht veröffentlicht werden: "+error.message);return;}
          setAnnouncements(prev=>[data,...prev]);setAnnouncementTitle("");setAnnouncementMessage("");flash("Mitteilung an das Team veröffentlicht");
        }} onDelete={async(id)=>{
          if(role!=="coach"||!confirm("Mitteilung wirklich löschen?"))return;
          const {error}=await supabase.from("team_announcements").delete().eq("id",id);
          if(error){flash("Löschen fehlgeschlagen: "+error.message);return;}
          setAnnouncements(prev=>prev.filter(x=>x.id!==id));flash("Mitteilung gelöscht");
        }}/>}

        {tab==="audit"&&role==="coach"&&<AuditView rows={auditRows} players={players} runs={runs}/>}

        {tab==="settings"&&role==="coach"&&<SettingsView players={players} setPlayers={setPlayers} goal={goal} setGoal={setGoal} runs={runs} setRuns={setRuns} onExport={()=>exportBackup(players,runs,goal)} onImport={d=>{setPlayers(d.players);setRuns(d.runs);setGoal(d.goal);flash("Backup importiert");}}/>}
      </div>
      <footer className="footer"><span>ATUSRUN · GSL</span><span>Jeder Kilometer zählt.</span></footer>
    </main>

    <div className="mobile-nav">{visibleNavItems.map(([k,label,icon])=><button key={k} className={tab===k?"active":""} onClick={()=>setTab(k)}>{icon}<small>{label==="Wochenübersicht"?"Woche":label==="Wochenplan"?"Plan":label==="Läufe"?"Läufe":label==="Meine Übersicht"?"Ich":label==="Trainerübersicht"?"Team":label==="Dashboard"?"Start":label}</small></button>)}</div>

    {modal&&<Modal mode={modal} run={editRun} player={editPlayer} players={players.filter(p=>p.active)} selectedId={selectedId} onClose={()=>{setModal(null);setEditRun(null);setEditPlayer(null);}} onSaveRun={saveRun} isCoach={role === "coach"} onSavePlayer={savePlayer}/>}

    {notice&&<div className="toast"><Check size={16}/>{notice}</div>}
  </div>;
}
function Title({eyebrow,title,subtitle,action}:{eyebrow:string;title:string;subtitle:string;action?:React.ReactNode}){
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function StatCard({label,value,sub,icon}:{label:string;value:string;sub:string;icon:React.ReactNode}){
  return <div className="stat-card"><div className="stat-icon">{icon}</div><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
}

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

function AnnouncementsView({posts,isCoach,title,setTitle,message,setMessage,onPublish,onDelete}:{posts:Announcement[];isCoach:boolean;title:string;setTitle:(s:string)=>void;message:string;setMessage:(s:string)=>void;onPublish:()=>void;onDelete:(id:string)=>void}){
  return <><Title eyebrow="TEAMKOMMUNIKATION" title="Mitteilungen" subtitle="Wichtige Informationen und Neuigkeiten für die gesamte Mannschaft."/>{isCoach&&<section className="weekly-plan-editor"><div className="section-head"><div><div className="eyebrow">TRAINERVERWALTUNG</div><h2>Neue Mitteilung veröffentlichen</h2></div></div><label>Titel<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="z. B. Änderung des Trainingsplans"/></label><label>Nachricht<textarea rows={5} maxLength={4000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Nachricht an alle Spieler …"/></label><div className="plan-actions"><button className="red-button" onClick={onPublish}><Plus size={16}/> Mitteilung veröffentlichen</button></div></section>}<div className="announcement-list">{posts.length===0?<div className="empty-card">Noch keine Mitteilungen vorhanden.</div>:posts.map(post=><article className="announcement-card" key={post.id}><div className="announcement-meta">ATUSRUN · TEAMINFO <span>{new Date(post.created_at).toLocaleString("de-AT")}</span></div><h3>{post.title}</h3><p>{post.message}</p>{isCoach&&<button className="secondary-button" onClick={()=>onDelete(post.id)}><Trash2 size={14}/> Löschen</button>}</article>)}</div></>;
}

function AuditView({rows,players,runs}:{rows:RunAudit[];players:Player[];runs:Run[]}){
  const runById=(id:string|null)=>id?runs.find(r=>r.id===id):undefined;
  return <><Title eyebrow="TRAINERVERWALTUNG" title="Änderungsprotokoll" subtitle="Nachvollziehbare Änderungen an Läufen. Die Einträge werden automatisch durch die Datenbank protokolliert."/><div className="audit-list">{rows.length===0?<div className="empty-card">Noch keine protokollierten Laufänderungen vorhanden. Änderungen ab Aktivierung der Protokollierung werden hier angezeigt.</div>:rows.map(row=>{const run=runById(row.run_id);const player=run?players.find(p=>p.id===run.playerId):undefined;return <article className="audit-card" key={row.id}><div className="audit-head"><b>{row.action==="INSERT"?"Lauf angelegt":row.action==="UPDATE"?"Lauf geändert":"Lauf gelöscht"}</b><small>{new Date(row.changed_at).toLocaleString("de-AT")}</small></div><p>{player?.name??"Spieler nicht mehr aktiv/zugeordnet"}{run?` · ${kmText(run.km)} km · ${fmtDate(run.date)}`:row.run_id?` · Lauf-ID ${row.run_id.slice(0,8)}`:""}</p><small>Ändernde Person: {players.find(p=>p.id===row.actor_id)?.name??(row.actor_id?"Trainerkonto":"System / unbekannt")}</small>{row.action==="UPDATE"&&<details><summary>Änderungsdetails anzeigen</summary><pre>{JSON.stringify({vorher:row.old_data,nachher:row.new_data},null,2)}</pre></details>}</article>})}</div></>;
}

function WeeklyPlanView({plans,isCoach,planWeek,setPlanWeek,title,setTitle,content,setContent,editingPlan,onEdit,onCancel,onSave,onDelete}:{plans:WeeklyPlan[];isCoach:boolean;planWeek:number;setPlanWeek:(n:number)=>void;title:string;setTitle:(s:string)=>void;content:string;setContent:(s:string)=>void;editingPlan:string|null;onEdit:(p:WeeklyPlan)=>void;onCancel:()=>void;onSave:()=>void;onDelete:(id:string)=>void}){
  return <><Title eyebrow="TRAININGSVORGABEN · GSL" title="Wochenplan" subtitle="Der Trainer veröffentlicht hier die Laufaufgaben für jede Challenge-Woche."/>{isCoach&&<section className="weekly-plan-editor"><div className="section-head"><div><div className="eyebrow">TRAINERBEREICH</div><h2>{editingPlan?"Wochenplan bearbeiten":"Neue Wochenaufgabe veröffentlichen"}</h2></div></div><div className="plan-form-row"><label>Challenge-Woche<select value={planWeek} onChange={e=>setPlanWeek(Number(e.target.value))}>{weeks.map(w=><option value={w.index+1} key={w.index}>Woche {w.index+1} · {fmtDate(w.start)} – {fmtDate(w.end)}</option>)}</select></label><label>Titel<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="z. B. Grundlagenausdauer"/></label></div><label className="plan-content-label">Laufaufgabe / Beschreibung<textarea value={content} onChange={e=>setContent(e.target.value)} rows={5} placeholder="Beschreibe die Laufaufgabe, Kilometerziele, Tempo oder Hinweise für die Mannschaft…"/></label><div className="plan-actions"><button className="red-button" onClick={onSave}><Check size={16}/>{editingPlan?"Änderungen speichern":"Wochenplan veröffentlichen"}</button>{editingPlan&&<button className="secondary-button" onClick={onCancel}>Abbrechen</button>}</div></section>}<div className="section-head top-gap"><div><div className="eyebrow">DIE 6 CHALLENGE-WOCHEN</div><h2>Aufgaben der Mannschaft</h2></div></div><div className="weekly-plan-list">{weeks.map(w=>{const p=plans.find(x=>x.week_number===w.index+1);return <article className="weekly-plan-card" key={w.index}><div className="plan-week-badge">W{w.index+1}</div><div className="plan-card-main"><small>{fmtDate(w.start)} – {fmtDate(w.end)}</small><h3>{p?.title??"Noch kein Wochenplan veröffentlicht"}</h3><p>{p?.content??(isCoach?"Veröffentliche hier die Laufaufgabe für diese Woche.":"Der Trainer hat für diese Woche noch keine Aufgabe veröffentlicht.")}</p>{p&&<small className="plan-published">Veröffentlicht am {new Date(p.created_at).toLocaleDateString("de-AT")}</small>}</div>{isCoach&&p&&<div className="plan-card-actions"><button className="icon-button" onClick={()=>onEdit(p)} title="Bearbeiten"><Pencil size={15}/></button><button className="icon-button delete" onClick={()=>onDelete(p.id)} title="Löschen"><Trash2 size={15}/></button></div>}</article>})}</div></>;
}

function WeekView({week,setWeek,totals,stats,players,isCoach,allPlayers,excuses,onExcuse}:{week:number;setWeek:(n:number)=>void;totals:any[];stats:any[];players:number;isCoach:boolean;allPlayers:Player[];excuses:WeeklyExcuse[];onExcuse:(playerId:string,weekNumber:number,excused:boolean)=>void}){
  const w=weeks[week];const current=totals.reduce((s,p)=>s+p.km,0);const bonus=rankBonuses(totals);
  return <><Title eyebrow="WOCHEN-CHECK" title="Wochenübersicht" subtitle="Jede Woche zählt – Kilometer und GSL-Punkte im Überblick."/>
  <div className="week-picker"><button onClick={()=>setWeek(Math.max(0,week-1))} disabled={week===0}>‹</button><div><b>Woche {week+1} von 6</b><span>{fmtDate(w.start)} – {fmtDate(w.end)}</span></div><button onClick={()=>setWeek(Math.min(5,week+1))} disabled={week===5}>›</button></div>
  <div className="week-summary"><div><small>TEAMKILOMETER</small><strong>{kmText(current)} <em>km</em></strong></div><div><small>SPIELER IM KADER</small><strong>{players}</strong></div><div><small>TEAMZIEL PRO WOCHE</small><strong>–</strong></div></div>
  <div className="section-head"><div><div className="eyebrow">WOCHENLEISTUNG</div><h2>Kilometer pro Spieler</h2></div></div><div className="bars-card">{totals.map((p,i)=><div className="bar-line" key={p.id}><div className="bar-name"><span>{p.name}</span><b>{kmText(p.km)} km</b></div><div className="bar-track"><div className="bar-fill" style={{width:`${Math.min(100,p.km/30*100)}%`}}/></div><small className={p.km<16?"negative":p.km>20?"positive":"neutral"}>{!isWeekCompleted(w.end)?(todayKey()<w.start?"Noch nicht freigeschaltet":"Woche läuft · Wertung nach Sonntag"):(p.km<16?"−1 GSL · unter 16 km":p.km>20?"+1 GSL · über 20 km":"0 GSL · Zielbereich erreicht")}{isWeekCompleted(w.end)&&bonus[p.id]?` · +${bonus[p.id]} Podium`:""}</small></div>)}</div>
  {isCoach&&<section className="weekly-plan-editor"><div className="section-head"><div><div className="eyebrow">NUR TRAINERVERWALTUNG</div><h2>Entschuldigungen · Woche {week+1}</h2></div></div><p>Entschuldigte Spieler erhalten bei unter 16 km keinen Minuspunkt. Kilometer und mögliche Plus- bzw. Podiums-Punkte bleiben erhalten.</p><div className="run-list">{allPlayers.map(p=>{const excused=excuses.some(e=>e.player_id===p.id&&e.week_number===week+1);return <div className="run-item" key={p.id}><div className="run-info"><b>{p.name}</b><small>{excused?"Für diese Woche entschuldigt":"Normale Wochenwertung"}</small></div><button className={excused?"secondary-button":"red-button"} onClick={()=>onExcuse(p.id,week+1,!excused)}>{excused?"Entschuldigung aufheben":"Entschuldigen"}</button></div>})}</div></section>}
  <div className="rules-note"><b>GSL-Regeln pro Woche</b><span>Unter 16 km: −1 Punkt · 16 bis einschließlich 20 km: 0 Punkte · über 20 km: +1 Punkt.</span><span>Zusätzlicher Wochenbonus: Platz 1 +4, Platz 2 +3, Platz 3 +2 GSL-Punkte. Bei Gleichstand erhalten Spieler mit gleicher Kilometerzahl denselben Rangbonus.</span></div>
  </>;
}

function ProfileEditor({player,canEdit,onSave}:{player:Player;canEdit:boolean;onSave:(v:{position:string;bio:string;avatar:File|null})=>Promise<void>}){
  const [position,setPosition]=useState(player.position??"");
  const [bio,setBio]=useState(player.bio??"");
  const [avatar,setAvatar]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const ref=useRef<HTMLInputElement>(null);
  useEffect(()=>{setPosition(player.position??"");setBio(player.bio??"");setAvatar(null);},[player.id,player.position,player.bio]);
  const preview=avatar?URL.createObjectURL(avatar):player.avatarDisplayUrl??"";
  return <section className="profile-editor">
    <div className="profile-editor-head">
      <button className="profile-photo" onClick={()=>canEdit&&ref.current?.click()} disabled={!canEdit} type="button">{preview?<img src={preview} alt="Profilbild"/>:initials(player.name)}{canEdit&&<span><Camera size={14}/></span>}</button>
      <div><small>ATUSRUN · TEAMPROFIL · #{player.number}</small><h2>{player.name}</h2><p>{position||"Teammitglied"}</p></div>
    </div>
    {canEdit&&<input ref={ref} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setAvatar(e.target.files?.[0]??null)}/>}
    <div className="profile-fields">
      <label>Position im Team<input value={position} onChange={e=>setPosition(e.target.value)} placeholder="z. B. Torwart, Abwehr, Mittelfeld" disabled={!canEdit}/></label>
      <label>Über mich<textarea rows={3} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Dein Motto oder ein paar Worte über dich …" disabled={!canEdit}/></label>
    </div>
    {player.bio&&<p className="profile-bio-view">{player.bio}</p>}
    {canEdit&&<div className="profile-save"><small>JPG, PNG oder WEBP · maximal 5 MB</small><button className="red-button" disabled={busy} onClick={async()=>{setBusy(true);await onSave({position,bio,avatar});setBusy(false);}}>{busy?"Speichert …":"Profil speichern"}</button></div>}
  </section>;
}

function PrivateView({player,stats,runs,players,selectedId,setSelectedId,finalBonus,totalPoints,onAdd,onEdit,onDelete,showActions,canEditProfile,onSaveProfile}:{player?:Player;stats:any;runs:Run[];players:Player[];selectedId:string;setSelectedId:(s:string)=>void;finalBonus:number;totalPoints:number;onAdd:()=>void;onEdit:(r:Run)=>void;onDelete:(id:string)=>void;showActions:boolean;canEditProfile:boolean;onSaveProfile:(v:{position:string;bio:string;avatar:File|null})=>Promise<void>}){
  if(!player)return <><Title eyebrow="PERSÖNLICHER BEREICH" title="Meine Übersicht" subtitle="Wähle dein Spielerprofil."/></>;
  return <><Title eyebrow="NUR DEIN PROFIL" title={`Servus, ${player.name.split(" ")[0]}.`} subtitle="Deine persönlichen Kilometer und GSL-Punkte." action={<button className="red-button" onClick={onAdd}><Plus size={17}/> Lauf einreichen</button>}/>
  <ProfileEditor player={player} canEdit={canEditProfile} onSave={onSaveProfile}/><div className="player-select"><label>Spielerprofil auswählen (Teamprofil ansehen)<select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>{players.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name} · #{p.number}</option>)}</select></label></div>
  <div className="private-score"><div className="private-avatar">{initials(player.name)}</div><div><small>DEIN GSL-KONTO</small><strong>{totalPoints>0?"+":""}{totalPoints}</strong><span>GSL-Punkte inkl. Abschlussbonus</span></div><div className="private-medal"><Medal size={32}/></div></div>
  <div className="stat-grid"><StatCard label="Challenge-Kilometer" value={`${kmText(stats?.challengeKm??0)} km`} sub="Im Zeitraum 6 Wochen" icon={<Footprints/>}/><StatCard label="Vor Challenge" value={`${kmText(stats?.preKm??0)} km`} sub="Zählt zur Prämie und Abschlusswertung" icon={<CalendarDays/>}/><StatCard label="Läufe gesamt" value={String(runs.length)} sub="Alle gespeicherten Einheiten" icon={<Activity/>}/><StatCard label="Durchschnitt pro Lauf" value={`${kmText(runs.length?runs.reduce((sum,r)=>sum+r.km,0)/runs.length:0)} km`} sub="Auf Basis deiner Läufe" icon={<Award/>}/><StatCard label="Längster Lauf" value={`${kmText(runs.reduce((best,r)=>Math.max(best,r.km),0))} km`} sub={runs.length?`Am ${fmtDate(runs.reduce((best,r)=>r.km>best.km?r:best,runs[0]).date)}`:"Noch kein Lauf gespeichert"} icon={<Trophy/>}/><StatCard label="Abschlussbonus" value={`+${finalBonus}`} sub="Endrangliste" icon={<Medal/>}/></div>
  <div className="section-head"><div><div className="eyebrow">DEIN WOCHENVERLAUF</div><h2>Kilometerentwicklung</h2></div></div>
  <section className="development-card"><div className="development-bars">{weeks.map((w,i)=>{const km=stats?.weekly[i]??0;const max=Math.max(25,...(stats?.weekly??[]));return <div className="development-column" key={w.index}><b>{kmText(km)}</b><div className="development-track"><span style={{height:`${Math.max(km>0?4:0,km/max*100)}%`}}/></div><small>W{i+1}</small></div>})}</div><p>Freigegebene Kilometer pro Challenge-Woche. Läufe außerhalb des Challenge-Zeitraums werden separat ausgewiesen.</p></section><div className="personal-weeks">{(()=>{const weekly=weeks.map((w,i)=>stats?.weekly[i]??0);const scale=Math.max(25,stats?.preKm??0,...weekly);return <><div className="personal-week personal-week-pre"><div><b>Vor Challenge</b><small>Bis 29.11.2026</small></div><div className="personal-week-bar"><div style={{width:`${Math.min(100,(stats?.preKm??0)/scale*100)}%`}}/></div><strong>{kmText(stats?.preKm??0)} km</strong><em className="locked">Ohne Punkte</em></div>{weeks.map((w,i)=>{const km=weekly[i];const pts=stats?.pointsByWeek[i]??0;return <div className="personal-week" key={w.index}><div><b>W{i+1}</b><small>{fmtDate(w.start).slice(0,5)} – {fmtDate(w.end).slice(0,5)}</small></div><div className="personal-week-bar"><div style={{width:`${Math.min(100,km/scale*100)}%`}}/></div><strong>{kmText(km)} km</strong><em className={!isWeekCompleted(w.end)?"locked":pts>0?"positive":pts<0?"negative":""}>{!isWeekCompleted(w.end)?(todayKey()<w.start?"Offen":"Läuft"):`${pts>0?"+":""}${pts} P.`}</em></div>;})}</>;})()}</div>
  <div className="rules-note"><b>Deine Punkte</b><span>Wochenpunkte: −1 bei unter 16 km, +1 bei über 20 km, dazu ein möglicher Top-3-Bonus.</span><span>Abschlussbonus: Die drei Spieler mit den meisten freigegebenen Gesamtkilometern (inklusive Läufe vor dem Challenge-Start) erhalten zusätzlich +4, +3 und +2 Punkte. Läufe vor dem Start bringen keine Wochenpunkte.</span></div>
  <div className="section-head top-gap"><div><div className="eyebrow">DEINE AKTIVITÄTEN</div><h2>Meine Läufe</h2></div></div><RunList runs={runs} onEdit={onEdit} onDelete={onDelete} showActions={showActions}/></>;
}

function TeamView({stats,totalPoints,finalBonuses,goal,allKm,reward,onEditPlayer,onDeletePlayer,canManage,onOpenProfile}:{stats:any[];totalPoints:(p:any)=>number;finalBonuses:Record<string,number>;goal:number;allKm:number;reward:number;onEditPlayer:(p:Player)=>void;onDeletePlayer:(id:string)=>void;canManage:boolean;onOpenProfile:(id:string)=>void}){
  return <><Title eyebrow="GSL TEAM CHALLENGE · ALLE SPIELER" title="Teamrangliste" subtitle="Kilometer, Wochenwerte und GSL-Punkte der gesamten Mannschaft."/>
  <div className="coach-metrics"><div><small>TEAM-KM</small><b>{kmText(allKm)}</b></div><div><small>MANNSCHAFTSKASSE</small><b>{reward} €</b></div><div><small>AKTIVE SPIELER</small><b>{stats.length}</b></div></div>
  <div className="section-head top-gap"><div><div className="eyebrow">DIE MANNSCHAFT</div><h2>Spielerprofile</h2></div></div><div className="team-profile-grid">{stats.map(p=><button className="team-profile-card" key={p.id} onClick={()=>onOpenProfile(p.id)}><span className="team-profile-avatar">{p.avatarDisplayUrl?<img src={p.avatarDisplayUrl} alt=""/>:initials(p.name)}</span><b>{p.name}</b><small>{p.position||`#${p.number} · Teammitglied`}</small><span className="team-profile-stats">{kmText(p.challengeKm+p.preKm)} km · {p.runsCount} Läufe</span><span className="team-profile-open">Profil ansehen <ChevronRight size={13}/></span></button>)}</div><div className="table-card coach-table"><div className="table-row coach-head"><span>Spieler</span><span>Gesamt-km</span>{weeks.map(w=><span key={w.index}>W{w.index+1}</span>)}<span>Abschluss</span><span>GSL</span>{canManage&&<span>Verwaltung</span>}</div>{stats.map((p,i)=><div className="table-row coach-row" key={p.id}><span className="name-cell"><i className={`place place-${i+1}`}>{i+1}</i><b>{p.name}</b></span><strong>{kmText(p.challengeKm+p.preKm)}</strong>{p.weekly.map((km:number,j:number)=><span key={j} className={!isWeekCompleted(weeks[j].end)?"locked":km<16?"negative":km>20?"positive":""}>{kmText(km)}</span>)}<strong className="points">+{finalBonuses[p.id]??0}</strong><strong className="points">{totalPoints(p)>0?"+":""}{totalPoints(p)}</strong>{canManage&&<span className="row-actions"><button onClick={()=>onEditPlayer(p)} title="Bearbeiten"><Pencil size={14}/></button><button onClick={()=>onDeletePlayer(p.id)} title="Deaktivieren"><Trash2 size={14}/></button></span>}</div>)}</div>
  <div className="rules-note"><b>Trainerhinweis</b><span>Die Wochenwerte sind nach dem festgelegten Zeitraum berechnet. Freigegebene Läufe vor dem 30.11.2026 zählen zur Mannschaftsprämie und zur Kilometerbasis des Abschlussbonus, aber nicht zu Wochenpunkten oder Wochenboni.</span><span>Die Teamrangliste ist für alle angemeldeten Mannschaftsmitglieder sichtbar.</span></div>
  </>;
}

function AllRuns({runs,players,role,selectedId,onAdd,onEdit,onDelete,onReview,onScreenshot}:{runs:Run[];players:Player[];role:Role;selectedId:string;onAdd:()=>void;onEdit:(r:Run)=>void;onDelete:(id:string)=>void;onReview:(id:string,s:"approved"|"rejected",km?:number)=>void;onScreenshot:(p:string)=>void}) {
  const [filterPlayer,setFilterPlayer]=useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [filterFrom,setFilterFrom]=useState("");
  const [filterTo,setFilterTo]=useState("");
  const visible = role === "coach" ? runs : runs.filter(r => r.playerId === selectedId);
  const sorted = [...visible].filter(r => (role !== "coach" || filterPlayer === "all" || r.playerId === filterPlayer) && (filterStatus === "all" || r.status === filterStatus) && (!filterFrom || r.date >= filterFrom) && (!filterTo || r.date <= filterTo)).sort((a,b) => b.date.localeCompare(a.date));
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
                <ReviewRow key={r.id} run={r} playerName={players.find(p => p.id === r.playerId)?.name ?? "Spieler"} onReview={onReview} onScreenshot={onScreenshot}/>
              ))}
            </div>
          )}
        </>
      )}
      <div className="section-head top-gap"><div><div className="eyebrow">ALLE EINREICHUNGEN</div><h2>{role === "coach" ? "Mannschaftsläufe" : "Deine Laufhistorie"}</h2></div></div>
      <div className="run-filters">
        {role === "coach" && <label>Spieler<select value={filterPlayer} onChange={e=>setFilterPlayer(e.target.value)}><option value="all">Alle Spieler</option>{players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>Status<select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="all">Alle Status</option><option value="pending">Offen</option><option value="approved">Freigegeben</option><option value="rejected">Abgelehnt</option></select></label>
        <label>Von<input type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}/></label>
        <label>Bis<input type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}/></label>
        <button className="secondary-button" onClick={()=>{setFilterPlayer("all");setFilterStatus("all");setFilterFrom("");setFilterTo("");}}>Zurücksetzen</button>
      </div>
      <div className="filter-result-count">{sorted.length} {sorted.length===1?"Lauf":"Läufe"} gefunden</div>
      <div className="run-list">
        {sorted.length===0 ? <div className="empty-card">Keine Läufe für diese Filter gefunden.</div> : sorted.map(r => (
          <div className="run-item" key={r.id}>
            <div className="run-icon"><Footprints size={18}/></div>
            <div className="run-info"><b>{players.find(p => p.id === r.playerId)?.name ?? "Lauf"} · {runKmText(r)}</b><small>{fmtDate(r.date)} · {r.minutes ? `${r.minutes} min` : "Zeit nicht angegeben"}</small></div>
            <strong className={`run-status ${r.status}`}>{r.status === "approved" ? "Freigegeben" : r.status === "rejected" ? "Abgelehnt" : "Wird geprüft"}</strong>
            {role === "coach" && r.screenshot_path && <button className="icon-button" onClick={() => onScreenshot(r.screenshot_path!)} title="Screenshot ansehen"><Camera size={15}/></button>}{role === "coach" && <><button className="icon-button" onClick={()=>onEdit(r)} title="Lauf bearbeiten"><Pencil size={15}/></button><button className="icon-button delete" onClick={()=>onDelete(r.id)} title="Lauf löschen"><Trash2 size={15}/></button></>}
          </div>
        ))}
      </div>
    </>
  );
}

const KM_CHECK_LABEL:Record<KmCheck,string>={verified:"✓ Automatisch erkannt & gegengeprüft",unsure:"⚠ Automatisch erkannt, nicht gegengeprüft – bitte mit Screenshot vergleichen",missing:"✗ Keine Distanz erkannt – bitte Kilometer eintragen",manual:"Vom Trainer eingetragen"};

function ReviewRow({run,playerName,onReview,onScreenshot}:{run:Run;playerName:string;onReview:(id:string,s:"approved"|"rejected",km?:number)=>void;onScreenshot:(p:string)=>void}){
  const [km,setKm]=useState(run.kmMissing?"":String(run.km));
  const check:KmCheck=run.kmCheck??(run.kmMissing?"missing":"unsure");
  const value=Number(km.replace(",","."));
  const valid=Number.isFinite(value)&&value>0&&value<=200;
  return <div className="review-row">
    <div className="run-info"><b>{playerName} · {fmtDate(run.date)}</b><small className={`km-check ${check}`}>{KM_CHECK_LABEL[check]}</small></div>
    <label className="review-km"><span>km</span><input inputMode="decimal" value={km} onChange={e=>setKm(e.target.value)} placeholder="z. B. 7,46" aria-label="Kilometer"/></label>
    {run.screenshot_path && <button className="secondary-button" onClick={() => onScreenshot(run.screenshot_path!)}>Screenshot ansehen</button>}
    <button className="red-button" disabled={!valid} title={valid?"":"Bitte zuerst Kilometer eintragen"} onClick={() => onReview(run.id,"approved",value)}>Freigeben</button>
    <button className="secondary-button" onClick={() => onReview(run.id,"rejected")}>Ablehnen</button>
  </div>;
}

function RunList({runs,players,onEdit,onDelete,showActions=true}:{runs:Run[];players?:Player[];onEdit:(r:Run)=>void;onDelete:(id:string)=>void;showActions?:boolean}){
  if(!runs.length)return <div className="empty-card">Noch keine Läufe gespeichert. Reiche deinen ersten Screenshot ein.</div>;
  return <div className="run-list">{runs.map(r=><div className="run-item" key={r.id}><div className="run-icon"><Footprints size={18}/></div><div className="run-info"><b>{players?.find(p=>p.id===r.playerId)?.name??(r.note||"Laufeinheit")}</b><small>{fmtDate(r.date)} · {r.minutes?`${r.minutes} min`:"Zeit nicht angegeben"} {inChallenge(r.date)?"· Challenge":"· Vor Challenge"}</small></div><strong>{runKmText(r)}</strong><strong className={`run-status ${r.status}`}>{r.status==="approved"?"Freigegeben":r.status==="rejected"?"Abgelehnt":"Wird geprüft"}</strong>{showActions&&r.status==="approved"&&<><button className="icon-button" onClick={()=>onEdit(r)}><Pencil size={15}/></button><button className="icon-button delete" onClick={()=>onDelete(r.id)}><Trash2 size={15}/></button></>}</div>)}</div>;
}

function SettingsView({players,setPlayers,goal,setGoal,runs,setRuns,onExport,onImport}:{players:Player[];setPlayers:(p:Player[])=>void;goal:number;setGoal:(n:number)=>void;runs:Run[];setRuns:(r:Run[])=>void;onExport:()=>void;onImport:(d:any)=>void}){
  const ref=useRef<HTMLInputElement>(null);
  return <><Title eyebrow="APP-EINSTELLUNGEN" title="Verwaltung" subtitle="Kader, Teamziel und Datensicherung verwalten."/><div className="settings-grid"><section className="settings-card"><h3><Flag/> Mannschaftsprämie</h3><p>Automatisch anhand der Teamkilometer im Challenge-Zeitraum.</p><label>Persönliches Anzeigeziel (km)<input type="number" min="1" value={goal} onChange={e=>setGoal(Number(e.target.value)||1)}/></label><small>Die Prämienstufen bleiben gemäß Vorgabe bei 2.300 bis 3.300 km.</small></section><section className="settings-card"><h3><Users/> Spielerverwaltung</h3><p>{players.filter(p=>p.active).length} aktive Spieler · {runs.length} Läufe</p>{players.map(p=><div className="admin-player" key={p.id}><span>#{p.number} · {p.name} {!p.active&&"(inaktiv)"}</span></div>)}</section><section className="settings-card"><h3><FileDown/> Backup</h3><p>Spieler und Läufe als JSON sichern oder wiederherstellen.</p><div className="button-line"><button className="secondary-button" onClick={onExport}>Exportieren</button><button className="secondary-button" onClick={()=>ref.current?.click()}>Importieren</button><input hidden ref={ref} type="file" accept="application/json" onChange={async e=>{const f=e.target.files?.[0];if(f){try{onImport(JSON.parse(await f.text()));}catch{alert("Backup-Datei ungültig.");}}}}/></div></section></div></>;
}

function Modal({mode,run,player,players,selectedId,onClose,onSaveRun,onSavePlayer,isCoach}:{mode:"run"|"player"|"editRun";run:Run|null;player:Player|null;players:Player[];selectedId:string;onClose:()=>void;onSaveRun:(r:Run,f:File|null)=>void;onSavePlayer:(p:Player)=>void;isCoach:boolean}){
  const isPlayer=mode==="player";
  const [playerId,setPlayerId]=useState(run?.playerId??selectedId??players[0]?.id??"");
  const [km,setKm]=useState(run&&!run.kmMissing?String(run.km):"");
  const [kmCheck,setKmCheck]=useState<KmCheck|null>(run?.kmCheck??null);
  const [dateFromOcr,setDateFromOcr]=useState(false);
  const [date,setDate]=useState(run?.date??dateKey(new Date()));
  const [minutes,setMinutes]=useState(run?String(run.minutes):"");
  const [note,setNote]=useState(run?.note??"");
  const [name,setName]=useState(player?.name??"");
  const [number,setNumber]=useState(player?String(player.number):"");
  const [err,setErr]=useState("");
  const [ocr,setOcr]=useState("");
  const [busy,setBusy]=useState(false);
  const [screenshot,setScreenshot]=useState<File|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  async function readImage(file:File){
    setScreenshot(file);setBusy(true);setErr("");setOcr("Screenshot wird per Texterkennung analysiert …");
    try{
      const result=await readRunScreenshot(file,setOcr);
      setKm(result.km==null?"":String(result.km));setKmCheck(result.kmCheck);
      if(result.date){setDate(result.date);setDateFromOcr(true);}else{setDateFromOcr(false);}
      setOcr(result.info+(result.date?"":" Datum nicht erkannt – bitte Laufdatum auswählen."));
    }catch{
      setKm("");setKmCheck("missing");setDateFromOcr(false);
      setOcr("Screenshot konnte nicht automatisch gelesen werden. Du kannst trotzdem einreichen – der Trainer trägt die Kilometer bei der Freigabe ein. Bitte Laufdatum auswählen.");
    }finally{setBusy(false);}
  }

  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(isPlayer){
      if(!name.trim()||!number.trim()){setErr("Name und Rückennummer sind erforderlich.");return;}
      onSavePlayer({id:player?.id??makeId(),name:name.trim(),number:Number(number),active:player?.active??true});
      return;
    }
    const kmMissing=!isCoach&&km.trim()==="";
    const dist=kmMissing?0:Number(km.replace(",","."));
    if(!playerId||(!kmMissing&&(!Number.isFinite(dist)||dist<=0||dist>200))){setErr("Bitte Spieler und gültige Kilometer angeben.");return;}
    if(date>dateKey(new Date())){setErr("Das Laufdatum darf nicht in der Zukunft liegen.");return;}
    if(!isCoach&&!screenshot){setErr("Bitte zuerst den Original-Screenshot hochladen.");return;}
    await onSaveRun({id:run?.id??makeId(),playerId,km:dist,kmMissing,kmCheck:isCoach?"manual":kmCheck,date,minutes:Number(minutes)||0,note:note.trim(),status:isCoach?"approved":"pending",screenshot_path:null},screenshot);
  }

  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal"><div className="modal-header"><div><small>{isPlayer?"MANNSCHAFT":run?"LAUF BEARBEITEN":"LAUF EINREICHEN"}</small><h2>{isPlayer?(player?"Spieler bearbeiten":"Spieler hinzufügen"):(run?"Lauf bearbeiten":"Neuen Lauf erfassen")}</h2></div><button className="icon-button" onClick={onClose}><X/></button></div><form onSubmit={submit}>
  {isPlayer?<><label>Spielername<input value={name} onChange={e=>setName(e.target.value)} placeholder="Vor- und Nachname" required/></label><label>Rückennummer<input type="number" min="0" max="99" value={number} onChange={e=>setNumber(e.target.value)} required/></label></>:<>
  {isCoach&&<label>Spieler<select value={playerId} onChange={e=>setPlayerId(e.target.value)}>{players.map(p=><option key={p.id} value={p.id}>{p.name} · #{p.number}</option>)}</select></label>}
  {mode!=="editRun"&&<div className="upload-box" onClick={()=>fileRef.current?.click()}><input ref={fileRef} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void readImage(f);}}/><Camera size={23}/><b>Screenshot auswählen</b><span>Garmin, Strava, Apple Fitness und andere Lauf-Apps</span><span className="upload-action"><Upload size={14}/> Bild hochladen</span></div>}{ocr&&<div className={`ocr-message ${busy?"":kmCheck??""}`}>{ocr}</div>}
  <div className="form-two"><label>Kilometer<input inputMode="decimal" value={km} onChange={e=>setKm(e.target.value)} placeholder={isCoach?"z. B. 7,46":kmCheck==="missing"?"Trägt der Trainer ein":"Wird aus Screenshot gelesen"} required={isCoach} readOnly={!isCoach}/></label><label>Datum<input type="date" value={date} max={dateKey(new Date())} onChange={e=>setDate(e.target.value)} required readOnly={!isCoach&&dateFromOcr}/></label></div>{isCoach&&<div className="form-two"><label>Laufzeit (Minuten)<input type="number" min="0" value={minutes} onChange={e=>setMinutes(e.target.value)} placeholder="z. B. 42"/></label><label>Notiz<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional"/></label></div>}{!isCoach&&<div className="ocr-message">Deine Werte sind nach dem Einreichen nicht mehr bearbeitbar. Sie zählen erst nach Trainerfreigabe; der Trainer prüft den Screenshot und korrigiert die Kilometer bei Bedarf.</div>}</>}
  {err&&<div className="form-error">{err}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="red-button" type="submit" disabled={busy}><Check size={16}/> {isCoach?"Speichern":"Zur Prüfung einreichen"}</button></div>
  </form></div></div>;
}

function exportBackup(players:Player[],runs:Run[],goal:number){
  const blob=new Blob([JSON.stringify({players,runs,goal},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="atusrun-backup.json";a.click();URL.revokeObjectURL(a.href);
}

function LoginScreen() {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error)setError(error.message);
    setBusy(false);
  }
  return <main className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="brand"><div className="brand-logo"><Footprints size={23}/></div><div><b>ATUSRUN</b><small>GSL TEAM CHALLENGE</small></div></div>
      <div className="eyebrow">MITGLIEDERBEREICH</div><h1>Willkommen zurück.</h1><p>Bitte mit deinem persönlichen Zugang anmelden.</p>
      <label>E-Mail-Adresse<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
      {error&&<div className="form-error">{error}</div>}
      <button className="red-button" type="submit" disabled={busy}>{busy?"Anmeldung läuft …":"Anmelden"}</button>
      <small>Zugänge werden vom Trainer eingerichtet.</small>
    </form>
  </main>;
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
      // Zuerst das vollständige Profil laden. Falls optionale Profilspalten
      // in der lokalen Datenbank noch fehlen, trotzdem die Rolle auslesen.
      let {data,error}=await supabase.from("profiles").select("id,name,number,active,role,avatar_url,position,bio").eq("id",session.user.id).single();
      if (error) {
        const fallback = await supabase.from("profiles").select("id,name,number,active,role").eq("id",session.user.id).single();
        data = fallback.data as any;
        error = fallback.error;
      }
      if(alive){
        if(error) {
          console.error("ATUSRUN: Profil konnte nicht geladen werden:", error.message);
          setProfile({id:session.user.id,name:session.user.email?.split("@")[0]??"Mitglied",role:"player"});
        } else {
          setProfile(data);
        }
      }
    }
    void loadProfile();return ()=>{alive=false;};
  },[session?.user.id]);
  if(loading)return <div className="app-shell" style={{padding:40}}>ATUSRUN wird geladen …</div>;
  if(!session)return <LoginScreen/>;
  if(!profile)return <div className="app-shell" style={{padding:40}}>Profil wird geladen …</div>;
  return <ChallengeApp user={session.user} profile={profile} onSignOut={()=>void supabase.auth.signOut()}/>;
}
export default App;