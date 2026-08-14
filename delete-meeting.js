import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB-4Eu769Zen7p__ZTrepFDuZfTvyIMYww",
  authDomain: "promptshot-d0190.firebaseapp.com",
  projectId: "promptshot-d0190",
  storageBucket: "promptshot-d0190.firebasestorage.app",
  messagingSenderId: "784599297882",
  appId: "1:784599297882:web:521015f79e9e1bb0f50d63",
  measurementId: "G-SPHLBD59S1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    const q = query(collection(db, "reservations"), where("title", "==", "ㅁㄴㅇ"));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log("No matching documents by title. Let's try fetching all and matching.");
      const allQ = query(collection(db, "reservations"));
      const allSnap = await getDocs(allQ);
      let deleted = false;
      for (const d of allSnap.docs) {
        const data = d.data();
        if (data.title === "ㅁㄴㅇ" || data.projectName === "ㅁㄴㅇ" || data.outputName === "ㅁㄴㅇ" || (data.title && data.title.includes("ㅁㄴㅇ"))) {
           console.log(`Deleting doc: ${d.id}`);
           await deleteDoc(doc(db, "reservations", d.id));
           deleted = true;
        }
      }
      if (!deleted) console.log("Nothing found to delete.");
      else console.log("Deleted.");
      process.exit(0);
      return;
    }
    
    for (const docSnap of snapshot.docs) {
      console.log(`Deleting doc: ${docSnap.id}`);
      await deleteDoc(doc(db, "reservations", docSnap.id));
    }
    console.log("Deleted.");
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}

run();
