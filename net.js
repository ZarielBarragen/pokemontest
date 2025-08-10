// net.js — Firebase auth + realtime presence for players
// Loads Firebase v10 modules from CDN.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, update,
  onChildAdded, onChildChanged, onChildRemoved,
  serverTimestamp, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- Your Firebase config ---
export const firebaseConfig = {
  apiKey: "AIzaSyAKYjaxMsnZZ_QeNxHZAFHQokGjhoYnT4Q",
  authDomain: "poketest-4d108.firebaseapp.com",
  projectId: "poketest-4d108",
  storageBucket: "poketest-4d108.firebasestorage.app",
  messagingSenderId: "874372031897",
  appId: "1:874372031897:web:bd7bdfe8338d36d086df08",
  measurementId: "G-HFXK2J605R"
};

// Behind the scenes we treat username as an email so we can use email/password auth
function usernameToEmail(u){ return `${u}@poketest.local`; }

export class Net {
  constructor(config = firebaseConfig){
    this.app  = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db   = getDatabase(this.app);

    this.uid = null;
    this.playerRef = null;
    this.playersRefPath = "players";
    this._throttleMs = 80;   // ~12.5 updates/sec
    this._lastSend = 0;

    onAuthStateChanged(this.auth, (user)=>{
      this.uid = user?.uid || null;
      if (this._authCb) this._authCb(user);
    });
  }

  onAuth(cb){ this._authCb = cb; }

  async signUp(username, password){
    const u = username.trim().toLowerCase();
    const cred = await createUserWithEmailAndPassword(this.auth, usernameToEmail(u), password);
    await updateProfile(cred.user, { displayName: u });
    return cred.user;
  }

  async logIn(username, password){
    const u = username.trim().toLowerCase();
    const cred = await signInWithEmailAndPassword(this.auth, usernameToEmail(u), password);
    if (!cred.user.displayName) await updateProfile(cred.user, { displayName: u });
    return cred.user;
  }

  async logOut(){ await signOut(this.auth); }

  async spawnLocal({ username, character, x, y, dir, anim = "stand", scale = 3 }){
    if (!this.uid) throw new Error("Not authed");
    const path = `${this.playersRefPath}/${this.uid}`;
    this.playerRef = ref(this.db, path);
    await set(this.playerRef, {
      username, character, x: Math.round(x), y: Math.round(y),
      dir, anim, scale, t: serverTimestamp()
    });
    onDisconnect(this.playerRef).remove();
  }

  updateState(partial){
    if (!this.playerRef) return;
    const now = performance.now();
    if (now - this._lastSend < this._throttleMs) return;
    this._lastSend = now;

    const patch = { ...partial, t: serverTimestamp() };
    if ("x" in patch) patch.x = Math.round(patch.x);
    if ("y" in patch) patch.y = Math.round(patch.y);
    update(this.playerRef, patch).catch(()=>{});
  }

  subscribePlayers({ onAdd, onChange, onRemove }){
    const playersRef = ref(this.db, this.playersRefPath);
    onChildAdded(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onAdd && onAdd(snap.key, snap.val());
    });
    onChildChanged(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onChange && onChange(snap.key, snap.val());
    });
    onChildRemoved(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onRemove && onRemove(snap.key);
    });
  }
}

/* ---- Realtime Database Rules (paste in Firebase Console)
{
  "rules": {
    "players": {
      "$uid": {
        ".read": true,
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
---------------------------------------------------------------- */
