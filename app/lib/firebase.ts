import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBc9vwV3bvHzOwzlwjtOTsE1Ce7fHEktm8",
  authDomain: "smart-vocab-master.firebaseapp.com",
  projectId: "smart-vocab-master",
  storageBucket: "smart-vocab-master.firebasestorage.app",
  messagingSenderId: "225185933112",
  appId: "1:225185933112:web:16d0d75359279ec44a83cd"
};

// ป้องกัน initialize ซ้ำ และรันบน Client เท่านั้น
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = typeof window !== "undefined" ? getAuth(app) : null as any;
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();