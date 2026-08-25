import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyDWZbvWIrY30uVVcBKjLyjVMUa668VqFoA",
  authDomain: "family-guard-b343f.firebaseapp.com",
  projectId: "family-guard-b343f",
  storageBucket: "family-guard-b343f.firebasestorage.app",
  messagingSenderId: "1050374864802",
  appId: "1:1050374864802:web:5b477582439de2e6137cfb",
  measurementId: "G-BVD4LXB1Q1"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
