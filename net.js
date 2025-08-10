// net.js — Firebase auth + lobbies + per-lobby players
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  updateProfile, signOut, setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, update, get,
  onValue, push, remove, onChildAdded, onChildChanged, onChildRemoved,
  serverTimestamp, onDisconnect, setLogLevel
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ---- Your Firebase config ----
export const firebaseConfig = {
  apiKey: "AIzaSyAKYjaxMsnZZ_QeNxHZAFHQokGjhoYnT4Q",
  authDomain: "poketest-4d108.firebaseapp.com",
  projectId: "poketest-4d108",
  storageBucket: "poketest-4d108.firebasestorage.app",
  messagingSenderId: "874372031897",
  appId: "1:874372031897:web:bd7bdfe8338d36d086df08",
  measurementId: "G-HFXK2J605R"
  // (no databaseURL here on purpose; we pass it explicitly to getDatabase below)
};

function usernameToEmail(u){ return `${u}@poketest.local`; }
const withTimeout = (p, ms=8000) =>
  Promise.race([ p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("Timed out talking to Realtime Database")), ms)) ]);

export class Net {
  constructor(config = firebaseConfig){
    this.app  = initializeApp(config);
    this.auth = getAuth(this.app);
    setPersistence(this.auth, browserSessionPersistence).catch(()=>{});

    // 🔧 Pin to the exact instance (firebaseio.com host)
    // This avoids rare .lp script failures some hosts/extensions cause on .firebasedatabase.app
    this.db   = getDatabase(this.app, "https://poketest-4d108-default-rtdb.firebaseio.com");

    // Uncomment while debugging to see detailed DB logs in the console:
    // setLogLevel("info"); // or "debug" for very noisy

    this.uid = null;
    this.lobbyId = null;
    this.playerRef = null;
    this.playersRefPath = null;

    this._throttleMs = 80;
    this._lastSend = 0;

    onAuthStateChanged(this.auth, (user)=>{
      this.uid = user?.uid || null;
      if (this._authCb) this._authCb(user);
    });
  }

  onAuth(cb){ this._authCb = cb; }

  // ---------- Auth ----------
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

  // ---------- Lobbies ----------
  subscribeLobbies(onList){
    const lref = ref(this.db, "lobbies");
    return onValue(lref, (snap)=>{
      const val = snap.val() || {};
      const list = Object.entries(val).map(([id, lob])=>{
        const playersCount = lob.players ? Object.keys(lob.players).length : 0;
        const w = lob.map?.w || 0, h = lob.map?.h || 0;
        return { id, name: lob.name || "Lobby", playersCount, createdAt: lob.createdAt || 0, w, h };
      }).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
      onList(list);
    });
  }

  async createLobby(name, map){
    if (!this.uid) throw new Error("Not authed");
    const lref = push(ref(this.db, "lobbies"));
    const payload = {
      name: (name && name.trim()) || "New Lobby",
      createdBy: this.uid,
      createdAt: serverTimestamp(),
      map
    };
    await withTimeout(set(lref, payload), 8000);
    return lref.key;
  }

  async getLobby(lobbyId){
    const snap = await withTimeout(get(ref(this.db, `lobbies/${lobbyId}`)), 8000);
    if (!snap.exists()) throw new Error("Lobby not found");
    return { id: lobbyId, ...snap.val() };
  }

  async joinLobby(lobbyId){
    if (!this.uid) throw new Error("Not authed");
    this.lobbyId = lobbyId;
    this.playersRefPath = `lobbies/${lobbyId}/players`;
  }

  async leaveLobby(){
    try { if (this.playerRef) await remove(this.playerRef); } catch {}
    this.playerRef = null;
    this.playersRefPath = null;
    this.lobbyId = null;
  }

  // ---------- Player presence within a lobby ----------
  async spawnLocal({ username, character, x, y, dir, anim = "stand", scale = 3 }){
    if (!this.uid) throw new Error("Not authed");
    if (!this.playersRefPath) throw new Error("Not in a lobby");
    const path = `${this.playersRefPath}/${this.uid}`;
    this.playerRef = ref(this.db, path);
    await withTimeout(set(this.playerRef, {
      username, character, x: Math.round(x), y: Math.round(y),
      dir, anim, scale, t: serverTimestamp()
    }), 8000);
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
    update(this.playerRef, patch).catch((e)=>console.warn("updateState failed:", e));
  }

  subscribePlayers({ onAdd, onChange, onRemove }){
    if (!this.playersRefPath) return () => {};
    const playersRef = ref(this.db, this.playersRefPath);
    const unsubs = [];
    unsubs.push(onChildAdded(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onAdd && onAdd(snap.key, snap.val());
    }));
    unsubs.push(onChildChanged(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onChange && onChange(snap.key, snap.val());
    }));
    unsubs.push(onChildRemoved(playersRef, (snap)=>{
      if (snap.key === this.uid) return;
      onRemove && onRemove(snap.key);
    }));
    return () => { unsubs.forEach(u=>{ try{ u(); }catch{} }); };
  }
}
