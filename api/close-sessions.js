import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
    rawKey = rawKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n').trim();
    
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID || "promptshot-d0190",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: rawKey,
    };
    initializeApp({ credential: cert(serviceAccount) });
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    const sessionsRef = db.collection('sessions');
    
    // 진행 중인 세션들(autoClosed가 아직 처리되지 않은 항목 중 checkOutAt이 없는 것)
    const snapshot = await sessionsRef.where('autoClosed', '==', false).get();
    
    let closedCount = 0;
    const promises = [];

    snapshot.forEach((d) => {
      const data = d.data();
      // 명세서 조건: checkOutAt이 없는 세션을 닫고 autoClosed: true 남김
      if (!data.checkOutAt) {
        promises.push(
          d.ref.update({
            checkOutAt: FieldValue.serverTimestamp(),
            autoClosed: true
          })
        );
        closedCount++;
      }
    });

    await Promise.all(promises);

    res.status(200).json({ success: true, message: `Closed ${closedCount} active sessions.` });
  } catch (error) {
    console.error('Error closing sessions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
