import { initializeApp as initializeAdminApp, cert } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase/app";
import { getFirestore, writeBatch, doc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import fs from "fs";

// 1. Admin SDK Initializer (for rules-bypassing Clean Up)
const KEY_PATH = "c:/Users/User/Desktop/HOME/ffm-backup/serviceAccountKey.json";
let adminDb;
if (fs.existsSync(KEY_PATH)) {
  const serviceAccount = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const adminApp = initializeAdminApp({ credential: cert(serviceAccount) }, "admin");
  adminDb = getAdminFirestore(adminApp);
} else {
  const adminApp = initializeAdminApp({ projectId: "promptshot-d0190" }, "admin");
  adminDb = getAdminFirestore(adminApp);
}

// 2. Client SDK Initializer
const firebaseConfig = {
  apiKey: "AIzaSyB-4Eu769Zen7p__ZTrepFDuZfTvyIMYww",
  projectId: "promptshot-d0190",
  authDomain: "promptshot-d0190.firebaseapp.com"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function testConcurrency() {
  console.log("Starting concurrency test on Firestore (20 concurrent requests for same slot)...");
  
  const slotId = "meeting-room_20260731_40"; // 20:00
  
  // Clean up using Admin SDK (delete is denied for client SDK)
  try {
    await adminDb.collection("reservations").doc(slotId).delete();
    console.log("Cleaned up existing slot document using Admin SDK.");
  } catch (e) {
    console.error("Clean up failed:", e.message);
  }

  // Authenticate Client SDK anonymously
  await signInAnonymously(auth);
  console.log("Client authenticated anonymously.");

  const promises = [];
  
  for (let i = 0; i < 20; i++) {
    const p = (async () => {
      try {
        const batch = writeBatch(db);
        const ref = doc(db, "reservations", slotId);
        batch.set(ref, {
          id: slotId,
          start: "20:00",
          end: "20:30",
          title: `Test Meeting ${i}`,
          ownerId: `m${i}`,
          status: 'booked'
        });
        await batch.commit();
        return `Success (Req ${i})`;
      } catch (err) {
        return `Failed (Req ${i}): ${err.code || err.message}`;
      }
    })();
    promises.push(p);
  }
  
  const results = await Promise.all(promises);
  
  const successes = results.filter(r => r.startsWith('Success'));
  const failures = results.filter(r => r.startsWith('Failed'));
  
  console.log(`\n--- TEST RESULTS ---`);
  console.log(`Total Requests: 20`);
  console.log(`Success: ${successes.length}`);
  console.log(`Failures: ${failures.length}`);
  
  if (successes.length === 1 && failures.length === 19) {
    console.log("\n✅ PASS: Exactly 1 request succeeded and 19 failed.");
  } else {
    console.log("\n❌ FAIL: Concurrency test failed.");
    console.log("Successes:", successes);
  }
  
  process.exit(0);
}

testConcurrency();
