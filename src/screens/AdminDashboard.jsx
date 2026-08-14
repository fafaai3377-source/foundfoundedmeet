import React, { useMemo } from 'react';
import { C } from '../constants';
import { BarChart3, Users, AlertCircle, Clock, Bell } from 'lucide-react';
import { toMin, keyOf, parseSessionTime } from '../utils/time';

export default function AdminDashboard({ sessions, reservations, now, resources }) {
  // 1. Data Filtering (last 3 months)
  const threeMonthsAgoKey = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return keyOf(d);
  }, []);
  
  const todayKey = useMemo(() => keyOf(new Date()), []);

  const recentReservations = useMemo(() => {
    return (reservations || []).filter(r => r.date >= threeMonthsAgoKey && r.date <= todayKey);
  }, [reservations, threeMonthsAgoKey, todayKey]);

  const recentSessions = useMemo(() => {
    return (sessions || []).map(s => {
      const { dateStr, startTime, endTime, durationStr } = parseSessionTime(s);
      return { ...s, date: dateStr, startTime, endTime, durationStr };
    }).filter(s => s.date >= threeMonthsAgoKey && s.date <= todayKey);
  }, [sessions, threeMonthsAgoKey, todayKey]);

  // KPI Calculations
  const stats = useMemo(() => {
    // 1. No-show rate (status !== cancelled, but no matching session)
    const validReservations = recentReservations.filter(r => r.status !== 'cancelled');
    let noshowCount = 0;
    validReservations.forEach(r => {
      const hasSession = recentSessions.some(s => s.reservationId === r.id);
      if (!hasSession) noshowCount++;
    });
    const noshowRate = validReservations.length > 0 ? (noshowCount / validReservations.length) * 100 : 0;

    // 2. Un-checked-out count
    const unCheckedOutCount = recentSessions.filter(s => s.autoClosed).length;

    // 3. Average duration & 4. Utilization
    const validSessions = recentSessions.filter(s => !s.autoClosed && s.startTime && s.endTime);
    let totalDurationMins = 0;
    validSessions.forEach(s => {
      const start = toMin(s.startTime);
      const end = toMin(s.endTime);
      if (end > start) totalDurationMins += (end - start);
    });
    const avgDurationMins = validSessions.length > 0 ? Math.round(totalDurationMins / validSessions.length) : 0;
    
    // Utilization
    const totalDays = 90;
    const availableMinsPerRoom = totalDays * 13 * 60; // 9:00 to 22:00 = 13 hours
    const totalAvailableMins = availableMinsPerRoom * (resources?.length || 4);
    const utilizationRate = totalAvailableMins > 0 ? (totalDurationMins / totalAvailableMins) * 100 : 0;

    return {
      noshowRate: noshowRate.toFixed(1),
      unCheckedOutCount,
      avgDurationMins,
      utilizationRate: utilizationRate.toFixed(1)
    };
  }, [recentReservations, recentSessions, resources]);

  // Heatmap Data
  const heatmapData = useMemo(() => {
    // 7 days x 14 hours (9 to 22)
    const data = Array(7).fill(0).map(() => Array(14).fill(0));
    let maxVal = 0;
    
    recentSessions.forEach(s => {
      if (!s.date || !s.startTime) return;
      const d = new Date(s.date);
      if (isNaN(d.getTime())) return;
      const day = d.getDay(); // 0 (Sun) - 6 (Sat)
      const startHr = parseInt(s.startTime.split(':')[0], 10);
      if (startHr >= 9 && startHr <= 22) {
        data[day][startHr - 9]++;
        if (data[day][startHr - 9] > maxVal) maxVal = data[day][startHr - 9];
      }
    });
    
    return { data, maxVal };
  }, [recentSessions]);

  // Yesterday's unchecked out
  const yesterdayUncheckedOut = useMemo(() => {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yestKey = keyOf(yest);
    return recentSessions.filter(s => s.date === yestKey && s.autoClosed);
  }, [recentSessions]);

  const daysStr = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="flex-1 overflow-y-auto pb-20 p-4 sm:p-6" style={{ backgroundColor: "var(--bg-secondary)" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: C.text }}>관리자 통계 (최근 3개월)</h1>
          <p className="text-[13px] font-medium" style={{ color: C.muted }}>
            전체 데이터 부하를 막기 위해 최근 90일 데이터만 연산합니다.
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl border shadow-sm flex flex-col gap-2 transition-colors hover:border-gray-300" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
            <div className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.muted }}>
              <BarChart3 size={15} /> 자원 가동률
            </div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: C.text }}>{stats.utilizationRate}%</div>
          </div>
          
          <div className="p-4 rounded-2xl border shadow-sm flex flex-col gap-2 transition-colors hover:border-gray-300" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
            <div className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.muted }}>
              <Users size={15} /> 노쇼율
            </div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: C.text }}>{stats.noshowRate}%</div>
          </div>

          <div className="p-4 rounded-2xl border shadow-sm flex flex-col gap-2 transition-colors hover:border-gray-300" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
            <div className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.muted }}>
              <AlertCircle size={15} /> 미체크아웃 건수
            </div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: C.text }}>{stats.unCheckedOutCount}건</div>
          </div>

          <div className="p-4 rounded-2xl border shadow-sm flex flex-col gap-2 transition-colors hover:border-gray-300" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
            <div className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.muted }}>
              <Clock size={15} /> 평균 이용시간
            </div>
            <div className="text-2xl font-extrabold tracking-tight" style={{ color: C.text }}>{stats.avgDurationMins}분</div>
          </div>
        </div>

        {/* Heatmap */}
        <div className="p-5 rounded-2xl border shadow-sm" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
          <h2 className="text-[15px] font-bold mb-5" style={{ color: C.text }}>요일 및 시간대별 이용 빈도 (Heatmap)</h2>
          <div className="overflow-x-auto no-scrollbar">
            <div className="min-w-[600px] flex flex-col gap-1.5">
              <div className="flex">
                <div className="w-10 shrink-0"></div>
                {Array(14).fill(0).map((_, i) => (
                  <div key={i} className="flex-1 text-center text-[11px] font-bold" style={{ color: C.faint }}>
                    {i + 9}
                  </div>
                ))}
              </div>
              {daysStr.map((day, dIdx) => (
                <div key={dIdx} className="flex items-center gap-1.5">
                  <div className="w-10 shrink-0 text-center text-[12px] font-bold" style={{ color: C.muted }}>
                    {day}
                  </div>
                  {heatmapData.data[dIdx].map((count, hIdx) => {
                    let heatLevel = 0;
                    if (count > 0 && heatmapData.maxVal > 0) {
                      const ratio = count / heatmapData.maxVal;
                      if (ratio > 0.75) heatLevel = 4;
                      else if (ratio > 0.5) heatLevel = 3;
                      else if (ratio > 0.25) heatLevel = 2;
                      else heatLevel = 1;
                    }
                    return (
                      <div 
                        key={hIdx} 
                        className="flex-1 h-9 rounded-md transition-all cursor-pointer relative group border"
                        style={{ backgroundColor: `var(--heat-${heatLevel})`, borderColor: heatLevel === 0 ? C.border : 'transparent' }}
                      >
                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-gray-900 text-white text-[11px] font-bold rounded shadow-lg pointer-events-none whitespace-nowrap z-10 transition-opacity">
                          {count}건
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Yesterday's unchecked out */}
        <div className="p-5 rounded-2xl border shadow-sm" style={{ backgroundColor: "var(--bg-select)", borderColor: C.border }}>
          <h2 className="text-[15px] font-bold mb-4" style={{ color: C.text }}>어제 미체크아웃 세션 (알림 대상)</h2>
          {yesterdayUncheckedOut.length === 0 ? (
            <div className="py-10 text-center text-[13px] font-bold rounded-xl border border-dashed" style={{ color: C.faint, borderColor: C.border, backgroundColor: "var(--bg-quaternary)" }}>
              어제 발생한 미체크아웃 건이 없습니다.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {yesterdayUncheckedOut.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-xl transition-colors hover:border-gray-300" style={{ borderColor: C.border, backgroundColor: "var(--bg)" }}>
                  <div>
                    <div className="text-[14px] font-bold" style={{ color: C.text }}>{s.roomName || s.roomId}</div>
                    <div className="text-[12px] font-medium mt-1" style={{ color: C.muted }}>
                      {s.owner}님 | {s.startTime} ~ {s.endTime}
                    </div>
                  </div>
                  <button 
                    onClick={() => alert("9단계에서 연동 예정입니다.")}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111] hover:bg-gray-800 text-white text-[12px] font-bold rounded-lg transition-colors"
                  >
                    <Bell size={14} /> 알림 보내기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
