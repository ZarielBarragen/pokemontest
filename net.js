// net.js — Firestore for lobbies+chat, Realtime Database (RTDB) for player state/presence
// ESM, drop-in replacement

// --- Firebase base ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// --- Auth ---
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- Firestore (lobbies + chat) ---
import {
  getFirestore, collection, doc, addDoc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp as fsServerTimestamp, increment, query, orderBy, where, limit,
  limitToLast, getCountFromServer, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Realtime Database (players) ---
import {
  getDatabase, ref, set, update, remove, onDisconnect,
  onChildAdded, onChildChanged, onChildRemoved, get, child,
  serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- Project config ---
export const firebaseConfig = {
  apiKey: "AIzaSyAKYjaxMsnZZ_QeNxHZAFHQokGjhoYnT4Q",
  authDomain: "poketest-4d108.firebaseapp.com",
  projectId: "poketest-4d108",
  storageBucket: "poketest-4d108.firebasestorage.app",
  messagingSenderId: "874372031897",
  appId: "1:874372031897:web:bd7bdfe8338d36d086df08",
  measurementId: "G-HFXK2J605R",
  // RTDB requires db URL; if you created the RTDB instance, set it here.
  databaseURL: "https://poketest-4d108-default-rtdb.firebaseio.com"
};

export class Net {
  constructor(cfg = firebaseConfig) {
    this.app  = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db   = getFirestore(this.app);
    this.rtdb = getDatabase(this.app);

    this._authCb = () => {};
    this._authUnsub = onAuthStateChanged(this.auth, (u) => this._authCb(u));

    // State
    this.currentLobbyId = null;
    this.currentLobbyOwner = null;

    // RTDB presence
    this._playerRef = null;
    this._playerOnDisconnect = null;

    // Subscriptions
    this.playersUnsubs = [];   // rtdb listeners
    this.chatUnsub = null;

    // Backoff for Firestore writes
    this._backoffUntil = 0;

    window.addEventListener("beforeunload", () => { this.leaveLobby().catch(()=>{}); });
    window.addEventListener("unload",       () => { this.leaveLobby().catch(()=>{}); });
  }

  // ------------ Backoff helpers (Firestore writes) ------------
  _now(){ return Date.now(); }
  _shouldBackoff(){ return this._now() < this._backoffUntil; }
  _noteError(e){
    const code = (e && (e.code || e.message)) || "";
    if (typeof code === "string" && (code.includes("resource-exhausted") || code.includes("unavailable"))) {
      this._backoffUntil = this._now() + 30000; // 30s
    }
  }
  async _guardFS(fn){
    if (this._shouldBackoff()) throw new Error("backoff");
    try { return await fn(); } catch(e){ this._noteError(e); throw e; }
  }

  // --------------------------- AUTH ---------------------------
  onAuth(cb){ this._authCb = cb; }
  _usernameToEmail(username){ return `${username}@poketest.local`; }

  async signUp(username, password){
    const email = this._usernameToEmail(username);
    const cred  = await createUserWithEmailAndPassword(this.auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    return cred.user;
  }
  async logIn(username, password){
    const email = this._usernameToEmail(username);
    const cred  = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }
  async logOut(){
    try { await this.leaveLobby(); } catch {}
    return signOut(this.auth);
  }

  // ------------------------- LOBBIES (FS) -------------------------
  async createLobby(name, mapMeta){
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    const refDoc = await this._guardFS(() => addDoc(collection(this.db, "lobbies"), {
      name: name || `Lobby ${Math.floor(Math.random()*9999)}`,
      owner: uid,
      createdAt: fsServerTimestamp(),
      mapMeta: { w: Number(mapMeta?.w)||48, h: Number(mapMeta?.h)||32, seed: Number(mapMeta?.seed)||1234 },
      playersCount: 0,
      active: true
    }));
    return refDoc.id;
  }

  async getLobby(lobbyId){
    const snap = await getDoc(doc(this.db, "lobbies", lobbyId));
    if (!snap.exists()) throw new Error("Lobby not found");
    return { id: snap.id, ...snap.data() };
  }

  async _countPlayersRTDB(lobbyId){
    try {
      const s = await get(child(ref(this.rtdb), `lobbies/${lobbyId}/players`));
      return s.exists() ? Object.keys(s.val() || {}).length : 0;
    } catch { return 0; }
  }

  softReconcileLater(lobbyId, ms=2500){ try{ setTimeout(()=>{ this._reconcilePlayersCount(lobbyId).catch(()=>{}); }, ms); }catch{} }

  async _reconcilePlayersCount(lobbyId){
    try {
      const actual = await this._countPlayersRTDB(lobbyId);
      const dref = doc(this.db, "lobbies", lobbyId);
      const ds   = await getDoc(dref);
      if (!ds.exists()) return;
      const current = Number(ds.data().playersCount || 0);
      if (current !== actual) await this._guardFS(() => updateDoc(dref, { playersCount: actual }));
    } catch {}
  }

  subscribeLobbies(cb){
    const qy = query(collection(this.db, "lobbies"), orderBy("createdAt","desc"), limit(50));
    return onSnapshot(qy, async (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(list);
      try { await Promise.all(list.map(l => this._reconcilePlayersCount(l.id))); } catch {}
    }, (err)=>console.error("subscribeLobbies:", err));
  }

  async cleanupEmptyLobbies(){
    const uid = this.auth.currentUser?.uid;
    if (!uid) return 0;
    try {
      const qy = query(
        collection(this.db, "lobbies"),
        where("owner","==",uid),
        where("active","==",true),
        limit(20)
      );
      const snap = await getDocs(qy);
      let removed = 0;
      for (const d of snap.docs) {
        const id = d.id;
        // Count RTDB players
        let n = 0;
        try { n = await this._countPlayersRTDB(id); } catch { n = 0; }
        // Keep playersCount accurate
        try { await this._guardFS(() => updateDoc(doc(this.db,"lobbies",id), { playersCount: n })); } catch {}
        if (n === 0) {
          try { await this._guardFS(() => deleteDoc(doc(this.db,"lobbies",id))); removed++; } catch {}
        }
      }
      return removed;
    } catch {
      return 0;
    }
  }

  // -------------------- JOIN / LEAVE (RTDB + FS) --------------------
  async joinLobby(lobbyId){
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    this.currentLobbyId = lobbyId;

    // cache owner (for chat trimming permissions)
    try {
      const s = await getDoc(doc(this.db, "lobbies", lobbyId));
      this.currentLobbyOwner = s.exists() ? (s.data().owner || null) : null;
    } catch { this.currentLobbyOwner = null; }

    // Best-effort increment (fire-and-forget). Joining must not block on Firestore.
    try { this._guardFS(() => updateDoc(doc(this.db, "lobbies", lobbyId), { playersCount: increment(1) })); } catch {}

    // Reconcile later from RTDB (doesn't block)
    this.softReconcileLater(lobbyId, 2500);
  }

    // Increment playersCount (best effort) and reconcile to RTDB after
    try { await this._guardFS(() => updateDoc(doc(this.db, "lobbies", lobbyId), { playersCount: increment(1) })); } catch {}
    try { await this._reconcilePlayersCount(lobbyId); } catch {}
  }

  async leaveLobby(){
    const uid = this.auth.currentUser?.uid;
    const lob = this.currentLobbyId;
    if (!lob) return;

    // Remove RTDB presence & cancel onDisconnect
    try {
      if (this._playerOnDisconnect) { try { await this._playerOnDisconnect.cancel(); } catch {} this._playerOnDisconnect = null; }
      if (this._playerRef) { await remove(this._playerRef); this._playerRef = null; }
    } catch {}

    // Fire-and-forget decrement, then reconcile later
    try { this._guardFS(() => updateDoc(doc(this.db, "lobbies", lob), { playersCount: increment(-1) })); } catch {}
    this.softReconcileLater(lob, 2500);

    // Unsub listeners
    this.playersUnsubs.forEach(u => { try{ u(); }catch{} });
    this.playersUnsubs = [];
    if (this.chatUnsub) { try{ this.chatUnsub(); }catch{} this.chatUnsub = null; }

    this.currentLobbyId = null;
    this.currentLobbyOwner = null;
  }

  // ------------------------- PLAYERS (RTDB) -------------------------
  _playerPath(){ return `lobbies/${this.currentLobbyId}/players/${this.auth.currentUser?.uid}`; }

  async spawnLocal(state){
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) throw new Error("No lobby joined");
    this._playerRef = ref(this.rtdb, this._playerPath());
    // Put presence with onDisconnect remove
    const payload = {
      username: state.username || "player",
      character: state.character,
      x: Number(state.x) || 0,
      y: Number(state.y) || 0,
      dir: state.dir || "down",
      anim: state.anim || "stand",
      typing: !!state.typing,
      scale: Number(state.scale) || 3,
      ts: rtdbServerTimestamp()
    };
    await set(this._playerRef, payload);
    try { this._playerOnDisconnect = onDisconnect(this._playerRef); await this._playerOnDisconnect.remove(); } catch {}
  }

  async updateState(partial){
    if (!this._playerRef) return;
    const data = { ...partial, ts: rtdbServerTimestamp() };
    try { await update(this._playerRef, data); } catch {}
  }

  subscribePlayers({ onAdd, onChange, onRemove }){
    if (!this.currentLobbyId) return () => {};
    const uid = this.auth.currentUser?.uid;
    const base = ref(this.rtdb, `lobbies/${this.currentLobbyId}/players`);

    const a = onChildAdded(base, (snap) => {
      if (snap.key === uid) return;
      onAdd && onAdd(snap.key, snap.val());
    });
    const c = onChildChanged(base, (snap) => {
      if (snap.key === uid) return;
      onChange && onChange(snap.key, snap.val());
    });
    const r = onChildRemoved(base, (snap) => {
      if (snap.key === uid) return;
      onRemove && onRemove(snap.key);
    });

    const unsub = () => { try{ a(); }catch{} try{ c(); }catch{} try{ r(); }catch{} };
    this.playersUnsubs.push(unsub);
    return unsub;
  }

  // --------------------------- CHAT (FS) ---------------------------
  async cleanupChatIfNeeded(){
    if (!this.currentLobbyId) return;
    try {
      const chatCol = collection(this.db, "lobbies", this.currentLobbyId, "chat");
      const snap = await getDocs(query(chatCol, orderBy("createdAt","desc"), limit(26)));
      if (snap.size > 24) {
        const old = snap.docs.slice(24);
        for (const d of old) { try { await this._guardFS(() => deleteDoc(d.ref)); } catch {} }
      }
    } catch {}
  }

  async sendChat(text){
    if (!this.currentLobbyId) return;
    const uid = this.auth.currentUser?.uid;
    const user = this.auth.currentUser;
    const username = user?.displayName || (user?.email ? user.email.split("@")[0] : "player");
    const refCol = collection(this.db, "lobbies", this.currentLobbyId, "chat");
    await this._guardFS(() => addDoc(refCol, {
      uid, username, text: String(text).slice(0,200), createdAt: fsServerTimestamp()
    }));
    if (this.currentLobbyOwner && this.currentLobbyOwner === uid) {
      try { await this.cleanupChatIfNeeded(); } catch {}
    }
  }

  subscribeChat(cb){
    if (!this.currentLobbyId) return () => {};
    const qy = query(
      collection(this.db, "lobbies", this.currentLobbyId, "chat"),
      orderBy("createdAt","asc"),
      limitToLast(24)
    );
    if (this.chatUnsub) { try{ this.chatUnsub(); }catch{} }
    this.chatUnsub = onSnapshot(qy, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb && cb(msgs);
    }, (err)=>console.error("subscribeChat:", err));
    return this.chatUnsub;
  }
}

// One-shot snapshot with Firestore query
async function onSnapshotOnce(qry){
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(qry, (snap) => { try{unsub();}catch{} resolve(snap); },
                                 (err)  => { try{unsub();}catch{} reject(err); });
  });
}
