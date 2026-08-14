import React, { useState, useEffect } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured } from "../firebase";
import { C, MEMBERS, M, nameWithNim } from "../constants";
import { 
  User, Bell, Shield, Moon, Sun, HelpCircle, LogOut, ChevronRight, 
  AlertCircle, CheckCircle2, Clock, Calendar, Lock, Trash2, RotateCcw, X, Plus
} from "lucide-react";

export default function MyPage({
  user,
  setUser,
  theme,
  setTheme,
  setSection,
  reservations,
  membersList,
  setMembersList,
  resources,
  onboardingRef,
  showToast,
  Avatar,
  onOpenProfileMenu,
  handleLogout
}) {
  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-4 pt-12 text-[var(--text)]">
        <div className="max-w-md mx-auto grid place-items-center rounded-2xl border bg-[var(--bg-secondary)] p-8 text-center" style={{ borderColor: C.border }}>
          <Lock size={32} className="text-[var(--faint)]" />
          <h2 className="mt-3 text-base font-bold">로그인이 필요합니다</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">로그인 후 마이페이지 및 시스템을 이용하실 수 있습니다.</p>
          <button 
            onClick={() => setSection("book")}
            className="mt-5 w-full py-2.5 px-4 bg-[#2383E2] text-white rounded-xl text-xs font-semibold hover:bg-blue-600 transition-colors cursor-pointer"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const me = user ? (membersList || MEMBERS).find((m) => m.name === user) : null;
  const meId = me?.id;
  const isAdmin = !!user && (user === "admin" || me?.group === "admin");

  // Settings states
  const [notifSettings, setNotifSettings] = useState({
    remindBefore: true,
    autoCancel: true,
    announcements: true
  });

  // Admin member suspension dialog state
  const [suspendConfirmMember, setSuspendConfirmMember] = useState(null);

  // Load user settings
  useEffect(() => {
    if (!meId) return;
    if (!isFirebaseConfigured) {
      try {
        const local = JSON.parse(localStorage.getItem(`user_settings_${meId}`) || "null");
        if (local) {
          if (local.notif) setNotifSettings(local.notif);
        }
      } catch (e) {}
    }
  }, [meId]);

  // Toggle notification setting
  const toggleNotif = async (key) => {
    const updated = { ...notifSettings, [key]: !notifSettings[key] };
    setNotifSettings(updated);

    if (isFirebaseConfigured && meId) {
      try {
        await setDoc(doc(db, "users", meId), {
          notifSettings: updated,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to save settings to Firestore:", err);
      }
    } else if (meId) {
      try {
        const local = JSON.parse(localStorage.getItem(`user_settings_${meId}`) || "{}");
        localStorage.setItem(`user_settings_${meId}`, JSON.stringify({ ...local, notif: updated }));
      } catch (e) {}
    }
    showToast("알림 설정이 저장되었습니다.");
  };

  // Toggle member active status (admin function)
  const handleToggleMemberActive = async (memberId, currentActive) => {
    const newActive = currentActive === false ? true : false;
    
    // Update local state
    setMembersList(prev => prev.map(m => m.id === memberId ? { ...m, active: newActive } : m));

    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "users", memberId), {
          active: newActive,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to update member active status:", err);
      }
    } else {
      try {
        const local = JSON.parse(localStorage.getItem("members_active_state") || "{}");
        local[memberId] = newActive;
        localStorage.setItem("members_active_state", JSON.stringify(local));
      } catch (e) {}
    }

    const memberObj = (membersList || MEMBERS).find(m => m.id === memberId);
    showToast(newActive ? `${memberObj?.name || '멤버'} 계정의 정지가 해제되었습니다.` : `${memberObj?.name || '멤버'} 계정이 정지되었습니다.`);
    setSuspendConfirmMember(null);
  };

  // Registered reservations count (created by current user)
  const myRegisteredCount = (reservations || []).filter(r => {
    const isMine = r.owner === user || (meId && (r.userId === meId || r.ownerId === meId));
    return isMine && r.status !== 'cancelled';
  }).length;

  // Attended meetings count (where user is owner or attendee)
  const myAttendedCount = (reservations || []).filter(r => {
    const isParticipant = r.owner === user || (r.attendees || []).includes(meId) || (r.attendees || []).includes(user);
    if (!isParticipant || r.status === 'cancelled') return false;

    const [y, m, d] = (r.date || '').split('-').map(Number);
    if (!y || !m || !d) return false;
    const rDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const [startH, startM] = (r.start || '00:00').split(':').map(Number);
    const startMin = (startH || 0) * 60 + (startM || 0);

    const isPastOrCurrent = rDate < today || (rDate.getTime() === today.getTime() && nowMin >= startMin);
    return isPastOrCurrent || (r.checkedIn || []).length > 0 || r.status === 'done';
  }).length;

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24 text-[var(--text)]">
      {/* Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3.5 backdrop-blur-md bg-[var(--bg)]/90" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <button onClick={() => setSection("book")} className="lift grid h-8 w-8 place-items-center rounded-lg border text-[var(--muted)]" style={{ borderColor: C.border }}>
            <ChevronRight className="rotate-180" size={18} />
          </button>
          <h1 className="text-[17px] font-bold">마이페이지</h1>
        </div>
        <button 
          onClick={() => {
            if (handleLogout) {
              handleLogout();
            } else {
              setUser(null);
              localStorage.removeItem("auth_token");
              localStorage.removeItem("last_user");
              setSection("book");
            }
          }} 
          className="lift flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-red-500 cursor-pointer" 
          style={{ borderColor: C.border }}
        >
          <LogOut size={13} />
          <span>로그아웃</span>
        </button>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">

        {/* 1. Account Info */}
        <section className="rounded-2xl border p-5 bg-[var(--bg-secondary)]" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-4">
            <div className="relative cursor-pointer shrink-0" onClick={onOpenProfileMenu} title="프로필 이미지 변경">
              {Avatar ? <Avatar name={user} size={56} solid /> : (
                <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] font-bold text-lg">
                  {user ? user[0] : "U"}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-[10px] text-white font-bold">편집</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[18px] font-bold">{nameWithNim(user)}</h2>
                {isAdmin && <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 text-[10px] font-bold">관리자</span>}
              </div>
              <p className="text-[12px] font-medium mt-0.5 text-[var(--muted)]">
                {me?.team ? `${me.team} · ` : ""}{me?.role || "임직원"}
              </p>
            </div>
          </div>
        </section>

        {/* 2. My Activity & Reservations */}
        <section className="rounded-2xl border p-5 space-y-3 bg-[var(--bg-secondary)]" style={{ borderColor: C.border }}>
          <h3 className="text-[13px] font-bold text-[var(--muted)] uppercase tracking-wider">내 이용 정보</h3>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3.5 bg-[var(--bg)]" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--faint)] mb-1">
                <Calendar size={14} />
                <span>예약 등록한 횟수</span>
              </div>
              <div className="text-xl font-bold">{myRegisteredCount}<span className="text-xs font-normal ml-1">회</span></div>
            </div>

            <div className="rounded-xl border p-3.5 bg-[var(--bg)]" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--faint)] mb-1">
                <Users size={14} className="text-[#2383E2]" />
                <span>참여한 회의 수</span>
              </div>
              <div className="text-xl font-bold">{myAttendedCount}<span className="text-xs font-normal ml-1">회</span></div>
            </div>
          </div>

          <button 
            onClick={() => setSection("history")}
            className="lift flex w-full items-center justify-between rounded-xl border p-3.5 text-xs font-bold transition-all hover:bg-[var(--lift-hover)] cursor-pointer"
            style={{ borderColor: C.border }}
          >
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-[#2383E2]" />
              <span>지난 이용 기록 전체 보기</span>
            </div>
            <ChevronRight size={16} className="text-[var(--faint)]" />
          </button>
        </section>

        {/* 3. Notification Settings */}
        <section className="rounded-2xl border p-5 space-y-3 bg-[var(--bg-secondary)]" style={{ borderColor: C.border }}>
          <h3 className="text-[13px] font-bold text-[var(--muted)] uppercase tracking-wider">알림 설정</h3>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-xl border bg-[var(--bg)]" style={{ borderColor: C.border }}>
              <div>
                <div className="text-sm font-semibold">시작 5분 전 알림</div>
                <div className="text-[11px] text-[var(--faint)]">예약 시작 5분 전에 앱 내 알림을 받아봅니다</div>
              </div>
              <button 
                onClick={() => toggleNotif("remindBefore")}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${notifSettings.remindBefore ? "bg-[#2383E2]" : "bg-gray-300 dark:bg-gray-700"}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.remindBefore ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border bg-[var(--bg)]" style={{ borderColor: C.border }}>
              <div>
                <div className="text-sm font-semibold">자동 취소 알림</div>
                <div className="text-[11px] text-[var(--faint)]">워크룸 10분 미입실 자동 취소 시 알림</div>
              </div>
              <button 
                onClick={() => toggleNotif("autoCancel")}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${notifSettings.autoCancel ? "bg-[#2383E2]" : "bg-gray-300 dark:bg-gray-700"}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.autoCancel ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border bg-[var(--bg)]" style={{ borderColor: C.border }}>
              <div>
                <div className="text-sm font-semibold">공지사항 및 업데이트 알림</div>
                <div className="text-[11px] text-[var(--faint)]">새로운 자원 추가 및 공지 등록 알림</div>
              </div>
              <button 
                onClick={() => toggleNotif("announcements")}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${notifSettings.announcements ? "bg-[#2383E2]" : "bg-gray-300 dark:bg-gray-700"}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${notifSettings.announcements ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-[11.5px] text-blue-700 dark:text-blue-300 leading-relaxed space-y-2">
            <div>💡 Chrome, Edge, Safari 및 PWA(홈 화면 앱)에서 알림 권한을 허용하시면 브라우저 및 디바이스 알림을 실시간으로 받아보실 수 있습니다.</div>
            <button
              type="button"
              onClick={async () => {
                if (typeof window === 'undefined' || !('Notification' in window)) {
                  alert("이 브라우저는 알림 기능을 지원하지 않습니다.");
                  return;
                }
                try {
                  const perm = await Notification.requestPermission();
                  if (perm === 'granted') {
                    new Notification("🔔 found/Founded 알림 테스트", {
                      body: "브라우저 및 디바이스 알림이 성공적으로 설정되었습니다!",
                      icon: "/icon-192.png"
                    });
                  } else if (perm === 'denied') {
                    alert("브라우저 알림 권한이 차단되어 있습니다. 주소창 좌측 자물쇠 아이콘 ➔ '알림' 권한을 '허용'으로 변경해 주세요.");
                  }
                } catch (e) {
                  console.error("Test notification error:", e);
                }
              }}
              className="w-full py-2 px-3 bg-[#2383E2] hover:bg-blue-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              🔔 브라우저 알림 권한 허용 & 테스트 팝업 보내기
            </button>
          </div>
        </section>

        {/* 4. Personalization */}
        <section className="rounded-2xl border p-5 space-y-3 bg-[var(--bg-secondary)]" style={{ borderColor: C.border }}>
          <h3 className="text-[13px] font-bold text-[var(--muted)] uppercase tracking-wider">개인화 설정</h3>

          <div className="flex items-center justify-between p-3 rounded-xl border bg-[var(--bg)]" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2">
              {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
              <span className="text-sm font-semibold">다크 모드</span>
            </div>
            <button 
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${theme === "dark" ? "bg-[#2383E2]" : "bg-gray-300"}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${theme === "dark" ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          <button 
            onClick={() => {
              setSection("book");
              setTimeout(() => {
                onboardingRef?.current?.startOnboarding();
              }, 150);
            }}
            className="lift flex w-full items-center justify-between rounded-xl border p-3.5 text-xs font-bold transition-all hover:bg-[var(--lift-hover)] cursor-pointer"
            style={{ borderColor: C.border }}
          >
            <div className="flex items-center gap-2">
              <HelpCircle size={15} className="text-[#2383E2]" />
              <span>첫 이용 가이드(온보딩) 다시 보기</span>
            </div>
            <ChevronRight size={16} className="text-[var(--faint)]" />
          </button>
        </section>

        {/* 5. Admin Section */}
        {isAdmin && (
          <section className="rounded-2xl border p-5 space-y-4 bg-amber-500/5 border-amber-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Shield size={18} />
                <h3 className="text-[15px] font-bold">관리자 구역</h3>
              </div>
              <button 
                onClick={() => setSection("admin")}
                className="lift flex items-center gap-1 text-xs font-bold text-[#2383E2] hover:underline cursor-pointer"
              >
                <span>멤버 계정 관리 (추가/삭제)</span>
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Member Management */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[var(--muted)]">멤버 빠른 관리 (정지 / 비활성화)</h4>
              <p className="text-[11px] text-[var(--faint)]">
                * 멤버 삭제 및 새 멤버 추가는 상단 [멤버 계정 관리] 페이지에서 진행할 수 있습니다.
              </p>

              <div className="rounded-xl border divide-y overflow-hidden bg-[var(--bg)] max-h-80 overflow-y-auto" style={{ borderColor: C.border }}>
                {(membersList || MEMBERS).filter(m => !["m_guest", "m_client", "m_room"].includes(m.id) && !m.deleted).map((m) => {
                  const isSuspended = m.active === false;
                  return (
                    <div key={m.id} className="flex items-center justify-between p-3 text-xs">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span>{nameWithNim(m.name)}</span>
                          <span className="text-[10px] opacity-60">({m.team})</span>
                          {isSuspended && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                              정지됨
                            </span>
                          )}
                          {m.isCustom && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                              추가됨
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--faint)]">{m.role}</div>
                      </div>

                      {isSuspended ? (
                        <button 
                          onClick={() => handleToggleMemberActive(m.id, false)}
                          className="lift flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold text-green-600 dark:text-green-400 cursor-pointer"
                          style={{ borderColor: C.border }}
                        >
                          <RotateCcw size={12} />
                          <span>정지 해제</span>
                        </button>
                      ) : (
                        <button 
                          onClick={() => setSuspendConfirmMember(m)}
                          className="lift flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          style={{ borderColor: C.border }}
                        >
                          <Trash2 size={12} />
                          <span>계정 정지</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Note on Security Rules */}
            <div className="p-3 rounded-xl border bg-amber-100/50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
              📌 <b>서버 보안 규칙 참고:</b> 현재 익명 인증(signInAnonymously) 사용 중으로, 서버 레벨(`firestore.rules`)의 정지 계정 DB 쓰기 완전 차단은 향후 정식 Firebase Auth (이메일/소셜 로그인) 도입 시 함께 적용할 수 있도록 설계되어 있습니다. 현재는 UI 레벨에서 로그인 및 새 예약 선택을 차단합니다.
            </div>
          </section>
        )}

      </div>

      {/* Suspension Confirmation Modal */}
      {suspendConfirmMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg)] border p-5 shadow-2xl space-y-4" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2 text-red-500 font-bold text-sm">
                <AlertCircle size={18} />
                <span>멤버 계정 정지 안내</span>
              </div>
              <button onClick={() => setSuspendConfirmMember(null)} className="text-[var(--faint)] cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-xs leading-relaxed" style={{ color: C.text }}>
              <p className="font-bold text-sm">
                "{nameWithNim(suspendConfirmMember.name)}" 멤버 계정을 삭제하시겠습니까?
              </p>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 space-y-1">
                <p className="font-semibold">⚠️ 삭제 시 실제 데이터가 삭제되지 않고 <b>"정지"</b>로 전환됩니다.</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>해당 멤버의 로그인 및 새 예약 작성이 차단됩니다.</li>
                  <li>예약 참석자 선택 목록에서 더 이상 표시되지 않습니다.</li>
                  <li><b>과거 예약 및 참석 기록의 이름은 정상 보존</b>됩니다.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button 
                onClick={() => setSuspendConfirmMember(null)}
                className="lift rounded-xl border px-3.5 py-2 text-xs font-semibold cursor-pointer"
                style={{ borderColor: C.border, color: C.muted }}
              >
                취소
              </button>
              <button 
                onClick={() => handleToggleMemberActive(suspendConfirmMember.id, true)}
                className="lift rounded-xl px-3.5 py-2 text-xs font-semibold bg-red-600 text-white shadow-sm hover:bg-red-700 cursor-pointer"
              >
                확인하고 정지 전환
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
