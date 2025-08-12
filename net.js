// net.js — ALL multiplayer on Realtime Database (RTDB): lobbies, players, chat
// Drop-in replacement for previous Net API.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getDatabase, ref, set, update, remove, onDisconnect, push,
  onValue, onChildAdded, onChildChanged, onChildRemoved, get, child, query,
  orderByChild, limitToLast, serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAKYjaxMsnZZ_QeNxHZAFHQokGjhoYnT4Q",
  authDomain: "poketest-4d108.firebaseapp.com",
  projectId: "poketest-4d108",
  storageBucket: "poketest-4d108.firebasestorage.app",
  messagingSenderId: "874372031897",
  appId: "1:874372031897:web:bd7bdfe8338d36d086df08",
  measurementId: "G-HFXK2J605R",
  databaseURL: "https://poketest-4d108-default-rtdb.firebaseio.com"
};

export class Net {
  constructor(cfg = firebaseConfig){
    this.app  = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db   = getDatabase(this.app);

    this._authCb = () => {};
    this._authUnsub = onAuthStateChanged(this.auth, (u)=>this._authCb(u));

    this.currentLobbyId = null;
    this.currentLobbyOwner = null;

    this._playerRef = null;
    this._playerOnDisconnect = null;

    this.playersUnsubs = [];
    this.chatUnsub = null;
    this.lobbiesUnsub = null;

    window.addEventListener("beforeunload", () => { this.leaveLobby().catch(()=>{}); });
    window.addEventListener("unload",       () => { this.leaveLobby().catch(()=>{}); });
  }

  // ---------- AUTH ----------
  onAuth(cb){ this._authCb = cb; }
  _usernameToEmail(username){ return `${username}@poketest.local`; }

  async signUp(username, password){
    const email = this._usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    return cred.user;
  }
  async logIn(username, password){
    const email = this._usernameToEmail(username);
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }
  async logOut(){
    try { await this.leaveLobby(); } catch {}
    return signOut(this.auth);
  }

  // ---------- LOBBIES (RTDB) ----------
  async createLobby(name, mapMeta){
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    const lobbiesRef = ref(this.db, "lobbies");
    const newRef = push(lobbiesRef);
    const id = newRef.key;
    const meta = {
      name: name || `Lobby ${Math.floor(Math.random()*9999)}`,
      owner: uid,
      createdAt: rtdbServerTimestamp(),
      mapMeta: { w: Number(mapMeta?.w)||48, h: Number(mapMeta?.h)||32, seed: Number(mapMeta?.seed)||1234 },
      active: true
    };
    await set(ref(this.db, `lobbies/${id}/meta`), meta);
    return id;
  }

  async getLobby(lobbyId){
    const s = await get(child(ref(this.db), `lobbies/${lobbyId}/meta`));
    if (!s.exists()) throw new Error("Lobby not found");
    const meta = s.val();
    let playersCount = 0;
    try {
      const ps = await get(child(ref(this.db), `lobbies/${lobbyId}/players`));
      playersCount = ps.exists() ? Object.keys(ps.val()||{}).length : 0;
    } catch {}
    return { id: lobbyId, ...meta, playersCount };
  }

  subscribeLobbies(cb){
    const base = ref(this.db, "lobbies");
    if (this.lobbiesUnsub) { try{ this.lobbiesUnsub(); }catch{} this.lobbiesUnsub = null; }
    const handler = onValue(base, (snap)=>{
      const val = snap.val() || {};
      const list = Object.entries(val).map(([id, node])=>{
        const meta = node.meta || {};
        const players = node.players || {};
        return {
          id,
          name: meta.name || "Lobby",
          owner: meta.owner || "",
          createdAt: meta.createdAt || 0,
          mapMeta: meta.mapMeta || { w:48, h:32, seed:1234 },
          active: meta.active !== false,
          playersCount: Object.keys(players).length
        };
      }).sort((a,b)=> (a.createdAt||0) < (b.createdAt||0) ? 1 : -1).slice(0,50);
      cb(list);
    }, (err)=>console.error("subscribeLobbies:", err));
    this.lobbiesUnsub = handler;
    return handler;
  }

  async cleanupEmptyLobbies(){
    const uid = this.auth.currentUser?.uid;
    if (!uid) return 0;
    const s = await get(child(ref(this.db), "lobbies"));
    if (!s.exists()) return 0;
    let removed = 0;
    const all = s.val() || {};
    for (const [id, node] of Object.entries(all)){
      const meta = node.meta || {};
      const players = node.players || {};
      if (meta.owner === uid){
        const n = Object.keys(players).length;
        if (n === 0) { try { await remove(ref(this.db, `lobbies/${id}`)); removed++; } catch {} }
      }
    }
    return removed;
  }

  async joinLobby(lobbyId){
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    this.currentLobbyId = lobbyId;
    try {
      const s = await get(child(ref(this.db), `lobbies/${lobbyId}/meta`));
      this.currentLobbyOwner = s.exists() ? (s.val().owner || null) : null;
    } catch { this.currentLobbyOwner = null; }
  }

  async leaveLobby(){
    const uid = this.auth.currentUser?.uid;
    const lob = this.currentLobbyId;
    if (!lob) return;

    try {
      if (this._playerOnDisconnect) { try { await this._playerOnDisconnect.cancel(); } catch {} this._playerOnDisconnect = null; }
      if (this._playerRef) { await remove(this._playerRef); this._playerRef = null; }
    } catch {}

    this.playersUnsubs.forEach(u=>{ try{u();}catch{} });
    this.playersUnsubs = [];
    if (this.chatUnsub){ try{ this.chatUnsub(); }catch{} this.chatUnsub = null; }

    this.currentLobbyId = null;
    this.currentLobbyOwner = null;
  }

  // ---------- PLAYERS (RTDB) ----------
  _playerPath(){ return `lobbies/${this.currentLobbyId}/players/${this.auth.currentUser?.uid}`; }

  async spawnLocal(state){
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) throw new Error("No lobby joined");
    this._playerRef = ref(this.db, this._playerPath());
    const payload = {
      username: state.username || "player",
      character: state.character,
      x: Number(state.x)||0,
      y: Number(state.y)||0,
      dir: state.dir || "down",
      anim: state.anim || "stand",
      typing: !!state.typing,
      scale: Number(state.scale)||3,
      hp: Number(state.hp) || 100,
      maxHp: Number(state.maxHp) || 100,
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
    const base = ref(this.db, `lobbies/${this.currentLobbyId}/players`);

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

    const unsub = () => { try{a();}catch{} try{c();}catch{} try{r();}catch{} };
    this.playersUnsubs.push(unsub);
    return unsub;
  }

  // ---------- PVP & CHAT (RTDB) ----------
  async dealDamage(targetUid, damage) {
    if (!this.currentLobbyId || !targetUid) return;
    const hitsRef = ref(this.db, `lobbies/${this.currentLobbyId}/players/${targetUid}/hits`);
    const newHitRef = push(hitsRef);
    await set(newHitRef, {
      damage: damage,
      from: this.auth.currentUser?.uid,
      ts: this.serverTimestamp()
    });
  }

  subscribeToHits(onHit) {
    const uid = this.auth.currentUser?.uid;
    if (!this.currentLobbyId || !uid) return () => {};

    const hitsRef = ref(this.db, `lobbies/${this.currentLobbyId}/players/${uid}/hits`);

    const unsub = onChildAdded(hitsRef, (snap) => {
      onHit(snap.val());
      // Remove the hit after processing to prevent re-triggering on reload
      remove(snap.ref).catch(e => console.error("Failed to remove hit", e));
    });

    this.playersUnsubs.push(unsub); // Add to cleanup array
    return unsub;
  }

  async sendChat(text){
    if (!this.currentLobbyId) return;
    const uid = this.auth.currentUser?.uid;
    const user = this.auth.currentUser;
    const username = user?.displayName || (user?.email ? user.email.split("@")[0] : "player");
    const msgRef = push(ref(this.db, `lobbies/${this.currentLobbyId}/chat`));
    await set(msgRef, { uid, username, text: String(text).slice(0,200), ts: rtdbServerTimestamp() });

    if (this.currentLobbyOwner && this.currentLobbyOwner === uid){
      try {
        const chatQ = query(ref(this.db, `lobbies/${this.currentLobbyId}/chat`), orderByChild("ts"));
        const snap = await get(chatQ);
        if (snap.exists()){
          const entries = Object.entries(snap.val()).sort((a,b)=> (a[1].ts||0) - (b[1].ts||0));
          if (entries.length > 24){
            const removeCount = entries.length - 24;
            for (let i=0;i<removeCount;i++){ try { await remove(ref(this.db, `lobbies/${this.currentLobbyId}/chat/${entries[i][0]}`)); } catch {} }
          }
        }
      } catch {}
    }
  }

  subscribeChat(cb){
    if (!this.currentLobbyId) return () => {};
    const qy = query(ref(this.db, `lobbies/${this.currentLobbyId}/chat`), orderByChild("ts"), limitToLast(24));
    if (this.chatUnsub) { try{ this.chatUnsub(); }catch{} this.chatUnsub = null; }
    const unsub = onValue(qy, (snap)=>{
      const arr = [];
      snap.forEach((child)=>{
        arr.push({ id: child.key, ...(child.val() || {}) });
      });
      cb(arr);
    }, (err)=>console.error("subscribeChat:", err));
    this.chatUnsub = unsub;
    return unsub;
  }
}
