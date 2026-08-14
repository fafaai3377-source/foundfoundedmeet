import React, { useState, useMemo, useEffect, useRef } from "react";
import { Search, X, Clock, Edit2, Filter } from "lucide-react";
import { parseSessionTime } from "../utils/time";

export default function HistorySearch({ user, sessions, reservations, ROOMS, MEMBERS, C, PASTEL, formatDate, formatTime, hl, onEditSession }) {
  const [filterType, setFilterType] = useState("all");
  const [filterPeriod, setPeriod] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [showFilters, setShowFilters] = useState(false);
  const [showMineOnly, setShowMineOnly] = useState(false);

  const [visibleCount, setVisibleCount] = useState(50);
  const observerTarget = useRef(null);
  const filterRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilters(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);



  const unifiedList = useMemo(() => {
    const meId = MEMBERS.find((m) => m.name === user)?.id;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const list = [];
    const toMin = (t) => { const [h,m] = t.split(':').map(Number); return h*60+m; };

    (reservations || []).forEach(r => {
      const isMine = r.owner === user;
      let status = "예약됨";
      
      const isToday = r.date === todayStr;
      const sMin = toMin(r.start);
      const eMin = toMin(r.end);
      
      if (isToday && nowMin >= sMin && nowMin < eMin) {
        status = "진행 중";
      } else if (r.date < todayStr || (isToday && nowMin >= eMin)) {
        status = "완료";
      }
      if (r.status === "cancelled") status = "취소됨";
      
      let dateObj = null;
      if (r.date) {
        const [y, m, d] = r.date.split("-").map(Number);
        dateObj = new Date(y, m - 1, d, Math.floor(sMin / 60), sMin % 60);
      }

      list.push({
        id: `res_${r.id}`,
        source: 'reservation',
        resourceId: r.roomId || r.resourceId,
        title: r.title || "제목 없음",
        owner: (MEMBERS.find(m => m.id === r.owner || m.name === r.owner || m.id === r.who || m.name === r.who || m.id === r.userId)?.name || r.owner || r.who || r.userId || (r.attendees && r.attendees[0] ? MEMBERS.find(m => m.id === r.attendees[0])?.name : "") || "예약자"),
        attendees: r.attendees || [],
        startTime: r.start,
        endTime: r.end,
        durationStr: "",
        autoClosed: false,
        dateObj: dateObj,
        dateStr: r.date,
        status: status,
        mine: isMine,
        isUrgent: r.isUrgent,
        sortTime: dateObj ? dateObj.getTime() : 0,
        raw: r
      });
    });

    (sessions || []).forEach(s => {
      const isMine = s.userId === user || (s.attendees || []).includes(user);
      const status = s.checkOutAt ? "완료" : "진행 중";
      const { dateStr, startTime, endTime, durationStr, st } = parseSessionTime(s);

      const relatedResIdx = list.findIndex(r => r.source === 'reservation' && r.raw.id === s.reservationId);
      if (relatedResIdx !== -1) {
         list.splice(relatedResIdx, 1);
      }

      list.push({
        id: `ses_${s.id}`,
        source: 'session',
        resourceId: s.resourceId,
        title: s.title || "제목 없음",
        owner: (MEMBERS.find(m => m.id === s.userId || m.name === s.userId)?.name || s.userId || "사용자"),
        attendees: s.attendees || [],
        startTime,
        endTime,
        durationStr,
        autoClosed: s.autoClosed,
        dateObj: st,
        dateStr,
        status,
        mine: isMine,
        isUrgent: false,
        sortTime: st.getTime(),
        raw: s
      });
    });

    return list;
  }, [sessions, reservations, user, MEMBERS]);

  const filtered = useMemo(() => {
    let list = unifiedList;

    if (filterType === "meeting") list = list.filter(item => ["big", "small", "lounge"].includes(item.resourceId));
    else if (filterType === "workroom") list = list.filter(item => item.resourceId === "workroom");
    else if (filterType === "printer") list = list.filter(item => item.resourceId?.startsWith("bambu"));

    if (showMineOnly) {
      list = list.filter(item => item.mine);
    }

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

      list = list.filter(item => {
        if (!item.dateObj) return true;
        if (startLimit && item.dateObj < startLimit) return false;
        if (endLimit && item.dateObj > endLimit) return false;
        return true;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(item => {
        const attendeeNames = (item.attendees || [])
          .map(id => {
            const member = MEMBERS.find(m => m.id === id);
            return member ? member.name : "";
          })
          .join(" ");
        return `${item.title} ${item.owner} ${attendeeNames}`.toLowerCase().includes(q);
      });
    }

    return list.sort((a, b) => b.sortTime - a.sortTime);
  }, [unifiedList, filterType, filterPeriod, customStart, customEnd, searchQuery, showMineOnly]);

  const visibleList = filtered.slice(0, visibleCount);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && visibleCount < filtered.length) {
          setVisibleCount(prev => prev + 50);
        }
      },
      { threshold: 0.1 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full">
      <div className="relative flex items-center bg-white border rounded-full px-4 py-3 shadow-sm" style={{ borderColor: C.border }}>
        <Search size={16} className="text-gray-400 mr-2" />
        <input 
          type="text" 
          placeholder="이름이나 프로젝트(출력물)로 찾기" 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 outline-none text-sm bg-transparent"
        />
        {searchQuery && <button onClick={() => setSearchQuery("")}><X size={16} className="text-gray-400" /></button>}
      </div>

      <div className="flex items-center justify-between gap-3 relative" ref={filterRef}>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar flex-1">
          {[
            { id: "all", label: "전체" },
            { id: "meeting", label: "회의실" },
            { id: "workroom", label: "워크룸" },
            { id: "printer", label: "3D 프린터" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors border ${filterType === f.id ? "bg-black text-white border-black" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              style={{ borderColor: filterType === f.id ? C.ink : C.border }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button 
          onClick={() => setShowFilters(!showFilters)}
          className={`shrink-0 flex items-center justify-center w-[34px] h-[34px] rounded-full border transition-all ${showFilters || filterPeriod !== "all" || showMineOnly ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-white text-gray-500 hover:bg-gray-50"}`}
          style={{ borderColor: showFilters || filterPeriod !== "all" || showMineOnly ? "#bfdbfe" : C.border }}
        >
          <Filter size={15} />
          {(filterPeriod !== "all" || showMineOnly) && (
            <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-blue-500 border border-white" />
          )}
        </button>

        {showFilters && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-white border rounded-xl shadow-xl z-50 p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] font-bold" style={{ color: C.text }}>상세 필터</span>
              <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            
            <div className="flex items-center justify-between mb-5">
              <span className="text-[12px] font-medium" style={{ color: C.text }}>내 예약만 보기</span>
              <button 
                onClick={() => setShowMineOnly(!showMineOnly)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showMineOnly ? 'bg-blue-500' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showMineOnly ? 'translate-x-4.5' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="h-px bg-gray-100 mb-4" />
            
            <span className="block text-[12px] font-medium mb-2" style={{ color: C.text }}>기간 설정</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: "all", label: "전체" },
                { id: "7days", label: "최근 7일" },
                { id: "month", label: "이번 달" },
                { id: "custom", label: "직접 지정" }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setPeriod(f.id)}
                  className={`text-[11px] px-3 py-1.5 rounded-full font-medium transition-colors ${filterPeriod === f.id ? "bg-gray-100 text-gray-900 border border-gray-200" : "bg-transparent border border-transparent hover:bg-gray-50"}`}
                  style={{ color: filterPeriod === f.id ? "#111827" : C.muted }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            
            {filterPeriod === "custom" && (
              <div className="flex items-center gap-1.5 mt-3 bg-gray-50 p-2 rounded-lg">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full bg-white border rounded px-1.5 py-1 text-[10px]" style={{ borderColor: C.border }} />
                <span className="text-gray-400">-</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full bg-white border rounded px-1.5 py-1 text-[10px]" style={{ borderColor: C.border }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-[13px] font-semibold text-gray-500 mt-2">
        {searchQuery ? `"${searchQuery}" 검색 결과 ${filtered.length}건` : `전체 ${filtered.length}건`}
      </div>

      <div className="flex flex-col gap-3 relative z-10">
        {visibleList.length === 0 ? (
          <div className="text-center py-10 text-sm font-semibold" style={{ color: C.muted }}>기록이 없습니다.</div>
        ) : (
          visibleList.map((item, i) => {
            const isPrinter = item.resourceId?.startsWith("bambu");
            const isWorkroom = item.resourceId === "workroom";
            const typeName = isPrinter ? "뱀부랩" : isWorkroom ? "워크룸" : "회의실";
            const colorClass = isPrinter ? "bg-gray-700" : isWorkroom ? "bg-blue-600" : "bg-green-600";
            
            const rm = ROOMS.find(x => x.id === item.resourceId);
            const roomName = isPrinter ? (item.resourceId === "bambu-1" ? "968 (LEFT)" : "990 (RIGHT)") : (rm?.name || (item.resourceId === "meeting-room" || item.roomId === "meeting-room" ? "큰 회의실" : item.resourceId));

            let statusBg = "bg-gray-100 text-gray-600";
            if (item.status === "예약됨") statusBg = "bg-blue-100 text-blue-700";
            else if (item.status === "진행 중") statusBg = "bg-green-100 text-green-700";
            else if (item.status === "취소됨") statusBg = "bg-red-100 text-red-700";
            else if (item.autoClosed) statusBg = "bg-orange-100 text-orange-700";

            let showDateDivider = false;
            if (i === 0) {
              showDateDivider = true;
            } else {
              const prev = visibleList[i-1];
              if (prev.dateStr !== item.dateStr) showDateDivider = true;
            }

            return (
              <React.Fragment key={item.id}>
                {showDateDivider && (
                  <div className="text-[12px] font-bold text-gray-400 mt-4 mb-1">
                    {item.dateObj ? formatDate(item.dateObj) : item.dateStr}
                  </div>
                )}
                <div className="flex items-stretch border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow relative" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <div className={`w-1.5 shrink-0 ${colorClass}`} />
                  <div className="flex-1 p-3.5 flex flex-col gap-1.5">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-1.5 font-bold text-[14px] pr-2" style={{ color: C.text }}>
                        <span className="truncate">{item.title}</span>
                        {item.mine && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold bg-[#2383E2] text-white">내 예약</span>}
                        {item.isUrgent && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: PASTEL.red.bg, color: PASTEL.red.text }}>중요</span>}
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${statusBg}`}>
                        {item.autoClosed ? "자동 마감" : item.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[12px] font-medium text-gray-500">
                      <span>{typeName}</span>
                      <span className="w-1 h-1 rounded-full bg-gray-300" />
                      <span dangerouslySetInnerHTML={{ __html: hl ? hl(`${item.owner}님`, searchQuery) : `${item.owner}님` }} />
                      {item.attendees && item.attendees.length > 1 && (
                        <span className="text-gray-400">(외 {item.attendees.length - 1}명)</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[12px] text-gray-500 mt-1 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-gray-400" />
                        <span>{item.startTime} ~ {item.endTime}</span>
                        {item.durationStr && !item.autoClosed && <span className="ml-1 text-gray-400 font-normal">({item.durationStr})</span>}
                        {item.autoClosed && <span className="ml-1 text-gray-400 font-normal">(통계 제외)</span>}
                      </div>
                      
                      {user === "admin" && item.source === 'session' && onEditSession && (
                        <button 
                          onClick={() => onEditSession(item.raw)}
                          className="p-1 text-gray-400 hover:text-gray-700 bg-gray-50 rounded"
                          title="관리자 수정"
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                      {!onEditSession && (
                        <span>{roomName}</span>
                      )}
                      {onEditSession && user !== "admin" && (
                        <span>{roomName}</span>
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        
        {visibleCount < filtered.length && <div className="text-center py-4 text-xs text-gray-400">더보기...</div>}
        <div ref={observerTarget} className="h-4" />
      </div>
    </div>
  );
}
