import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { collection, query, orderBy, limit, getDocs, startAfter, where, updateDoc, doc, arrayUnion } from "firebase/firestore";
import { Search, X, Calendar as CalendarIcon, Clock, Edit2 } from "lucide-react";
import { db } from "./firebase";

// Helper to format date
const formatDate = (date) => {
  if (!date) return "";
  const d = date.toDate ? date.toDate() : new Date(date);
  if (isNaN(d)) return String(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatTime = (date) => {
  if (!date) return "";
  const d = date.toDate ? date.toDate() : new Date(date);
  if (isNaN(d)) return String(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function HistorySearch({ user, ROOMS, MEMBERS, C, PASTEL, hl }) {
  const [sessions, setSessions] = useState([]);
  const [lastDoc, setLastDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [filterType, setFilterType] = useState("all");
  const [filterPeriod, setPeriod] = useState("all"); // 7days, month, custom, all
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const observerTarget = useRef(null);

  const fetchSessions = async (isLoadMore = false) => {
    if (loading || (!hasMore && isLoadMore)) return;
    setLoading(true);

    try {
      let q = query(collection(db, "sessions"), orderBy("checkInAt", "desc"), limit(50));
      
      if (isLoadMore && lastDoc) {
        q = query(collection(db, "sessions"), orderBy("checkInAt", "desc"), startAfter(lastDoc), limit(50));
      }

      const snapshot = await getDocs(q);
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      setSessions(prev => isLoadMore ? [...prev, ...fetched] : fetched);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 50);
    } catch (err) {
      console.error("Error fetching sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions(false);
  }, []); // Initial load only, rely on client-side filter or re-fetch

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchSessions(true);
        }
      },
      { threshold: 1.0 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, loading, lastDoc]);

  // Client-side filtering
  const filtered = useMemo(() => {
    let list = sessions;

    // Type Filter
    if (filterType === "meeting") list = list.filter(s => ["big", "small", "lounge"].includes(s.resourceId));
    else if (filterType === "workroom") list = list.filter(s => s.resourceId === "workroom");
    else if (filterType === "printer") list = list.filter(s => s.resourceId?.startsWith("bambu"));

    // Period Filter
    if (filterPeriod !== "all") {
      const now = new Date();
      let startLimit = null;
      let endLimit = null;

      if (filterPeriod === "7days") {
        startLimit = new Date();
        startLimit.setDate(now.getDate() - 7);
      } else if (filterPeriod === "month") {
        startLimit = new Date(now.getFullYear(), now.getMonth(), 1);
        endLimit = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      } else if (filterPeriod === "custom" && customStart && customEnd) {
        startLimit = new Date(`${customStart}T00:00:00`);
        endLimit = new Date(`${customEnd}T23:59:59`);
      }

      list = list.filter(s => {
        const d = s.checkInAt ? (s.checkInAt.toDate ? s.checkInAt.toDate() : new Date(s.checkInAt)) : null;
        if (!d) return true;
        if (startLimit && d < startLimit) return false;
        if (endLimit && d > endLimit) return false;
        return true;
      });
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => {
        const members = (s.attendees || []).join(" ");
        const title = s.title || "";
        const user = s.userId || "";
        return `${title} ${user} ${members}`.toLowerCase().includes(q);
      });
    }

    return list;
  }, [sessions, filterType, filterPeriod, customStart, customEnd, searchQuery]);

  const handleEditTime = async (session) => {
    if (!user || user.role !== "admin") return;
    const newEnd = prompt("수정할 종료 시각을 입력하세요 (HH:MM 형식, 예: 14:30)", formatTime(session.checkOutAt));
    if (!newEnd) return;

    try {
      // Very basic validation
      if (!/^\d{2}:\d{2}$/.test(newEnd)) {
        alert("HH:MM 형식으로 입력해주세요.");
        return;
      }

      // Parse current date to keep the YYYY-MM-DD but change time
      const baseDate = session.checkOutAt ? (session.checkOutAt.toDate ? session.checkOutAt.toDate() : new Date(session.checkOutAt)) : new Date();
      const [h, m] = newEnd.split(":").map(Number);
      baseDate.setHours(h, m, 0, 0);

      const beforeVal = session.checkOutAt ? (session.checkOutAt.toDate ? session.checkOutAt.toDate().toISOString() : session.checkOutAt) : null;
      const afterVal = baseDate.toISOString();

      const editRecord = {
        by: user.id,
        at: new Date().toISOString(),
        field: "checkOutAt",
        before: beforeVal,
        after: afterVal
      };

      await updateDoc(doc(db, "sessions", session.id), {
        checkOutAt: baseDate,
        edits: arrayUnion(editRecord)
      });
      
      // Update local state to reflect change immediately
      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, checkOutAt: baseDate } : s));
      alert("수정되었습니다.");
    } catch (err) {
      console.error(err);
      alert("수정에 실패했습니다.");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full">
      {/* Search Input */}
      <div className="relative flex items-center bg-white border rounded-full px-4 py-3" style={{ borderColor: C.border }}>
        <Search size={16} className="text-gray-400 mr-2" />
        <input 
          type="text" 
          placeholder="이름이나 프로젝트로 찾기" 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 outline-none text-sm bg-transparent"
        />
        {searchQuery && <button onClick={() => setSearchQuery("")}><X size={16} className="text-gray-400" /></button>}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: "all", label: "전체" },
            { id: "meeting", label: "회의실" },
            { id: "workroom", label: "워크룸" },
            { id: "printer", label: "3D 프린터" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap border transition-colors ${filterType === f.id ? "bg-black text-white border-black" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              style={{ borderColor: filterType === f.id ? C.ink : C.border }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "전기간" },
            { id: "7days", label: "최근 7일" },
            { id: "month", label: "이번 달" },
            { id: "custom", label: "직접 지정" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setPeriod(f.id)}
              className={`text-[12px] px-3 py-1 rounded-full font-medium transition-colors ${filterPeriod === f.id ? "bg-gray-100 text-gray-900" : "text-gray-400"}`}
            >
              {f.label}
            </button>
          ))}
          
          {filterPeriod === "custom" && (
            <div className="flex items-center gap-1 ml-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border rounded px-2 py-1 text-[11px]" />
              <span className="text-gray-400">-</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border rounded px-2 py-1 text-[11px]" />
            </div>
          )}
        </div>
      </div>

      {/* Header Info */}
      <div className="text-[13px] font-semibold text-gray-500 mt-2">
        {searchQuery ? `"${searchQuery}" 검색 결과 ${filtered.length}건` : `전체 ${filtered.length}건`}
      </div>

      {/* List */}
      <div className="flex flex-col gap-3">
        {filtered.map((s, i) => {
          const isPrinter = s.resourceId?.startsWith("bambu");
          const isWorkroom = s.resourceId === "workroom";
          const typeName = isPrinter ? "뱀부랩" : isWorkroom ? "워크룸" : "회의실";
          const colorClass = isPrinter ? "bg-gray-700" : isWorkroom ? "bg-blue-600" : "bg-green-600";
          
          const startDate = s.checkInAt ? formatDate(s.checkInAt) : formatDate(s.createdAt);
          const startTime = s.checkInAt ? formatTime(s.checkInAt) : "00:00";
          const endTime = s.checkOutAt ? formatTime(s.checkOutAt) : "진행 중";

          let durationStr = "";
          if (s.checkInAt && s.checkOutAt) {
            const st = s.checkInAt.toDate ? s.checkInAt.toDate() : new Date(s.checkInAt);
            const en = s.checkOutAt.toDate ? s.checkOutAt.toDate() : new Date(s.checkOutAt);
            const diffMin = Math.floor((en - st) / 60000);
            if (diffMin > 0) {
              const h = Math.floor(diffMin / 60);
              const m = diffMin % 60;
              durationStr = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
            }
          }

          const showDateDivider = i === 0 || formatDate(filtered[i-1].checkInAt || filtered[i-1].createdAt) !== startDate;

          return (
            <React.Fragment key={s.id}>
              {showDateDivider && (
                <div className="text-[12px] font-bold text-gray-400 mt-4 mb-1">
                  {startDate}
                </div>
              )}
              <div className="flex items-stretch bg-white border rounded-xl overflow-hidden shadow-sm" style={{ borderColor: C.border }}>
                <div className={`w-1.5 shrink-0 ${colorClass}`} />
                <div className="flex-1 p-3.5 flex flex-col gap-1.5">
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-[14px] text-gray-900 truncate pr-2">{s.title || "제목 없음"}</div>
                    {s.autoClosed ? (
                      <span className="shrink-0 bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold">자동 마감</span>
                    ) : (
                      <span className="shrink-0 bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold">완료</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[12px] font-medium text-gray-500">
                    <span>{typeName}</span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span dangerouslySetInnerHTML={{ __html: hl ? hl(`${s.userId}님`, searchQuery) : `${s.userId}님` }} />
                  </div>

                  <div className="flex items-center justify-between text-[12px] text-gray-500 mt-1 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-gray-400" />
                      <span>{startTime} ~ {endTime}</span>
                      {durationStr && !s.autoClosed && <span className="ml-1 text-gray-400 font-normal">({durationStr})</span>}
                      {s.autoClosed && <span className="ml-1 text-gray-400 font-normal">(통계 제외)</span>}
                    </div>
                    
                    {user?.role === "admin" && (
                      <button 
                        onClick={() => handleEditTime(s)}
                        className="p-1 text-gray-400 hover:text-gray-700 bg-gray-50 rounded"
                        title="관리자 수정"
                      >
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        
        {loading && <div className="text-center py-4 text-xs text-gray-400">불러오는 중...</div>}
        <div ref={observerTarget} className="h-4" />
      </div>
    </div>
  );
}
