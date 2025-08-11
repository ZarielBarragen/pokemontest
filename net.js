// net.js — Firebase + realtime lobby, players, chat helpers

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAKYjaxMsnZZ_QeNxHZAFHQokGjhoYnT4Q",
  authDomain: "poketest-4d108.firebaseapp.com",
  projectId: "poketest-4d108",
  storageBucket: "poketest-4d108.firebasestorage.app",
  messagingSenderId: "874372031897",
  appId: "1:874372031897:web:bd7bdfe8338d36d086df08",
  measurementId: "G-HFXK2J605R"
};

export class Net {
  constructor(cfg){
    this.app = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db   = getFirestore(this.app);
    this.user = null;
    this.lobbyId = null;
    this.playerDocRef = null;
    this.playersUnsub = null;
    this.chatUnsub = null;
  }

  // ---------- Auth ----------
  onAuth(cb){ return onAuthStateChanged(this.auth, u=>{ this.user=u; cb(u); }); }
  async signUp(username, password){
    const email = `${username}@example.local`;
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    return cred.user;
  }
  async logIn(username, password){
    const email = `${username}@example.local`;
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }
  async logOut(){ return signOut(this.auth); }

  // ---------- Lobbies ----------
  lobbiesCol(){ return collection(this.db, "lobbies"); }
  lobbyRef(id){ return doc(this.db, "lobbies", id); }
  playersCol(lobbyId){ return collection(this.db, "lobbies", lobbyId, "players"); }
  chatCol(lobbyId){ return collection(this.db, "lobbies", lobbyId, "chat"); }

  async createLobby(name, mapMeta){
    // mapMeta must be ONLY {w,h,seed} — no 2D arrays in Firestore
    const res = await addDoc(this.lobbiesCol(), {
      name: name || "Lobby",
      createdAt: serverTimestamp(),
      playersCount: 0,
      mapMeta
    });
    return res.id;
  }
  async getLobby(id){
    const snap = await getDoc(this.lobbyRef(id));
    if (!snap.exists()) throw new Error("Lobby not found");
    return { id: snap.id, ...snap.data() };
  }
  subscribeLobbies(cb){
    this.cleanupEmptyLobbies().catch(()=>{});
    const q = query(this.lobbiesCol(), orderBy("createdAt","desc"), limit(50));
    return onSnapshot(q, s=>{
      cb(s.docs.map(d=>({ id:d.id, ...d.data() })));
    });
  }

  // ---------- Join / Leave ----------
  async joinLobby(lobbyId){
    if (!this.user) throw new Error("Not signed in");
    this.lobbyId = lobbyId;
    const pref = doc(this.db, "lobbies", lobbyId, "players", this.user.uid);
    await setDoc(pref, {
      username: this.user.displayName || "player",
      x:0, y:0, dir:"down", anim:"stand",
      character:"sableye",
      typing:false,
      updatedAt: serverTimestamp()
    }, { merge:true });
    this.playerDocRef = pref;

    const lref = this.lobbyRef(lobbyId);
    const lsnap = await getDoc(lref);
    if (lsnap.exists()){
      const pc = (lsnap.data().playersCount|0) + 1;
      await updateDoc(lref, { playersCount: pc });
    }
  }
  async leaveLobby(){
    if (!this.lobbyId || !this.playerDocRef) return;
    const lobbyId = this.lobbyId;
    try { await deleteDoc(this.playerDocRef); } catch {}
    this.playerDocRef = null;

    try {
      const lref = this.lobbyRef(lobbyId);
      const ps = await getDocs(this.playersCol(lobbyId));
      if (ps.size === 0) await deleteDoc(lref);
      else {
        const lsnap = await getDoc(lref);
        if (lsnap.exists()){
          const pc = Math.max(0, (lsnap.data().playersCount|0) - 1);
          await updateDoc(lref, { playersCount: pc });
        }
      }
    } catch {}

    if (this.playersUnsub){ try{ this.playersUnsub(); }catch{} this.playersUnsub = null; }
    if (this.chatUnsub){ try{ this.chatUnsub(); }catch{} this.chatUnsub = null; }
    this.lobbyId = null;
  }

  async cleanupEmptyLobbies(){
    const ls = await getDocs(this.lobbiesCol());
    for (const d of ls.docs){
      const ps = await getDocs(this.playersCol(d.id));
      if (ps.size === 0){ try{ await deleteDoc(this.lobbyRef(d.id)); }catch{} }
    }
  }

  // ---------- Player state ----------
  async spawnLocal(init){
    if (!this.playerDocRef) throw new Error("Not in lobby");
    await setDoc(this.playerDocRef, { ...init, updatedAt: serverTimestamp(), typing:false }, { merge:true });
  }
  async updateState(partial){
    if (!this.playerDocRef) return;
    await updateDoc(this.playerDocRef, { ...partial, updatedAt: serverTimestamp() });
  }

  subscribePlayers(handlers){
    if (!this.lobbyId) throw new Error("No lobby");
    const { onAdd, onChange, onRemove } = handlers;
    const col = this.playersCol(this.lobbyId);
    this.playersUnsub = onSnapshot(col, snap=>{
      snap.docChanges().forEach(ch=>{
        const uid = ch.doc.id, data = ch.doc.data();
        if (ch.type === "added") onAdd && onAdd(uid, data);
        else if (ch.type === "modified") onChange && onChange(uid, data);
        else if (ch.type === "removed") onRemove && onRemove(uid);
      });
    });
    return this.playersUnsub;
  }

  // ---------- Chat ----------
  subscribeChat(cb){
    if (!this.lobbyId) throw new Error("No lobby");
    const qy = query(this.chatCol(this.lobbyId), orderBy("ts","asc"), limit(24));
    this.chatUnsub = onSnapshot(qy, snap=>{
      cb(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return this.chatUnsub;
  }
  async sendChat(text){
    if (!this.lobbyId || !this.user) return;
    await addDoc(this.chatCol(this.lobbyId), {
      uid: this.user.uid,
      username: this.user.displayName || "player",
      text,
      ts: serverTimestamp()
    });
    await this.trimChat(24).catch(()=>{});
  }
  async trimChat(keep){
    if (!this.lobbyId) return;
    const qy = query(this.chatCol(this.lobbyId), orderBy("ts","desc"));
    const snap = await getDocs(qy);
    if (snap.size <= keep) return;
    const batch = writeBatch(this.db);
    let i = 0;
    for (const d of snap.docs){
      if (i >= keep) batch.delete(d.ref);
      i++;
      if (i > keep + 64) break;
    }
    await batch.commit();
  }
}