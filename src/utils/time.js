import { DAY_START, STEP, SLOTS } from "../constants";

/* helpers */
export const pad = (n) => String(n).padStart(2, "0");
export const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtK = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a, b) => keyOf(a) === keyOf(b);
export const TIMES = Array.from({ length: SLOTS + 1 }, (_, i) => toHHMM(DAY_START + i * STEP));
export const getClosestTime = (tStr) => {
  if (!tStr) return TIMES[0];
  const m = toMin(tStr);
  if (isNaN(m)) return TIMES[0];
  let closest = TIMES[0], minDiff = Infinity;
  for (const t of TIMES) {
    const diff = Math.abs(toMin(t) - m);
    if (diff < minDiff) { minDiff = diff; closest = t; }
  }
  return closest;
};

export const parseSessionTime = (session) => {
  if (!session) return { dateStr: "", startTime: "", endTime: "", durationStr: "", st: null, en: null };
  const st = session.checkInAt ? (session.checkInAt.toDate ? session.checkInAt.toDate() : new Date(session.checkInAt)) : new Date(session.createdAt || 0);
  const en = session.checkOutAt ? (session.checkOutAt.toDate ? session.checkOutAt.toDate() : new Date(session.checkOutAt)) : null;
  
  const dateStr = `${st.getFullYear()}-${pad(st.getMonth()+1)}-${pad(st.getDate())}`;
  const startTime = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
  const endTime = en ? `${pad(en.getHours())}:${pad(en.getMinutes())}` : "진행 중";
  
  let durationStr = "";
  if (en) {
     const diffMin = Math.floor((en - st) / 60000);
     if (diffMin > 0) {
       const h = Math.floor(diffMin / 60);
       const m = diffMin % 60;
       durationStr = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
     }
  }
  return { dateStr, startTime, endTime, durationStr, st, en };
};
