import { useState, useEffect, useMemo, useRef, forwardRef } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, arrayUnion, serverTimestamp, runTransaction, writeBatch, deleteField } from "firebase/firestore";
import { db, auth, isFirebaseConfigured } from "./firebase";
import { env } from "./runtimeEnv";
import HistorySearch from "./screens/HistorySearch";
import AdminDashboard from "./screens/AdminDashboard";
import OnboardingGuide from "./screens/OnboardingGuide";
import MyPage from "./screens/MyPage";
import { signInAnonymously } from "firebase/auth";
import {
  Calendar, CalendarDays, Clock, Users, Monitor, Video, Plus, X, Check,
  CheckCircle2, Repeat, AlertCircle, ChevronLeft, ChevronRight, ChevronDown, Trash2, Play, Square,
  Building2, List, LogOut, Lock, User, UserPlus, GripVertical, LogIn,
  LayoutDashboard, HelpCircle, Sun, Moon, Download, FileText, Bell, Grid, ArrowUp, BarChart3,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

import {
  C, PASTEL, COLORS, pal, EQUIP, ROOMS, MEMBERS, M, memLabel, nameWithNim,
  DAY_START, DAY_END, STEP, PX, SLOTS, GUTTER, UPDATE_NOTES
} from "./constants";
import {
  pad, toMin, toHHMM, WEEK, keyOf, fmtK, addDays, dayOnly, sameDay, TIMES, getClosestTime
} from "./utils/time";
const nid = () => `r_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;


const VAPID_PUBLIC_KEY = "BLqCKTDBeszY0bUR8cDBThOpHkATpM4tZY9qu6zOlnKpDxQoRkCMKvkBxsivA1h0xDqdfVy_I9Yvs7U-6CzA1j4";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToWebPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/service-worker.js');
    
    // Wait until the service worker is active and ready
    const registration = await navigator.serviceWorker.ready;
    
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const targetKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      let subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        const existingKey = subscription.options?.applicationServerKey;
        let keyMatches = false;
        if (existingKey) {
          const keyArray = new Uint8Array(existingKey);
          if (keyArray.length === targetKey.length && keyArray.every((val, i) => val === targetKey[i])) {
            keyMatches = true;
          }
        }
        
        if (!keyMatches) {
          console.log('Unsubscribing key-mismatched push subscription...');
          try {
            await subscription.unsubscribe();
            subscription = null;
          } catch(unsubErr) {
            console.warn('Failed to unsubscribe stale push subscription:', unsubErr);
          }
        }
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: targetKey
        });
      }

      // Save subscription to user document in Firestore with retry logic
      if (isFirebaseConfigured && userId) {
        const subJson = JSON.parse(JSON.stringify(subscription));
        const saveSubWithRetry = async (attempts = 3) => {
          for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
              await setDoc(doc(db, "users", userId), { 
                id: userId, 
                webPushSubscription: subJson,
                webPushSubscriptions: arrayUnion(subJson) 
              }, { merge: true });
              console.log("Push subscription synchronized for user:", userId);
              break;
            } catch (err) {
              console.warn(`Firestore push save attempt ${attempt} failed:`, err);
              if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 600 * attempt));
              }
            }
          }
        };
        saveSubWithRetry();
      }
    }
  } catch (err) {
    console.error('Web Push subscription error:', err);
  }
}

async function sendPushNotification(title, body, attendees) {
  // 1. Instant local Notification popup (Same direct method as the working test button)
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png'
      });
    } catch (e) {
      console.log('Local Notification popup error:', e);
    }
  }

  // 2. Remote Server Push API trigger for all attendees & devices
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, url: '/', attendees, isRealtime: true })
    });
  } catch (err) {
    console.error('Failed to send push notification:', err);
  }
}

/* ===================== shared atoms ===================== */
function TeamTag({ team }) {
  const id = team === "ID";
  return <span className="inline-grid h-[18px] min-w-[24px] place-items-center rounded-[3px] px-1 text-[10px] font-medium" style={id ? { background: PASTEL.gray.bg, color: PASTEL.gray.text } : { background: PASTEL.brown.bg, color: PASTEL.brown.text }}>{team}</span>;
}
function EquipChip({ type }) {
  const e = EQUIP[type]; if (!e) return null; const { Icon } = e;
  return <span className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium" style={{ background: "var(--bg-chip)", color: C.muted }}><Icon size={12} /> {e.label}</span>;
}
function StatusPill({ kind, text }) {
  const m = { busy: { bg: PASTEL.red.bg, fg: PASTEL.red.text, dot: PASTEL.red.dot }, soon: { bg: PASTEL.gray.bg, fg: PASTEL.gray.text, dot: PASTEL.gray.dot }, free: { bg: PASTEL.green.bg, fg: PASTEL.green.text, dot: PASTEL.green.dot } }[kind];
  return <span className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-medium" style={{ background: m.bg, color: m.fg }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} /> {text}</span>;
}
function Wordmark({ size = 18 }) {
  return (
    <span style={{ fontFamily: '"Pretendard Variable", sans-serif', fontSize: size, color: C.ink, lineHeight: 1, letterSpacing: "-0.02em", display: "inline-flex", alignItems: "center", fontWeight: "normal" }}>
      <span style={{ fontWeight: 600, color: C.text }}>found</span>
      <span style={{ fontWeight: 600, color: C.text, opacity: 0.8 }}>/</span>
      <span style={{ fontWeight: 800 }}>Founded</span>
    </span>
  );
}
const defaultProfiles = {
  "혜경": "/혜경.png",
  "지민": "/지민.png",
  "수현": "/수현.png",
  "보아": "/보아.png",
  "oxo": "/oxo.png",
  "진우": "/진우.png",
  "다은": "/다은.png",
  "태영": "/태영.png",
  "경선": "/경선.png",
  "유진": "/유진.png",
  "준범": "/준범.png",
  "현열": "/현열.png",
  "정수": "/정수.png",
  "준구": "/준구.png",
  "규호": "/규호.png",
  "여준": "/여준.png",
  "민지": "/민지.png"
};

function Avatar({ name, label, size = 36, solid = false, onClick, className, style, dbProfiles }) {
  const [img, setImg] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [retryDefault, setRetryDefault] = useState(false);
  
  useEffect(() => {
    setImgError(false);
    setRetryDefault(false);
    const loadImg = () => {
      const meId = MEMBERS.find(m => m.name === name)?.id;
      // 1. Firestore profileImage
      if (meId && dbProfiles && dbProfiles[meId]) {
        setImg(dbProfiles[meId]);
        return;
      }
      // 2. localStorage fallback
      try {
        const x = localStorage.getItem("profile_images");
        const p = x ? JSON.parse(x) : {};
        if (name && p[name]) {
          setImg(p[name]);
          return;
        }
      } catch {}
      // 3. public/{name}.png default fallback
      setImg(name ? defaultProfiles[name] : null);
    };
    loadImg();
    const handler = () => loadImg();
    window.addEventListener("profile_updated", handler);
    return () => window.removeEventListener("profile_updated", handler);
  }, [name, dbProfiles]);

  if (img && !imgError) {
    return (
      <img 
        src={encodeURI(img)} 
        alt={name} 
        onClick={onClick}
        onError={() => {
          if (!retryDefault && name && defaultProfiles[name] && img !== defaultProfiles[name]) {
            setRetryDefault(true);
            setImg(defaultProfiles[name]);
          } else {
            setImgError(true);
          }
        }}
        className={`shrink-0 rounded-full object-cover ${className || ""}`} 
        style={{ width: size, height: size, border: `1px solid ${C.border}`, cursor: onClick ? "pointer" : "default", ...style }} 
      />
    );
  }
  
  const lbl = label || (name ? name.slice(0, 2) : "");
  return (
    <span 
      onClick={onClick}
      className={`grid shrink-0 place-items-center rounded-full font-medium ${className || ""}`} 
      style={{ 
        width: size, 
        height: size, 
        fontSize: size * 0.36, 
        background: solid ? "var(--bg-avatar)" : "var(--bg-input)", 
        border: `1px solid ${C.border}`, 
        color: C.muted,
        cursor: onClick ? "pointer" : "default",
        ...style 
      }}
    >
      {lbl}
    </span>
  );
}

/* ===================== login modal ===================== */
function LoginModal({ message, onClose, onLogin, membersList }) {
  const [name, setName] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const submit = () => { 
    const trimmedName = name.trim();
    if (!trimmedName) return setErr("이름을 입력해주세요."); 
    if (trimmedName.toLowerCase() === "admin") {
      if (pw !== env("VITE_ADMIN_PASSWORD")) return setErr("비밀번호가 올바르지 않아요.");
      return onLogin("admin");
    }
    if (trimmedName.toLowerCase() === "guest") {
      if (pw !== "1234") return setErr("비밀번호가 올바르지 않아요.");
      return onLogin("Guest");
    }
    const member = (membersList || MEMBERS).find((m) => m.name === trimmedName);
    if (!member || member.deleted) return setErr("등록되지 않은 멤버 이름입니다. 등록된 이름으로 로그인해 주세요.");
    if (member.inactive || member.active === false) return setErr("해당 계정은 정지되어 로그인할 수 없습니다.");
    if (pw !== env("VITE_MEMBER_PASSWORD")) return setErr("비밀번호가 올바르지 않아요."); 
    onLogin(trimmedName); 
  };
  return (
    <div className="ov fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={onClose}>
      <div className="sheet w-full rounded-t-lg bg-white p-6 sm:max-w-sm sm:rounded-lg" style={{ boxShadow: "0 -4px 12px rgba(0,0,0,.08)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><Wordmark size={20} /><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button></div>
        <p className="mt-4 text-[15px] font-medium">{message}</p>
        <p className="mt-1 text-[12px]" style={{ color: C.faint }}>이름과 비밀번호를 입력해 로그인하세요.</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border px-3" style={{ borderColor: C.border }}>
          <User size={16} style={{ color: C.faint }} />
          <input className="inp w-full bg-transparent py-2.5 text-sm outline-none" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="이름 (예: 태영)" autoFocus />
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border px-3" style={{ borderColor: C.border }}>
          <Lock size={16} style={{ color: C.faint }} />
          <input type="password" className="inp w-full bg-transparent py-2.5 text-sm outline-none" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="비밀번호" />
        </div>
        {err && <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: PASTEL.red.text }}><AlertCircle size={13} />{err}</div>}
        <button onClick={submit} className="lift mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg py-3 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}><LogIn size={16} /> 로그인</button>
      </div>
    </div>
  );
}


/* ===================== dashboard ===================== */
function lcg(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function genDash(year, month, roomFilter, reservations) {
  const days = new Date(year, month + 1, 0).getDate();
  const daily = [];
  let bigMin = 0, smallMin = 0;
  
  for (let d = 1; d <= days; d++) {
    daily.push({ d, wd: new Date(year, month, d).getDay(), big: 0, small: 0, total: 0 });
  }

  if (Array.isArray(reservations)) {
    reservations.forEach(r => {
      const [ry, rm, rd] = r.date.split("-").map(Number);
      if (ry === year && rm === month + 1) {
        if (roomFilter === "all" || r.roomId === roomFilter) {
          const dObj = daily[rd - 1];
          if (dObj) {
            const durationMin = toMin(r.end) - toMin(r.start);
            if (r.roomId === "big") {
              dObj.big += 1;
              bigMin += durationMin;
            } else if (r.roomId === "small") {
              dObj.small += 1;
              smallMin += durationMin;
            }
            dObj.total += 1;
          }
        }
      }
    });
  }

  const total = daily.reduce((acc, curr) => acc + curr.total, 0);
  const totalMinutes = bigMin + smallMin;
  const mostUsed = bigMin > smallMin ? "큰 회의실" : smallMin > bigMin ? "작은 회의실" : "-";
  const leastUsed = bigMin > smallMin ? "작은 회의실" : smallMin > bigMin ? "큰 회의실" : "-";
  return { 
    days, 
    daily, 
    total, 
    totalMinutes, 
    mostUsed, 
    leastUsed, 
    mostMinutes: bigMin, 
    leastMinutes: smallMin
  };
}
const HEAT = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];
function heatColor(v, max) { if (!v) return HEAT[0]; const lv = Math.min(4, 1 + Math.floor((v / Math.max(1, max)) * 3.99)); return HEAT[lv]; }

function StatCard({ label, value, sub, delay }) {
  return (
    <div className="rise rounded-lg border bg-white p-4" style={{ borderColor: C.border, animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.muted }}>{label}<HelpCircle size={12} style={{ color: C.faint }} /></div>
      {sub && <div className="mt-3 text-[11px] font-medium" style={{ color: C.faint }}>{sub}</div>}
      <div className={`${sub ? "mt-0.5" : "mt-4"} text-[22px] font-medium tracking-tight`}>{value}</div>
    </div>
  );
}

function Dashboard({ month, setMonth, roomF, setRoomF, now, reservations, onSelectEvent }) {
  const data = useMemo(() => genDash(month.getFullYear(), month.getMonth(), roomF, reservations), [month, roomF, reservations]);
  const maxTotal = Math.max(1, ...data.daily.map((x) => x.total));
  // heatmap grid
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const heatCells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dailyByDate = {}; data.daily.forEach((x) => { dailyByDate[x.d] = x; });

  const [selectedDate, setSelectedDate] = useState(null);

  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}`;
    return reservations.filter(r => {
      const isSameDate = r.date === dateStr;
      const matchesRoom = roomF === "all" || r.roomId === roomF;
      return isSameDate && matchesRoom;
    }).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
  }, [selectedDate, reservations, roomF]);


  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-medium">회의실 현황 대시보드</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-white" style={{ borderColor: C.border }}>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="lift grid h-9 w-9 place-items-center rounded-l-xl" style={{ color: C.muted }}><ChevronLeft size={17} /></button>
            <div className="px-2 text-sm font-medium">{month.getFullYear()}년 {month.getMonth() + 1}월</div>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="lift grid h-9 w-9 place-items-center rounded-r-xl" style={{ color: C.muted }}><ChevronRight size={17} /></button>
          </div>
          <div className="inline-flex rounded-lg border bg-white p-1" style={{ borderColor: C.border }}>
            {[["all", "전체"], ["big", "큰 회의실"], ["small", "작은 회의실"]].map(([k, l]) => (
              <button key={k} onClick={() => setRoomF(k)} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={roomF === k ? { background: C.ink, color: "var(--bg)" } : { color: C.muted }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="총 회의실 예약 수" value={`${data.total}건`} delay={0} />
        <StatCard label="총 회의실 사용 시간" value={`${data.totalMinutes}분`} delay={40} />
        <StatCard label="가장 많이 사용된 회의실" sub={`${data.mostMinutes}분`} value={data.mostUsed} delay={80} />
        <StatCard label="가장 적게 사용된 회의실" sub={`${data.leastMinutes}분`} value={data.leastUsed} delay={120} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4">
        {/* heatmap */}
        <div className="rise rounded-lg border bg-white p-5" style={{ borderColor: C.border, animationDelay: "120ms" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-lg px-2 py-0.5 text-xs font-medium" style={{ background: PASTEL.yellow.bg, color: PASTEL.yellow.text }}>{month.getMonth() + 1}월</span>
            <span className="text-sm font-medium">회의실 이용 현황</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEK.map((w, i) => <div key={w} className="text-center text-[10px] font-medium" style={{ color: i === 0 ? "#C0392B" : i === 6 ? "#2A5DC7" : C.faint }}>{w}</div>)}
            {heatCells.map((c, i) => {
              const inM = c.getMonth() === month.getMonth();
              const v = inM ? (dailyByDate[c.getDate()]?.total || 0) : 0;
              return (
                <div
                  key={i}
                  className={`aspect-square rounded-lg flex flex-col justify-between p-1.5 text-center transition-all ${inM && v > 0 ? "cursor-pointer hover:scale-[1.04]" : ""}`}
                  title={inM ? `${c.getDate()}일 · ${v}건` : ""}
                  onClick={() => { if (inM && v > 0) setSelectedDate(c); }}
                  style={{
                    background: inM ? (v > 0 ? "var(--bg-quaternary)" : "var(--bg-secondary)") : "transparent",
                    border: inM ? `1px solid ${C.line}` : "none",
                    minHeight: "48px"
                  }}
                >
                  {inM ? (
                    <>
                      <span className="text-[10px] font-semibold block text-left" style={{ color: C.muted }}>{c.getDate()}</span>
                      <span className="text-[12px] font-bold block" style={{ color: v > 0 ? "var(--ink)" : "var(--faint)", opacity: v > 0 ? 1 : 0.4 }}>
                        {v > 0 ? `${v}건` : "-"}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px]" style={{ color: C.faint }}>
            * 각 날짜별 칸에 내가 포함된 예약의 총 건수가 숫자로 표시됩니다. (클릭 시 세부 예약 목록을 볼 수 있습니다.)
          </div>
        </div>

      </div>
      <p className="mt-3 text-[11px]" style={{ color: C.faint }}>* 대시보드 지표는 해당 월의 이용 현황을 집계해 보여줍니다.</p>

      {/* ===== Dashboard Day Events Popup Modal ===== */}
      {selectedDate && (
        <div className="ov fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setSelectedDate(null)}>
          <div className="sheet w-full rounded-t-lg bg-white p-6 sm:max-w-md sm:rounded-lg flex flex-col max-h-[85vh] sm:max-h-[75vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2">
                <CalendarDays size={18} style={{ color: C.ink }} />
                <h3 className="text-[17px] font-semibold">{fmtK(selectedDate)} 내 예약 목록</h3>
              </div>
              <button onClick={() => setSelectedDate(null)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button>
            </div>
            
            <div className="sc overflow-y-auto pr-1 flex-1 space-y-2.5" style={{ maxHeight: "300px" }}>
              {selectedDateEvents.length === 0 ? (
                <div className="py-8 text-center text-sm font-semibold" style={{ color: C.muted }}>등록된 예약 일정이 없습니다.</div>
              ) : (
                selectedDateEvents.map((r) => {
                  const p = r.isUrgent ? pal('red') : pal('green');
                  const rm = ROOMS.find((x) => x.id === r.roomId);
                  return (
                    <div
                      key={r.id}
                      onClick={() => { setSelectedDate(null); if (onSelectEvent) onSelectEvent(r); }}
                      className="blk rounded-lg border p-3.5 transition-all hover:scale-[1.01] cursor-pointer"
                      style={{ background: p.bg, borderColor: p.line, color: p.text }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.dot }} />
                          <span className="text-[14px] font-semibold truncate max-w-[180px] sm:max-w-[220px]">{r.title}</span>
                          {r.repeat && <Repeat size={11} />}
                        </div>
                        <span className="text-[10px] font-semibold rounded px-2 py-0.5" style={{ background: "rgba(255,255,255,0.6)", color: p.text }}>
                          {rm?.name || (r.roomId === 'meeting-room' ? '큰 회의실' : '회의실')}
                        </span>
                      </div>
                      <div className="text-[12px] opacity-90 space-y-0.5 font-medium">
                        <div className="flex items-center gap-1"><Clock size={12} style={{ opacity: 0.7 }} /> {r.start} ~ {r.end}</div>
                        <div className="flex items-center gap-1"><User size={12} style={{ opacity: 0.7 }} /> 등록자: {nameWithNim(r.owner)} · 참석자: {r.attendees ? r.attendees.length : 0}명</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== splash screen ===================== */
function SplashScreen({ onComplete }) {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    // 로고와 자막이 나온 후 약 1.5초 대기 후 진입 (총 2350ms)
    const timer = setTimeout(() => {
      setFade(true);
      setTimeout(() => {
        onComplete();
      }, 500); // CSS opacity transition duration
    }, 2350);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className={`splash-container ${fade ? "fade-out" : ""}`}>
      <div className="splash-fallback flex flex-col items-center justify-center gap-2.5">
        <div className="splash-logo-container">
          <span className="splash-char w600 del-1">f</span><span className="splash-char w600 del-2">o</span><span className="splash-char w600 del-3">u</span><span className="splash-char w600 del-4">n</span><span className="splash-char w600 del-5">d</span><span className="splash-char w600 del-6">/</span><span className="splash-char w800 del-7">F</span><span className="splash-char w800 del-8">o</span><span className="splash-char w800 del-9">u</span><span className="splash-char w800 del-10">n</span><span className="splash-char w800 del-11">d</span><span className="splash-char w800 del-12">e</span><span className="splash-char w800 del-13">d</span>
        </div>
      </div>
    </div>
  );
}

/* ===================== custom date picker (ios style) ===================== */
function CustomDatePicker({ anchor, onClose, onSelect, theme }) {
  const [pickerDate, setPickerDate] = useState(() => new Date(anchor));
  const [selectedDate, setSelectedDate] = useState(() => new Date(anchor));

  const year = pickerDate.getFullYear();
  const month = pickerDate.getMonth();

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const changeMonth = (offset) => {
    setPickerDate(new Date(year, month + offset, 1));
  };

  const handleDayClick = (day) => {
    const d = new Date(year, month, day);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      alert("주말은 예약할 수 없습니다.");
      return;
    }
    setSelectedDate(d);
  };

  const days = [];
  // Blank slots
  for (let i = 0; i < firstDayIndex; i++) {
    days.push(<div key={`empty-${i}`} className="w-12 h-12" />);
  }
  // Days of month
  for (let d = 1; d <= totalDays; d++) {
    const isSel = selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === d;
    const nowD = new Date();
    const isToday = nowD.getFullYear() === year && nowD.getMonth() === month && nowD.getDate() === d;

    days.push(
      <button
        key={`day-${d}`}
        onClick={() => handleDayClick(d)}
        className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-medium transition-all relative"
        style={{
          background: isSel ? "#3b82f6" : "transparent",
          color: isSel ? "#ffffff" : "#ffffff", // In dark modal days are white
          border: isToday && !isSel ? "1.5px solid rgba(255,255,255,0.4)" : "none",
        }}
      >
        {d}
      </button>
    );
  }

  const isDark = theme === "dark";
  
  // Custom picker color system
  const overlayBg = isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.25)";
  const cardBg = isDark
    ? "linear-gradient(180deg, rgba(30, 30, 30, 0.65) 0%, rgba(20, 20, 20, 0.75) 100%)"
    : "linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(240, 240, 245, 0.7) 100%)";
  const textColor = isDark ? "text-white" : "text-black";
  const subTextColor = isDark ? "text-white/50" : "text-black/50";
  const resetBtnStyle = isDark
    ? { background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.15)", color: "#ffffff" }
    : { background: "rgba(0, 0, 0, 0.06)", border: "1px solid rgba(0, 0, 0, 0.08)", color: "#000000" };
  const cardBorder = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.4)";
  const arrowColor = "#2f80ed";

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: overlayBg }}
      onClick={onClose}
    >
      {/* Modal Card */}
      <div 
        className={`relative w-[380px] rounded-[32px] p-6 ${textColor} select-none shadow-2xl overflow-hidden flex flex-col`}
        style={{
          background: cardBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${cardBorder}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Close Button (X) */}
        <button 
          onClick={onClose}
          className={`absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95`}
          style={{ background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }}
        >
          <X size={14} className={textColor} />
        </button>

        {/* Header */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1 cursor-pointer">
            <span className="text-[20px] font-bold">{year}년 {month + 1}월</span>
            <span className="text-[15px] font-bold" style={{ color: arrowColor }}>＞</span>
          </div>
          <div className="flex items-center gap-4 mr-8">
            <button onClick={() => changeMonth(-1)} className="p-1 hover:opacity-85 active:scale-95 transition-all" style={{ color: arrowColor }}>
              <ChevronLeft size={24} />
            </button>
            <button onClick={() => changeMonth(1)} className="p-1 hover:opacity-85 active:scale-95 transition-all" style={{ color: arrowColor }}>
              <ChevronRight size={24} />
            </button>
          </div>
        </div>

        {/* Weekday Row */}
        <div className={`grid grid-cols-7 mt-6 text-[14px] font-semibold text-center ${subTextColor}`}>
          {["일", "월", "화", "수", "목", "금", "토"].map((w, idx) => (
            <div key={idx} className="w-12 h-6" style={{ color: idx === 0 ? "#ef4444" : idx === 6 ? "#2f80ed" : "inherit" }}>
              {w}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-y-1 mt-2 text-center">
          {days.map((dayElem, idx) => {
            if (dayElem.key && dayElem.key.startsWith("day-")) {
              const dNum = parseInt(dayElem.key.replace("day-", ""), 10);
              const isSel = selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === dNum;
              const isToday = new Date().getFullYear() === year && new Date().getMonth() === month && new Date().getDate() === dNum;
              
              return (
                <button
                  key={dayElem.key}
                  onClick={() => handleDayClick(dNum)}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-medium transition-all relative mx-auto"
                  style={{
                    background: isSel ? "#2f80ed" : "transparent",
                    color: isSel ? "#ffffff" : isDark ? "#ffffff" : "#000000",
                    border: isToday && !isSel ? (isDark ? "1.5px solid rgba(255,255,255,0.4)" : "1.5px solid rgba(0,0,0,0.2)") : "none",
                  }}
                >
                  {dNum}
                </button>
              );
            }
            return dayElem;
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center mt-6">
          <button
            onClick={() => {
              const td = new Date();
              setSelectedDate(td);
              setPickerDate(td);
            }}
            className="px-6 py-2.5 rounded-full text-[14px] font-bold transition-all active:scale-95"
            style={resetBtnStyle}
          >
            재설정
          </button>
          <button
            onClick={() => onSelect(selectedDate)}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white transition-all active:scale-95 shadow-md"
            style={{ backgroundColor: "#2f80ed" }}
          >
            <Check size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== Member Management ===================== */
function MemberManagement({ onBack, membersList, handleToggleMemberActive, handleAddMember, handleDeleteMember, Avatar }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirmMember, setDeleteConfirmMember] = useState(null);

  // Form state for new member
  const [newName, setNewName] = useState("");
  const [newTeam, setNewTeam] = useState("ID");
  const [newRole, setNewRole] = useState("디자이너");
  const [newGroup, setNewGroup] = useState("staff");
  const [addErr, setAddErr] = useState("");

  const submitAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddErr("이름을 입력해주세요.");
      return;
    }
    handleAddMember({
      name: trimmed,
      team: newTeam,
      role: newRole,
      group: newGroup
    });
    setNewName("");
    setNewTeam("ID");
    setNewRole("디자이너");
    setNewGroup("staff");
    setAddErr("");
    setShowAddModal(false);
  };

  const filtered = (membersList || []).filter(m => !["m_guest", "m_client", "m_room"].includes(m.id) && !m.deleted);

  return (
    <div className="flex-1 w-full flex flex-col p-4 sm:p-8 overflow-y-auto" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-4xl mx-auto w-full pb-20">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: C.text }}>사용자 및 승인 관리</h1>
            <p className="text-[13px]" style={{ color: C.muted }}>회원가입 승인 대기 계정 관리 및 기존 임원/운영진의 프로필 상태를 관리합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#2383E2] hover:bg-[#1b6fc2] transition-all lift cursor-pointer shadow-sm"
            >
              <UserPlus size={16} /> 새 멤버 추가
            </button>
            <button 
              onClick={onBack}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-semibold transition-all lift cursor-pointer"
              style={{ borderColor: C.border, background: C.paper, color: C.text }}
            >
              <ChevronLeft size={16} /> 돌아가기
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D859]"></span>
            <h2 className="text-[15px] font-bold" style={{ color: C.text }}>멤버 계정 목록 ({filtered.length}명)</h2>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {filtered.map(m => {
            const isSuspended = m.active === false;
            return (
              <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all" style={{ background: C.paper, borderColor: C.border }}>
                <div className="flex items-center gap-4 mb-3 sm:mb-0">
                  <Avatar name={m.name} size={46} style={{ border: `2px solid ${C.border}` }} />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[16px] font-bold tracking-tight" style={{ color: C.text }}>{nameWithNim(m.name)}</span>
                      <span className="text-[13px] font-bold text-[#00A3FF]">{m.team}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-[#00D859]" style={{ background: "rgba(0,216,89,0.15)" }}>{m.role}</span>
                      {m.isCustom && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          추가됨
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] font-medium" style={{ color: C.muted }}>
                      FOUND/FOUNDED
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                  {isSuspended && (
                    <div className="text-[12px] font-medium text-[#FF3B3B] mr-1">
                      [정지됨]
                    </div>
                  )}
                  <button
                    onClick={() => handleToggleMemberActive(m.id, isSuspended ? false : true)}
                    className="px-3.5 py-1.5 rounded-lg text-[12px] font-bold transition-all border shrink-0 lift cursor-pointer"
                    style={isSuspended 
                      ? { color: "#00D859", borderColor: "rgba(0,216,89,0.3)", background: "rgba(0,216,89,0.1)" } 
                      : { color: C.muted, borderColor: C.border, background: C.paper }}
                  >
                    {isSuspended ? "정지 해제" : "계정 정지"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmMember(m)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all border shrink-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 lift cursor-pointer"
                    style={{ borderColor: C.border }}
                  >
                    <Trash2 size={13} /> 삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg)] border p-6 shadow-2xl space-y-4" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2 font-bold text-base" style={{ color: C.text }}>
                <UserPlus size={20} className="text-[#2383E2]" />
                <span>새 멤버 추가</span>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-[var(--faint)] cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: C.muted }}>이름 <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={newName} 
                  onChange={(e) => { setNewName(e.target.value); setAddErr(""); }} 
                  placeholder="예: 길동 (성 제외)"
                  className="inp w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none bg-[var(--bg-input)]"
                  style={{ borderColor: addErr ? "#FF3B3B" : C.border, color: C.text }}
                  autoFocus
                />
                {addErr && <p className="mt-1 text-xs text-red-500 font-semibold">{addErr}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: C.muted }}>소속 / 팀 배지</label>
                  <select 
                    value={newTeam} 
                    onChange={(e) => setNewTeam(e.target.value)}
                    className="inp w-full rounded-lg border px-3 py-2.5 text-sm outline-none bg-[var(--bg-select)] cursor-pointer"
                    style={{ borderColor: C.border, color: C.text }}
                  >
                    <option value="ID">ID</option>
                    <option value="VD">VD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: C.muted }}>구분 / 그룹</label>
                  <select 
                    value={newGroup} 
                    onChange={(e) => setNewGroup(e.target.value)}
                    className="inp w-full rounded-lg border px-3 py-2.5 text-sm outline-none bg-[var(--bg-select)] cursor-pointer"
                    style={{ borderColor: C.border, color: C.text }}
                  >
                    <option value="staff">임직원 (Staff)</option>
                    <option value="director">임원 (Director)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: C.muted }}>직함</label>
                <select 
                  value={newRole} 
                  onChange={(e) => setNewRole(e.target.value)}
                  className="inp w-full rounded-lg border px-3 py-2.5 text-sm outline-none bg-[var(--bg-select)] cursor-pointer"
                  style={{ borderColor: C.border, color: C.text }}
                >
                  <option value="디렉터">디렉터</option>
                  <option value="시니어 디자이너">시니어 디자이너</option>
                  <option value="디자이너">디자이너</option>
                  <option value="프리랜서 디자이너">프리랜서 디자이너</option>
                  <option value="인턴">인턴</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: C.border }}>
              <button 
                onClick={() => setShowAddModal(false)}
                className="lift rounded-xl border px-4 py-2.5 text-xs font-semibold cursor-pointer"
                style={{ borderColor: C.border, color: C.muted }}
              >
                취소
              </button>
              <button 
                onClick={submitAdd}
                className="lift rounded-xl px-5 py-2.5 text-xs font-semibold bg-[#2383E2] text-white shadow-sm hover:bg-[#1b6fc2] cursor-pointer"
              >
                멤버 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg)] border p-5 shadow-2xl space-y-4" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2 text-red-500 font-bold text-sm">
                <AlertCircle size={18} />
                <span>멤버 계정 삭제 안내</span>
              </div>
              <button onClick={() => setDeleteConfirmMember(null)} className="text-[var(--faint)] cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs leading-relaxed" style={{ color: C.text }}>
              <p className="font-bold text-sm">
                "{nameWithNim(deleteConfirmMember.name)}" 멤버 계정을 삭제하시겠습니까?
              </p>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 space-y-1">
                <p className="font-semibold">⚠️ 과거 기록 안전 보존 (소프트 삭제)</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>신규 회의실 예약 및 참석자 선택 목록에서 제거됩니다.</li>
                  <li>해당 멤버 이름으로 더 이상 로그인할 수 없습니다.</li>
                  <li><b>과거 예약 및 참석 내역의 이름은 깨지지 않고 정상 보존</b>됩니다.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button 
                onClick={() => setDeleteConfirmMember(null)}
                className="lift rounded-xl border px-3.5 py-2 text-xs font-semibold cursor-pointer"
                style={{ borderColor: C.border, color: C.muted }}
              >
                취소
              </button>
              <button 
                onClick={() => {
                  handleDeleteMember(deleteConfirmMember.id);
                  setDeleteConfirmMember(null);
                }}
                className="lift rounded-xl px-3.5 py-2 text-xs font-semibold bg-red-600 text-white shadow-sm hover:bg-red-700 cursor-pointer"
              >
                확인하고 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== app ===================== */
function NoticeModal({ notice, onClose, onConfirm }) {
  const [checked, setChecked] = useState(new Array(notice.length).fill(false));
  const allChecked = checked.every(Boolean);

  return (
    <div className="ov fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-[17px] font-bold mb-4" style={{ color: "#111" }}>사용 전 확인사항</h3>
        <ul className="space-y-2 mb-6">
          {notice.map((txt, i) => (
            <li key={i} className="flex items-center gap-2 cursor-pointer" onClick={() => {
              const nc = [...checked];
              nc[i] = !nc[i];
              setChecked(nc);
            }}>
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${checked[i] ? 'bg-[#1d9e75] border-[#1d9e75]' : 'border-gray-300'}`}>
                {checked[i] && <CheckCircle2 size={14} color="white" />}
              </div>
              <span className="text-[14px] text-gray-700">{txt}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-500 font-bold">취소</button>
          <button 
            disabled={!allChecked}
            onClick={() => { if(allChecked) onConfirm(); }} 
            className={`flex-1 py-3 rounded-xl font-bold transition-opacity ${allChecked ? 'bg-[#1d9e75] text-white' : 'bg-gray-100 text-gray-400'}`}
          >확인 및 시작</button>
        </div>
      </div>
    </div>
  );
}

function OccupancyBar({ capacity, current }) {
  const dots = Array.from({ length: capacity });
  return (
    <div className="flex gap-1.5 items-center mt-3">
      {dots.map((_, i) => (
        <div key={i} className={`h-2 flex-1 rounded-full transition-colors ${i < current ? 'bg-white' : 'bg-white/30'}`} />
      ))}
    </div>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('skipSplash'));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(null);
  const guideRef = useRef(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return;
    signInAnonymously(auth).catch((error) => {
      console.error("Anonymous auth failed:", error);
    });

    const unsub = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          // Force Firebase to resolve the ID Token first
          await user.getIdToken(true);
          // Add a 150ms delay to guarantee token propagation to the Firestore SDK before setting isAuthenticated to true
          setTimeout(() => {
            setIsAuthenticated(true);
            console.log("Logged in anonymously as:", user.uid);
          }, 150);
        } catch (e) {
          console.error("Token propagation failed:", e);
        }
      } else {
        setIsAuthenticated(false);
      }
    });
    return () => unsub();
  }, []);
  const [user, setUser] = useState(() => {
    try {
      const tokenStr = localStorage.getItem("auth_token");
      if (tokenStr) {
        const token = JSON.parse(decodeURIComponent(escape(atob(tokenStr))));
        if (token.exp && token.exp > Date.now()) {
          return token.name;
        } else {
          localStorage.removeItem("auth_token");
          localStorage.removeItem("last_user");
        }
      }
    } catch(e) {}
    return null;
  });

  useEffect(() => {
    if (user && isAuthenticated) {
      const meId = MEMBERS.find((m) => m.name === user)?.id;
      if (meId) {
        subscribeToWebPush(meId);
      }
    }
  }, [user, isAuthenticated]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);

  const [resources, setResources] = useState([]);
  useEffect(() => {
    if (!isFirebaseConfigured || !isAuthenticated) return;
    const unsub = onSnapshot(collection(db, "resources"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setResources(data);
    }, (err) => console.error("resources snapshot error:", err));
    return () => unsub();
  }, [isAuthenticated]);

  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    if (!isFirebaseConfigured || !isAuthenticated) return;
    const unsub = onSnapshot(collection(db, "sessions"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSessions(data);
    }, (err) => console.error("sessions snapshot error:", err));
    return () => unsub();
  }, [isAuthenticated]);

  const [suspendedIds, setSuspendedIds] = useState(() => {
    try {
      const stored = localStorage.getItem("suspended_members");
      if (stored) return JSON.parse(stored);
    } catch {}
    return MEMBERS.filter(m => m.inactive).map(m => m.id);
  });

  const [deletedIds, setDeletedIds] = useState(() => {
    try {
      const stored = localStorage.getItem("deleted_members");
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  const [customMembers, setCustomMembers] = useState(() => {
    try {
      const stored = localStorage.getItem("custom_members");
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  const [membersList, setMembersList] = useState(() => {
    const combined = [...MEMBERS, ...customMembers.filter(cm => !MEMBERS.some(m => m.id === cm.id))];
    return combined.map(m => ({
      ...m,
      active: !suspendedIds.includes(m.id) && !m.inactive,
      deleted: deletedIds.includes(m.id) || m.deleted || false
    }));
  });

  const [dbProfiles, setDbProfiles] = useState({});

  useEffect(() => {
    if (!isFirebaseConfigured) {
      try {
        const localActive = JSON.parse(localStorage.getItem("members_active_state") || "{}");
        const localDeleted = JSON.parse(localStorage.getItem("deleted_members") || "[]");
        const localCustom = JSON.parse(localStorage.getItem("custom_members") || "[]");

        const combined = [...MEMBERS, ...localCustom.filter(cm => !MEMBERS.some(m => m.id === cm.id))];

        setMembersList(combined.map(m => ({
          ...m,
          active: localActive[m.id] !== undefined ? localActive[m.id] : (!suspendedIds.includes(m.id) && !m.inactive),
          deleted: localDeleted.includes(m.id) || m.deleted || false
        })));
      } catch (e) {}
      return;
    }
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const dbUsersMap = new Map();
      const pMap = {};
      const customUsersFromDb = [];

      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        dbUsersMap.set(docSnap.id, data);
        if (data.profileImage) {
          pMap[docSnap.id] = data.profileImage;
        }
        if (!MEMBERS.some(m => m.id === docSnap.id) && data.name) {
          customUsersFromDb.push({
            id: docSnap.id,
            name: data.name,
            team: data.team || "ID",
            role: data.role || "디자이너",
            group: data.group || "staff",
            active: data.active !== false,
            deleted: data.deleted || false,
            isCustom: true
          });
        }
      });
      setDbProfiles(pMap);

      const combinedBase = [...MEMBERS, ...customUsersFromDb];
      setMembersList(combinedBase.map(m => {
        const uData = dbUsersMap.get(m.id);
        const isActive = uData?.active !== undefined ? uData.active : (!suspendedIds.includes(m.id) && !m.inactive);
        const isDeleted = uData?.deleted === true || deletedIds.includes(m.id) || m.deleted === true;
        return {
          ...m,
          ...(uData ? { name: uData.name || m.name, team: uData.team || m.team, role: uData.role || m.role, group: uData.group || m.group } : {}),
          active: isActive,
          deleted: isDeleted
        };
      }));
      window.dispatchEvent(new CustomEvent("profile_updated"));
    }, (err) => console.error("users snapshot error:", err));
    return () => unsub();
  }, [suspendedIds, deletedIds]);

  useEffect(() => {
    if (user && membersList.length > 0) {
      const me = membersList.find((m) => m.name === user);
      if (me && (me.active === false || me.deleted)) {
        showToast(me.deleted ? "삭제 처리된 계정입니다." : "정지된 계정입니다. 관리자에게 문의하세요.");
        setUser(null);
        localStorage.removeItem("auth_token");
        localStorage.removeItem("last_user");
      }
    }
  }, [user, membersList]);

  useEffect(() => {
    localStorage.setItem("suspended_members", JSON.stringify(suspendedIds));
    MEMBERS.forEach(m => {
      m.inactive = suspendedIds.includes(m.id);
    });
  }, [suspendedIds]);

  useEffect(() => {
    localStorage.setItem("deleted_members", JSON.stringify(deletedIds));
  }, [deletedIds]);

  const handleToggleMemberActive = async (memberId, currentActive) => {
    const newActive = currentActive === false ? true : false;

    setMembersList(prev => prev.map(m => m.id === memberId ? { ...m, active: newActive } : m));

    if (newActive) {
      setSuspendedIds(prev => prev.filter(x => x !== memberId));
    } else {
      setSuspendedIds(prev => prev.includes(memberId) ? prev : [...prev, memberId]);
    }

    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "users", memberId), {
          active: newActive,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to update active status:", err);
      }
    } else {
      try {
        const local = JSON.parse(localStorage.getItem("members_active_state") || "{}");
        local[memberId] = newActive;
        localStorage.setItem("members_active_state", JSON.stringify(local));
      } catch (e) {}
    }

    const target = membersList.find(m => m.id === memberId);
    showToast(newActive ? `${nameWithNim(target?.name || '멤버')} 계정 정지가 해제되었습니다.` : `${nameWithNim(target?.name || '멤버')} 계정이 정지되었습니다.`);
  };

  const handleAddMember = async (newMemberData) => {
    const newId = `m_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const memberObj = {
      id: newId,
      name: newMemberData.name.trim(),
      team: newMemberData.team || "ID",
      role: newMemberData.role || "디자이너",
      group: newMemberData.group || "staff",
      active: true,
      deleted: false,
      isCustom: true
    };

    setCustomMembers(prev => [...prev, memberObj]);
    try {
      const stored = JSON.parse(localStorage.getItem("custom_members") || "[]");
      localStorage.setItem("custom_members", JSON.stringify([...stored, memberObj]));
    } catch (e) {}

    setMembersList(prev => [...prev, memberObj]);

    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "users", newId), {
          ...memberObj,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to add member to Firestore:", err);
      }
    }

    showToast(`${nameWithNim(memberObj.name)} 계정이 추가되었습니다.`);
  };

  const handleDeleteMember = async (memberId) => {
    const target = membersList.find(m => m.id === memberId);

    setDeletedIds(prev => [...prev, memberId]);
    setMembersList(prev => prev.map(m => m.id === memberId ? { ...m, deleted: true, active: false } : m));

    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "users", memberId), {
          deleted: true,
          active: false,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to delete member in Firestore:", err);
      }
    }

    showToast(`${nameWithNim(target?.name || '멤버')} 계정이 삭제 처리되었습니다.`);
  };

  const getOwnerName = (r) => {
    if (!r) return "";
    const rawName = r.who || r.owner || r.user || r.userId;
    if (!rawName) {
      if (r.attendees && r.attendees.length > 0) {
        const firstAtt = r.attendees[0];
        const m = (membersList || MEMBERS).find(x => x.id === firstAtt || x.name === firstAtt);
        if (m) return m.name;
      }
      return "";
    }
    const m = (membersList || MEMBERS).find(x => x.id === rawName || x.name === rawName);
    return m ? m.name : rawName;
  };



  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return "dark";
    return "light";
  });
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const [section, setSection] = useState("book");
  const [announcements, setAnnouncements] = useState([]);
  const [announcementPanelOpen, setAnnouncementPanelOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [lastReadTime, setLastReadTime] = useState(() => Number(localStorage.getItem("announcement_last_read") || 0));
  const [userGuideSeen, setUserGuideSeen] = useState([]);

  useEffect(() => {
    const meId = MEMBERS.find(m => m.name === user)?.id;
    if (!meId) return;

    if (isFirebaseConfigured) {
      const unsub = onSnapshot(doc(db, "users", meId), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setUserGuideSeen(data.guideSeen || []);
        }
      }, (err) => console.error("users guideSeen snapshot error:", err));
      return () => unsub();
    } else {
      try {
        const local = JSON.parse(localStorage.getItem(`rsv_guide_${meId}`) || 'null');
        setUserGuideSeen(local?.seen || []);
      } catch (e) {
        setUserGuideSeen([]);
      }
    }
  }, [user]);

  const handleMarkGuideSeen = async (guideKey) => {
    const meId = MEMBERS.find(m => m.name === user)?.id;
    const updated = Array.from(new Set([...userGuideSeen, guideKey]));
    setUserGuideSeen(updated);

    if (isFirebaseConfigured && meId) {
      try {
        await setDoc(doc(db, "users", meId), {
          guideSeen: arrayUnion(guideKey),
          lastSeenAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to update guideSeen in Firestore:", err);
      }
    } else if (meId) {
      try {
        const existing = JSON.parse(localStorage.getItem(`rsv_guide_${meId}`) || '{}');
        localStorage.setItem(`rsv_guide_${meId}`, JSON.stringify({ ...existing, seen: updated, ver: '2026-07', lastSeenAt: Date.now() }));
      } catch (e) {}
    }
  };

  useEffect(() => {
    if (!isFirebaseConfigured) {
      try {
        const local = localStorage.getItem("announcements");
        setAnnouncements(local ? JSON.parse(local) : []);
      } catch {
        setAnnouncements([]);
      }
      return;
    }
    if (!isAuthenticated) return;
    const unsub = onSnapshot(collection(db, "announcements"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => b.createdAt - a.createdAt);
      setAnnouncements(data);
    }, (err) => console.error("announcements snapshot error:", err));
    return () => unsub();
  }, [isAuthenticated]);

  const hasUnreadAnn = useMemo(() => {
    const hasUnreadUpdate = UPDATE_NOTES.some(n => !userGuideSeen.includes(n.guide));
    return hasUnreadUpdate || announcements.some(a => a.createdAt > lastReadTime);
  }, [announcements, lastReadTime, userGuideSeen]);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [menuDrawerOpen, setMenuDrawerOpen] = useState(false);
  const [view, setView] = useState("timeline");
  const [anchor, setAnchor] = useState(() => dayOnly(new Date()));
  const [mineDate, setMineDate] = useState(() => keyOf(new Date()));
  const [roomId, setRoomId] = useState("big");
  const [dashMonth, setDashMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dashRoom, setDashRoom] = useState("all");
  const [openAttendanceId, setOpenAttendanceId] = useState(null);

  const today = dayOnly(now);
  const selKey = keyOf(anchor);
  const isToday = sameDay(anchor, today);
  const isCurMonth = anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const room = ROOMS.find((r) => r.id === roomId);

  const [rawReservations, setReservations] = useState(() => {
    if (!isFirebaseConfigured) {
      try {
        const local = localStorage.getItem("reservations");
        return local ? JSON.parse(local) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const allReservations = useMemo(() => {
    const todayKey = keyOf(today);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    
    // Group slots by groupId
    const grouped = new Map();
    const singles = [];
    
    const activeRaw = rawReservations.filter(r => r.status !== 'cancelled');
    activeRaw.forEach(r => {
      if (r.groupId) {
        if (!grouped.has(r.groupId)) {
          grouped.set(r.groupId, { ...r, _slots: [r.id], _starts: [toMin(r.start)], _ends: [toMin(r.end)] });
        } else {
          const g = grouped.get(r.groupId);
          g._slots.push(r.id);
          g._starts.push(toMin(r.start));
          g._ends.push(toMin(r.end));
        }
      } else {
        singles.push(r);
      }
    });
    
    const mergedGroups = Array.from(grouped.values()).map(g => {
      const minStart = Math.min(...g._starts);
      const maxEnd = Math.max(...g._ends);
      return { ...g, start: toHHMM(minStart), end: toHHMM(maxEnd) };
    });
    
    const allRes = [...singles, ...mergedGroups];

    return allRes.map(r => {
      if (r.date) {
        const isPastDay = r.date < todayKey;
        const isTodayOver30Min = r.date === todayKey && nowMin >= (toMin(r.start) + 30);
        
        if (isPastDay || isTodayOver30Min) {
          const ownerId = MEMBERS.find(m => m.name === r.owner && m.id !== "m_room")?.id;
          const attendees = (r.attendees || []).filter(id => id !== "m_room");
          const currentCheckedIn = (r.checkedIn || []).filter(id => id !== "m_room");
          const combined = Array.from(new Set([
            ...currentCheckedIn,
            ...attendees,
            ...(ownerId ? [ownerId] : [])
          ]));
          return { ...r, checkedIn: combined };
        }
      }
      return r;
    });
  }, [rawReservations, today, now]);

  const reservations = useMemo(() => {
    return allReservations.filter(r => r.status !== 'cancelled' && !r.title?.includes('Test Concurrency'));
  }, [allReservations]);

  // 노쇼 방지 (Auto-Cancel)
  useEffect(() => {
    if (!resources.length || !reservations.length || !sessions.length) return;
    
    const interval = setInterval(() => {
      const currentTime = new Date();
      reservations.forEach(r => {
        if (r.status !== 'booked') return;
        
        const resPolicy = resources.find(res => res.id === (r.resourceId || 'meeting-room'))?.policy;
        if (!resPolicy || !resPolicy.autoCancelMinutes) return;
        
        const [y, m, d] = r.date.split('-').map(Number);
        const [hh, mm] = r.start.split(':').map(Number);
        const startDt = new Date(y, m - 1, d, hh, mm);
        
        const elapsedMins = (currentTime - startDt) / (1000 * 60);
        if (elapsedMins > resPolicy.autoCancelMinutes) {
          const hasSession = sessions.some(s => s.reservationId === r.id);
          if (!hasSession) {
            if (r._slots) {
              const batch = writeBatch(db);
              r._slots.forEach(slotId => batch.update(doc(db, "reservations", slotId), { status: 'cancelled' }));
              batch.commit().catch(console.error);
            } else {
              updateDoc(doc(db, "reservations", r.id), { status: 'cancelled' }).catch(console.error);
            }
          }
        }
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [resources, reservations, sessions]);

  
  useEffect(() => {
    if (!isFirebaseConfigured || !isAuthenticated) return;
    const unsub = onSnapshot(collection(db, "reservations"), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReservations(data);
    }, (err) => console.error("reservations snapshot error:", err));
    return () => unsub();
  }, [isAuthenticated]);

  // Trigger ending notifications
  useEffect(() => {
    if (!isFirebaseConfigured || reservations.length === 0 || !user) return;
    const todayKey = keyOf(new Date());
    const nowM = now.getHours() * 60 + now.getMinutes();

    reservations.forEach(async (r) => {
      if (r.date !== todayKey || !r.start || !r.end) return;
      const endM = toMin(r.end);
      const startM = toMin(r.start);
      if (nowM < startM || nowM >= endM) return; // Only process active meetings

      const left = endM - nowM;
      
      const nextMeeting = reservations
        .filter(nr => nr.roomId === r.roomId && nr.date === todayKey && nr.id !== r.id && toMin(nr.start) >= endM)
        .sort((a, b) => toMin(a.start) - toMin(b.start))[0];
      
      let nextInfo = "";
      if (nextMeeting && (toMin(nextMeeting.start) - endM <= 30)) {
        nextInfo = ` (다음 예약: ${nextMeeting.start} ${nextMeeting.title})`;
      }
      
      if (left === 1 && !r.notified1m) {
        try {
          await runTransaction(db, async (transaction) => {
            const sfDocRef = doc(db, "reservations", r.id);
            const sfDoc = await transaction.get(sfDocRef);
            if (!sfDoc.exists() || sfDoc.data().notified1m) throw "Already notified";
            transaction.update(sfDocRef, { notified1m: true });
          });
          const roomName = ROOMS.find(rm => rm.id === r.roomId)?.name || r.roomId;
          const isPrinter = r.resourceId === 'bambu-1' || r.resourceId === 'bambu-2' || r.roomId === 'bambu-1' || r.roomId === 'bambu-2';
          const isMeeting = !r.roomId || ['big', 'small', 'lounge', 'meeting-room'].includes(r.roomId);

          let notifTitle = '⏱️ 사용 종료 1분 전입니다';
          if (isPrinter) {
            notifTitle = '⏱️ 3D 프린터 출력이 곧 완료됩니다!';
          } else if (isMeeting) {
            notifTitle = '⏱️ 회의 종료 1분 전입니다';
          }
          sendPushNotification(notifTitle, `[${roomName}] 이용 시간이 끝납니다.${nextInfo}`, Array.from(new Set([...(r.attendees || []), r.owner].filter(Boolean))));
        } catch(e) {}
      }
    });
  }, [now, reservations, user]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const localRes = localStorage.getItem("reservations");
    const migrated = localStorage.getItem("firestore_migrated_v3");
    if (localRes && !migrated) {
      try {
        const parsed = JSON.parse(localRes);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const promises = parsed.map((r) => {
            if (r.id) {
              return setDoc(doc(db, "reservations", r.id), r);
            }
            return Promise.resolve();
          });
          Promise.all(promises)
            .then(() => {
              localStorage.setItem("firestore_migrated_v3", "true");
              console.log("Local data successfully migrated to Firestore!");
            })
            .catch((err) => {
              console.error("Failed to migrate some local records:", err);
            });
        } else {
          localStorage.setItem("firestore_migrated_v3", "true");
        }
      } catch (err) {
        console.error("Local data migration error:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      localStorage.setItem("reservations", JSON.stringify(reservations));
    }
  }, [reservations]);

  const isMigratedRef = useRef(false);
  useEffect(() => {
    if (!isFirebaseConfigured && reservations.length > 0 && !isMigratedRef.current) {
      const seenIds = new Set();
      let hasDuplicates = false;
      const updated = reservations.map((r) => {
        if (!r.id || seenIds.has(r.id)) {
          hasDuplicates = true;
          return { ...r, id: nid() };
        }
        seenIds.add(r.id);
        return r;
      });

      if (hasDuplicates) {
        isMigratedRef.current = true;
        // eslint-disable-next-line
        setReservations(updated);
        showToast("중복 등록된 예약을 안전하게 개별 분리하여 복구했습니다.");
      }
    }
  }, [reservations]);

  const touchStart = useRef({ x: 0, y: 0 });
  const handleTouchStart = (e) => {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };
  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const diffX = e.changedTouches[0].clientX - touchStart.current.x;
    const diffY = e.changedTouches[0].clientY - touchStart.current.y;
    if (Math.abs(diffX) > 60 && Math.abs(diffY) < 50) {
      if (diffX > 0) {
        setAnchor(addDays(anchor, -1));
      } else {
        setAnchor(addDays(anchor, 1));
      }
    }
  };

  const [form, setForm] = useState(null);
  const selectedResource = useMemo(() => {
    if (!form) return null;
    const targetId = form.resourceId || form.roomId;
    const dbRes = resources.find(r => r.id === targetId);
    if (dbRes) return dbRes;
    const roomRes = ROOMS.find(r => r.id === targetId);
    if (roomRes) {
      return {
        id: roomRes.id,
        name: roomRes.name,
        type: 'space',
        policy: {
          requiresReservation: true,
          allowOverlap: false,
          allowUrgentOverride: true,
          capacity: roomRes.capacity,
          notice: []
        }
      };
    }
    return null;
  }, [form, resources]);
  const [showStartList, setShowStartList] = useState(false);
  const [showEndList, setShowEndList] = useState(false);
  const hasScrolledStartRef = useRef(false);
  const hasScrolledEndRef = useRef(false);

  useEffect(() => {
    if (!showStartList) hasScrolledStartRef.current = false;
  }, [showStartList]);

  useEffect(() => {
    if (!showEndList) hasScrolledEndRef.current = false;
  }, [showEndList]);
  const [errs, setErrs] = useState({});
  const [detail, setDetail] = useState(null);
  const [noticeTarget, setNoticeTarget] = useState(null);
  const [reportModalSession, setReportModalSession] = useState(null);
  const [confirmModalData, setConfirmModalData] = useState(null);
  const [checkedNotices, setCheckedNotices] = useState({});
  const [endCheckedNotices, setEndCheckedNotices] = useState({});
  const [reportForm, setReportForm] = useState({ result: 'success', filamentG: '', note: '' });
  const [toast, setToast] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [temp, setTemp] = useState([]);
  const [dz, setDz] = useState(false);
  const [isRoomDropdownOpen, setIsRoomDropdownOpen] = useState(false);
  const roomPickerRef = useRef(null);
  const dgScrollRef = useRef(null);

  useEffect(() => {
    if ((roomId === 'printer' || roomId === 'workroom') && section === "book") {
      const timer = setTimeout(() => {
        const scrollEl = dgScrollRef.current;
        if (!scrollEl) return;

        const currentSelKey = keyOf(anchor);
        const currentTodayKey = keyOf(new Date());
        const isToday = currentSelKey === currentTodayKey;

        if (isToday) {
          const nowM = now.getHours() * 60 + now.getMinutes();
          if (nowM >= 540) { // after 09:00
            const nowTop = ((nowM - 540) / 60) * 78;
            scrollEl.scrollTo({ top: Math.max(0, nowTop - 40), behavior: 'smooth' });
          } else {
            scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
        } else {
          const dayRes = reservations.filter(r => r.date === currentSelKey && (r.roomId === roomId || (roomId === 'printer' && (r.roomId === 'bambu-1' || r.roomId === 'bambu-2'))));
          if (dayRes.length > 0) {
            const minStartM = Math.min(...dayRes.map(r => toMin(r.start)));
            const startTop = Math.max(0, ((minStartM - 540) / 60) * 78);
            scrollEl.scrollTo({ top: Math.max(0, startTop - 40), behavior: 'smooth' });
          } else {
            scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [roomId, anchor, section, now]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isRoomDropdownOpen && roomPickerRef.current && !roomPickerRef.current.contains(e.target)) {
        setIsRoomDropdownOpen(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') setIsRoomDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isRoomDropdownOpen]);


  useEffect(() => {
    if (section === "book" && !showSplash) {
      const mobEl = document.getElementById(`mob-date-${keyOf(anchor)}`);
      const deskEl = document.getElementById(`desk-date-${keyOf(anchor)}`);

      const centerElement = (el) => {
        if (!el) return;
        const container = el.parentElement;
        if (!container || container.clientWidth === 0) return;
        const elementLeft = el.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
        container.scrollLeft = elementLeft - (container.clientWidth / 2) + (el.clientWidth / 2);
      };

      const observer = new ResizeObserver(() => {
        centerElement(mobEl);
        centerElement(deskEl);
      });

      if (mobEl && mobEl.parentElement) observer.observe(mobEl.parentElement);
      if (deskEl && deskEl.parentElement) observer.observe(deskEl.parentElement);

      // Trigger immediate and fallback timeouts
      centerElement(mobEl);
      centerElement(deskEl);
      const t1 = setTimeout(() => { centerElement(mobEl); centerElement(deskEl); }, 50);
      const t2 = setTimeout(() => { centerElement(mobEl); centerElement(deskEl); }, 150);
      const t3 = setTimeout(() => { centerElement(mobEl); centerElement(deskEl); }, 400);

      return () => {
        observer.disconnect();
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [section, anchor, showSplash]);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  const [authPending, setAuthPending] = useState(null);

  useEffect(() => {
    if (!user && !showSplash) {
      setAuthMsg("서비스를 이용하려면 로그인이 필요합니다.");
      setAuthOpen(true);
    }
  }, [user, showSplash]);
  
  // PWA & iOS install banner
  const [showIosBanner, setShowIosBanner] = useState(false);
  useEffect(() => {
    const isIos = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIos() && !isStandalone) {
      setShowIosBanner(true);
    }
  }, []);

const [dayEventsDate, setDayEventsDate] = useState(null);
  const [requestUrgentOpen, setRequestUrgentOpen] = useState(false);
  const [urgentMessage, setUrgentMessage] = useState("");

  useEffect(() => {
    const handleMessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'EXPO_PUSH_TOKEN' && isFirebaseConfigured) {
          const u = localStorage.getItem("last_user"); // Need to save last_user on login
          const meId = MEMBERS.find((m) => m.name === u)?.id;
          if (meId) {
             await setDoc(doc(db, "users", meId), { id: meId, expoPushToken: data.token }, { merge: true });
          }
        }
      } catch (e) {}
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        setDatePickerOpen(false);
        setMenuDrawerOpen(false);
        setForm(null);
        setDetail(null);
        setPickerOpen(false);
        setAuthOpen(false);
        setAuthPending(null);
        setShowProfileMenu(false);
        setDayEventsDate(null);
        setRequestUrgentOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const size = 300; // 300x300
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

        const meId = MEMBERS.find(m => m.name === user)?.id;
        if (isFirebaseConfigured && meId) {
          try {
            await setDoc(doc(db, "users", meId), {
              profileImage: dataUrl,
              updatedAt: serverTimestamp()
            }, { merge: true });
          } catch (err) {
            console.error("Failed to save profileImage to Firestore:", err);
          }
        }

        const updated = { ...profiles, [user]: dataUrl };
        setProfiles(updated);
        try {
          localStorage.setItem("profile_images", JSON.stringify(updated));
        } catch (e) {}
        window.dispatchEvent(new CustomEvent("profile_updated"));
        showToast("프로필 이미지를 변경했습니다.");
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleAddComment = async (resId, text) => {
    if (!user) {
      showToast("로그인이 필요합니다.");
      return;
    }
    if (!text || !text.trim()) return;
    
    const newComment = {
      id: nid(),
      user: user,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };
    
    const target = reservations.find(r => r.id === resId);
    if (!target) return;
    
    const updatedComments = [...(target.comments || []), newComment];
    const updatedRes = { ...target, comments: updatedComments };
    
    try {
      if (isFirebaseConfigured) {
        await updateDoc(doc(db, "reservations", resId), { comments: updatedComments });
      } else {
        setReservations(prev => prev.map(r => r.id === resId ? updatedRes : r));
      }
      
      if (detail && detail.id === resId) {
        setDetail(updatedRes);
      }
      if (form && form.id === resId) {
        setForm(updatedRes);
      }
      
      showToast("댓글을 등록했습니다.");
      
      const notifyIds = new Set(target.attendees || []);
      const ownerId = MEMBERS.find(m => m.name === target.owner)?.id;
      if (ownerId) notifyIds.add(ownerId);
      
      sendPushNotification('💬 새 댓글이 달렸어요', `${user}: ${text.trim()}`, [...Array.from(notifyIds), 'm_room']);
    } catch (err) {
      console.error(err);
      showToast("댓글 등록 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteComment = async (resId, commentId) => {
    if (!user) return;
    const target = reservations.find(r => r.id === resId);
    if (!target) return;
    
    const comment = (target.comments || []).find(c => c.id === commentId);
    if (!comment) return;
    if (comment.user !== user && user !== "admin" && user !== "회의실") {
      showToast("본인이 작성한 댓글만 삭제할 수 있습니다.");
      return;
    }
    
    const updatedComments = (target.comments || []).filter(c => c.id !== commentId);
    const updatedRes = { ...target, comments: updatedComments };
    
    try {
      if (isFirebaseConfigured) {
        await updateDoc(doc(db, "reservations", resId), { comments: updatedComments });
      } else {
        setReservations(prev => prev.map(r => r.id === resId ? updatedRes : r));
      }
      
      if (detail && detail.id === resId) {
        setDetail(updatedRes);
      }
      if (form && form.id === resId) {
        setForm(updatedRes);
      }
      
      showToast("댓글을 삭제했습니다.");
    } catch (err) {
      console.error(err);
      showToast("댓글 삭제 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteProfileImage = async () => {
    if (!user) return;
    const meId = MEMBERS.find(m => m.name === user)?.id;

    if (isFirebaseConfigured && meId) {
      try {
        await updateDoc(doc(db, "users", meId), {
          profileImage: deleteField(),
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to delete profileImage in Firestore:", err);
      }
    }

    const updated = { ...profiles };
    delete updated[user];
    setProfiles(updated);
    try {
      const x = localStorage.getItem("profile_images");
      const saved = x ? JSON.parse(x) : {};
      delete saved[user];
      localStorage.setItem("profile_images", JSON.stringify(saved));
    } catch (e) {}

    setShowProfileMenu(false);
    window.dispatchEvent(new CustomEvent("profile_updated"));
    showToast("기본 프로필 이미지로 되돌렸습니다.");
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [profiles, setProfiles] = useState(() => {
    try {
      const x = localStorage.getItem("profile_images");
      const saved = x ? JSON.parse(x) : {};
      return { ...defaultProfiles, ...saved };
    } catch { 
      return defaultProfiles; 
    }
  });
  const hasCustomProfileImage = useMemo(() => {
    if (!user) return false;
    try {
      const x = localStorage.getItem("profile_images");
      const saved = x ? JSON.parse(x) : {};
      return !!saved[user];
    } catch {
      return false;
    }
  }, [profiles, user]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const fileInputRef = useRef(null);
  
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef(null);
  const [exportMode, setExportMode] = useState("week");

  const handleExportPDF = async (mode) => {
    if (isExporting) return;
    setExportMode(mode);
    setIsExporting(true);
    showToast("PDF 리포트를 생성하고 있습니다. 잠시만 기다려 주세요...");

    setTimeout(async () => {
      const element = reportRef.current;
      if (!element) {
        showToast("에러: 출력 대상을 찾을 수 없습니다.");
        setIsExporting(false);
        return;
      }

      try {
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        const pdf = new jsPDF("p", "mm", "a4");
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        const rangeStr = mode === "week" ? "주간" : "월간";
        pdf.save(`${user}_회의실_사용내역_${rangeStr}.pdf`);
        showToast("PDF 리포트를 성공적으로 다운로드했습니다!");
      } catch (err) {
        console.error(err);
        showToast("PDF 생성 중 오류가 발생했습니다.");
      } finally {
        setIsExporting(false);
      }
    }, 800); // 렌더링 대기
  };

  const timelineScrollRef = useRef(null);

  useEffect(() => {
    if (view === "timeline" && section === "book" && timelineScrollRef.current) {
      const timer = setTimeout(() => {
        const today = new Date();
        const currentHourMin = today.getHours() * 60;
        if (sameDay(anchor, today)) {
          if (currentHourMin >= DAY_START && currentHourMin <= DAY_END) {
            const minutesFromStart = currentHourMin - DAY_START;
            const pixelOffset = minutesFromStart * (PX / STEP);
            timelineScrollRef.current.scrollTop = Math.max(0, pixelOffset);
          } else if (today.getHours() * 60 + today.getMinutes() > DAY_END) {
            timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
          } else {
            timelineScrollRef.current.scrollTop = 0;
          }
        } else {
          timelineScrollRef.current.scrollTop = 0;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [view, roomId, section, anchor]);


  const getMeId = () => { const u = user; const m = MEMBERS.find((x) => u && (x.name.includes(u) || u.includes(x.name))); return m ? m.id : null; };
  const isMine = (r) => !!user && r.owner === user;
  const canEdit = (r) => {
    if (!user) return false;
    if (user === "admin" || user === "회의실") return true;
    if (r.owner === user) return true;
    const meId = MEMBERS.find((m) => m.name === user)?.id;
    return !!(meId && r.attendees && r.attendees.includes(meId));
  };
  const canDelete = (r) => {
    if (!user) return false;
    if (user === "admin" || user === "회의실") return true;
    return r.owner === user;
  };
  function showToast(m) { setToast(m); setTimeout(() => setToast(null), 2600); }

  function requireAuth(fn, msg) { if (user) return fn(); setAuthMsg(msg || "계속하려면 로그인이 필요해요."); setAuthPending(() => fn); setAuthOpen(true); }
      function doLogin(name) { 
    setReservations((p) => p.map((r) => (r.owner === "나" ? { ...r, owner: name } : r))); 
    setUser(name); 
    localStorage.setItem("last_user", name);
    const token = { name: name, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 };
    localStorage.setItem("auth_token", btoa(unescape(encodeURIComponent(JSON.stringify(token)))));
    setAuthOpen(false); 
    const meId = MEMBERS.find((m) => m.name === name)?.id;
    if (meId) {
      subscribeToWebPush(meId);
    }
  }
  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("last_user");
    setSection("book");
    setMenuDrawerOpen(false);
  };
  useEffect(() => { if (user && authPending) { const p = authPending; setAuthPending(null); p(); } }, [user]); // eslint-disable-line

  const myRes = useMemo(() => {
    if (!user) return [];
    const meId = MEMBERS.find((m) => m.name === user)?.id;
    return reservations.filter((r) => {
      const isMine = r.owner === user || (meId && r.attendees && r.attendees.includes(meId));
      return isMine && r.date === mineDate;
    }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }, [reservations, user, mineDate, now, nowMin]);

  const myResAll = useMemo(() => {
    if (!user) return [];
    const meId = MEMBERS.find((m) => m.name === user)?.id;
    return reservations.filter((r) => {
      const isMine = r.owner === user || (meId && r.attendees && r.attendees.includes(meId));
      return isMine;
    }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }, [reservations, user, now, nowMin]);

  const myDashRes = useMemo(() => {
    if (!user) return [];
    const meId = MEMBERS.find((m) => m.name === user)?.id;
    return reservations.filter((r) => {
      return meId && r.attendees && r.attendees.includes(meId);
    });
  }, [reservations, user]);

  const byDate = useMemo(() => { const m = {}; reservations.forEach((r) => { (m[r.date] ||= []).push(r); }); return m; }, [reservations]);

  function roomStatus(rid) {
    const list = reservations.filter((r) => r.roomId === rid && r.date === selKey);
    if (isToday) {
      const cur = list.find((r) => toMin(r.start) <= nowMin && nowMin < toMin(r.end));
      if (cur) return { kind: "busy", text: `사용 중 · ~${cur.end}`, count: list.length };
      const next = list.filter((r) => toMin(r.start) > nowMin).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
      if (next) return { kind: "soon", text: `다음 ${next.start}`, count: list.length };
      return { kind: "free", text: "사용 가능", count: list.length };
    }
    return { kind: list.length ? "soon" : "free", text: list.length ? `예약 ${list.length}건` : "사용 가능", count: list.length };
  }
  const handleStartSession = async (res) => {
    const policy = resources.find(r => r.id === (res.resourceId || 'meeting-room'))?.policy;
    if (policy && policy.notice && policy.notice.length > 0 && !noticeTarget) {
      setNoticeTarget(res);
      return;
    }
    
    if (isFirebaseConfigured) {
      await addDoc(collection(db, "sessions"), {
        resourceId: res.resourceId || 'meeting-room',
        userId: user,
        reservationId: res.id,
        checkInAt: serverTimestamp(),
        source: 'button'
      });
      showToast("사용을 시작했습니다.");
      setDetail(null);
    }
  };

  const handleEndSession = async (sessionOrId) => {
    const sessionObj = typeof sessionOrId === 'string' ? sessions.find(s => s.id === sessionOrId) : sessionOrId;
    const sessionId = sessionObj?.id || sessionOrId;
    const resInfo = resources.find(r => r.id === (sessionObj?.resourceId || detail?.resourceId || detail?.roomId));
    const policy = resInfo?.policy;

    const isWorkroom = sessionObj?.resourceId === 'workroom' || detail?.resourceId === 'workroom' || detail?.roomId === 'workroom';
    const isPrinter = sessionObj?.resourceId === 'bambu-1' || sessionObj?.resourceId === 'bambu-2' || detail?.resourceId === 'bambu-1' || detail?.resourceId === 'bambu-2' || detail?.roomId === 'bambu-1' || detail?.roomId === 'bambu-2' || resInfo?.type === 'equipment';

    if (policy?.requiresReport || isWorkroom || isPrinter) {
      setReportModalSession(sessionObj || { id: sessionId, resourceId: sessionObj?.resourceId || resInfo?.id || detail?.resourceId || detail?.roomId });
      setEndCheckedNotices({});
      setReportForm({ result: 'success', filamentG: '', note: '' });
      return;
    }

    if (isFirebaseConfigured) {
      await updateDoc(doc(db, "sessions", sessionId), {
        checkOutAt: serverTimestamp(),
        autoClosed: false
      });
      showToast("사용을 종료했습니다.");
      setDetail(null);
    }
  };

  const submitSessionReport = async () => {
    if (!reportModalSession) return;
    const sessionId = reportModalSession.id;
    if (isFirebaseConfigured) {
      await updateDoc(doc(db, "sessions", sessionId), {
        checkOutAt: serverTimestamp(),
        autoClosed: false,
        report: {
          result: reportForm.result || 'success',
          filamentG: Number(reportForm.filamentG) || 0,
          note: reportForm.note || ''
        }
      });
      showToast("리포트 제출과 함께 사용이 종료되었습니다.");
      setReportModalSession(null);
      setDetail(null);
    }
  };

  function overlaps(rid, date, s, e, ignore) {
    const a = toMin(s), b = toMin(e);
    const effectiveRoomId = (rid === 'meeting-room' || !rid) ? 'big' : rid;
    const roomDef = ROOMS.find(r => r.id === effectiveRoomId) || ROOMS.find(r => r.id === 'big') || {};
    const targetPolicyId = roomDef.group === 'meeting' ? 'meeting-room' : effectiveRoomId;
    const resInfo = resources.find(r => r.id === targetPolicyId);
    const isOverlapAllowed = resInfo?.policy?.allowOverlap;
    const capacity = roomDef.capacity || (effectiveRoomId === 'workroom' ? 3 : 8);

    const conflicts = reservations.filter(
      (r) => r.roomId === rid && r.date === date && r.id !== ignore && !(b <= toMin(r.start) || a >= toMin(r.end))
    );

    if (isOverlapAllowed) {
      return conflicts.length >= capacity;
    }
    return conflicts.length > 0;
  }
  const defStart = () => Math.min(Math.max(isToday ? Math.ceil(nowMin / STEP) * STEP : 10 * 60, DAY_START), DAY_END - 10);
  function openCreate(rid, startMin, date) {
    setErrs({});
    const me = getMeId();
    const targetId = (rid === 'all' || rid === 'meeting-room') ? 'big' : rid;
    setForm({ id: null, roomId: targetId, resourceId: targetId === 'workroom' ? 'workroom' : 'meeting-room', title: "", date: date || selKey, start: toHHMM(startMin), end: toHHMM(Math.min(startMin + 10, DAY_END)), attendees: me && me !== "m_room" ? [me] : [], repeat: false, color: "yellow", isUrgent: false, comments: [], status: 'booked' });
  }
  const tryCreate = (rid, sm, date) => requireAuth(() => openCreate(rid, sm, date), "일정을 추가하려면 로그인이 필요해요.");
  const openEdit = (r) => {
    setErrs({});
    const targetId = (r.roomId === 'meeting-room' || !r.roomId) ? 'big' : r.roomId;
    setForm({ ...r, roomId: targetId, attendees: [...r.attendees] });
  };

    async function saveForm() {
    if (isSubmitting) return;
    const effectiveRoomId = (form.roomId === 'meeting-room' || !form.roomId) ? 'big' : form.roomId;
    const roomDef = ROOMS.find(r => r.id === effectiveRoomId) || ROOMS.find(r => r.id === 'big') || {};
    const targetRes = resources.find(r => r.id === effectiveRoomId) || resources.find(r => r.id === form.resourceId);
    const policy = targetRes?.policy || {};
    const openFromMin = policy.openHours ? toMin(policy.openHours.from) : DAY_START;
    const openToMin = policy.openHours ? toMin(policy.openHours.to) : DAY_END;
    const allowedDays = policy.openHours?.days || [1, 2, 3, 4, 5];
    const cap = roomDef.capacity || (effectiveRoomId === 'workroom' ? 3 : 8);

    const f = form; const e = {};
    const cleanedAttendees = (f.attendees || []).filter(id => id !== "m_room");
    if (!f.title.trim()) e.title = "예약 목적(제목)을 입력해주세요.";
    if (!f.start || !f.end) e.time = "시간을 정확히 입력해주세요.";
    else if (isNaN(toMin(f.start)) || isNaN(toMin(f.end))) e.time = "시간 형식(예: 14:00)을 올바르게 입력해주세요.";
    else if (f.start === f.end) e.time = "시작 시간과 종료 시간이 같습니다.";
    else if (openFromMin !== undefined && openToMin !== undefined && (openFromMin !== 0 || openToMin !== 1440)) {
      const startM_check = toMin(f.start);
      const rawEndM_check = toMin(f.end);
      const isNextDay_check = rawEndM_check <= startM_check;
      const endM_check = isNextDay_check ? rawEndM_check + 1440 : rawEndM_check;
      if (startM_check < openFromMin || (!isNextDay_check && endM_check > openToMin) || (isNextDay_check && endM_check > openToMin + 1440)) {
        e.time = `운영 시간(${toHHMM(openFromMin)} ~ ${toHHMM(openToMin)}) 내로 설정해주세요.`;
      }
    } else {
      const d = new Date(f.date);
      if (!allowedDays.includes(d.getDay())) {
        e.time = "해당 자원은 선택하신 요일(주말 등)에 운영하지 않습니다.";
      }
    }
    if (cleanedAttendees.length === 0) e.att = "참석자(또는 사용자)를 1명 이상 선택해주세요.";
    if (cleanedAttendees.length > cap) e.att = `정원(${cap}명)을 초과했습니다.`;
    setErrs(e);
    if (Object.keys(e).length) return;

    const startM = toMin(f.start);
    const rawEndM = toMin(f.end);
    const isNextDay = rawEndM <= startM && rawEndM !== startM;
    const endM = isNextDay ? rawEndM + 1440 : rawEndM;
    let pushedReservations = [];

    const roomOverlaps = reservations.filter((r) => {
      const rEffRoomId = (r.roomId === 'meeting-room' || !r.roomId) ? 'big' : r.roomId;
      const fEffRoomId = (f.roomId === 'meeting-room' || !f.roomId) ? 'big' : f.roomId;
      if (rEffRoomId !== fEffRoomId) return false;
      if (r.id === f.id) return false; // Exclude exact same monolithic reservation
      if (f.id && r.groupId === f.id) return false; // If editing a group (f.id is docId), exclude its slots
      if (f.groupId && r.groupId === f.groupId) return false; // If editing a slot directly (f.groupId exists)

      const rStartM = toMin(r.start);
      const rRawEndM = toMin(r.end);
      const rIsNextDay = rRawEndM <= rStartM && rRawEndM !== rStartM;
      const rEndM = rIsNextDay ? rRawEndM + 1440 : rRawEndM;

      if (r.date === f.date) {
        if (!(endM <= rStartM || startM >= rEndM)) return true;
      }
      if (isNextDay && r.date === keyOf(addDays(f.date, 1))) {
        if (!(rawEndM <= rStartM || 0 >= rEndM)) return true;
      }
      return false;
    });
    
    console.log('겹침검사:', {
      내roomId: f.roomId,
      전체예약수: reservations.length,
      같은방예약: reservations.filter(r => {
        const rEffRoomId = (r.roomId === 'meeting-room' || !r.roomId) ? 'big' : r.roomId;
        const fEffRoomId = (f.roomId === 'meeting-room' || !f.roomId) ? 'big' : f.roomId;
        return rEffRoomId === fEffRoomId && r.date === f.date;
      }).map(r => ({id: r.id, roomId: r.roomId, start: r.start, end: r.end, status: r.status, owner: r.owner})),
      roomOverlaps: roomOverlaps.map(r => r.id)
    });
    
    if (policy.allowOverlap) {
      if (roomOverlaps.length >= cap) {
        setErrs({ ...e, time: `그 시간에는 정원이 찼습니다 (${cap}명)` });
        return;
      }
    } else if (roomOverlaps.length > 0) {
      if (policy.allowUrgentOverride) {
        if (!f.isUrgent) {
          setErrs({ ...e, time: "선택한 시간에 이미 다른 예약이 있어요. (중요 회의로 설정하면 기존 예약을 미룰 수 있습니다)" });
          return;
        } else {
          // Pushing existing normal meetings
          const hasUrgentOverlap = roomOverlaps.some(r => r.isUrgent);
          if (hasUrgentOverlap) {
            setErrs({ ...e, time: "선택한 시간에 이미 다른 중요 회의가 있어서 밀어낼 수 없습니다." });
            return;
          }
          
          // Push logic: move them right after this meeting
          let currentPushTime = endM;
          const sortedOverlaps = roomOverlaps.sort((a, b) => toMin(a.start) - toMin(b.start));
          
          for (const overlap of sortedOverlaps) {
            const duration = toMin(overlap.end) - toMin(overlap.start);
            const pushedStart = currentPushTime;
            const pushedEnd = pushedStart + duration;
            
            if (pushedEnd > DAY_END) {
               setErrs({ ...e, time: "기존 예약을 밀어내면 운영 시간(22:00)을 초과하게 됩니다." });
               return;
            }
            
            pushedReservations.push({
              ...overlap,
              start: toHHMM(pushedStart),
              end: toHHMM(pushedEnd)
            });
            currentPushTime = pushedEnd;
          }
        }
      } else {
        setErrs({ ...e, time: "선택한 시간에 이미 다른 예약이 있어요." });
        return;
      }
    }

    const isFormPrinter = f.resourceId === 'bambu-1' || f.resourceId === 'bambu-2' || f.roomId === 'bambu-1' || f.roomId === 'bambu-2';
    
    if (!isFormPrinter) {
      const conflicts = [];
      reservations.forEach((r) => {
        const rEffRoomId = (r.roomId === 'meeting-room' || !r.roomId) ? 'big' : r.roomId;
        const isRPrinter = r.resourceId === 'bambu-1' || r.resourceId === 'bambu-2' || rEffRoomId === 'bambu-1' || rEffRoomId === 'bambu-2';
        const isSameRes = r.id === f.id || (f.id && r.groupId === f.id) || (f.groupId && r.groupId === f.groupId);
        if (!isSameRes && r.date === f.date && !isRPrinter) {
          if (!(endM <= toMin(r.start) || startM >= toMin(r.end))) {
            cleanedAttendees.forEach((attId) => {
              if (r.attendees && r.attendees.includes(attId)) {
                const mName = MEMBERS.find((m) => m.id === attId)?.name || attId;
                const rRoomName = ROOMS.find((rm) => rm.id === rEffRoomId)?.name || rEffRoomId;
                conflicts.push(`${nameWithNim(mName)} (${rRoomName} / ${r.start}~${r.end} "${r.title}")`);
              }
            });
          }
        }
      });

      if (conflicts.length > 0) {
        alert(`선택하신 참석자 중 해당 시간에 이미 다른 공간 일정(회의실/워크룸)이 예약되어 있는 멤버가 있습니다:\n\n${conflicts.join("\n")}\n\n시간을 변경하거나 참석자 조정을 해주세요.`);
        return;
      }
    }
    
    setIsSubmitting(true);
    try {
      const isEdit = !!f.id;
      const docId = f.id || nid();
      const cleanedCheckedIn = (f.checkedIn || []).filter(id => cleanedAttendees.includes(id));
      const finalForm = { ...f, id: docId, title: f.title.trim(), owner: f.owner || user, attendees: cleanedAttendees, checkedIn: cleanedCheckedIn };
      
      if (isFirebaseConfigured) {
        const resInfo = resources.find(r => r.id === (finalForm.resourceId || 'meeting-room'));
        const policy = resInfo?.policy || { slotMinutes: 30, allowOverlap: false, capacity: 1 };
        
        const startM = toMin(finalForm.start);
        const rawEndM = toMin(finalForm.end);
        const isNextDay = rawEndM <= startM && rawEndM !== startM;
        const endM = isNextDay ? rawEndM + 1440 : rawEndM;
        const slotsCount = Math.ceil((endM - startM) / policy.slotMinutes);
        const dateStr = finalForm.date.replace(/-/g, '');
        const batch = writeBatch(db);
        const ops = [];
        
        const myBatchUpdate = (docRef, data) => {
          ops.push({ type: 'update', id: docRef.id, data });
          batch.update(docRef, data);
        };
        const myBatchSet = (docRef, data) => {
          ops.push({ type: 'set', id: docRef.id, owner: data.owner, ownerId: data.ownerId, data });
          batch.set(docRef, data);
        };
        
        const groupId = isEdit ? (finalForm.groupId || docId) : docId;
        finalForm.groupId = groupId;
        
        if (isEdit) {
          if (f._slots) {
            f._slots.forEach(slotId => {
              const exists = rawReservations.some(r => r.id === slotId);
              if (exists) {
                console.log('예약 수정 중 기존 슬롯 상태 cancelled 로 업데이트:', slotId);
                myBatchUpdate(doc(db, "reservations", slotId), { status: 'cancelled' });
              } else {
                console.log('예약 수정 중 기존 슬롯이 존재하지 않아 건너뜀:', slotId);
              }
            });
          } else {
            const exists = rawReservations.some(r => r.id === docId);
            if (exists) {
              console.log('예약 수정 중 구형 통문서 상태 cancelled 로 업데이트:', docId);
              myBatchUpdate(doc(db, "reservations", docId), { status: 'cancelled' });
            } else {
              console.log('예약 수정 중 구형 통문서가 존재하지 않아 건너뜀:', docId);
            }
          }
        }
        
        let seatNum = null;
        if (policy.allowOverlap) {
          const activeSlots = reservations.filter(r => r.roomId === finalForm.roomId && r.date === finalForm.date && r.status === 'booked' && r.groupId !== groupId && !(endM <= toMin(r.start) || startM >= toMin(r.end)));
          const usedSeats = new Set(activeSlots.map(r => r.id.split('_').pop()));
          for (let i = 1; i <= policy.capacity; i++) {
            if (!usedSeats.has(i.toString())) {
              seatNum = i;
              break;
            }
          }
          if (!seatNum) {
            setErrs({ ...e, time: "해당 시간에 이미 만석입니다." });
            setIsSubmitting(false);
            return;
          }
        }
        
        for (let i = 0; i < slotsCount; i++) {
          const currentSlotStartMin = startM + (i * policy.slotMinutes);
          const currentSlotEndMin = Math.min(currentSlotStartMin + policy.slotMinutes, endM);

          const dayOffset = Math.floor(currentSlotStartMin / 1440);
          const slotStartDayMin = currentSlotStartMin % 1440;
          const slotEndDayMin = currentSlotEndMin > (dayOffset + 1) * 1440 ? 1440 : (currentSlotEndMin % 1440 || 1440);

          const slotDate = dayOffset > 0 ? keyOf(addDays(finalForm.date, dayOffset)) : finalForm.date;
          const slotDateStr = slotDate.replace(/-/g, '');
          const slotIndex = Math.floor(slotStartDayMin / policy.slotMinutes);
          
          let slotId = `${finalForm.roomId}_${slotDateStr}_${slotIndex}`;
          if (seatNum) {
            slotId += `_${seatNum}`;
          }
          
          const slotData = {
            ...finalForm,
            id: slotId,
            date: slotDate,
            start: toHHMM(slotStartDayMin),
            end: toHHMM(slotEndDayMin)
          };
          delete slotData._slots;
          delete slotData._starts;
          delete slotData._ends;
          
          myBatchSet(doc(db, "reservations", slotId), slotData);
        }
        
        for (const pushed of pushedReservations) {
          console.log('밀어내기 대상:', pushed.id, 'owner:', pushed.owner, 'ownerId:', pushed.ownerId);
          if (pushed._slots) {
            pushed._slots.forEach(slotId => {
              const exists = rawReservations.some(r => r.id === slotId);
              if (exists) {
                console.log('밀어내기 대상 슬롯 취소 중:', slotId);
                myBatchUpdate(doc(db, "reservations", slotId), { status: 'cancelled' });
              }
            });
            const pStartM = toMin(pushed.start);
            const pEndM = toMin(pushed.end);
            const pSlotsCount = Math.ceil((pEndM - pStartM) / policy.slotMinutes);
            for (let i = 0; i < pSlotsCount; i++) {
              const currentSlotStartMin = pStartM + (i * policy.slotMinutes);
              const currentSlotEndMin = Math.min(currentSlotStartMin + policy.slotMinutes, pEndM);
              const slotIndex = Math.floor(currentSlotStartMin / policy.slotMinutes);
              let slotId = `${pushed.roomId}_${dateStr}_${slotIndex}`;
              const slotData = { ...pushed, id: slotId, start: toHHMM(currentSlotStartMin), end: toHHMM(currentSlotEndMin) };
              delete slotData._slots; delete slotData._starts; delete slotData._ends;
              console.log('밀어낸 새 슬롯 생성 중:', slotId);
              myBatchSet(doc(db, "reservations", slotId), slotData);
            }
          } else {
            const exists = rawReservations.some(r => r.id === pushed.id);
            if (exists) {
              console.log('밀어내기 통문서(옛 포맷) 변경 중:', pushed.id);
              myBatchUpdate(doc(db, "reservations", pushed.id), { start: pushed.start, end: pushed.end });
            } else {
              console.log('밀어내기 통문서가 존재하지 않아 건너뜀:', pushed.id);
            }
          }
        }
        
        console.log('BATCH:', ops);
        try {
          console.log('배치 쓰기(commit) 시작');
          await batch.commit();
          console.log('배치 쓰기 성공!');
        } catch (commitErr) {
          console.error('Batch Commit Error Code:', commitErr.code);
          console.error('Batch Commit Error Message:', commitErr.message);
          throw commitErr;
        }
      } else {
        setReservations((prev) => {
          let updated = [...prev];
          if (isEdit) {
            updated = updated.map(r => r.id === docId ? finalForm : r);
          } else {
            updated.push(finalForm);
          }
          pushedReservations.forEach(pushed => {
            updated = updated.map(r => r.id === pushed.id ? pushed : r);
          });
          return updated;
        });
      }
      
      showToast(isEdit ? "예약을 수정했어요." : "예약이 완료됐어요.");
      
      // Push Notifications
      if (user !== "admin") {
        const resIdToUse = effectiveRoomId || f.resourceId || f.roomId;
        const resInfo = resources.find(r => r.id === resIdToUse) || {};
        const targetRoomName = resInfo.name || ROOMS.find(r => r.id === resIdToUse)?.name || '회의실';
        
        let resourceTypeName = '회의실';
        if (resInfo.type === 'equipment' || targetRoomName.includes('프린터') || targetRoomName.includes('뱀부랩')) {
          resourceTypeName = '3D 프린터';
        } else if (resIdToUse?.includes('workroom') || targetRoomName.includes('워크룸')) {
          resourceTypeName = '워크룸';
        }

        let notifyTargetIds = Array.from(new Set([...(cleanedAttendees || []), getMeId()].filter(Boolean)));
        if (resourceTypeName === '3D 프린터') {
          notifyTargetIds = MEMBERS.map(m => m.id).filter(id => !["m_guest", "m_client", "m_room"].includes(id));
        }

        const notifTitle = isEdit ? `✏️ ${resourceTypeName} 일정이 변경됐어요` : `📅 ${resourceTypeName} 사용 예약이 완료되었습니다`;
        const actionVerb = isEdit ? '일정을 변경했습니다' : '예약했습니다';
        const notifBody = `${nameWithNim(user)}이 ${actionVerb}. [${targetRoomName}] ${f.date} ${f.start}~${f.end}`;

        sendPushNotification(notifTitle, notifBody, notifyTargetIds);

        pushedReservations.forEach(pushed => {
           const roomName = ROOMS.find(r=>r.id===pushed.roomId)?.name || pushed.roomId;
           const msg = f.urgentComment ? `[${f.urgentComment}] 기존 일정은 ${pushed.start}로 밀렸습니다.` : `[${roomName}] 일정이 ${pushed.start}로 밀렸어요.`;
           const pushedTargets = Array.from(new Set([...(pushed.attendees || []), pushed.ownerId || pushed.owner].filter(Boolean)));
           sendPushNotification('🚨 중요 회의로 일정이 밀렸어요', msg, pushedTargets);
        });
      }

      setForm(null);
    } catch (err) {
      console.error(err);
      showToast("오류가 발생했습니다: " + (err.message || err.toString()));
    } finally {
      setIsSubmitting(false);
    }
  }
  function cancelRes(id) { 
    const target = reservations.find((x) => x.id === id);
    if (target && !canDelete(target)) {
      showToast("예약 등록자 본인만 일정을 취소할 수 있어요.");
      return;
    }
    requireAuth(async () => { 
      if (isFirebaseConfigured) {
        try {
          if (target._slots) {
            const batch = writeBatch(db);
            target._slots.forEach(slotId => batch.update(doc(db, "reservations", slotId), { status: 'cancelled' }));
            await batch.commit();
          } else {
            await updateDoc(doc(db, "reservations", id), { status: 'cancelled' });
          }
          setForm(null); setDetail(null); showToast("예약을 취소했어요."); 
        } catch (err) {
          console.error(err);
          showToast("오류가 발생했습니다: " + (err.message || err.toString()));
        }
      } else {
        setReservations((prev) => prev.map((r) => {
          if (target.groupId && r.groupId === target.groupId) {
            return { ...r, status: 'cancelled' };
          }
          if (r.id === id) {
            return { ...r, status: 'cancelled' };
          }
          return r;
        }));
        setForm(null); setDetail(null); showToast("예약을 취소했어요.");
      }
    }, "일정을 취소하려면 로그인이 필요해요."); 
  }

  function completeRes(r) {
    requireAuth(() => {
      if (r.date !== keyOf(today)) {
        showToast("오늘 일정만 즉시 완료할 수 있어요.");
        return;
      }
      const nowM = now.getHours() * 60 + now.getMinutes();
      const startM = toMin(r.start);
      const endM = toMin(r.end);
      if (nowM < startM) {
        showToast("아직 시작하지 않은 회의입니다.");
        return;
      }
      if (nowM >= endM) {
        showToast("이미 종료된 회의입니다.");
        return;
      }
      const newEnd = Math.max(startM + 1, nowM);
      
      if (isFirebaseConfigured) {
        (async () => {
          if (r._slots) {
            const batch = writeBatch(db);
            r._slots.forEach(slotId => batch.update(doc(db, "reservations", slotId), { end: toHHMM(newEnd) }));
            await batch.commit();
          } else {
            await updateDoc(doc(db, "reservations", r.id), { end: toHHMM(newEnd) });
          }
        })().then(() => {
          showToast("회의를 완료 처리했어요.");
        }).catch(err => {
          console.error(err);
          showToast("오류가 발생했습니다.");
        });
      } else {
        setReservations((prev) => prev.map((item) => item.id === r.id ? { ...item, end: toHHMM(newEnd) } : item));
        showToast("회의를 완료 처리했어요.");
      }
    }, "회의를 완료하려면 로그인이 필요해요.");
  }

    function extendRes(r, mins) {
    requireAuth(() => {
      const endM = toMin(r.end);
      const newEndM = endM + mins;
      if (newEndM > DAY_END) {
        showToast("운영 시간이 초과되어 연장할 수 없어요.");
        return;
      }
      
      const isOverlap = overlaps(r.roomId, r.date, toHHMM(endM), toHHMM(newEndM), r.id);
      if (isOverlap) {
         if(!window.confirm("⚠️ 이후 예약이 있습니다. 그래도 강제로 연장하시겠습니까? (다음 예약자에게 알림이 전송됩니다)")) {
            return;
         }
      }
      
      if (isFirebaseConfigured) {
        (async () => {
          if (r._slots) {
            const resInfo = resources.find(res => res.id === (r.resourceId || 'meeting-room'));
            const policy = resInfo?.policy || { slotMinutes: 30, allowOverlap: false, capacity: 1 };
            const startM = toMin(r.start);
            const slotsCount = Math.ceil((newEndM - startM) / policy.slotMinutes);
            const dateStr = r.date.replace(/-/g, '');
            
            let seatNum = null;
            if (policy.allowOverlap && r._slots.length > 0) {
              const parts = r._slots[0].split('_');
              seatNum = parts[parts.length - 1];
            }
            
            const batch = writeBatch(db);
            r._slots.forEach(slotId => batch.delete(doc(db, "reservations", slotId)));
            
            for (let i = 0; i < slotsCount; i++) {
              const currentSlotStartMin = startM + (i * policy.slotMinutes);
              const currentSlotEndMin = Math.min(currentSlotStartMin + policy.slotMinutes, newEndM);
              const slotIndex = Math.floor(currentSlotStartMin / policy.slotMinutes);
              let slotId = `${r.resourceId || 'meeting-room'}_${dateStr}_${slotIndex}`;
              if (seatNum) slotId += `_${seatNum}`;
              const slotData = { ...r, id: slotId, start: toHHMM(currentSlotStartMin), end: toHHMM(currentSlotEndMin) };
              delete slotData._slots; delete slotData._starts; delete slotData._ends;
              batch.set(doc(db, "reservations", slotId), slotData);
            }
            await batch.commit();
          } else {
            await updateDoc(doc(db, "reservations", r.id), { end: toHHMM(newEndM) });
          }
        })().then(() => {
          showToast(`회의를 ${mins}분 연장했어요.`);
          if(isOverlap && user !== "admin") {
             const overlapsNext = reservations.filter(x => x.roomId === r.roomId && x.date === r.date && x.id !== r.id && !(toMin(x.end) <= endM || toMin(x.start) >= newEndM));
             overlapsNext.forEach(ov => {
               sendPushNotification('✏️ 회의 일정이 변경됐어요', `${nameWithNim(user)}의 회의 연장으로 인해 일정이 겹쳤습니다. [${ROOMS.find(rm=>rm.id===ov.roomId)?.name}] 확인해주세요.`, ov.attendees);
             });
          }
        }).catch(err => {
          console.error(err);
          showToast("오류가 발생했습니다.");
        });
      } else {
        setReservations((prev) => prev.map((item) => item.id === r.id ? { ...item, end: toHHMM(newEndM) } : item));
        showToast(`회의를 ${mins}분 연장했어요.`);
      }
    }, "회의를 연장하려면 로그인이 필요해요.");
  }

  const toggleAttendance = (r) => {
    requireAuth(async () => {
      const meId = MEMBERS.find(m => m.name === user)?.id;
      if (user === "admin" || user === "회의실" || meId === "m_room") {
        showToast("회의실 계정과 관리자 계정은 참석 확인을 할 수 없어요.");
        return;
      }
      if (!meId) return;
      if (!r.attendees || !r.attendees.includes(meId)) {
        showToast("회의 참석자만 참석 확인을 할 수 있어요.");
        return;
      }
      const newCheckedIn = r.checkedIn?.includes(meId)
        ? r.checkedIn.filter(id => id !== meId)
        : [...(r.checkedIn || []), meId];
      
      if (isFirebaseConfigured) {
        try {
          if (r._slots) {
            const batch = writeBatch(db);
            r._slots.forEach(slotId => batch.update(doc(db, "reservations", slotId), { checkedIn: newCheckedIn }));
            await batch.commit();
          } else {
            await updateDoc(doc(db, "reservations", r.id), { checkedIn: newCheckedIn });
          }
          showToast(r.checkedIn?.includes(meId) ? "참석 확인을 취소했어요." : "참석을 확인했어요.");
        } catch (err) {
          console.error(err);
          showToast("참석 확인 중 오류가 발생했습니다.");
        }
      } else {
        setReservations(prev => prev.map(item => item.id === r.id ? { ...item, checkedIn: newCheckedIn } : item));
        showToast(r.checkedIn?.includes(meId) ? "참석 확인을 취소했어요." : "참석을 확인했어요.");
      }
    }, "참석을 확인하려면 로그인이 필요해요.");
  };

  const saveAnnouncement = async (text, id = null) => {
    if (!text.trim()) return;
    const docId = id || nid();
    const finalAnn = {
      id: docId,
      text: text.trim(),
      createdAt: id ? (announcements.find(a => a.id === id)?.createdAt || Date.now()) : Date.now()
    };
    
    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "announcements", docId), finalAnn);
        showToast(id ? "공지사항을 수정했습니다." : "새 공지사항을 등록했습니다.");
      } catch (err) {
        console.error(err);
        showToast("오류가 발생했습니다.");
      }
    } else {
      setAnnouncements(prev => {
        let updated = [...prev];
        if (id) {
          updated = updated.map(a => a.id === docId ? finalAnn : a);
        } else {
          updated.unshift(finalAnn);
        }
        localStorage.setItem("announcements", JSON.stringify(updated));
        return updated;
      });
      showToast(id ? "공지사항을 수정했습니다." : "새 공지사항을 등록했습니다.");
    }
    setEditingAnnouncement(null);
  };

  const deleteAnnouncement = async (id) => {
    if (!window.confirm("공지사항을 삭제하시겠습니까?")) return;
    if (isFirebaseConfigured) {
      try {
        await deleteDoc(doc(db, "announcements", id));
        showToast("공지사항을 삭제했습니다.");
      } catch (err) {
        console.error(err);
        showToast("오류가 발생했습니다.");
      }
    } else {
      setAnnouncements(prev => {
        const updated = prev.filter(a => a.id !== id);
        localStorage.setItem("announcements", JSON.stringify(updated));
        return updated;
      });
      showToast("공지사항을 삭제했습니다.");
    }
  };

  function openPicker() { setTemp([...(form.attendees || [])]); setPickerOpen(true); }
  const toggleTemp = (id) => setTemp((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const addTemp = (id) => setTemp((p) => (id && !p.includes(id) ? [...p, id] : p));
  function donePicker() { setForm((f) => ({ ...f, attendees: [...temp] })); setErrs((e) => ({ ...e, att: undefined })); setPickerOpen(false); }

  const onBlockClick = (r) => (canEdit(r) ? openEdit(r) : setDetail(r));

  /* ----- timeline renderers ----- */
   const renderMobileDashboard = (isDesktopSplit = false) => {
    const selKey = keyOf(anchor);
    const matchesTab = (r) => {
      if (roomId === "all") return !r.roomId || ["big", "small", "lounge", "meeting-room"].includes(r.roomId);
      if (roomId === "printer") return r.roomId === "bambu-1" || r.roomId === "bambu-2";
      return r.roomId === roomId || (r.roomId === "meeting-room" && roomId === "big");
    };
    let mobDayList = reservations.filter(r => r.date === selKey && matchesTab(r)).sort((a, b) => toMin(a.start) - toMin(b.start));
    
    if (roomId === "printer" && document.body.classList.contains('onb-open')) {
      const mock1 = { id: 'mock-1', roomId: 'bambu-1', date: selKey, start: '10:00', end: '14:00', title: '[예시] 자정 넘김 출력', isMock: true, attendees: [] };
      const mock2 = { id: 'mock-2', roomId: 'bambu-2', date: selKey, start: '13:00', end: '16:00', title: '[예시] 결과물 공유', isMock: true, attendees: [] };
      mobDayList = [...mobDayList, mock1, mock2].sort((a, b) => toMin(a.start) - toMin(b.start));
    }
    
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayKey = keyOf(today);
    const isTodayAnchor = selKey === todayKey;

    const groupedDayList = [];
    if (roomId === "all") {
      const groups = {};
      mobDayList.forEach(r => {
        groups[r.start] = groups[r.start] || [];
        groups[r.start].push(r);
      });
      Object.keys(groups).sort((a, b) => toMin(a) - toMin(b)).forEach(start => {
        groupedDayList.push({
          start,
          meetings: groups[start]
        });
      });
    } else {
      mobDayList.forEach(r => {
        groupedDayList.push({
          start: r.start,
          meetings: [r]
        });
      });
    }
    
    // Status Card calculations
    const currentRoomRes = roomId === "all" ? [] : reservations.filter(r => r.date === todayKey && matchesTab(r));
    const mobCurrentMtg = roomId === "all" ? null : currentRoomRes.find(r => {
      const s = toMin(r.start);
      const e = toMin(r.end);
      return nowMin >= s && nowMin < e;
    });
    const mobNextMtg = roomId === "all" ? null : currentRoomRes.filter(r => toMin(r.start) >= nowMin && (!mobCurrentMtg || r.id !== mobCurrentMtg.id)).sort((a,b)=>toMin(a.start)-toMin(b.start))[0];

    return (
      <div className={`${isDesktopSplit ? "hidden md:flex min-h-0 overflow-y-auto no-scrollbar" : "flex md:hidden"} flex-col flex-1 w-full pt-2 ${isDesktopSplit ? "pb-24" : "pb-36"} relative`}>
        {/* Mobile Header / Desktop Timeline Header */}
        <div className="flex items-center justify-between mb-4 px-1 md:px-0">
          <div>
            <div className="flex items-center gap-2">
              <div className="relative flex items-center">
                <button 
                  onClick={() => setDatePickerOpen(!datePickerOpen)}
                  className="text-xl font-bold flex items-center gap-1 cursor-pointer hover:opacity-80 active:opacity-60 transition-opacity"
                >
                  {anchor.getMonth() + 1}월 {anchor.getDate()}일 {WEEK[anchor.getDay()]}요일
                  <span className="text-[10px] opacity-40 ml-1">▼</span>
                </button>
                {datePickerOpen && (
                  <CustomDatePicker
                    anchor={anchor}
                    onClose={() => setDatePickerOpen(false)}
                    onSelect={(d) => {
                      setAnchor(d);
                      setDatePickerOpen(false);
                    }}
                    theme={theme}
                  />
                )}
              </div>
              <button 
                onClick={() => {
                  const td = dayOnly(new Date());
                  setAnchor(td);
                }}
                className="lift cursor-pointer px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ml-1.5 active:scale-95 active:opacity-85 shadow-sm"
                style={{ background: "var(--bg-input)", border: `1px solid ${C.border}`, color: C.text }}
              >
                오늘
              </button>
            </div>
            <div className="text-xs mt-1" style={{ color: C.faint }}>
              오늘 예약 {roomId === "all" ? reservations.filter(r => r.date === todayKey && matchesTab(r)).length : currentRoomRes.length}건
            </div>
          </div>
        </div>

        {/* Date Picker */}
        <div 
          className="flex gap-3 overflow-x-auto sc mb-4 pb-2 -mx-4 px-4"
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {Array.from({length: 31}, (_, i) => addDays(anchor, i - 15)).map((d, i) => {
            const dk = keyOf(d);
            const isSel = dk === selKey;
            const isT = dk === todayKey;
            const dRes = reservations.filter(r => r.date === dk && matchesTab(r));
            const hasUrgent = dRes.some(r => r.isUrgent);
            const hasNormal = dRes.length > 0 && !hasUrgent;
            return (
              <div id={`${isDesktopSplit ? "desk" : "mob"}-date-${dk}`} key={i} onClick={() => setAnchor(d)} className="flex flex-col items-center shrink-0 w-10 cursor-pointer snap-center">
                <span className="text-[10px] mb-1.5 font-medium" style={{ color: (d.getDay() === 0 || d.getDay() === 6) ? "#ef4444" : C.faint }}>{WEEK[d.getDay()]}</span>
                <div 
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-bold transition-all ${isSel ? (theme === 'dark' ? 'active-date-circle-dark shadow-sm border border-white' : 'active-date-circle-light shadow-sm border border-black') : ''}`} 
                  style={isSel ? {} : (d.getDay() === 0 || d.getDay() === 6) ? { color: "#ef4444" } : isT ? { color: "#2f80ed" } : { color: C.text }}
                >
                  {d.getDate()}
                </div>
                <div className="h-1.5 mt-1.5 flex gap-0.5">
                  {hasUrgent && <span className="block w-1.5 h-1.5 rounded-full" style={{ background: "var(--mob-busy-bg)" }} />}
                  {!hasUrgent && hasNormal && <span className="block w-1.5 h-1.5 rounded-full" style={{ background: "var(--mob-free-bg)" }} />}
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Tab Selection */}
        <div className="picker res-picker" id="picker" ref={roomPickerRef}>
          <div className="glass">
            <div className={`pick pick--room ${['all', 'big', 'small', 'lounge'].includes(roomId) ? 'on' : ''} ${isRoomDropdownOpen ? 'open' : ''}`}>
              <button className="pick__head" onClick={() => {
                setRoomId('all');
                setIsRoomDropdownOpen(!isRoomDropdownOpen);
              }}>
                <span className="dot"></span>
                회의실
                <span className="cur">
                  {roomId === 'big' ? ' 큰 회의실' : roomId === 'small' ? ' 작은 회의실' : roomId === 'lounge' ? ' 라운지' : ''}
                </span>
                <i className="chev">›</i>
              </button>
              <div className="sub">
                <button className={roomId === 'big' ? 'on' : ''} onClick={(e) => { setRoomId('big'); setIsRoomDropdownOpen(false); e.currentTarget.blur(); }}>
                  큰 회의실
                </button>
                <button className={roomId === 'small' ? 'on' : ''} onClick={(e) => { setRoomId('small'); setIsRoomDropdownOpen(false); e.currentTarget.blur(); }}>
                  작은 회의실
                </button>
                <button className={roomId === 'lounge' ? 'on' : ''} onClick={(e) => { setRoomId('lounge'); setIsRoomDropdownOpen(false); e.currentTarget.blur(); }}>
                  라운지
                </button>
              </div>
            </div>
            
            <span className="divider"></span>
            
            <button className={`pick pick--work ${roomId === 'workroom' ? 'on' : ''}`} onClick={() => { setRoomId('workroom'); setIsRoomDropdownOpen(false); }}>
              <span className="pick__head"><span className="dot"></span>워크룸</span>
            </button>
            
            <button className={`pick pick--prnt ${roomId === 'printer' ? 'on' : ''}`} onClick={() => { setRoomId('printer'); setIsRoomDropdownOpen(false); }}>
              <span className="pick__head"><span className="dot"></span>3D 프린터</span>
            </button>
          </div>
        </div>

        {/* Status Card (Only show context for today AND if not "all") */}
        {isTodayAnchor && roomId !== "all" && (() => {
          if (roomId === 'printer') {
            const b1Res = reservations.filter(r => r.roomId === 'bambu-1' && r.date === keyOf(now));
            const b2Res = reservations.filter(r => r.roomId === 'bambu-2' && r.date === keyOf(now));
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const b1Busy = b1Res.find(r => nowMin >= toMin(r.start) && nowMin < toMin(r.end));
            const b2Busy = b2Res.find(r => nowMin >= toMin(r.start) && nowMin < toMin(r.end));
            const busyCount = (b1Busy ? 1 : 0) + (b2Busy ? 1 : 0);
            const isFull = busyCount === 2;
            const titleText = busyCount === 0 ? "2대 모두 사용 가능" : busyCount === 1 ? "2대 중 1대 사용 가능" : "2대 모두 출력 중";
            
            const freeCount = 2 - busyCount;
            let subText = "";
            if (freeCount === 0) {
              const ends = [b1Busy.end, b2Busy.end].sort();
              subText = `가장 빨리 끝나는 건 ${ends[0]}입니다`;
            } else {
              const freeNames = [];
              if (!b1Busy) freeNames.push("968 (LEFT)");
              if (!b2Busy) freeNames.push("990 (RIGHT)");
              subText = `${freeNames.join(' · ')} 지금 비어있음`;
              if (busyCount > 0) {
                const busyEnd = b1Busy ? b1Busy.end : b2Busy.end;
                subText += ` · ${busyEnd}에 한 대 더 비워집니다`;
              }
            }
            
            const b1Mine = b1Busy && b1Busy.who === user ? b1Busy : null;
            const b2Mine = b2Busy && b2Busy.who === user ? b2Busy : null;
            const myLiveRes = b1Mine || b2Mine;
            const myRoomName = b1Mine ? "968 (LEFT)" : "990 (RIGHT)";

            return (
              <div className="status-card mb-6 rounded-[14px] p-4 text-white relative overflow-hidden" style={{ background: isFull ? "var(--mob-busy-bg)" : "var(--mob-free-bg)", margin: "6px 0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className={`w-2.5 h-2.5 rounded-full ${isFull ? "glow-dot-busy" : "glow-dot-free"}`} />
                  <span className="text-[18px] font-bold" style={{ color: isFull ? "var(--mob-busy-text)" : "var(--mob-free-text)" }}>
                    {titleText}
                  </span>
                </div>
                <div className="text-[13px] font-medium mb-5" style={{ color: isFull ? "var(--mob-busy-text)" : "var(--mob-free-text)", opacity: 0.8 }}>
                  {subText}
                </div>
                <div className="relative z-10 btnrow flex gap-2">
                  {myLiveRes && (
                    <button className="flex-1 py-2.5 rounded-[10px] text-[13px] font-bold text-white transition-opacity" style={{ background: "var(--busy)" }} onClick={() => completeRes(myLiveRes)}>
                      {myRoomName} 사용 종료
                    </button>
                  )}
                  <button className="flex-1 py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white" onClick={() => tryCreate('bambu-1', defStart(), selKey)}>
                    + 지금 바로 예약하기
                  </button>
                </div>
              </div>
            );
          }
          const resInfo = resources.find(r => r.id === roomId) || resources.find(r => (roomId === 'big' || roomId === 'small' || roomId === 'lounge' ? r.id === 'meeting-room' : false));
          const policy = resInfo?.policy;
          
          if (policy?.capacity > 1) {
            // 다인용 자원 (Workroom)
            const activeCount = sessions.filter(s => 
              s.resourceId === resInfo.id && 
              !s.checkOutAt &&
              reservations.some(r => r.id === s.reservationId && r.date === keyOf(now))
            ).length;
            const isFull = activeCount >= policy.capacity;
            
            return (
              <div className="status-card mb-6 rounded-[14px] p-4 text-white relative overflow-hidden" style={{ background: isFull ? "var(--mob-busy-bg)" : "var(--mob-free-bg)", margin: "6px 0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className={`w-2.5 h-2.5 rounded-full ${isFull ? "glow-dot-busy" : "glow-dot-free"}`} />
                  <span className="text-[18px] font-bold" style={{ color: isFull ? "var(--mob-busy-text)" : "var(--mob-free-text)" }}>
                    {isFull ? "지금 만석입니다" : `${policy.capacity - activeCount}자리 남았습니다`}
                  </span>
                </div>
                <div className="text-[13px] font-medium mb-3" style={{ color: isFull ? "var(--mob-busy-text)" : "var(--mob-free-text)", opacity: 0.8 }}>
                  정원 {policy.capacity}명 · 지금 {activeCount}명 이용 중
                </div>
                
                <div className="caps">
                  {Array.from({ length: policy.capacity }).map((_, i) => (
                    <i key={i} className={i < activeCount ? 'on' : ''}></i>
                  ))}
                  <b>{activeCount} / {policy.capacity}</b>
                </div>
                
                <div className="relative z-10 mt-5">
                  <button className="w-full py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white" onClick={() => {
                    if (isFull) {
                      showToast("알림이 설정되었습니다.");
                    } else {
                      tryCreate(roomId, defStart(), selKey);
                    }
                  }}>
                    {isFull ? "자리 나면 알림 받기" : "+ 지금 바로 예약하기"}
                  </button>
                </div>
                <div className="text-center text-[12px] mt-2 opacity-80" style={{ color: isFull ? "var(--mob-busy-text)" : "var(--mob-free-text)" }}>예약 시간이 10분 지나면 자동으로 취소됩니다</div>
              </div>
            );
          } else {
            // 단일 자원 (Meeting Room)
            return (
              <div className="status-card mb-6 rounded-[14px] p-4 text-white relative overflow-hidden" style={{ background: mobCurrentMtg ? "var(--mob-busy-bg)" : "var(--mob-free-bg)", margin: "6px 0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className={`w-2.5 h-2.5 rounded-full ${mobCurrentMtg ? "glow-dot-busy" : "glow-dot-free"}`} />
                  <span className="text-[18px] font-bold" style={{ color: mobCurrentMtg ? "var(--mob-busy-text)" : "var(--mob-free-text)" }}>{mobCurrentMtg ? "지금 회의 중" : "지금 비어있음"}</span>
                </div>
                <div className="text-[13px] font-medium mb-5" style={{ color: mobCurrentMtg ? "var(--mob-busy-text)" : "var(--mob-free-text)", opacity: 0.8 }}>
                  {mobCurrentMtg ? `${mobCurrentMtg.title} · ${mobCurrentMtg.end} 종료` : mobNextMtg ? `${mobNextMtg.start}까지 사용 가능` : "오늘 남은 시간 계속 사용 가능"}
                </div>
                <div className="relative z-10">
                  {mobCurrentMtg ? (
                    canEdit(mobCurrentMtg) ? (
                      <div className="flex gap-2">
                        <select 
                          onChange={(e) => { if (e.target.value) { extendRes(mobCurrentMtg, parseInt(e.target.value)); e.target.value = ""; } }} 
                          className="flex-1 py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white text-center cursor-pointer outline-none appearance-none"
                        >
                          <option value="" hidden>회의 연장</option>
                          <option value="5" style={{color: "#000"}}>+ 5분</option>
                          <option value="10" style={{color: "#000"}}>+ 10분</option>
                          <option value="15" style={{color: "#000"}}>+ 15분</option>
                          <option value="30" style={{color: "#000"}}>+ 30분</option>
                        </select>
                        <button className="flex-1 py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white" onClick={() => completeRes(mobCurrentMtg)}>
                          회의 종료
                        </button>
                      </div>
                    ) : (
                      <button className="w-full py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white" onClick={() => requireAuth(() => setDetail(mobCurrentMtg), "댓글을 남기려면 로그인이 필요해요.")}>
                        댓글 남기기
                      </button>
                    )
                  ) : (
                    <button className="w-full py-2.5 rounded-[10px] text-[13px] font-bold bg-black/20 text-white" onClick={() => tryCreate(roomId, defStart(), selKey)}>
                      지금 바로 예약하기
                    </button>
                  )}
                </div>
              </div>
            );
          }
        })()}

        {/* Timeline List */}
        <div className="flex-1" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {roomId === 'printer' ? (() => {
            const b1Res = reservations.filter(r => r.roomId === 'bambu-1' && r.date === selKey);
            const b2Res = reservations.filter(r => r.roomId === 'bambu-2' && r.date === selKey);
            
            if (onboardingStep === '프린터 · 1') {
              b1Res.push({ id: 'mock1', roomId: 'bambu-1', date: selKey, start: '10:00', end: '13:00', who: '사용자', title: '예시', isMock: true });
              b2Res.push({ id: 'mock2', roomId: 'bambu-2', date: selKey, start: '11:00', end: '15:30', who: '사용자', title: '예시', isMock: true });
            }

            const nowMin = now.getHours() * 60 + now.getMinutes();
            const b1Busy = isTodayAnchor && b1Res.find(r => nowMin >= toMin(r.start) && nowMin < toMin(r.end));
            const b2Busy = isTodayAnchor && b2Res.find(r => nowMin >= toMin(r.start) && nowMin < toMin(r.end));

            return (
              <div className="dg" style={{ '--cols': 2, '--hours': 15 }}>
                <div className="dg__head">
                  <b></b>
                  <b className={b1Busy ? 'hot' : ''}>
                    968 (LEFT)
                    <small>{b1Busy ? `${b1Busy.end} 종료 예정` : '비어 있음'}</small>
                  </b>
                  <b className={b2Busy ? 'hot' : ''}>
                    990 (RIGHT)
                    <small>{b2Busy ? `${b2Busy.end} 종료 예정` : '비어 있음'}</small>
                  </b>
                </div>
                <div className="dg__scroll" ref={dgScrollRef}>
                  <div className="dg__body">
                    <div className="dg__gut">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <span key={i} style={{ top: `${i * 78}px` }}>{String(9 + i).padStart(2, '0')}시</span>
                      ))}
                    </div>
                    {[b1Res, b2Res].map((resArr, colIdx) => (
                      <div className="dg__col" key={colIdx}>
                        {resArr.map(r => {
                          const sMin = Math.max(0, toMin(r.start) - toMin("09:00"));
                          const eMin = Math.max(0, toMin(r.end) - toMin("09:00"));
                          const top = (sMin / 60) * 78;
                          const h = Math.max(((eMin - sMin) / 60) * 78, 26);
                          const isLive = isTodayAnchor && nowMin >= toMin(r.start) && nowMin < toMin(r.end);
                          const ownerName = getOwnerName(r);
                          const isMine = r.who === user || r.owner === user || r.userId === user || ownerName === user;
                          let cls = 'blk--done';
                          if (!isPast && !isLive) cls = 'blk--plan';
                          else if (isLive) cls = 'blk--live';
                          if (isMine) cls += ' blk--mine';
                          if (r.isMock) cls += ' blk--mock border-2 border-dashed opacity-50';
                          
                          let badge = isLive ? '출력 중' : (!isPast && !isLive) ? '예약됨' : '완료';
                          
                          return (
                            <button key={r.id} className={`blk ${cls} ${h < 38 ? 's1' : h < 74 ? 's2' : ''}`} style={{ top: `${top}px`, height: `${h}px`, left: '3px', right: '3px' }} onClick={() => !r.isMock && onBlockClick(r)}>
                              <b>{isLive && <span className="livedot"></span>}<span>{r.title || ownerName}{isMine ? ' · 내 예약' : ''}</span></b>
                              <small>{r.start} ~ {r.end}</small>
                              <small>{ownerName ? `${ownerName}님` : ''}</small>
                              <span className="badge">{badge}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {isTodayAnchor && nowMin >= toMin("09:00") && nowMin <= toMin("24:00") && (
                      <div className="nowrow" style={{ top: `${((nowMin - toMin("09:00")) / 60) * 78}px` }}>
                        <b>{toHHMM(nowMin)}</b>
                      </div>
                    )}
                  </div>
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--busy)', border: '1px solid var(--busy)' }}></i>출력 중</span>
                  <span><i style={{ background: 'var(--free-bg)', border: '1px solid var(--free-ln)' }}></i>성공</span>
                  <span><i style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-ln)' }}></i>실패</span>
                  <span><i style={{ background: 'var(--free-bg)', border: '1px dashed var(--free-ln)' }}></i>예약됨</span>
                  <span><i style={{ background: 'var(--bg-tertiary)', boxShadow: '0 0 0 1.5px var(--bg),0 0 0 3px var(--ink)' }}></i>내 예약</span>
                </div>
              </div>
            );
          })() : resources.find(x => x.id === roomId)?.policy?.capacity > 1 ? (() => {
            const wRes = reservations.filter(r => r.roomId === roomId && r.date === selKey);
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const activeCount = isTodayAnchor ? wRes.filter(r => nowMin >= toMin(r.start) && nowMin < toMin(r.end)).length : 0;
            
            const layoutBlocks = (bars) => {
              const arr = bars.map(b => ({ b, sMin: toMin(b.start), eMin: toMin(b.end) })).sort((x, y) => x.sMin - y.sMin || x.eMin - y.eMin);
              let cluster = [], end = -1, out = [];
              const flush = () => {
                if (!cluster.length) return;
                const lanes = [];
                cluster.forEach(it => {
                  let i = lanes.findIndex(L => L <= it.sMin);
                  if (i < 0) { i = lanes.length; lanes.push(0); }
                  lanes[i] = it.eMin; it.col = i;
                });
                cluster.forEach(it => { it.cols = lanes.length; out.push(it); });
                cluster = []; end = -1;
              };
              arr.forEach(it => { if (cluster.length && it.sMin >= end) flush(); cluster.push(it); end = Math.max(end, it.eMin); });
              flush();
              return out;
            };
            
            const items = layoutBlocks(wRes);
            return (
              <div className="dg" style={{ '--cols': 1, '--hours': 15 }}>
                <div className="dg__head">
                  <b></b>
                  <b className={activeCount > 0 ? 'hot' : ''}>
                    워크룸 · 정원 {resources.find(x => x.id === roomId)?.policy?.capacity}명
                    <small>{activeCount > 0 ? `지금 ${activeCount}명 이용 중` : '지금 아무도 없음'}</small>
                  </b>
                </div>
                <div className="dg__scroll" ref={dgScrollRef}>
                  <div className="dg__body">
                    <div className="dg__gut">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <span key={i} style={{ top: `${i * 78}px` }}>{String(9 + i).padStart(2, '0')}시</span>
                      ))}
                    </div>
                    <div className="dg__col">
                      {items.map(it => {
                        const r = it.b;
                        const sMin = Math.max(0, it.sMin - toMin("09:00"));
                        const eMin = Math.max(0, it.eMin - toMin("09:00"));
                        const top = (sMin / 60) * 78;
                        const h = Math.max(((eMin - sMin) / 60) * 78, 26);
                        const isLive = isTodayAnchor && nowMin >= toMin(r.start) && nowMin < toMin(r.end);
                        const isPast = isTodayAnchor && nowMin >= toMin(r.end);
                        const ownerName = getOwnerName(r);
                        const isMine = r.who === user || r.owner === user || r.userId === user || ownerName === user;
                        let cls = 'blk--done';
                        if (!isPast && !isLive) cls = 'blk--plan';
                        else if (isLive) cls = 'blk--live';
                        if (isMine) cls += ' blk--mine';
                        
                        let badge = isLive ? '사용 중' : (!isPast && !isLive) ? '예약됨' : '완료';
                        
                        const w = 100 / it.cols;
                        const left = it.col * w;
                        
                        return (
                          <button key={r.id} className={`blk ${cls} ${h < 38 ? 's1' : h < 74 ? 's2' : ''}`} style={{ top: `${top}px`, height: `${h}px`, left: `calc(${left}% + 3px)`, width: `calc(${w}% - 6px)` }} onClick={() => onBlockClick(r)}>
                            <b>{isLive && <span className="livedot"></span>}<span>{r.title || ownerName}{isMine ? ' · 내 예약' : ''}</span></b>
                            <small>{r.start} ~ {r.end}</small>
                            <small>{ownerName ? `${ownerName}님` : ''}</small>
                            <span className="badge">{badge}</span>
                          </button>
                        );
                      })}
                    </div>
                    {isTodayAnchor && nowMin >= toMin("09:00") && nowMin <= toMin("24:00") && (
                      <div className="nowrow" style={{ top: `${((nowMin - toMin("09:00")) / 60) * 78}px` }}>
                        <b>{toHHMM(nowMin)}</b>
                      </div>
                    )}
                  </div>
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--busy)', border: '1px solid var(--busy)' }}></i>사용 중</span>
                  <span><i style={{ background: 'var(--free-bg)', border: '1px solid var(--free-ln)' }}></i>완료</span>
                  <span><i style={{ background: 'var(--free-bg)', border: '1px dashed var(--free-ln)' }}></i>예약됨</span>
                  <span><i style={{ background: 'var(--bg-tertiary)', boxShadow: '0 0 0 1.5px var(--bg),0 0 0 3px var(--ink)' }}></i>내 예약</span>
                </div>
              </div>
            );
          })() : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[12px] font-medium" style={{ color: C.faint }}>{isTodayAnchor ? "오늘 일정" : `${anchor.getMonth() + 1}월 ${anchor.getDate()}일 일정`}</span>
                <div className="flex-1 h-px" style={{ background: C.border }} />
              </div>

              <div className="flex flex-col gap-2 relative">
            {groupedDayList.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-center">
                <Calendar size={28} className="mb-2" style={{ color: C.faint }} />
                <span className="text-[13px] font-medium" style={{ color: C.faint }}>오늘 예약 없음</span>
              </div>
            ) : (
              groupedDayList.map((group) => {
                const groupIsPast = group.meetings.every(r => nowMin >= toMin(r.end) && isTodayAnchor);
                
                return (
                  <div key={group.start} className={`flex relative items-stretch ${group.meetings.some(m => m.id === openAttendanceId) ? 'z-50' : 'z-10'}`}>
                    <div className="w-[42px] shrink-0 pt-3 text-[11px] font-medium" style={{ color: C.faint }}>
                      {group.start}
                    </div>
                    
                    <div className="relative flex-1 ml-1 pl-3 py-1">
                      {/* Vertical Color Line */}
                      <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" 
                           style={{ 
                             background: group.meetings.some(r => r.isUrgent) ? "var(--mob-line-urgent)" : "var(--mob-line-normal)", 
                             opacity: groupIsPast ? 0.3 : 1 
                           }} />
                      
                      {/* Cards Container */}
                      <div className={group.meetings.length > 1 ? "flex flex-row gap-3 w-full" : "w-full"}>
                        {group.meetings.map((r, rIdx) => {
                          const sM = toMin(r.start);
                          const eM = toMin(r.end);
                          const isPast = nowMin >= eM && isTodayAnchor;
                          const isCurr = nowMin >= sM && nowMin < eM && isTodayAnchor;
                          const rm = ROOMS.find(x => x.id === r.roomId);
                          const isLastCard = group.meetings.length > 1 && rIdx === group.meetings.length - 1;
                          
                          return (
                            <div 
                              key={r.id} 
                              onClick={() => !r.isMock && onBlockClick(r)}
                              className={`flex-1 min-w-0 p-3.5 rounded-[10px] relative overflow-visible transition-all hover:scale-[1.01] ${openAttendanceId === r.id ? 'z-50' : 'z-10'} ${r.isMock ? 'border-2 border-dashed' : 'border cursor-pointer'}`} 
                              style={{ 
                                background: r.isUrgent ? "var(--mob-card-urgent)" : "var(--mob-card-normal)",
                                opacity: r.isMock ? 0.6 : 1,
                                borderColor: r.isMock ? C.border : 'var(--border)'
                              }}
                            >
                              {/* Content Wrapper */}
                              <div className="flex flex-col h-full w-full">
                                <div style={{ opacity: isPast ? 0.5 : 1 }}>
                                  <div className="flex items-start justify-between mb-1">
                                  <div className="text-[14px] font-bold pr-2 leading-tight flex items-center gap-1.5 min-w-0" style={{ color: C.text }}>
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCurr ? (r.isUrgent ? 'glow-dot-busy' : 'glow-dot-free') : ''}`} style={{ background: r.isUrgent ? pal('red').dot : pal('green').dot }} />
                                    <span className="truncate">{r.title}</span>
                                  </div>
                                  {r.isUrgent && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "var(--mob-busy-bg)", color: "var(--mob-busy-text)" }}>중요</span>
                                  )}
                                </div>
                                <div className="text-[11px] font-medium flex items-center gap-1 mt-0.5" style={{ color: C.faint }}>
                                  <Clock size={11} className="shrink-0" style={{ opacity: 0.7 }} />
                                  <span>{r.roomId === 'bambu-1' ? '968 (LEFT)' : r.roomId === 'bambu-2' ? '990 (RIGHT)' : (rm?.name || (r.roomId === 'meeting-room' ? '큰 회의실' : r.roomId))} · {r.start}~{r.end}</span>
                                </div>
                                
                                {/* Attendees / Users */}
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 relative z-20">
                                  <span className="text-[11px] font-semibold mr-0.5 flex items-center gap-1" style={{ color: C.faint }}><User size={11} className="shrink-0" style={{ opacity: 0.7 }} />{r.roomId === 'bambu-1' || r.roomId === 'bambu-2' ? '사용자' : '참석자'}</span>
                                  {Array.from(new Set((r.attendees || []).map(id => M(id)?.name))).filter(Boolean).map(name => (
                                    <span key={name} className="inline-flex items-center rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:text-gray-300">
                                      {name}
                                    </span>
                                  ))}
                                </div>
                                </div>

                                {/* Attendance Check Widget */}
                                {(() => {
                                  const meId = MEMBERS.find(m => m.name === user)?.id;
                                  const isMyChecked = meId && r.checkedIn && r.checkedIn.includes(meId) && r.attendees && r.attendees.includes(meId);
                                  const checkedCount = r.checkedIn ? r.checkedIn.filter(id => r.attendees && r.attendees.includes(id)).length : 0;
                                  const checkedMembers = (r.checkedIn || []).filter(id => r.attendees && r.attendees.includes(id)).map(id => MEMBERS.find(m => m.id === id)).filter(Boolean);

                                  return (
                                    <div className={`mt-2.5 flex items-center justify-between relative ${openAttendanceId === r.id ? 'z-50' : 'z-30'}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                      <div className="relative flex items-center gap-1.5">
                                        {/* Attend Button */}
                                        <button
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAttendance(r); }}
                                          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold border transition-all active:scale-95 shadow-sm cursor-pointer"
                                          style={{
                                            background: isMyChecked ? "rgba(39, 174, 96, 0.1)" : "var(--bg-input)",
                                            borderColor: isMyChecked ? "#27ae60" : C.border,
                                            color: isMyChecked ? "#27ae60" : C.text,
                                            height: "20px",
                                            opacity: isPast ? 0.5 : 1
                                          }}
                                        >
                                          <span className="flex items-center justify-center w-3.5 h-3.5 rounded text-white shrink-0" style={{ background: isMyChecked ? "#27ae60" : "#a0aec0" }}>
                                            <Check size={9} strokeWidth={3.5} />
                                          </span>
                                          <span>참석</span>
                                          {checkedCount > 0 && (
                                            <span className="ml-0.5 text-[10px] font-extrabold" style={{ color: isMyChecked ? "#27ae60" : "#7b2cbf" }}>
                                              {checkedCount}
                                            </span>
                                          )}
                                        </button>

                                        {/* Attendee Info Button & Popover Wrapper */}
                                        <div 
                                          className="relative flex items-center justify-center"
                                          onMouseEnter={() => setOpenAttendanceId(r.id)}
                                          onMouseLeave={() => setOpenAttendanceId(null)}
                                        >
                                          <button
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              setOpenAttendanceId(openAttendanceId === r.id ? null : r.id);
                                            }}
                                            style={{ opacity: isPast ? 0.5 : 1 }}
                                            className="w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all active:scale-90 bg-[#eeeeee] dark:bg-zinc-800 cursor-pointer"
                                          >
                                            <User size={11} className="text-gray-600 dark:text-gray-400" />
                                          </button>

                                          {/* Popover */}
                                          {openAttendanceId === r.id && (
                                            <div 
                                              className="absolute z-50 pb-2" 
                                              style={{ 
                                                bottom: "100%", 
                                                left: "50%",
                                                transform: "translateX(-50%)"
                                              }}
                                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                            >
                                              <div className="w-56 bg-white dark:bg-[#1a1a1a] rounded-xl border p-3 shadow-xl text-left cursor-default" style={{ borderColor: C.border }}>
                                                <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: C.border }}>
                                                  <span className="text-[12px] font-bold" style={{ color: C.text }}>참석 확인 현황</span>
                                                  <span className="text-[11px] font-extrabold text-[#27ae60] bg-[#27ae60]/10 px-2 py-0.5 rounded-full">{checkedCount}명 완료</span>
                                                </div>
                                                <div className="space-y-2 max-h-[172px] overflow-y-auto pr-1 scrollbar-thin">
                                                  {checkedCount > 0 ? (
                                                    checkedMembers.map(m => (
                                                      <div key={m.id} className="flex items-center justify-between text-[11px]">
                                                        <div className="flex items-center gap-2">
                                                          <Avatar name={m.name} size={22} solid />
                                                          <span className="font-semibold" style={{ color: C.text }}>{m.name} <span className="font-normal text-[10px]" style={{ color: C.faint }}>{m.role}</span></span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                          <span className="text-[9px] font-medium px-1 rounded" style={{ background: PASTEL.gray.bg, color: PASTEL.gray.text }}>{m.team}</span>
                                                          <span className="w-3.5 h-3.5 rounded bg-[#27ae60] flex items-center justify-center text-white">
                                                            <Check size={9} strokeWidth={4} />
                                                          </span>
                                                        </div>
                                                      </div>
                                                    ))
                                                  ) : (
                                                    <div className="py-4 text-center text-[11px]" style={{ color: C.faint }}>
                                                      아직 참석 확인을 한 사람이 없어요.
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Current Time Line Overlay */}
                      {(() => {
                        const activeMtg = group.meetings.find(r => {
                          const sM = toMin(r.start);
                          const eM = toMin(r.end);
                          return nowMin >= sM && nowMin < eM && isTodayAnchor;
                        });
                        if (!activeMtg) return null;
                        
                        const sM = toMin(activeMtg.start);
                        const eM = toMin(activeMtg.end);
                        const exactNowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
                        const progress = Math.max(0, Math.min(100, ((exactNowMin - sM) / (eM - sM)) * 100));
                        return (
                          <div className="absolute left-0 right-0 flex items-center z-10 pointer-events-none -ml-4" style={{ top: `${progress}%`, transform: 'translateY(-50%)', transition: 'top 1s ease-in-out' }}>
                            <span className="w-[6px] h-[6px] rounded-full" style={{ background: "var(--mob-busy-bg)" }} />
                            <div className="flex-1 h-0 border-t-[1.5px] border-dashed" style={{ borderColor: "var(--mob-busy-bg)" }} />
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          </>)}
        </div>

        {/* Bottom Fixed FAB for Mobile/Desktop */}
        <div className={`fixed bottom-[calc(env(safe-area-inset-bottom)+74px)] md:bottom-[calc(env(safe-area-inset-bottom)+16px)] left-4 right-4 z-30 flex flex-col items-center ${isDesktopSplit ? "md:sticky md:bottom-0 md:mt-auto md:pt-4 md:pb-0 md:bg-[var(--bg)] md:left-auto md:right-auto md:w-full" : ""}`}>
          <button className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2 text-[14px] font-bold shadow-lg transition-transform active:scale-95" style={{ background: "var(--ink)", color: "var(--bg)" }} onClick={() => {
            let targetId = roomId;
            if (roomId === "all") targetId = ROOMS.find(r => r.group === "meeting")?.id || "big";
            else if (roomId === "printer") targetId = ROOMS.find(r => r.group === "printer")?.id || "bambu-1";
            tryCreate(targetId, defStart(), selKey);
          }}>
            <Plus size={18} /> 예약하기
          </button>
          {(() => {
            let targetId = roomId;
            if (roomId === "all") targetId = ROOMS.find(r => r.group === "meeting")?.id || "big";
            else if (roomId === "printer") targetId = ROOMS.find(r => r.group === "printer")?.id || "bambu-1";
            const group = ROOMS.find(r => r.id === targetId)?.group;
            const policyId = group === 'meeting' ? 'meeting-room' : targetId;
            const policy = resources.find(r => r.id === policyId)?.policy;
            if (policy?.requiresReport) {
              return <div className="text-[12.5px] mt-2 text-center" style={{ color: C.faint }}>종료하면 결과를 물어봅니다</div>;
            }
            return null;
          })()}
        </div>
      </div>
    );
  };

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const startOfWeek = addDays(anchor, -anchor.getDay());
  const weekCells = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));

  const NAV = user 
    ? (user === "admin" 
       ? [["book", "예약", CalendarDays], ["history", "사용 기록", List], ["admin", "멤버 관리", Users], ["stats", "관리자 통계", BarChart3]]
       : [["book", "예약", CalendarDays], ["history", "사용 기록", List]])
    : [["book", "예약", CalendarDays]];

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh" }} className="w-full flex flex-col">
      {showSplash && <SplashScreen onComplete={() => {
        setShowSplash(false);
        if (!user) {
          requireAuth(() => {}, "이용하시려면 로그인이 필요해요.");
        }
      }} />}
      <style>{`
        *{font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";box-sizing:border-box;}
        .lift{transition:background .1s ease;} .lift:hover{background:var(--lift-hover);} .lift:active{background:var(--lift-active);}
        .inp{transition:border-color .15s ease, box-shadow .15s ease;} .inp:focus{border-color:${C.ink};}
        .slot{transition:background .12s ease;cursor:pointer;} .slot:hover{background:var(--slot-hover);}
        .slot:hover::after{content:'+ 예약';position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:600;color:${C.muted};}
        .blk{transition:background .1s ease;cursor:pointer;} .blk:hover{filter: brightness(0.95);}
        .cell{transition:background .1s ease;cursor:pointer;} .cell:hover{background:var(--slot-hover);}
        .mrow{cursor:grab;transition:background .1s ease;} .mrow:active{cursor:grabbing;}
        .fade{animation:fade .15s ease both;} @keyframes fade{from{opacity:0;}to{opacity:1;}}
        .sheet{animation:sheet .15s ease both;} @keyframes sheet{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
        .ov{animation:ov .15s ease both;} @keyframes ov{from{opacity:0;}to{opacity:1;}}
        .rise{animation:rise .2s ease both;} @keyframes rise{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
        .tdrop{animation:tdrop .15s ease both;} @keyframes tdrop{from{opacity:0;}to{opacity:1;}}
        .sc::-webkit-scrollbar{width:6px;height:6px;} .sc::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
        input,select,button{font-family:inherit;} select{appearance:none;-webkit-appearance:none;}
        /* PDF exporting style overrides */
        .pdf-exporting {
          background: #ffffff !important;
          color: #1a1a1a !important;
          padding: 28px !important;
          border-color: #e5e7eb !important;
          box-shadow: none !important;
        }
        .pdf-exporting .pdf-hide {
          display: none !important;
        }
        .pdf-exporting .pdf-card {
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          color: #1f2937 !important;
          box-shadow: none !important;
        }
        .pdf-exporting .pdf-title {
          color: #0f172a !important;
        }
        .pdf-exporting .pdf-text-muted {
          color: #4b5563 !important;
        }
        .pdf-exporting .pdf-text-faint {
          color: #9ca3af !important;
        }
        .pdf-exporting .pdf-border {
          border-color: #e5e7eb !important;
        }
        .pdf-exporting .pdf-cell-active {
          background: #fef08a !important;
          border-color: #fde047 !important;
        }
        .pdf-exporting .pdf-cell-in {
          background: #ffffff !important;
          border-color: #e5e7eb !important;
        }
        .pdf-exporting .pdf-cell-out {
          background: #f3f4f6 !important;
          border-color: #e5e7eb !important;
          opacity: 0.3 !important;
        }
      `}</style>

      
      {showIosBanner && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex justify-between items-center z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
          <div className="text-sm">
            <b>iOS 앱으로 설치</b><br/><span className="text-xs text-gray-500">Safari 공유 버튼 ➔ '홈 화면에 추가'</span>
          </div>
          <button onClick={() => setShowIosBanner(false)} className="text-gray-400 p-2"><X size={18}/></button>
        </div>
      )}

      {/* ===== Header ===== */}
      <header className="sticky top-0 z-30 border-b" style={{ background: "var(--bg-header)", borderColor: C.border, backdropFilter: "blur(10px)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-5 relative">
          <button onClick={() => { sessionStorage.setItem('skipSplash', 'true'); window.location.href = '/'; }} className="flex items-center"><Wordmark size={19} /></button>
          {user && (
            <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
              <nav className="flex items-center gap-1 rounded-lg p-1" style={{ background: "var(--bg-quaternary)" }}>
                {NAV.map(([k, lbl, Icon]) => (
                  <button key={k} id={`nav-btn-${k}`} onClick={() => setSection(k)} className="lift flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium" style={section === k ? { background: C.ink, color: "var(--bg)" } : { color: C.muted }}><Icon size={15} />{lbl}{k === "mine" && myRes.length ? ` · ${myRes.length}` : ""}</button>
                ))}
              </nav>
            </div>
          )}
          {/* Desktop header controls */}
          <div className="hidden md:flex items-center gap-2">
            <div className="hidden text-right leading-tight sm:block"><div className="text-[12px] font-medium">{fmtK(now)}</div><div className="text-[11px]" style={{ color: C.faint }}>{now.getHours() < 12 ? "오전" : "오후"} {((now.getHours() + 11) % 12) + 1}:{pad(now.getMinutes())}</div></div>
            <div className="relative">
              <button
                id="bellBtn"
                onClick={() => {
                  setAnnouncementPanelOpen(!announcementPanelOpen);
                  const nowTime = Date.now();
                  localStorage.setItem("announcement_last_read", String(nowTime));
                  setLastReadTime(nowTime);
                  const meId = getMeId();
                  if (meId) {
                    subscribeToWebPush(meId);
                  }
                }}
                className="lift relative grid h-9 w-9 place-items-center rounded-lg border transition-all duration-200 active:scale-90 cursor-pointer"
                style={{ borderColor: C.border, color: C.muted }}
                title="공지사항"
              >
                <Bell size={16} />
                {hasUnreadAnn && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
              {announcementPanelOpen && (
                <>
                  <div className="fixed inset-0 z-[450] cursor-default" onClick={() => setAnnouncementPanelOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#1a1a1a] rounded-xl border p-4 shadow-xl z-[500] flex flex-col max-h-[480px]" style={{ borderColor: C.border }}>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: C.border }}>
                      <div className="flex items-center gap-1.5">
                        <Bell size={15} className="text-[#2383E2]" />
                        <span className="text-[13px] font-bold" style={{ color: C.text }}>알림 및 공지사항</span>
                      </div>
                      {user === "admin" && !editingAnnouncement && (
                        <button 
                          onClick={() => setEditingAnnouncement({ id: null, text: "" })}
                          className="text-[10px] font-bold text-[#2383E2] hover:underline cursor-pointer"
                        >
                          글쓰기
                        </button>
                      )}
                    </div>
                    {/* Admin Form */}
                    {editingAnnouncement && (
                      <div className="pb-2 border-b space-y-2 mb-2" style={{ borderColor: C.border }}>
                        <h4 className="text-[10px] font-bold" style={{ color: C.muted }}>{editingAnnouncement.id ? "공지사항 수정" : "새 공지사항 등록"}</h4>
                        <textarea 
                          value={editingAnnouncement.text}
                          onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, text: e.target.value })}
                          placeholder="공지사항 내용을 입력하세요..."
                          className="inp w-full rounded border p-2 text-[11px] outline-none bg-white min-h-[50px] resize-none"
                          style={{ borderColor: C.border, color: C.text }}
                        />
                        <div className="flex justify-end gap-1.5 text-[10px]">
                          <button onClick={() => setEditingAnnouncement(null)} className="lift rounded px-2 py-1 border font-semibold" style={{ borderColor: C.border, color: C.muted }}>취소</button>
                          <button onClick={() => saveAnnouncement(editingAnnouncement.text, editingAnnouncement.id)} className="lift rounded px-2 py-1 text-white font-semibold" style={{ background: "#2383E2" }}>저장</button>
                        </div>
                      </div>
                    )}
                    {/* Content List */}
                    <div className="sc overflow-y-auto flex-1 space-y-3 pr-1 text-left no-scrollbar">
                      {/* Update Notifications */}
                      {UPDATE_NOTES.map((n) => {
                        const isNew = !userGuideSeen.includes(n.guide);
                        return (
                          <div 
                            key={n.id} 
                            onClick={() => handleMarkGuideSeen(n.guide)}
                            className="p-3 rounded-xl border relative transition-all hover:opacity-95 cursor-pointer text-left"
                            style={{ 
                              borderColor: isNew ? "rgba(35, 131, 226, 0.4)" : C.border, 
                              background: isNew ? (theme === "dark" ? "rgba(35, 131, 226, 0.12)" : "#f0f7ff") : "var(--bg-secondary)" 
                            }}
                          >
                            <div className="flex items-center gap-1.5 font-bold text-[13px] mb-1" style={{ color: C.text }}>
                              {isNew && <span className="newtag">새로 추가됨</span>}
                              <span>{n.title}</span>
                            </div>
                            <p className="text-[12px] font-medium leading-normal mb-1.5" style={{ color: C.muted }}>{n.body}</p>
                            <ul className="chglist mb-2">
                              {n.changes.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkGuideSeen(n.guide);
                                setAnnouncementPanelOpen(false);
                                guideRef.current?.startOnboarding([n.guide]);
                              }}
                              className="ngo inline-flex items-center gap-1"
                            >
                              가이드 보기 ›
                            </button>
                          </div>
                        );
                      })}

                      {/* Admin Announcements */}
                      {announcements.map((a) => {
                        const dateStr = new Date(a.createdAt).toLocaleString("ko-KR", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        });
                        return (
                          <div key={a.id} className="p-2.5 rounded-lg border flex flex-col justify-between" style={{ borderColor: C.border, background: "var(--bg-secondary)" }}>
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex-1 text-[11px] font-medium leading-relaxed whitespace-pre-wrap break-all" style={{ color: C.text }}>
                                {a.text}
                              </div>
                              {user === "admin" && (
                                <div className="flex gap-1 shrink-0 text-[9px] font-bold">
                                  <button onClick={() => setEditingAnnouncement({ id: a.id, text: a.text })} className="text-blue-500 hover:underline cursor-pointer">수정</button>
                                  <span className="opacity-20">|</span>
                                  <button onClick={() => deleteAnnouncement(a.id)} className="text-red-500 hover:underline cursor-pointer">삭제</button>
                                </div>
                              )}
                            </div>
                            <div className="mt-2 text-[9px]" style={{ color: C.faint }}>{dateStr}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="lift grid h-9 w-9 place-items-center rounded-lg border transition-all duration-200 active:scale-90"
              style={{ borderColor: C.border, color: C.muted }}
              title={theme === "dark" ? "라이트 모드" : "다크 모드"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {user ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSection("mypage")} 
                  className="lift flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all hover:border-black dark:hover:border-white"
                  style={{ 
                    borderColor: section === "mypage" ? C.ink : C.border, 
                    background: section === "mypage" ? "var(--bg-quaternary)" : "transparent"
                  }}
                >
                  <Avatar name={user} size={24} solid={section === "mypage"} />
                  <span style={{ color: C.text }}>{nameWithNim(user)}</span>
                </button>
              </div>
            ) : (
              <button onClick={() => requireAuth(() => {}, "로그인")} className="lift flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}><LogIn size={15} /> 로그인</button>
            )}
          </div>

          {/* Mobile header controls */}
          <div className="flex md:hidden items-center gap-1.5">
            <div className="relative">
              <button
                id="bellBtnMob"
                onClick={() => {
                  setAnnouncementPanelOpen(!announcementPanelOpen);
                  const nowTime = Date.now();
                  localStorage.setItem("announcement_last_read", String(nowTime));
                  setLastReadTime(nowTime);
                }}
                className="lift relative grid h-9 w-9 place-items-center rounded-lg transition-all duration-200 active:scale-90 cursor-pointer"
                style={{ color: C.muted }}
                title="공지사항"
              >
                <Bell size={20} />
                {hasUnreadAnn && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
              {announcementPanelOpen && (
                <>
                  <div className="fixed inset-0 z-[450] cursor-default" onClick={() => setAnnouncementPanelOpen(false)} />
                  <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#1a1a1a] rounded-xl border p-4 shadow-xl z-[500] flex flex-col max-h-[480px] -mr-16" style={{ borderColor: C.border }}>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: C.border }}>
                      <div className="flex items-center gap-1.5">
                        <Bell size={15} className="text-[#2383E2]" />
                        <span className="text-[13px] font-bold" style={{ color: C.text }}>알림 및 공지사항</span>
                      </div>
                      {user === "admin" && !editingAnnouncement && (
                        <button 
                          onClick={() => setEditingAnnouncement({ id: null, text: "" })}
                          className="text-[10px] font-bold text-[#2383E2] hover:underline cursor-pointer"
                        >
                          글쓰기
                        </button>
                      )}
                    </div>
                    {/* Admin Form */}
                    {editingAnnouncement && (
                      <div className="pb-2 border-b space-y-2 mb-2 text-left" style={{ borderColor: C.border }}>
                        <h4 className="text-[10px] font-bold" style={{ color: C.muted }}>{editingAnnouncement.id ? "공지사항 수정" : "새 공지사항 등록"}</h4>
                        <textarea 
                          value={editingAnnouncement.text}
                          onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, text: e.target.value })}
                          placeholder="공지사항 내용을 입력하세요..."
                          className="inp w-full rounded border p-2 text-[11px] outline-none bg-white min-h-[50px] resize-none"
                          style={{ borderColor: C.border, color: C.text }}
                        />
                        <div className="flex justify-end gap-1.5 text-[10px]">
                          <button onClick={() => setEditingAnnouncement(null)} className="lift rounded px-2 py-1 border font-semibold" style={{ borderColor: C.border, color: C.muted }}>취소</button>
                          <button onClick={() => saveAnnouncement(editingAnnouncement.text, editingAnnouncement.id)} className="lift rounded px-2 py-1 text-white font-semibold" style={{ background: "#2383E2" }}>저장</button>
                        </div>
                      </div>
                    )}
                    {/* Content List */}
                    <div className="sc overflow-y-auto flex-1 space-y-3 pr-1 text-left no-scrollbar">
                      {/* Update Notifications */}
                      {UPDATE_NOTES.map((n) => {
                        const isNew = !userGuideSeen.includes(n.guide);
                        return (
                          <div 
                            key={n.id} 
                            onClick={() => handleMarkGuideSeen(n.guide)}
                            className="p-3 rounded-xl border relative transition-all hover:opacity-95 cursor-pointer text-left"
                            style={{ 
                              borderColor: isNew ? "rgba(35, 131, 226, 0.4)" : C.border, 
                              background: isNew ? (theme === "dark" ? "rgba(35, 131, 226, 0.12)" : "#f0f7ff") : "var(--bg-secondary)" 
                            }}
                          >
                            <div className="flex items-center gap-1.5 font-bold text-[13px] mb-1" style={{ color: C.text }}>
                              {isNew && <span className="newtag">새로 추가됨</span>}
                              <span>{n.title}</span>
                            </div>
                            <p className="text-[12px] font-medium leading-normal mb-1.5" style={{ color: C.muted }}>{n.body}</p>
                            <ul className="chglist mb-2">
                              {n.changes.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkGuideSeen(n.guide);
                                setAnnouncementPanelOpen(false);
                                guideRef.current?.startOnboarding([n.guide]);
                              }}
                              className="ngo inline-flex items-center gap-1"
                            >
                              가이드 보기 ›
                            </button>
                          </div>
                        );
                      })}

                      {/* Admin Announcements */}
                      {announcements.map((a) => {
                        const dateStr = new Date(a.createdAt).toLocaleString("ko-KR", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        });
                        return (
                          <div key={a.id} className="p-2.5 rounded-lg border flex flex-col justify-between" style={{ borderColor: C.border, background: "var(--bg-secondary)" }}>
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex-1 text-[11px] font-medium leading-relaxed whitespace-pre-wrap break-all" style={{ color: C.text }}>
                                {a.text}
                              </div>
                              {user === "admin" && (
                                <div className="flex gap-1 shrink-0 text-[9px] font-bold">
                                  <button onClick={() => setEditingAnnouncement({ id: a.id, text: a.text })} className="text-blue-500 hover:underline cursor-pointer">수정</button>
                                  <span className="opacity-20">|</span>
                                  <button onClick={() => deleteAnnouncement(a.id)} className="text-red-500 hover:underline cursor-pointer">삭제</button>
                                </div>
                              )}
                            </div>
                            <div className="mt-2 text-[9px]" style={{ color: C.faint }}>{dateStr}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="lift grid h-9 w-9 place-items-center rounded-lg transition-all duration-200 active:scale-90"
              style={{ color: C.muted }}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              onClick={() => setMenuDrawerOpen(true)}
              className="lift grid h-9 w-9 place-items-center rounded-lg transition-all duration-200 active:scale-90"
              style={{ color: C.muted }}
            >
              <span className="flex flex-col gap-[4px] w-[17px] items-center justify-center">
                <span className="h-[2px] w-full bg-current rounded-sm"></span>
                <span className="h-[2px] w-full bg-current rounded-sm"></span>
                <span className="h-[2px] w-full bg-current rounded-sm"></span>
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-5 md:pb-10 flex-1 flex flex-col w-full">
        {section === "book" && (
          !user ? (
            <div className="grid place-items-center rounded-lg border bg-white dark:bg-[#1a1a1a] py-16 text-center" style={{ borderColor: C.border }}>
              <Lock size={30} style={{ color: C.faint }} />
              <p className="mt-3 text-sm font-semibold" style={{ color: C.muted }}>로그인하면 회의 내역 및 일정을 볼 수 있어요</p>
              <button onClick={() => requireAuth(() => setSection("book"), "로그인하면 회의 내역 및 일정을 볼 수 있어요.")} className="lift mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)" }}>
                <LogIn size={15} />로그인
              </button>
            </div>
          ) : (
            <>
              {/* --- Desktop View --- */}
              <div className="hidden md:flex flex-col flex-1 w-full">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {view === "calendar" && (
                    <>
                      <div className="flex items-center rounded-lg border bg-white" style={{ borderColor: C.border }}>
                        <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} className="lift grid h-9 w-9 place-items-center rounded-l-xl" style={{ color: C.muted }}><ChevronLeft size={18} /></button>
                        <div className="flex items-center gap-2 px-2.5 text-sm font-medium sm:px-3"><CalendarDays size={15} style={{ color: C.ink }} />{`${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`}</div>
                        <button onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} className="lift grid h-9 w-9 place-items-center rounded-r-xl" style={{ color: C.muted }}><ChevronRight size={18} /></button>
                      </div>
                      {isCurMonth
                        ? <span className="rounded-lg px-2.5 py-1 text-xs font-medium" style={{ background: C.ink, color: "var(--bg)" }}>이번 달</span>
                        : <button onClick={() => setAnchor(today)} className="lift rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: C.border, background: "var(--bg-input)", color: C.muted }}>오늘</button>}
                    </>
                  )}
                </div>
                <div className="inline-flex rounded-lg border bg-white p-1" style={{ borderColor: C.border }}>
                  {[["timeline", "타임라인", List], ["calendar", "캘린더", CalendarDays]].map(([k, lbl, Icon]) => (
                    <button key={k} onClick={() => setView(k)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium" style={view === k ? { background: C.ink, color: "var(--bg)" } : { color: C.muted }}><Icon size={15} /><span className="hidden sm:inline">{lbl}</span></button>
                  ))}
                </div>
              </div>

              {view === "calendar" ? (
                <section className="rise rounded-lg border bg-white p-2.5 sm:p-4 flex-1 flex flex-col" style={{ borderColor: C.border, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
                  <div className="mb-2 hidden items-center justify-end px-1 text-xs font-medium sm:flex" style={{ color: C.faint }}>날짜를 누르면 해당 날짜로 이동 · 색상은 예약 시 직접 지정</div>
                  <div className="grid grid-cols-7 overflow-hidden rounded-lg border flex-1" style={{ borderColor: C.border, gridTemplateRows: "auto repeat(6, 1fr)" }}>
                    {WEEK.map((w, i) => <div key={w} className="border-b py-2 text-center text-[11px] font-medium sm:text-xs" style={{ borderColor: C.border, background: "var(--bg-secondary)", color: i === 0 ? "#C0392B" : i === 6 ? "#2A5DC7" : C.muted }}>{w}</div>)}
                    {cells.map((cell, i) => {
                      const inMonth = cell.getMonth() === anchor.getMonth(), cToday = sameDay(cell, today);
                      const list = (byDate[keyOf(cell)] || []).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
                      return (
                        <div key={i} onClick={() => setDayEventsDate(cell)} className="cell border-b border-l p-1 sm:p-1.5 flex flex-col cursor-pointer" style={{ borderColor: C.border, background: cToday ? C.yellowSoft : inMonth ? "var(--bg-input)" : "var(--bg-tertiary)", opacity: inMonth ? 1 : .5, minHeight: 0 }}>
                          <div className="flex items-center justify-between">
                            <span className={cToday ? "grid h-5 w-5 place-items-center rounded-lg text-[11px] font-medium" : "text-[12px] font-medium"} style={cToday ? { background: C.ink, color: "var(--bg)" } : { color: cell.getDay() === 0 ? "#C0392B" : cell.getDay() === 6 ? "#2A5DC7" : C.text }}>{cell.getDate()}</span>
                            {list.length > 0 && <span className="hidden text-[10px] font-medium sm:inline" style={{ color: C.faint }}>{list.length}</span>}
                          </div>
                          <div className="mt-1 hidden space-y-1 sm:block flex-1" style={{ minHeight: 54 }}>
                            {list.slice(0, 3).map((r) => { const p = r.isUrgent ? pal('red') : pal('green'); return (
                              <div key={r.id} onClick={(e) => { e.stopPropagation(); setDetail(r); }} className="flex items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-[11px] font-medium" style={{ background: p.bg, color: p.text }}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-lg" style={{ background: p.dot }} /><span className="truncate">{r.start} {r.title}</span>
                              </div>
                            ); })}
                            {list.length > 3 && <div className="px-1 text-[10px] font-medium" style={{ color: C.faint }}>+{list.length - 3} 더보기</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : view === "timeline" ? (
                <section className="rise flex-1 flex flex-col h-full rounded-[20px] p-6 sm:p-8 overflow-hidden border w-full" style={{ background: "var(--bg)", borderColor: C.border, boxShadow: "0 8px 32px rgba(0,0,0,0.06)" }}>
                  {/* Full screen Timeline Dashboard */}
                  {renderMobileDashboard(true)}
                </section>
              ) : null}
              </div>
              
              {/* --- Mobile View --- */}
              {renderMobileDashboard()}
            </>
          )
        )}

        


        {section === "mypage" && (
          <MyPage 
            user={user}
            setUser={setUser}
            theme={theme}
            setTheme={setTheme}
            setSection={setSection}
            reservations={rawReservations}
            membersList={membersList}
            setMembersList={setMembersList}
            resources={resources}
            onboardingRef={guideRef}
            showToast={showToast}
            Avatar={(props) => <Avatar {...props} dbProfiles={dbProfiles} />}
            onOpenProfileMenu={() => setShowProfileMenu(true)}
            handleLogout={handleLogout}
          />
        )}

        {section === "history" && (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium">사용 기록</h2>
              </div>
              {user && (
                <button 
                  onClick={() => setSection("book")} 
                  className="lift flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold"
                  style={{ borderColor: C.border, color: C.muted }}
                >
                  <Plus size={14} /> 회의실 예약하기
                </button>
              )}
            </div>
            {!user ? (
              <div className="grid place-items-center rounded-lg border bg-white py-16 text-center" style={{ borderColor: C.border }}>
                <Lock size={30} style={{ color: C.faint }} /><p className="mt-3 text-sm font-semibold" style={{ color: C.muted }}>로그인하면 사용 기록을 볼 수 있어요</p>
                <button onClick={() => requireAuth(() => setSection("history"), "로그인하면 사용 기록을 볼 수 있어요.")} className="lift mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)" }}><LogIn size={15} />로그인</button>
              </div>
            ) : (
              <HistorySearch 
                user={user} 
                sessions={sessions}
                reservations={reservations}
                ROOMS={ROOMS} 
                MEMBERS={MEMBERS} 
                C={C} 
                PASTEL={PASTEL} 
                formatDate={keyOf} 
                formatTime={(dateStr) => {
                  if (!dateStr) return "";
                  const d = dateStr.toDate ? dateStr.toDate() : new Date(dateStr);
                  if (isNaN(d)) return String(dateStr);
                  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                }}
                onEditSession={async (session) => {
                  if (user !== "admin") return;
                  const newEnd = prompt("수정할 종료 시각을 입력하세요 (HH:MM 형식)", "");
                  if (!newEnd || !/^\d{2}:\d{2}$/.test(newEnd)) return alert("취소되었거나 형식이 올바르지 않습니다.");
                  
                  const baseDate = session.checkOutAt ? (session.checkOutAt.toDate ? session.checkOutAt.toDate() : new Date(session.checkOutAt)) : new Date();
                  const [h, m] = newEnd.split(":").map(Number);
                  baseDate.setHours(h, m, 0, 0);

                  const beforeVal = session.checkOutAt ? (session.checkOutAt.toDate ? session.checkOutAt.toDate().toISOString() : session.checkOutAt) : null;
                  const afterVal = baseDate.toISOString();

                  try {
                    await updateDoc(doc(db, "sessions", session.id), {
                      checkOutAt: baseDate,
                      edits: arrayUnion({ by: user, at: new Date().toISOString(), field: "checkOutAt", before: beforeVal, after: afterVal })
                    });
                    setToast("수정되었습니다.");
                  } catch (err) {
                    setToast("수정에 실패했습니다.");
                  }
                }}
              />
            )}
          </section>
        )}


        {section === "dash" && (
          !user ? (
            <div className="grid place-items-center rounded-lg border bg-white py-16 text-center" style={{ borderColor: C.border }}>
              <Lock size={30} style={{ color: C.faint }} /><p className="mt-3 text-sm font-semibold" style={{ color: C.muted }}>로그인하면 대시보드를 볼 수 있어요</p>
              <button onClick={() => requireAuth(() => setSection("dash"), "대시보드를 보려면 로그인이 필요해요.")} className="lift mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)" }}><LogIn size={15} />로그인</button>
            </div>
          ) : (
            <div className="pt-2">
              <Dashboard month={dashMonth} setMonth={setDashMonth} roomF={dashRoom} setRoomF={setDashRoom} now={now} reservations={myDashRes} onSelectEvent={setDetail} />
            </div>
          )
        )}
        {section === "admin" && user === "admin" && (
          <MemberManagement 
            onBack={() => setSection("book")} 
            membersList={membersList} 
            handleToggleMemberActive={handleToggleMemberActive}
            handleAddMember={handleAddMember}
            handleDeleteMember={handleDeleteMember}
            Avatar={(props) => <Avatar {...props} dbProfiles={dbProfiles} />}
          />
        )}
        {section === "stats" && user === "admin" && (
          <AdminDashboard sessions={sessions} reservations={reservations} now={now} resources={ROOMS} />
        )}
      </main>

      {/* ===== mobile bottom nav ===== */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t md:hidden" style={{ background: theme === "dark" ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,.92)", borderColor: C.border, backdropFilter: "blur(10px)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {NAV.filter(([k]) => k !== "install").map(([k, lbl, Icon]) => { const on = section === k; return (
            <button key={k} id={`nav-btn-${k}`} onClick={() => setSection(k)} className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium" style={{ color: on ? C.ink : (theme === "dark" ? "#D1D5DB" : C.faint) }}>
              {on && <span className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-lg" style={{ background: C.ink }} />}
              <Icon size={20} />{lbl}{k === "mine" && myRes.length ? ` ${myRes.length}` : ""}
            </button>
          ); })}
        </div>
      </nav>


      {/* ===== Booking modal ===== */}
      {form && (
        <div className="ov fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => { setShowStartList(false); setShowEndList(false); }}>
          <div id="mForm" className="sheet w-full rounded-t-lg bg-white sm:max-w-md sm:rounded-lg" style={{ maxHeight: "92vh", boxShadow: "0 -4px 12px rgba(0,0,0,.08)" }} onClick={(e) => { e.stopPropagation(); setShowStartList(false); setShowEndList(false); }}>
            <div className="sc max-h-[92vh] overflow-y-auto p-6">
              {(() => {
                const isWorkroom = form.resourceId === 'workroom' || form.roomId === 'workroom';
                const isPrinter = form.resourceId === 'bambu-1' || form.resourceId === 'bambu-2' || form.roomId === 'bambu-1' || form.roomId === 'bambu-2' || selectedResource?.type === 'equipment';
                const modalTitle = form.id ? "예약 수정" : isPrinter ? "3D 프린터 예약" : isWorkroom ? "워크룸 예약" : "회의실 예약";
                const titleLabel = isPrinter ? "출력물 이름" : isWorkroom ? "어떤 프로젝트 때문에 쓰시나요?" : "회의 제목";
                const titlePh = isPrinter ? "예: LG 웰컴키트 트레이" : isWorkroom ? "예: LG 웰컴키트 리서치" : "예: OOO 프로젝트_아이데이션 회의";
                const dropdownLabel = isPrinter ? "기계" : "회의실";
                const dropdownOptions = isPrinter 
                  ? [["bambu-1", "968 (LEFT)"], ["bambu-2", "990 (RIGHT)"]]
                  : ROOMS.filter(r => r.group === "meeting").map((r) => [r.id, `${r.name} · ${r.capacity}명`]);

                return (
                  <>
                    <div className="flex items-center justify-between"><h3 className="text-lg font-medium">{modalTitle}</h3><button onClick={() => setForm(null)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button></div>
                    <div className="mt-5 space-y-4">
                      <Field label={titleLabel} error={errs.title}>
                        <input value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); setErrs((x) => ({ ...x, title: undefined })); }} placeholder={titlePh} className="inp w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none" style={{ borderColor: errs.title ? "#C0392B" : C.border }} />
                      </Field>
                      {!isWorkroom && (
                        <Field label={dropdownLabel}><SelectBox value={form.roomId || form.resourceId} onChange={(v) => setForm({ ...form, roomId: v, resourceId: v })} options={dropdownOptions} /></Field>
                      )}
                      <Field label="날짜">
                        <input type="date" value={form.date} onClick={(e) => { try { e.target.showPicker(); } catch(err) {} }} onChange={(e) => setForm({ ...form, date: e.target.value })} className="inp w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none cursor-pointer" style={{ borderColor: C.border, background: "var(--bg-select)" }} />
                      </Field>
                <Field label="시간" error={errs.time}>
                  <div className="flex flex-col gap-2.5">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      {/* Start Time Combobox */}
                      <div className="relative flex-1" onClick={(e) => e.stopPropagation()}>
                        <div
                          className="flex items-center justify-between rounded-lg border pl-3.5 pr-2.5 py-2.5 text-sm font-medium cursor-pointer"
                          style={{ borderColor: errs.time ? "#C0392B" : C.border, background: "var(--bg-input)" }}
                          onClick={() => {
                            setShowStartList(!showStartList);
                            setShowEndList(false);
                          }}
                        >
                          <input
                            type="text"
                            value={form.start}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = e.target.value;
                              const sMin = toMin(v);
                              const currE = toMin(form.end);
                              setForm(prev => {
                                const newForm = { ...prev, start: v };
                                if (!isNaN(sMin) && !isNaN(currE) && currE <= sMin) {
                                  newForm.end = toHHMM(Math.min(sMin + 10, DAY_END));
                                }
                                return newForm;
                              });
                              setErrs((x) => ({ ...x, time: undefined }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                if (e.key === "Enter") e.preventDefault();
                                let v = e.target.value.replace(/[^0-9]/g, "");
                                if (v.length === 3 || v.length === 4) {
                                  const h = v.length === 3 ? v.slice(0, 1) : v.slice(0, 2);
                                  const m = v.length === 3 ? v.slice(1) : v.slice(2);
                                  const formatted = `${h.padStart(2, '0')}:${m}`;
                                  const sMin = toMin(formatted);
                                  const currE = toMin(form.end);
                                  setForm(prev => {
                                    const newForm = { ...prev, start: formatted };
                                    if (!isNaN(sMin) && !isNaN(currE) && currE <= sMin) {
                                      newForm.end = toHHMM(Math.min(sMin + 10, DAY_END));
                                    }
                                    return newForm;
                                  });
                                }
                                setShowStartList(false);
                              }
                            }}
                            placeholder="09:00"
                            className="bg-transparent outline-none w-14 font-medium text-sm"
                            style={{ color: C.ink }}
                          />
                          <ChevronDown size={16} className="text-[var(--faint)]" />
                        </div>
                        {showStartList && (() => {
                          const closestStart = getClosestTime(form.start);
                          return (
                            <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border bg-white shadow-lg py-1" style={{ borderColor: C.border }}>
                              {TIMES.map(t => {
                                const isSelected = t === closestStart;
                                return (
                                  <div
                                    key={`s-opt-${t}`}
                                    ref={(el) => {
                                      if (el && isSelected && !hasScrolledStartRef.current) {
                                        hasScrolledStartRef.current = true;
                                        requestAnimationFrame(() => {
                                          el.scrollIntoView({ block: "nearest" });
                                        });
                                      }
                                    }}
                                    onClick={() => {
                                      const sMin = toMin(t);
                                      const currE = toMin(form.end);
                                      setForm(prev => {
                                        const newForm = { ...prev, start: t };
                                        if (!isNaN(sMin) && !isNaN(currE) && currE <= sMin) {
                                          newForm.end = toHHMM(Math.min(sMin + 10, DAY_END));
                                        }
                                        return newForm;
                                      });
                                      setErrs((x) => ({ ...x, time: undefined }));
                                      setShowStartList(false);
                                    }}
                                    className="px-3.5 py-2 text-sm hover:bg-[var(--bg-secondary)] cursor-pointer font-medium text-left"
                                    style={{ color: C.ink, background: isSelected ? "var(--bg-secondary)" : "transparent" }}
                                  >
                                    {t}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>

                      <span className="text-[13px] font-bold" style={{ color: C.muted }}>~</span>

                      {/* End Time Combobox */}
                      <div className="relative flex-1" onClick={(e) => e.stopPropagation()}>
                        <div
                          className="flex items-center justify-between rounded-lg border pl-3.5 pr-2.5 py-2.5 text-sm font-medium cursor-pointer"
                          style={{ borderColor: errs.time ? "#C0392B" : C.border, background: "var(--bg-input)" }}
                          onClick={() => {
                            setShowEndList(!showEndList);
                            setShowStartList(false);
                          }}
                        >
                          <input
                            type="text"
                            value={form.end}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = e.target.value;
                              setForm({ ...form, end: v });
                              setErrs((x) => ({ ...x, time: undefined }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                if (e.key === "Enter") e.preventDefault();
                                let v = e.target.value.replace(/[^0-9]/g, "");
                                if (v.length === 3 || v.length === 4) {
                                  const h = v.length === 3 ? v.slice(0, 1) : v.slice(0, 2);
                                  const m = v.length === 3 ? v.slice(1) : v.slice(2);
                                  const formatted = `${h.padStart(2, '0')}:${m}`;
                                  setForm(prev => ({ ...prev, end: formatted }));
                                }
                                setShowEndList(false);
                              }
                            }}
                            placeholder="10:00"
                            className="bg-transparent outline-none w-14 font-medium text-sm"
                            style={{ color: C.ink }}
                          />
                          <ChevronDown size={16} className="text-[var(--faint)]" />
                        </div>
                        {showEndList && (() => {
                          const closestEnd = getClosestTime(form.end);
                          return (
                            <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border bg-white shadow-lg py-1" style={{ borderColor: C.border }}>
                              {TIMES.map(t => {
                                const isSelected = t === closestEnd;
                                return (
                                  <div
                                    key={`e-opt-${t}`}
                                    ref={(el) => {
                                      if (el && isSelected && !hasScrolledEndRef.current) {
                                        hasScrolledEndRef.current = true;
                                        requestAnimationFrame(() => {
                                          el.scrollIntoView({ block: "nearest" });
                                        });
                                      }
                                    }}
                                    onClick={() => {
                                      setForm({ ...form, end: t });
                                      setErrs((x) => ({ ...x, time: undefined }));
                                      setShowEndList(false);
                                    }}
                                    className="px-3.5 py-2 text-sm hover:bg-[var(--bg-secondary)] cursor-pointer font-medium text-left"
                                    style={{ color: C.ink, background: isSelected ? "var(--bg-secondary)" : "transparent" }}
                                  >
                                    {t}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {(() => {
                      const isWorkroom = form.resourceId === 'workroom' || form.roomId === 'workroom';
                      const isPrinter = form.resourceId === 'bambu-1' || form.resourceId === 'bambu-2' || form.roomId === 'bambu-1' || form.roomId === 'bambu-2' || selectedResource?.type === 'equipment';
                      const quickBtns = isPrinter
                        ? [{ label: "+1시간", mins: 60 }, { label: "+2시간", mins: 120 }, { label: "+4시간", mins: 240 }]
                        : isWorkroom
                        ? [{ label: "+30분", mins: 30 }, { label: "+1시간", mins: 60 }, { label: "+2시간", mins: 120 }]
                        : [{ label: "+5분", mins: 5 }, { label: "+10분", mins: 10 }, { label: "+15분", mins: 15 }];
                      const isNextDay = form.end && form.start && toMin(form.end) <= toMin(form.start) && form.end !== form.start;
                      const startMin = toMin(form.start);
                      const rawEndMin = toMin(form.end || form.start);
                      const totalMins = isNextDay ? (rawEndMin + 1440 - startMin) : Math.max(0, rawEndMin - startMin);

                      return (
                        <>
                          <div className="flex gap-1.5">
                            {quickBtns.map((btn) => (
                              <button
                                key={btn.label}
                                type="button"
                                onClick={() => {
                                  const startMin = toMin(form.start);
                                  const currentEndMin = toMin(form.end || form.start);
                                  let baseMin = currentEndMin <= startMin && currentEndMin !== startMin ? currentEndMin + 1440 : currentEndMin;
                                  if (baseMin < startMin) baseMin = startMin;
                                  let newEndMin = baseMin + btn.mins;
                                  const newEndMinInDay = newEndMin % 1440;
                                  setForm({ ...form, end: toHHMM(newEndMinInDay) });
                                  setErrs((x) => ({ ...x, time: undefined }));
                                }}
                                className="lift flex-1 rounded-[6px] border py-2 text-[12px] font-bold transition-all active:scale-95 shadow-sm"
                                style={{ borderColor: C.border, color: C.ink, background: "var(--bg-input)" }}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                          {isNextDay && (
                            <div style={{ fontSize: "12.5px", color: "var(--warn)", fontWeight: 600, marginTop: "9px" }}>
                              다음 날 {form.end}까지 이어집니다 · 총 {Math.floor(totalMins / 60)}시간 {totalMins % 60}분
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </Field>

                {(() => {
                  const isWorkroom = form.resourceId === 'workroom' || form.roomId === 'workroom';
                  const isPrinter = form.resourceId === 'bambu-1' || form.resourceId === 'bambu-2' || form.roomId === 'bambu-1' || form.roomId === 'bambu-2' || selectedResource?.type === 'equipment';
                  const isMeet = !isWorkroom && !isPrinter;

                  if (isMeet) {
                    return (
                      <>
                        {selectedResource?.policy?.allowUrgentOverride === true && (
                          <div className="flex flex-col gap-2 rounded-lg border p-3 mt-1" style={{ borderColor: form.isUrgent ? PASTEL.red.line : C.border, background: form.isUrgent ? PASTEL.red.bg : "transparent" }}>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={form.isUrgent || false} onChange={(e) => setForm({ ...form, isUrgent: e.target.checked })} className="w-4 h-4" style={{ accentColor: PASTEL.red.dot }} />
                              <span className="text-sm font-bold" style={{ color: form.isUrgent ? PASTEL.red.text : C.ink }}>🚨 중요 회의 (겹치는 예약을 뒤로 미룹니다)</span>
                            </label>
                            {form.isUrgent && (
                              <input 
                                value={form.urgentComment || ""} 
                                onChange={(e) => setForm({ ...form, urgentComment: e.target.value })} 
                                placeholder="사유 (기존 예약자에게 알림으로 전송됩니다)" 
                                className="inp w-full mt-1 rounded border px-3 py-2 text-xs outline-none bg-white" 
                                style={{ borderColor: PASTEL.red.line, color: C.text }} 
                              />
                            )}
                          </div>
                        )}
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-xs font-medium" style={{ color: C.muted }}>참석자 <span style={{ color: "var(--faint)" }}>· 참석 인원 {(form.attendees || []).length}명</span></span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: errs.att ? "#C0392B" : C.border, background: "var(--bg-secondary)", minHeight: 46 }}>
                            {(form.attendees || []).length ? (form.attendees || []).map((id) => {
                              const m = M(id);
                              if (!m) return null;
                              return (
                                <span key={id} className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-[13px]" style={{ background: "var(--bg-chip)", color: C.text }}>
                                  <span className="h-2 w-2 rounded-full" style={{ background: C.muted }} />
                                  <span><span className="font-bold">{m.team}</span> <span className="font-medium">{nameWithNim(m.name)}</span></span>
                                  <button 
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setForm({ ...form, attendees: form.attendees.filter(x => x !== id) });
                                    }}
                                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 transition-all text-xs font-semibold ml-0.5 opacity-60 hover:opacity-100"
                                  >
                                    <X size={10} />
                                  </button>
                                </span>
                              );
                            }) : <span className="text-sm" style={{ color: C.faint }}>선택된 참석자가 없어요</span>}
                          </div>
                          {errs.att && <div className="mt-1.5 flex items-center gap-1 text-xs font-semibold" style={{ color: PASTEL.red.text }}><AlertCircle size={12} />{errs.att}</div>}
                          <button onClick={openPicker} className="lift mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium" style={{ borderColor: C.ink, color: C.ink }}><UserPlus size={16} /> 참석자 선택</button>
                        </div>
                      </>
                    );
                  }

                  if (isWorkroom) {
                    const activeCount = sessions.filter(s => 
                      s.resourceId === 'workroom' && 
                      !s.checkOutAt &&
                      reservations.some(r => r.id === s.reservationId && r.date === keyOf(now))
                    ).length;
                    const isFull = activeCount >= 3;
                    return (
                      <div className={`rounded-lg border p-3.5 text-xs font-semibold ${isFull ? 'border-red-400 bg-red-50 text-red-600' : ''}`} style={{ borderColor: isFull ? undefined : C.border, background: isFull ? undefined : "var(--bg-secondary)", color: isFull ? undefined : C.text }}>
                        정원 3명 · 지금 {activeCount}명 이용 중 · {Math.max(0, 3 - activeCount)}자리 남음
                      </div>
                    );
                  }

                  if (isPrinter) {
                    return (
                      <div className="rounded-lg border p-3.5 text-xs font-semibold" style={{ borderColor: C.border, background: "var(--bg-secondary)", color: C.text }}>
                        24시간 · 주말에도 예약할 수 있습니다
                      </div>
                    );
                  }

                  return null;
                })()}

                {form.id && (
                  <div className="mt-4 border-t pt-4" style={{ borderColor: C.border }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold" style={{ color: C.text }}>💬 댓글</span>
                      <span className="text-[10px]" style={{ color: C.faint }}>{(form.comments || []).length}개</span>
                    </div>
                    <div className="max-h-[120px] overflow-y-auto space-y-2 mb-3 pr-1 sc no-scrollbar">
                      {(form.comments || []).length === 0 ? (
                        <p className="text-[11px] text-center py-2" style={{ color: C.faint }}>등록된 댓글이 없습니다.</p>
                      ) : (
                        (form.comments || []).map(c => (
                          <div key={c.id} className="text-[11px] p-2 rounded-lg" style={{ background: "var(--bg-secondary)", border: `1px solid ${C.border}` }}>
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold">{nameWithNim(c.user)}</span>
                                <span className="text-[9px]" style={{ color: C.faint }}>{c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                              </div>
                              {user && (c.user === user || user === "admin") && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteComment(form.id, c.id);
                                  }}
                                  className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </div>
                            <p style={{ color: C.text }} className="break-all whitespace-pre-wrap">{c.text}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          id="comment-input-edit"
                          placeholder="댓글 내용을 입력하세요..." 
                          className="inp flex-1 rounded border px-3 py-2 text-xs outline-none bg-white" 
                          style={{ borderColor: C.border }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = e.target.value;
                              handleAddComment(form.id, val);
                              e.target.value = '';
                            }
                          }}
                        />
                        <button 
                          onClick={() => {
                            const input = document.getElementById("comment-input-edit");
                            if (input) {
                              handleAddComment(form.id, input.value);
                              input.value = '';
                            }
                          }}
                          className="lift w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm active:scale-95 transition-all" 
                          style={{ 
                            backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f0efea', 
                            color: theme === 'dark' ? '#ffffff' : '#121212' 
                          }}
                        >
                          <ArrowUp size={18} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-6 flex gap-2.5">
                {form.id && canDelete(form) && (
                  <button onClick={() => cancelRes(form.id)} className="lift rounded-lg px-4 py-3 text-sm font-medium" style={{ background: PASTEL.red.bg, color: PASTEL.red.text }}><Trash2 size={15} /></button>
                )}
                <button onClick={() => setForm(null)} className="lift flex-1 rounded-lg border py-3 text-sm font-medium" style={{ borderColor: C.border, color: C.muted }}>취소</button>
                <button 
                  onClick={() => {
                    if (isPrinter || isWorkroom) {
                      setConfirmModalData(form);
                      setCheckedNotices({});
                    } else {
                      saveForm();
                    }
                  }} 
                  disabled={isSubmitting}
                  className="lift flex flex-[2] items-center justify-center gap-1.5 rounded-lg py-3 text-sm font-medium" 
                  style={{ 
                    background: isSubmitting ? "#a0aec0" : "#2383E2", 
                    color: "#fff", 
                    boxShadow: "0 1px 2px rgba(0,0,0,.05)",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                    opacity: isSubmitting ? 0.7 : 1
                  }}
                >
                  <Check size={16} /> {isSubmitting ? "처리 중..." : (form.id ? "수정 완료" : "지금 예약하기")}
                </button>
              </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ===== Attendee picker ===== */}
      {pickerOpen && (
        <div className="ov fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setPickerOpen(false)}>
          <div className="sheet flex w-full flex-col rounded-t-lg bg-white sm:max-w-2xl sm:rounded-lg" style={{ maxHeight: "90vh", boxShadow: "0 -4px 12px rgba(0,0,0,.08)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: C.border }}>
              <div><h3 className="text-lg font-medium">참석자 선택</h3><p className="text-xs" style={{ color: C.faint }}>멤버를 끌어다 놓거나 눌러서 추가하세요</p></div>
              <button onClick={() => setPickerOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button>
            </div>
            <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
              {/* dropzone (top on mobile / right on desktop) */}
              <div className="order-1 flex shrink-0 flex-col border-b p-3 md:order-2 md:w-1/2 md:border-b-0 md:border-l" style={{ borderColor: C.border }}>
                <div className="mb-2 px-1 flex justify-between items-center text-xs font-medium" style={{ color: C.muted }}>
                  <span>참석자 ({temp.length})</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => toggleTemp("m_client")}
                      className={`hover:underline text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${temp.includes("m_client") ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400" : "bg-black/5 text-slate-700 dark:bg-white/5 dark:text-slate-300"}`}
                    >
                      {temp.includes("m_client") ? "클라이언트 제거" : "+ 클라이언트 추가"}
                    </button>
                    <button 
                      onClick={() => {
                        const normalMembers = MEMBERS.filter(m => !m.inactive && (m.group === "director" || m.group === "staff"));
                        const allSelected = normalMembers.every(m => temp.includes(m.id));
                        if (allSelected) {
                          setTemp(temp.filter(id => !normalMembers.some(nm => nm.id === id)));
                        } else {
                          const newTemp = new Set([...temp, ...normalMembers.map(m => m.id)]);
                          setTemp(Array.from(newTemp));
                        }
                      }}
                      className="hover:underline text-[11px] px-1 py-0.5 rounded"
                      style={{ color: C.ink }}
                    >
                      {MEMBERS.filter(m => !m.inactive && (m.group === "director" || m.group === "staff")).every(m => temp.includes(m.id)) ? "전체 해제" : "전체 선택"}
                    </button>
                  </div>
                </div>
                <div onDragOver={(e) => { e.preventDefault(); setDz(true); }} onDragLeave={() => setDz(false)} onDrop={(e) => { e.preventDefault(); addTemp(e.dataTransfer.getData("text/plain")); setDz(false); }}
                  className="sc overflow-y-auto rounded-lg border-2 border-dashed p-3" style={{ borderColor: dz ? C.ink : C.border, background: dz ? C.yellowSoft : "var(--bg-secondary)", minHeight: 120, maxHeight: 220 }}>
                  {temp.length === 0 ? (
                    <div className="grid h-full place-items-center py-6 text-center"><div><UserPlus size={26} style={{ color: C.faint }} className="mx-auto" /><p className="mt-2 text-xs font-semibold" style={{ color: C.faint }}>여기로 멤버를 끌어다 놓으세요</p></div></div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {temp.map((id) => { const m = M(id); return (
                        <span key={id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium" style={{ borderColor: C.border, background: "var(--bg-input)" }}>
                          <TeamTag team={m?.team} /><span>{nameWithNim(m?.name)}</span>
                          <button onClick={() => toggleTemp(id)} className="grid h-4 w-4 place-items-center rounded-lg" style={{ background: "var(--bg-chip)" }}><X size={11} /></button>
                        </span>
                      ); })}
                    </div>
                  )}
                </div>
              </div>
              {/* roster */}
              <div className="sc order-2 flex-1 overflow-y-auto p-3 md:order-1">
                {[["director", "디렉터"], ["staff", "임직원"]].map(([g, label]) => {
                  const rows = (membersList || MEMBERS).filter((m) => m.group === g && m.active !== false && !m.inactive);
                  return (
                    <div key={g} className="mb-2">
                      <div className="px-1.5 py-1 text-xs font-medium" style={{ color: C.muted }}>{label} ({rows.length})</div>
                      {rows.map((m) => { const on = temp.includes(m.id), me = m.id === getMeId(); return (
                        <div key={m.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", m.id); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => toggleTemp(m.id)}
                          className="mrow mb-1 flex items-center gap-2.5 rounded-lg border px-2.5 py-2" style={{ borderColor: on ? C.ink : "transparent", background: on ? C.yellowSoft : "transparent" }}>
                          <GripVertical size={14} style={{ color: C.faint }} className="hidden sm:block" />
                          <Avatar name={m.name} size={32} />
                          <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><TeamTag team={m.team} /><span className="truncate text-sm font-medium">{nameWithNim(m.name)}{me ? " (나)" : ""}</span></div><div className="text-[11px]" style={{ color: C.faint }}>{m.role}</div></div>
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-lg border" style={on ? { background: C.ink, borderColor: C.ink } : { borderColor: C.border }}>{on && <Check size={13} color={C.yellow} />}</span>
                        </div>
                      ); })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2.5 border-t px-5 py-4" style={{ borderColor: C.border }}>
              <button onClick={() => setTemp([])} className="text-xs font-medium" style={{ color: C.muted }}>전체 비우기</button>
              <div className="flex gap-2.5">
                <button onClick={() => setPickerOpen(false)} className="lift rounded-lg border px-5 py-2.5 text-sm font-medium" style={{ borderColor: C.border, color: C.muted }}>취소</button>
                <button onClick={donePicker} className="lift flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-sm font-medium" style={{ background: C.ink, color: "var(--bg)", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}><Check size={16} />완료 ({temp.length})</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Day Events Popup Modal ===== */}
      {dayEventsDate && (() => {
        const dateStr = keyOf(dayEventsDate);
        const list = (byDate[dateStr] || []).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
        return (
          <div className="ov fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setDayEventsDate(null)}>
            <div className="sheet w-full max-w-md rounded-2xl bg-white p-6 flex flex-col max-h-[85vh] sm:max-h-[75vh] shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b pb-3 mb-4 shrink-0" style={{ borderColor: C.border }}>
                <div className="flex items-center gap-2">
                  <CalendarDays size={20} style={{ color: C.ink }} />
                  <h3 className="text-lg font-bold" style={{ color: C.text }}>{fmtK(dayEventsDate)} 예약 일정</h3>
                </div>
                <button onClick={() => setDayEventsDate(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors" style={{ color: C.faint }}><X size={18} /></button>
              </div>
              
              <div className="sc overflow-y-auto pr-1 flex-1 space-y-3" style={{ maxHeight: "360px" }}>
                {list.length === 0 ? (
                  <div className="py-12 text-center text-sm font-medium" style={{ color: C.muted }}>등록된 일정이 없습니다.</div>
                ) : (
                  list.map((r) => {
                    const p = r.isUrgent ? pal('red') : pal('green');
                    const rm = ROOMS.find((x) => x.id === r.roomId);
                    return (
                      <div
                        key={r.id}
                        onClick={() => { setDayEventsDate(null); setDetail(r); }}
                        className="blk rounded-xl border p-4 transition-all hover:scale-[1.01] cursor-pointer flex flex-col gap-2"
                        style={{ background: p.bg, borderColor: p.line, color: p.text }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.dot }} />
                            <span className="text-[15px] font-bold truncate">{r.title}</span>
                            {r.repeat && <Repeat size={12} className="shrink-0" />}
                          </div>
                          <span className="shrink-0 text-xs font-semibold rounded-md px-2.5 py-1 shadow-xs" style={{ background: theme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.75)", color: p.text }}>
                            {rm?.name || (r.roomId === 'meeting-room' ? '큰 회의실' : '회의실')}
                          </span>
                        </div>
                        <div className="text-[13px] opacity-90 space-y-1 font-medium pl-4">
                          <div className="flex items-center gap-1.5"><Clock size={13} style={{ opacity: 0.75 }} /> {r.start} ~ {r.end}</div>
                          <div className="flex items-center gap-1.5"><User size={13} style={{ opacity: 0.75 }} /> 등록자: {nameWithNim(r.owner)} · 참석자: {r.attendees ? r.attendees.length : 0}명</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              <div className="mt-4 border-t pt-4 flex flex-col shrink-0" style={{ borderColor: C.border }}>
                <button
                  onClick={() => {
                    const targetDate = dayEventsDate;
                    setDayEventsDate(null);
                    tryCreate(roomId === "all" ? "big" : roomId, defStart(), keyOf(targetDate));
                  }}
                  className="lift flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.99]"
                  style={{ background: C.ink, color: "var(--bg)", boxShadow: "0 2px 4px rgba(0,0,0,.08)" }}
                >
                  <Plus size={16} /> 회의실 예약하기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== Notice Modal ===== */}
      {noticeTarget && (
        <NoticeModal 
          notice={resources.find(r => r.id === (noticeTarget.resourceId || 'meeting-room'))?.policy?.notice || []} 
          onClose={() => setNoticeTarget(null)}
          onConfirm={() => {
            const target = noticeTarget;
            setNoticeTarget(null);
            handleStartSession(target);
          }}
        />
      )}

      {/* ===== Detail ===== */}
      {detail && (
        <div className="ov fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setDetail(null)}>
          <div className="sheet w-full rounded-t-lg bg-white p-6 sm:max-w-sm sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b pb-3 mb-3" style={{ borderColor: C.border }}><span className="h-3 w-3 rounded-full" style={{ background: detail.isUrgent ? pal('red').dot : pal('green').dot }} /><h3 className="text-[17px] font-semibold">{detail.title}</h3></div>
            {(() => {
              const isPrinter = detail.resourceId === 'bambu-1' || detail.resourceId === 'bambu-2' || detail.roomId === 'bambu-1' || detail.roomId === 'bambu-2';
              return (
                <div className="space-y-1">
                  <DetailRow icon={Clock} label="시간" value={`${detail.date} ${detail.start} ~ ${detail.end}`} />
                  <DetailRow icon={Users} label={isPrinter ? "사용자" : "참석자"} value={detail.attendees.length ? detail.attendees.map(memLabel).join(", ") : "없음"} />
                  <DetailRow icon={User} label="등록자" value={`${nameWithNim(detail.owner)}`} />
                </div>
              );
            })()}
            
            {/* 💬 댓글 목록 */}
            <div className="mt-4 border-t pt-4" style={{ borderColor: C.border }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-bold" style={{ color: C.text }}>💬 댓글</span>
                <span className="text-[10px]" style={{ color: C.faint }}>{(detail.comments || []).length}개</span>
              </div>
              <div className="max-h-[120px] overflow-y-auto space-y-2 mb-3 pr-1 sc no-scrollbar">
                {(detail.comments || []).length === 0 ? (
                  <p className="text-[11px] text-center py-2" style={{ color: C.faint }}>등록된 댓글이 없습니다.</p>
                ) : (
                  (detail.comments || []).map(c => (
                    <div key={c.id} className="text-[11px] p-2 rounded-lg" style={{ background: "var(--bg-secondary)", border: `1px solid ${C.border}` }}>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{nameWithNim(c.user)}</span>
                          <span className="text-[9px]" style={{ color: C.faint }}>{c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                        </div>
                        {user && (c.user === user || user === "admin") && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteComment(detail.id, c.id);
                            }}
                            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                      <p style={{ color: C.text }} className="break-all whitespace-pre-wrap">{c.text}</p>
                    </div>
                  ))
                )}
              </div>
              {user ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      id="comment-input-detail"
                      placeholder="댓글 내용을 입력하세요..." 
                      className="inp flex-1 rounded border px-3 py-2 text-xs outline-none bg-white" 
                      style={{ borderColor: C.border }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.target.value;
                          handleAddComment(detail.id, val);
                          e.target.value = '';
                        }
                      }}
                    />
                    <button 
                      onClick={() => {
                        const input = document.getElementById("comment-input-detail");
                        if (input) {
                          handleAddComment(detail.id, input.value);
                          input.value = '';
                        }
                      }}
                      className="lift w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm active:scale-95 transition-all" 
                      style={{ 
                        backgroundColor: theme === 'dark' ? '#2a2a2a' : '#f0efea', 
                        color: theme === 'dark' ? '#ffffff' : '#121212' 
                      }}
                    >
                      <ArrowUp size={18} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-center" style={{ color: C.faint }}>로그인 후 댓글을 작성할 수 있습니다.</p>
              )}
            </div>
            
            {/* 🟢 사용 시작/종료 버튼 */}
            {(() => {
              if (!user) return null;
              const isAttendeeOrOwner = detail.owner === user || (detail.attendees && detail.attendees.includes(MEMBERS.find(m => m.name === user)?.id));
              if (!isAttendeeOrOwner) return null;

              const activeDetailSession = sessions.find(s => s.reservationId === detail.id && !s.checkOutAt);
              
              if (activeDetailSession) {
                return (
                  <div className="mt-4 border-t pt-4" style={{ borderColor: C.border }}>
                    <button onClick={() => handleEndSession(activeDetailSession)} className="lift flex w-full items-center justify-center gap-1.5 rounded-lg py-3 text-[14px] font-bold shadow-sm" style={{ background: PASTEL.red.bg, color: PASTEL.red.text }}>
                      <Square size={16} fill="currentColor" /> 사용 종료
                    </button>
                  </div>
                );
              } else {
                if (detail.date === keyOf(now)) {
                  return (
                    <div className="mt-4 border-t pt-4" style={{ borderColor: C.border }}>
                      <button onClick={() => handleStartSession(detail)} className="lift flex w-full items-center justify-center gap-1.5 rounded-lg py-3 text-[14px] font-bold shadow-sm text-white" style={{ background: "var(--mob-free-bg)" }}>
                        <Play size={16} fill="currentColor" /> 사용 시작
                      </button>
                    </div>
                  );
                }
              }
              return null;
            })()}
            
            {/* 🚨 중요 사용 요청 */}
            {user && detail.owner !== user && (() => {
              const [y, mo, da] = detail.date.split("-").map(Number);
              const d = new Date(y, mo - 1, da);
              const isEnded = d < dayOnly(now) || (sameDay(d, now) && toMin(detail.end) <= nowMin);
              return !isEnded;
            })() && (
              <div className="mt-4 border-t pt-4" style={{ borderColor: C.border }}>
                {!requestUrgentOpen ? (
                  <button onClick={() => setRequestUrgentOpen(true)} className="lift flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500 bg-red-50 py-2.5 text-[13px] font-bold text-red-600">
                    <AlertCircle size={15} /> 이 회의실을 중요하게 사용해야 하나요?
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-bold text-red-600">🚨 참석자에게 양보 요청 알림 보내기</span>
                    <input 
                      autoFocus
                      value={urgentMessage}
                      onChange={e => setUrgentMessage(e.target.value)}
                      placeholder="사유 (예: 급한 손님이 오셔서 회의실이 필요합니다ㅠㅠ)" 
                      className="inp w-full rounded border px-3 py-2 text-xs outline-none bg-white" 
                      style={{ borderColor: PASTEL.red.line }}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRequestUrgentOpen(false); setUrgentMessage(""); }} className="lift rounded border px-3 py-1.5 text-xs font-semibold flex-1" style={{ borderColor: C.border, color: C.muted }}>취소</button>
                      <button onClick={() => {
                        sendPushNotification('🚨 회의실 중요 사용 요청', `${nameWithNim(user)}이 중요 사용을 요청했습니다: "${urgentMessage || '가능하시다면 양보 부탁드립니다ㅠㅠ'}"`, detail.attendees);
                        showToast('중요 요청 알림을 전송했습니다.');
                        setRequestUrgentOpen(false);
                        setUrgentMessage("");
                      }} className="lift rounded px-3 py-1.5 text-xs font-semibold flex-1" style={{ background: PASTEL.red.bg, color: PASTEL.red.text }}>보내기</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className="mt-6 flex gap-2 justify-end">
              {canEdit(detail) && (
                <button onClick={() => { const d = detail; setDetail(null); setRoomId(d.roomId); openEdit(d); }} className="lift rounded-lg border px-4 py-2 text-xs font-semibold" style={{ background: C.ink, borderColor: C.ink, color: "var(--bg)" }}>수정</button>
              )}
              {canDelete(detail) && (
                <button onClick={() => cancelRes(detail.id)} className="lift rounded-lg px-4 py-2 text-xs font-semibold" style={{ background: PASTEL.red.bg, color: PASTEL.red.text }}>삭제</button>
              )}
              <button onClick={() => { setDetail(null); setRequestUrgentOpen(false); setUrgentMessage(""); }} className="lift rounded-lg border px-4 py-2 text-xs font-semibold" style={{ borderColor: C.border, color: C.muted }}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Login modal ===== */}
      {authOpen && <LoginModal message={authMsg} onClose={() => { setAuthOpen(false); setAuthPending(null); }} onLogin={doLogin} membersList={membersList} />}

      {/* ===== Profile Image Edit Menu ===== */}
      {showProfileMenu && (
        <div className="ov fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setShowProfileMenu(false)}>
          <div className="sheet w-full max-w-xs rounded-lg bg-white p-5 flex flex-col" style={{ boxShadow: "0 4px 12px rgba(0,0,0,.12)" }} onClick={(e) => e.stopPropagation()}>
            <h4 className="text-[14px] font-semibold text-center mb-4">프로필 이미지 설정</h4>
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => {
                  setShowProfileMenu(false);
                  fileInputRef.current?.click();
                }}
                className="lift rounded-lg border py-2.5 text-xs font-semibold text-center w-full"
                style={{ borderColor: C.border, color: C.ink }}
              >
                프로필 이미지 추가하기
              </button>
              {hasCustomProfileImage && (
                <button 
                  onClick={handleDeleteProfileImage}
                  className="lift rounded-lg border py-2.5 text-xs font-semibold text-center w-full"
                  style={{ borderColor: C.border, color: PASTEL.red.text }}
                >
                  프로필 이미지 삭제하기
                </button>
              )}
              <button 
                onClick={() => setShowProfileMenu(false)}
                className="lift mt-2 rounded-lg py-2.5 text-xs font-semibold text-center w-full text-gray-500"
                style={{ background: "var(--bg-input)" }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global File Input for profile upload */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

      {/* ===== Hamburger Menu Drawer ===== */}
      {menuDrawerOpen && (
        <div className="fixed inset-0 z-[110] flex justify-end">
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
            onClick={() => setMenuDrawerOpen(false)}
          />
          {/* Drawer Panel */}
          <div 
            className="relative w-[280px] h-full flex flex-col justify-between p-6 shadow-2xl transition-transform duration-300 ease-out"
            style={{ 
              background: theme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderLeft: `1px solid ${C.border}`,
              color: C.text
            }}
          >
            <div>
              {/* Header inside Drawer */}
              <div className="flex items-center justify-between pb-4 border-b" style={{ borderColor: C.border }}>
                <Wordmark size={18} />
                <button 
                  onClick={() => setMenuDrawerOpen(false)} 
                  className="p-1 hover:opacity-80"
                >
                  <X size={20} />
                </button>
              </div>

              {/* User profile section */}
              <div className="py-5">
                {user ? (
                  <div 
                    className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                    onClick={() => {
                      setSection("mypage");
                      setMenuDrawerOpen(false);
                    }}
                  >
                    <div className="relative shrink-0" onClick={(e) => { e.stopPropagation(); setShowProfileMenu(true); }} title="프로필 설정">
                      <Avatar name={user} size={38} />
                      <div className="absolute inset-0 bg-black/35 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 active:opacity-100 transition-opacity">
                        <span className="text-[8px] text-white font-semibold text-center">편집</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[15px] flex items-center gap-1">
                        <span className="truncate">{nameWithNim(user)}</span>
                        <span className="text-[10px] font-bold text-[#2383E2]">›</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => {
                      setMenuDrawerOpen(false);
                      requireAuth(() => {}, "로그인");
                    }} 
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold w-full justify-center transition-all hover:scale-[1.02] active:scale-95" 
                    style={{ background: C.ink, color: "var(--bg)" }}
                  >
                    <LogIn size={15} /> 로그인
                  </button>
                )}
              </div>

              {/* Menu Items */}
              <nav className="flex flex-col gap-2 mt-2">
                <button 
                  onClick={() => { setSection("book"); setMenuDrawerOpen(false); }}
                  className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={section === "book" ? { background: "var(--bg-secondary)", color: C.ink } : {}}
                >
                  <span>예약하기</span>
                </button>
                <button 
                  onClick={() => { 
                    setMenuDrawerOpen(false);
                    requireAuth(() => setSection("mypage"), "마이페이지를 이용하시려면 로그인이 필요해요."); 
                  }}
                  className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={section === "mypage" ? { background: "var(--bg-secondary)", color: C.ink } : {}}
                >
                  <span>마이페이지</span>
                </button>
                <button 
                  onClick={() => { 
                    setMenuDrawerOpen(false);
                    requireAuth(() => setSection("history"), "이용하시려면 로그인이 필요해요."); 
                  }}
                  className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={section === "history" ? { background: "var(--bg-secondary)", color: C.ink } : {}}
                >
                  <span>사용 기록</span>
                </button>
                <button 
                  onClick={() => { setSection("dash"); setMenuDrawerOpen(false); }}
                  className="flex items-center w-full px-4 py-3 rounded-xl text-sm font-bold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={section === "dash" ? { background: "var(--bg-secondary)", color: C.ink } : {}}
                >
                  <span>대시보드</span>
                </button>
              </nav>
            </div>

            {/* Footer inside Drawer */}
            <div className="text-center text-xs opacity-40 border-t pt-4 font-medium" style={{ borderColor: C.border }}>
              v1.0 / made by taeo
            </div>
          </div>
        </div>
      )}


      {/* ===== 예약 2단계: 수칙 확인 모달 (openConfirm) ===== */}
      {confirmModalData && (() => {
        const f = confirmModalData;
        const isPrinter = f.resourceId === 'bambu-1' || f.resourceId === 'bambu-2' || f.roomId === 'bambu-1' || f.roomId === 'bambu-2';
        const resName = isPrinter ? "3D 프린터" : "워크룸";
        const notices = isPrinter ? [
          { id: 1, title: "출력 전 베드가 비어 있는지 확인", sub: "앞 사람 출력물이 남아 있을 수 있습니다" },
          { id: 2, title: "필라멘트 잔량 확인하기", sub: "중간에 떨어지면 처음부터 다시입니다" },
          { id: 3, title: "종료 시각은 넉넉하게 잡기", sub: "예상보다 오래 걸리는 경우가 많습니다" }
        ] : [
          { id: 1, title: "정원 3명입니다", sub: "같은 시간에 3명까지만 예약됩니다" },
          { id: 2, title: "예약 시간이 10분 지나면 자동으로 취소됩니다", sub: "못 오게 되면 미리 취소해주세요" },
          { id: 3, title: "음식물은 가지고 들어오지 않기", sub: "냄새와 부스러기가 남습니다" }
        ];
        const checkedCount = Object.values(checkedNotices).filter(Boolean).length;
        const allChecked = checkedCount === notices.length;

        return (
          <div className="ov fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(20,20,20,.5)" }} onClick={() => setConfirmModalData(null)}>
            <div className="sheet w-full rounded-t-lg bg-white sm:max-w-md sm:rounded-lg p-6" style={{ maxHeight: "92vh", boxShadow: "0 -4px 12px rgba(0,0,0,.08)" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: C.border }}>
                <div>
                  <h4 className="text-base font-bold" style={{ color: C.text }}>{resName} 사용 주의사항</h4>
                  <p className="text-xs mt-0.5" style={{ color: C.muted }}>아래를 모두 확인해야 예약됩니다</p>
                </div>
                <button onClick={() => setConfirmModalData(null)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button>
              </div>

              <div className="my-4 rounded-lg p-3 space-y-1 text-xs" style={{ background: "var(--bg-secondary)", border: `1px solid ${C.border}` }}>
                {isPrinter ? (
                  <>
                    <div className="flex justify-between"><span>기계</span><span className="font-bold">{f.roomId === 'bambu-1' ? '968 (LEFT)' : '990 (RIGHT)'}</span></div>
                    <div className="flex justify-between"><span>출력물</span><span className="font-bold">{f.title}</span></div>
                    <div className="flex justify-between"><span>시간</span><span className="font-bold">{f.date} · {f.start} ~ {toMin(f.end) <= toMin(f.start) ? '다음 날 ' : ''}{f.end}</span></div>
                    <div className="flex justify-between"><span>예약자</span><span className="font-bold">{user || ''}님</span></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><span>자원</span><span className="font-bold">워크룸</span></div>
                    <div className="flex justify-between"><span>프로젝트</span><span className="font-bold">{f.title}</span></div>
                    <div className="flex justify-between"><span>시간</span><span className="font-bold">{f.date} · {f.start} ~ {f.end}</span></div>
                    <div className="flex justify-between"><span>예약자</span><span className="font-bold">{user || ''}님</span></div>
                  </>
                )}
              </div>

              <div className="space-y-2.5">
                {notices.map((nt) => (
                  <label key={nt.id} className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all" style={{ borderColor: checkedNotices[nt.id] ? C.ink : C.border, background: checkedNotices[nt.id] ? "var(--bg-chip)" : "transparent" }}>
                    <input type="checkbox" checked={!!checkedNotices[nt.id]} onChange={(e) => setCheckedNotices({ ...checkedNotices, [nt.id]: e.target.checked })} className="mt-0.5 w-4 h-4 rounded" style={{ accentColor: C.ink }} />
                    <div className="flex-1">
                      <div className="text-sm font-bold" style={{ color: C.text }}>{nt.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: C.muted }}>{nt.sub}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="text-xs font-semibold text-right mt-3" style={{ color: allChecked ? "var(--green)" : C.muted }}>
                {notices.length}개 중 {checkedCount}개 확인
              </div>

              <div className="mt-6 flex gap-2.5">
                <button onClick={() => setConfirmModalData(null)} className="lift flex-1 rounded-lg border py-3 text-sm font-medium" style={{ borderColor: C.border, color: C.muted }}>뒤로</button>
                <button 
                  onClick={() => {
                    saveForm();
                    setConfirmModalData(null);
                  }}
                  disabled={!allChecked}
                  className="lift flex-[2] rounded-lg py-3 text-sm font-bold transition-all"
                  style={{
                    background: allChecked ? "#2383E2" : "#a0aec0",
                    color: "#fff",
                    cursor: allChecked ? "pointer" : "not-allowed",
                    opacity: allChecked ? 1 : 0.6
                  }}
                >
                  확인하고 예약하기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== 사용/출력 종료 모달 (openEnd) ===== */}
      {reportModalSession && (() => {
        const s = reportModalSession;
        const isPr = s.resourceId === 'bambu-1' || s.resourceId === 'bambu-2';
        const machineName = s.resourceId === 'bambu-1' ? '968 (LEFT)' : '990 (RIGHT)';
        const endNotices = isPr ? [
          { id: 1, title: "베드에서 출력물 조심스럽게 분리", sub: "베드가 식은 뒤 스크레이퍼를 사용하세요" },
          { id: 2, title: "주변 필라멘트 찌꺼기 청소", sub: "다음 사람을 위해 바닥과 베드를 깨끗이" },
          { id: 3, title: "사용한 공구 제자리에 두기", sub: "니퍼, 스크레이퍼 등 원래 자리에" }
        ] : [
          { id: 1, title: "다음 사람이 바로 쓸 수 있게 자리 정리", sub: "개인 물품과 쓰레기는 꼭 챙겨가세요" },
          { id: 2, title: "의자 제자리에 넣고 전원 확인", sub: "멀티탭과 조명 전원 확인" },
          { id: 3, title: "잊은 물건 없나 마지막으로 확인", sub: "충전기, 마우스 등 소지품" }
        ];
        const checkedCount = Object.values(endCheckedNotices).filter(Boolean).length;
        const allChecked = checkedCount === endNotices.length;

        return (
          <div className="ov fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setReportModalSession(null)}>
            <div id="report-modal" className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1e1e1e] border p-6 shadow-2xl space-y-4" style={{ borderColor: C.border }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: C.border }}>
                <div>
                  <h4 className="text-base font-bold" style={{ color: C.text }}>{isPr ? "출력을 종료합니다" : "사용을 종료합니다"}</h4>
                  <p className="text-xs mt-0.5" style={{ color: C.muted }}>{isPr ? machineName : '워크룸'} · {s.checkInAt ? new Date(s.checkInAt?.toDate ? s.checkInAt.toDate() : s.checkInAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '시작'} ~ {new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                </div>
                <button onClick={() => setReportModalSession(null)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.faint }}><X size={18} /></button>
              </div>

              <div className="space-y-2.5">
                {endNotices.map((nt) => (
                  <label key={nt.id} className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all" style={{ borderColor: endCheckedNotices[nt.id] ? C.ink : C.border, background: endCheckedNotices[nt.id] ? "var(--bg-chip)" : "transparent" }}>
                    <input type="checkbox" checked={!!endCheckedNotices[nt.id]} onChange={(e) => setEndCheckedNotices({ ...endCheckedNotices, [nt.id]: e.target.checked })} className="mt-0.5 w-4 h-4 rounded" style={{ accentColor: C.ink }} />
                    <div className="flex-1">
                      <div className="text-sm font-bold" style={{ color: C.text }}>{nt.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: C.muted }}>{nt.sub}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="text-xs font-semibold text-right mt-2" style={{ color: allChecked ? "var(--green)" : C.muted }}>
                {endNotices.length}개 중 {checkedCount}개 확인
              </div>

              {isPr && (
                <div className="space-y-3 pt-2 border-t" style={{ borderColor: C.border }}>
                  <div>
                    <label className="block text-xs font-bold mb-1.5" style={{ color: C.text }}>출력 결과</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        ['success', '성공'],
                        ['partial', '부분 실패'],
                        ['fail', '실패']
                      ].map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setReportForm(f => ({ ...f, result: val }))}
                          className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                            reportForm.result === val ? 'bg-[#2383E2] text-white border-[#2383E2]' : 'bg-transparent text-gray-400 border-gray-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold mb-1.5" style={{ color: C.text }}>남길 말 · 선택</label>
                    <textarea
                      placeholder="다음 사람이 알아야 할 게 있다면"
                      rows={2}
                      value={reportForm.note}
                      onChange={(e) => setReportForm(f => ({ ...f, note: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-transparent resize-none"
                      style={{ borderColor: C.border, color: C.text }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t" style={{ borderColor: C.border }}>
                <button
                  type="button"
                  onClick={() => setReportModalSession(null)}
                  className="px-4 py-2.5 rounded-lg border text-xs font-semibold hover:bg-gray-800/40"
                  style={{ borderColor: C.border, color: C.muted }}
                >
                  닫기
                </button>
                <button
                  type="button"
                  disabled={!allChecked}
                  onClick={() => {
                    if (isPr && (s.resourceId || true)) {
                      submitSessionReport();
                    } else {
                      handleEndSession(s.id);
                      setReportModalSession(null);
                    }
                  }}
                  className="px-4 py-2.5 rounded-lg text-white text-xs font-bold transition-all"
                  style={{
                    background: allChecked ? "#E53E3E" : "#a0aec0",
                    cursor: allChecked ? "pointer" : "not-allowed",
                    opacity: allChecked ? 1 : 0.6
                  }}
                >
                  확인했어요, 종료하기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <OnboardingGuide 
        ref={guideRef} 
        meId={MEMBERS.find(m => m.name === user)?.id} 
        currentRes={roomId} 
        setRes={setRoomId} 
        currentTab={section} 
        setTab={setSection} 
        isFormOpen={!!form} 
        openForm={(type) => {
          const targetId = type === 'printer' ? 'bambu-1' : type;
          setForm({ roomId: targetId, resourceId: targetId, date: keyOf(now), start: '09:00', end: '09:30', attendees: [] });
        }} 
        closeForm={() => setForm(null)} 
        openReport={() => {
          setReportModalSession({
            id: 'mock-session',
            reservationId: 'mock2',
            resourceId: 'bambu-1',
            title: '웰컴키트 트레이',
            who: user,
            owner: user,
            checkInAt: new Date(),
            isMock: true
          });
          setReportForm({ result: 'success', note: '' });
        }}
        closeReport={() => setReportModalSession(null)}
        isReportOpen={!!reportModalSession}
        onStepChange={(st) => setOnboardingStep(st?.step || null)}
      />

      {/* ===== Toast ===== */}
      {toast && <div className="rise fixed left-1/2 bottom-[100px] -translate-x-1/2 z-[80] flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap" style={{ background: C.ink, color: "var(--bg)", boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}><CheckCircle2 size={16} style={{ color: "var(--yellow)" }} /> {toast}</div>}
    </div>
  );
}

/* ===================== helpers ===================== */
function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium" style={{ color: C.muted }}>{label}</span>
      {children}
      {error && <span className="mt-1.5 flex items-center gap-1 text-xs font-semibold" style={{ color: PASTEL.red.text }}><AlertCircle size={12} />{error}</span>}
    </label>
  );
}
function SelectBox({ value, onChange, options, error }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="inp w-full rounded-lg border px-3.5 py-2.5 pr-9 text-sm outline-none" style={{ borderColor: error ? "#C0392B" : C.border, background: "var(--bg-select)" }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <ChevronRight size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90" style={{ color: C.faint }} />
    </div>
  );
}
function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-4 py-1.5">
      <div className="flex items-center gap-1.5 w-[84px] shrink-0 text-[13px]" style={{ color: C.muted }}>
        <Icon size={14} style={{ color: C.faint }} /><span>{label}</span>
      </div>
      <div className="text-[13px] font-medium flex-1 truncate" style={{ color: C.text }}>{value}</div>
    </div>
  );
}
