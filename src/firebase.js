import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// TODO: Replace this with your actual Firebase project configuration
// 1. Go to Firebase Console (https://console.firebase.google.com/)
// 2. Create a new project or select an existing one
// 3. Add a Web App to get your configuration object
// 4. Enable Firestore Database in Test Mode or configure proper rules
const firebaseConfig = {
  apiKey: "AIzaSyB-4Eu769Zen7p__ZTrepFDuZfTvyIMYww",
  authDomain: "promptshot-d0190.firebaseapp.com",
  projectId: "promptshot-d0190",
  storageBucket: "promptshot-d0190.firebasestorage.app",
  messagingSenderId: "784599297882",
  appId: "1:784599297882:web:521015f79e9e1bb0f50d63",
  measurementId: "G-SPHLBD59S1"
};

// Check if actual configuration is provided
export const isFirebaseConfigured = true;

let db = null;
let auth = null;

if (isFirebaseConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

export { db, auth };


