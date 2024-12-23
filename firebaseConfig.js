import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';  // Firestore
import { getStorage } from "firebase/storage";

// Firebase Client SDK for client-side
const firebaseConfig = {
  apiKey: "AIzaSyANpzHzRY0Ay1om3NowJCKuEtoPS-1F_Es",
  authDomain: "arabamarketim-775fa.firebaseapp.com",
  projectId: "arabamarketim-775fa",
  storageBucket: "arabamarketim-775fa.firebasestorage.app",
  messagingSenderId: "329849612561",
  appId: "1:329849612561:web:f6d69a239261d856e644b0",
  measurementId: "G-2R1YQBN3NL"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

export { auth, db, storage };
