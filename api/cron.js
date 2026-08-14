import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MEMBERS } from './flowTeamKeys.js';

function getDb() {
  if (!getApps().length) {
    try {
      let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
      rawKey = rawKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim();
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      if (clientEmail && rawKey) {
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID || "promptshot-d0190",
          clientEmail: clientEmail,
          privateKey: rawKey,
        };
        initializeApp({ credential: cert(serviceAccount) });
      }
    } catch (error) {
      console.error("Firebase Admin initialization error:", error);
    }
  }
  if (getApps().length) {
    try { return getFirestore(); } catch(e) {}
  }
  return null;
}

const pad = (n) => String(n).padStart(2, "0");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const now = new Date();
    // Vercel server time is UTC. We need KST (UTC+9).
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    
    const todayStr = keyOf(kstDate);
    const nowMin = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes(); // Since we added kstOffset to the epoch time, getUTCHours() will give us KST hours.

    const db = getDb();
    if (!db) {
      return res.status(200).json({ success: false, message: 'Server DB Admin not initialized.' });
    }

    // Query today's reservations
    const resRef = db.collection('reservations');
    const snapshot = await resRef.where('date', '==', todayStr).get();
    
    const targetAttendees = new Set();
    const endingRooms = [];
    const morningAttendees = new Set();
    const startingAttendees = new Set();
    const startingMeetings = [];
    
    // 월요일은 12시(720분), 화~금은 오전 9시(540분)
    const isMonday = kstDate.getUTCDay() === 1;
    const morningTime = isMonday ? 720 : 540;

    const getRoomName = (id) => ({
      'big': '큰 회의실',
      'small': '작은 회의실',
      'workroom': '워크룸',
      'bambu-1': '968 (LEFT)',
      'bambu-2': '990 (RIGHT)'
    }[id] || '공간');

    const addIdentifiers = (targetSet, val) => {
      if (!val) return;
      targetSet.add(String(val));
      const m = MEMBERS.find(x => x.id === val || x.name === val);
      if (m) {
        targetSet.add(String(m.id));
        targetSet.add(String(m.name));
      }
    };

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === 'cancelled') return;

      const endMin = toMin(data.end);
      const startMin = toMin(data.start);

      // 당일 첫 알림 시간에 오늘 회의 참석자 모두 수집
      if (nowMin === morningTime) {
        if (data.attendees) { data.attendees.forEach(att => addIdentifiers(morningAttendees, att)); }
        addIdentifiers(morningAttendees, data.owner);
        addIdentifiers(morningAttendees, data.who);
        addIdentifiers(morningAttendees, data.userId);
      }

      // If the meeting ends in 1 minute (allowing 0~1 min tolerance)
      const endDelta = endMin - nowMin;
      if (endDelta >= 0 && endDelta <= 1) {
        if (data.attendees) { data.attendees.forEach(att => addIdentifiers(targetAttendees, att)); }
        addIdentifiers(targetAttendees, data.owner);
        addIdentifiers(targetAttendees, data.who);
        addIdentifiers(targetAttendees, data.userId);
        endingRooms.push(getRoomName(data.roomId || data.resourceId));
      }

      // If the meeting starts in 1 minute (allowing 0~1 min tolerance)
      const startDelta = startMin - nowMin;
      if (startDelta >= 0 && startDelta <= 1) {
        if (data.attendees) { data.attendees.forEach(att => addIdentifiers(startingAttendees, att)); }
        addIdentifiers(startingAttendees, data.owner);
        addIdentifiers(startingAttendees, data.who);
        addIdentifiers(startingAttendees, data.userId);
        const roomName = getRoomName(data.roomId || data.resourceId);
        startingMeetings.push(`[${roomName}] ${data.title || '일정'}`);
      }
    });

    if (targetAttendees.size === 0 && morningAttendees.size === 0 && startingAttendees.size === 0) {
      return res.status(200).json({ success: true, message: 'No meetings to notify.' });
    }

    // Call our own notify API
    const host = req.headers.host;
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const notifyPromises = [];
    
    if (targetAttendees.size > 0) {
      notifyPromises.push(
        fetch(`${protocol}://${host}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '⏰ 일정 종료 1분 전이에요',
            body: `${endingRooms.join(', ')} 이용 시간이 곧 끝납니다. 마무리 부탁드려요 :)`,
            url: '/',
            attendees: Array.from(targetAttendees)
          })
        }).then(res => res.json())
      );
    }

    if (startingAttendees.size > 0) {
      notifyPromises.push(
        fetch(`${protocol}://${host}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '🚀 일정 시작 1분 전이에요',
            body: `${startingMeetings.join(', ')} 일정이 곧 시작됩니다. 준비해주세요!`,
            url: '/',
            attendees: Array.from(startingAttendees)
          })
        }).then(res => res.json())
      );
    }

    if (nowMin === morningTime && morningAttendees.size > 0) {
      notifyPromises.push(
        fetch(`${protocol}://${host}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '📅 오늘 예정된 일정이 있어요',
            body: '오늘 예약 일정이 있습니다. 앱에서 캘린더를 확인해 보세요!',
            url: '/',
            attendees: Array.from(morningAttendees)
          })
        }).then(res => res.json())
      );
    }

    const notifyRes = await Promise.all(notifyPromises);
    res.status(200).json({ success: true, notified: notifyRes });
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
