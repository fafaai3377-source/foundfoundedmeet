import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import { C } from '../constants';

export const FEATURES = ['meeting', 'workroom', 'printer'];
const GUIDE_VERSION = '2026-07';
const DAY = 24 * 60 * 60 * 1000;

const ONB_ALL = [
  { group: 'intro', tab: 'book', sel: null, step: '환영합니다', title: '예약 시스템이 새로워졌어요', body: '회의실 · 워크룸 · 3D 프린터를 한 곳에서 예약합니다. 1분만에 핵심만 짚어드릴게요.' },
  { group: 'meeting', tab: 'book', res: 'meeting-room', sel: '.res-picker', step: '회의실 · 1', title: '회의실은 눌러서 방을 고릅니다', body: '회의실 알약을 누르면 큰 회의실 · 작은 회의실 · 라운지가 펼쳐집니다. 방을 고르면 그 방의 일정만 보여요.' },
  { group: 'meeting', tab: 'book', res: 'meeting-room', sel: '.timeline-container, .status-card', step: '회의실 · 2', title: '일정과 참석 여부를 한눈에', body: '세로 타임라인으로 하루 회의가 시간순으로 쌓입니다. 내가 참석하는 회의는 초록으로 표시돼요. 예약 창과 중요 회의 기능은 기존 그대로입니다.' },
  { group: 'workroom', tab: 'book', res: 'workroom', sel: '.status-card', step: '워크룸 · 1', title: '워크룸은 정원 3명', body: '지금 몇 명이 쓰는지 카드에서 바로 보입니다. 자리가 남으면 초록, 꽉 차면 빨강이에요. 자리 번호는 없고 인원만 관리합니다.' },
  { group: 'workroom', tab: 'book', res: 'workroom', popup: 'workroom', sel: '#mForm', step: '워크룸 · 2', title: '프로젝트와 시간만 넣으면 끝', body: '예약 창은 이렇게 생겼어요. "어떤 프로젝트로 쓰는지"와 시간만 적으면 됩니다. 예약 전·후로 정리 주의사항을 확인하고, 10분 안 오면 자동 취소돼요.' },
  { group: 'printer', tab: 'book', res: 'printer', sel: '.dg', step: '프린터 · 1', title: '뱀부랩 예약', body: '세로줄 하나가 기계 한 대입니다. 어느 기계가 언제 비는지 머리글에서 바로 확인할 수 있어요.' },
  { group: 'printer', tab: 'book', res: 'printer', openReport: true, sel: '#report-modal', step: '프린터 · 2', title: '밤샘 출력도, 결과 공유도', body: '출력물 이름과 기계를 고르면 됩니다. 밤 11시에 걸어 아침에 찾는 자정 넘김 출력도 되고, 끝나면 성공·실패 결과를 남겨 다음 사람에게 알려줄 수 있어요.' },
  { group: 'common', tab: 'history', res: 'meeting-room', sel: '#nav-btn-history', step: '거의 다 왔어요', title: '지난 이용은 사용 기록에서', body: '내가 언제 뭘 썼는지, 이름이나 프로젝트로 검색해 찾을 수 있습니다.' },
  { group: 'common', tab: 'book', sel: '#bellBtn, #bellBtnMob', step: '마지막', title: '알림은 여기로 옵니다', body: '예약 확정, 시작 5분 전, 자리가 났을 때 알려드려요. 새 기능이 생기면 여기서 먼저 알려드립니다.' }
];

const OnboardingGuide = forwardRef(({ meId, currentRes, setRes, currentTab, setTab, isFormOpen, openForm, closeForm, openReport, closeReport, isReportOpen, onStepChange }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [spotStyle, setSpotStyle] = useState({ display: 'none' });
  const [cardStyle, setCardStyle] = useState({});
  const cardRef = useRef(null);
  const initialRestoreState = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      initialRestoreState.current = { tab: currentTab, res: currentRes };
    }
  }, [isOpen, currentTab, currentRes]);

  const startOnboarding = useCallback((groups = null) => {
    let newSteps = ONB_ALL.slice();
    if (groups) {
      newSteps = ONB_ALL.filter(s => groups.includes(s.group));
    }
    setSteps(newSteps);
    setCurrentIndex(0);
    setIsOpen(true);
    document.body.classList.add('onb-open');
  }, []);

  useImperativeHandle(ref, () => ({
    startOnboarding
  }));

  const checkInitialGuide = useCallback(async () => {
    if (!meId) return;

    let f = null;
    if (isFirebaseConfigured) {
      try {
        const docSnap = await getDoc(doc(db, "users", meId));
        if (docSnap.exists()) {
          const data = docSnap.data();
          f = {
            seen: data.guideSeen || [],
            ver: data.guideVer,
            lastSeenAt: data.lastSeenAt ? (data.lastSeenAt.toDate ? data.lastSeenAt.toDate().getTime() : data.lastSeenAt) : null,
            dismissedUntil: data.dismissedUntil || null
          };
        }
      } catch (err) {
        console.error("Failed to read guide state from Firestore:", err);
      }
    } else {
      try {
        f = JSON.parse(localStorage.getItem(`rsv_guide_${meId}`) || 'null');
      } catch (e) { }
    }

    const now = Date.now();
    let show = false;
    let groups = null;

    if (f && f.dismissedUntil && now < f.dismissedUntil) {
      show = false;
    } else if (!f || !f.seen || !f.seen.length) {
      show = true;
    } else if (f.ver !== GUIDE_VERSION) {
      show = true;
    } else {
      const newOnes = FEATURES.filter(x => !f.seen.includes(x));
      if (newOnes.length > 0) {
        show = true;
        groups = newOnes;
      } else if (f.lastSeenAt && (now - f.lastSeenAt > DAY)) {
        show = true;
      }
    }

    if (show) {
      setTimeout(() => startOnboarding(groups), 450);
    }
  }, [meId, startOnboarding]);

  useEffect(() => {
    checkInitialGuide();
  }, [checkInitialGuide]);

  const markGuideSeen = async () => {
    if (!meId) return;
    
    if (isFirebaseConfigured) {
      try {
        await setDoc(doc(db, "users", meId), {
          guideSeen: [...FEATURES],
          guideVer: GUIDE_VERSION,
          lastSeenAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Failed to save guide state to Firestore:", err);
      }
    } else {
      localStorage.setItem(`rsv_guide_${meId}`, JSON.stringify({
        seen: [...FEATURES],
        ver: GUIDE_VERSION,
        lastSeenAt: Date.now()
      }));
    }
  };

  const endOnboarding = () => {
    setIsOpen(false);
    document.body.classList.remove('onb-open');
    if (isFormOpen) {
      closeForm();
    }
    if (isReportOpen) {
      closeReport();
    }
    if (initialRestoreState.current) {
      if (initialRestoreState.current.tab && initialRestoreState.current.tab !== currentTab) setTab(initialRestoreState.current.tab);
      if (initialRestoreState.current.res && initialRestoreState.current.res !== currentRes) setRes(initialRestoreState.current.res);
    }
    markGuideSeen();
    if (onStepChange) onStepChange(null);
  };

  const positionSpotlight = useCallback(() => {
    if (!isOpen || steps.length === 0) return;
    const st = steps[currentIndex];
    if (!st) return;

    const vw = window.innerWidth;
    let cStyle = {};

    let target = null;
    if (st.sel) {
      const selectors = st.sel.split(',');
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel.trim());
        for (let i = 0; i < els.length; i++) {
          const r = els[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            target = els[i];
            break;
          }
        }
        if (target) break;
      }
    }

    if (target) {
      const r = target.getBoundingClientRect();
      const pad = 8;
      setSpotStyle({
        display: 'block',
        left: (r.left - pad) + 'px',
        top: (r.top - pad) + 'px',
        width: (r.width + pad * 2) + 'px',
        height: (r.height + pad * 2) + 'px'
      });
      
      const cardW = Math.min(360, vw - 40);
      const leftPos = Math.max(16, Math.min(r.left, vw - cardW - 16));
      if (st.popup || st.openReport) {
        if (vw <= 760) {
          cStyle = { left: '16px', right: '16px', width: 'auto', bottom: '24px', top: 'auto' };
        } else {
          if (vw - r.right > cardW + 24) {
             cStyle = { left: (r.right + 24) + 'px', top: Math.max(24, r.top) + 'px', width: cardW + 'px', bottom: 'auto', right: 'auto' };
          } else if (r.left > cardW + 24) {
             cStyle = { left: (r.left - cardW - 24) + 'px', top: Math.max(24, r.top) + 'px', width: cardW + 'px', bottom: 'auto', right: 'auto' };
          } else {
             cStyle = { left: (vw / 2 - cardW / 2) + 'px', bottom: '24px', width: cardW + 'px', right: 'auto', top: 'auto' };
          }
        }
      } else {
        if (r.bottom + 20 + 200 < window.innerHeight) {
          cStyle = { top: (r.bottom + 16) + 'px', left: leftPos + 'px', width: cardW + 'px', right: 'auto', bottom: 'auto' };
        } else if (r.top - 20 - 200 > 0) {
          cStyle = { bottom: (window.innerHeight - r.top + 16) + 'px', left: leftPos + 'px', width: cardW + 'px', right: 'auto', top: 'auto' };
        } else {
          cStyle = { bottom: '24px', left: (vw / 2 - cardW / 2) + 'px', width: cardW + 'px', right: 'auto', top: 'auto' };
        }
      }
    } else {
      setSpotStyle({ display: 'none' });
      if (st.sel) return; // Wait for DOM to update instead of jumping to center
      const cardW = Math.min(360, vw - 40);
      if (st.popup || st.openReport) {
        if (vw <= 760) {
          cStyle = { left: '16px', right: '16px', width: 'auto', bottom: '24px', top: 'auto', transform: 'none' };
        } else {
          cStyle = { left: (vw / 2 - cardW / 2) + 'px', top: '50%', transform: 'translateY(-50%)', width: cardW + 'px', right: 'auto', bottom: 'auto' };
        }
      } else {
        if (vw <= 760) {
          cStyle = { left: '16px', right: '16px', width: 'auto', top: '50%', transform: 'translateY(-50%)', bottom: 'auto' };
        } else {
          cStyle = { left: (vw / 2 - cardW / 2) + 'px', top: '50%', transform: 'translateY(-50%)', width: cardW + 'px', right: 'auto', bottom: 'auto' };
        }
      }
    }
    setCardStyle(cStyle);
  }, [isOpen, steps, currentIndex]);

  useEffect(() => {
    if (!isOpen || steps.length === 0) {
      if (onStepChange) onStepChange(null);
      return;
    }
    const st = steps[currentIndex];
    if (onStepChange) onStepChange(st);

    if (st.tab && currentTab !== st.tab) {
      setTab(st.tab);
    }
    
    if (st.popup) {
      if (currentRes !== st.popup) setRes(st.popup);
      if (!isFormOpen) openForm(st.popup);
    } else {
      if (isFormOpen) closeForm();
    }

    if (st.openReport) {
      if (!isReportOpen && openReport) openReport();
    } else {
      if (isReportOpen && closeReport) closeReport();
    }

    if (st.res && !st.popup && !st.openReport && st.res !== currentRes) {
      setRes(st.res);
    }

    const timer = setTimeout(() => {
      if (st.sel && !st.popup) {
        let target = null;
        const selectors = st.sel.split(',');
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel.trim());
          for (let i = 0; i < els.length; i++) {
            const r = els[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              target = els[i];
              break;
            }
          }
          if (target) break;
        }
        if (target) {
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
        }
      }
      requestAnimationFrame(() => requestAnimationFrame(positionSpotlight));
    }, 100);

    return () => clearTimeout(timer);
  }, [currentIndex, isOpen, steps, currentRes, setRes, currentTab, setTab, isFormOpen, openForm, closeForm, positionSpotlight]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('scroll', positionSpotlight, true);
    window.addEventListener('resize', positionSpotlight);
    return () => {
      window.removeEventListener('scroll', positionSpotlight, true);
      window.removeEventListener('resize', positionSpotlight);
    };
  }, [isOpen, positionSpotlight]);

  if (!isOpen || steps.length === 0) return null;

  const st = steps[currentIndex];

  return (
    <>
      <div 
        className="onb__scrim" 
        style={{ position: 'fixed', inset: 0, zIndex: 510, background: st.popup || st.openReport ? '#00000055' : 'transparent', transition: 'background .3s', pointerEvents: 'auto' }} 
      />
      
      <div 
        className="onb__spot" 
        style={{
          position: 'fixed', borderRadius: '14px', 
          boxShadow: '0 0 0 4px #ffffff59, 0 0 0 9999px #00000075',
          transition: 'top .18s ease, left .18s ease, width .18s ease, height .18s ease',
          pointerEvents: 'none', zIndex: 511,
          ...spotStyle
        }} 
      />
      
      <div 
        ref={cardRef}
        className="onb__card" 
        style={{
          position: 'fixed', background: 'var(--bg)', borderRadius: '16px',
          padding: '26px 22px 22px', boxShadow: '0 24px 60px -18px #0000005c',
          transition: 'left .3s, right .3s, bottom .3s, top .3s',
          pointerEvents: 'auto', zIndex: 550,
          ...cardStyle
        }}
      >
        <div style={{ position: 'absolute', top: '18px', right: '18px', display: 'flex', gap: '12px' }}>
          <button className="onb__dismiss" onClick={async () => {
            if (!meId) return;
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            if (isFirebaseConfigured) {
              try {
                await setDoc(doc(db, "users", meId), { dismissedUntil: endOfDay.getTime() }, { merge: true });
              } catch (e) {}
            } else {
              const f = JSON.parse(localStorage.getItem(`rsv_guide_${meId}`) || '{}');
              f.dismissedUntil = endOfDay.getTime();
              localStorage.setItem(`rsv_guide_${meId}`, JSON.stringify(f));
            }
            setIsOpen(false);
            document.body.classList.remove('onb-open');
            if (isFormOpen) closeForm();
          }} style={{ fontSize: '12px', color: 'var(--faint)', fontWeight: 600, textDecoration: 'underline' }}>오늘 하루 보지 않기</button>
          <button className="onb__skip" onClick={endOnboarding} style={{ fontSize: '12px', color: 'var(--faint)', fontWeight: 600 }}>건너뛰기</button>
        </div>
        <div className="onb__step" style={{ fontSize: '11.5px', fontWeight: 700, color: '#2383E2', marginBottom: '7px' }}>{st.step}</div>
        <h4 style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-.03em', marginBottom: '7px' }}>{st.title}</h4>
        <p style={{ fontSize: '13.5px', color: 'var(--muted)', lineHeight: 1.6 }}>{st.body}</p>
        
        <div className="onb__foot" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '18px' }}>
          {currentIndex > 0 && (
            <button 
              className="onb__prev" 
              onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
              style={{ flex: '0 0 auto', fontSize: '13.5px', fontWeight: 700, color: 'var(--muted)', padding: '10px 16px', border: '1px solid var(--border)', borderRadius: '10px' }}
            >
              이전
            </button>
          )}
          <button 
            className="onb__next" 
            onClick={() => {
              if (currentIndex >= steps.length - 1) endOnboarding();
              else setCurrentIndex(i => i + 1);
            }}
            style={{ flex: 1, background: '#2383E2', color: '#fff', fontSize: '13.5px', fontWeight: 700, padding: '11px 18px', borderRadius: '10px' }}
          >
            {currentIndex === steps.length - 1 ? '시작하기' : '다음'}
          </button>
        </div>
        <div className="onb__dots" style={{ display: 'flex', gap: '6px', marginTop: '16px' }}>
          {steps.map((_, i) => (
            <i key={i} style={{ width: i === currentIndex ? '18px' : '6px', height: '6px', borderRadius: '99px', background: i === currentIndex ? '#2383E2' : 'var(--border)', transition: '.2s' }} />
          ))}
        </div>
      </div>
    </>
  );
});

OnboardingGuide.displayName = 'OnboardingGuide';

export default OnboardingGuide;
