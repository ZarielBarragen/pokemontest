// net.js — Firebase wiring (auth, lobbies, players, chat) — Firestore only, lint‑clean

// Firebase ESM CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, increment, query, orderBy, where, limit,
  limitToLast, getCountFromServer, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your Firebase project (unchanged)
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
  constructor(cfg = firebaseConfig) {
    this.app  = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db   = getFirestore(this.app);

    // callbacks / unsub
    this._authCb = () => {};
    this._authUnsub = onAuthStateChanged(this.auth, (u) => this._authCb(u));

    // lobby state
    this.currentLobbyId = null;
    this.currentLobbyOwner = null;
    this.playersUnsub = null;
    this.chatUnsub = null;

    // best‑effort leave
    window.addEventListener("beforeunload", () => { this.leaveLobby().catch(()=>{}); });
    window.addEventListener("unload",       () => { this.leaveLobby().catch(()=>{}); });
  }

  // ------------ helpers (playersCount reconciliation) ------------
  async _countPlayers(lobbyId) {
    try {
      const col = collection(this.db, "lobbies", lobbyId, "players");
      const snap = await getCountFromServer(col);
      return snap.data().count || 0;
    } catch {
      return 0;
    }
  }
  async _reconcilePlayersCount(lobbyId) {
    try {
      const actual = await this._countPlayers(lobbyId);
      const dref = doc(this.db, "lobbies", lobbyId);
      const ds = await getDoc(dref);
      if (!ds.exists()) return;
      const current = Number(ds.data().playersCount || 0);
      if (current !== actual) await updateDoc(dref, { playersCount: actual });
    } catch {}
  }

  // --------------------------- AUTH ---------------------------
  onAuth(cb) { this._authCb = cb; }
  _usernameToEmail(username) { return `${username}@poketest.local`; }

  async signUp(username, password) {
    const email = this._usernameToEmail(username);
    const cred  = await createUserWithEmailAndPassword(this.auth, email, password);
    try { await updateProfile(cred.user, { displayName: username }); } catch {}
    return cred.user;
  }

  async logIn(username, password) {
    const email = this._usernameToEmail(username);
    const cred  = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }

  async logOut() {
    try { await this.leaveLobby(); } catch {}
    return signOut(this.auth);
  }

  // ------------------------- LOBBIES -------------------------
  async createLobby(name, mapMeta) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    const ref = await addDoc(collection(this.db, "lobbies"), {
      name: name || `Lobby ${Math.floor(Math.random() * 9999)}`,
      owner: uid,
      createdAt: serverTimestamp(),
      mapMeta: {
        w: Number(mapMeta?.w) || 48,
        h: Number(mapMeta?.h) || 32,
        seed: Number(mapMeta?.seed) || 1234
      },
      playersCount: 0,
      active: true
    });
    return ref.id;
  }

  async getLobby(lobbyId) {
    const snap = await getDoc(doc(this.db, "lobbies", lobbyId));
    if (!snap.exists()) throw new Error("Lobby not found");
    return { id: snap.id, ...snap.data() };
  }

  subscribeLobbies(cb) {
    const q = query(collection(this.db, "lobbies"), orderBy("createdAt", "desc"), limit(50));
    return onSnapshot(q, async (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(list);
      // opportunistic reconciliation
      try { await Promise.all(list.map(l => this._reconcilePlayersCount(l.id))); } catch {}
    }, (err) => console.error("subscribeLobbies:", err));
  }

  async cleanupEmptyLobbies() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const q = query(
      collection(this.db, "lobbies"),
      where("owner", "==", uid),
      where("playersCount", "==", 0),
      where("active", "==", true),
      limit(10)
    );
    const snap = await onSnapshotOnce(q);
    for (const d of snap.docs) {
      try { await deleteDoc(doc(this.db, "lobbies", d.id)); } catch {}
    }
  }

  async joinLobby(lobbyId) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");
    this.currentLobbyId = lobbyId;
    try { await updateDoc(doc(this.db, "lobbies", lobbyId), { playersCount: increment(1) }); } catch {}
    // capture owner for chat cleanup permission
    try {
      const s = await getDoc(doc(this.db, "lobbies", lobbyId));
      this.currentLobbyOwner = s.exists() ? (s.data().owner || null) : null;
    } catch { this.currentLobbyOwner = null; }
  }

  async leaveLobby() {
    const uid = this.auth.currentUser?.uid;
    const lob = this.currentLobbyId;
    if (!lob) return;

    try { await deleteDoc(doc(this.db, "lobbies", lob, "players", uid)); } catch {}
    try { await updateDoc(doc(this.db, "lobbies", lob), { playersCount: increment(-1) }); } catch {}
    try { const n = await this._countPlayers(lob); await updateDoc(doc(this.db, "lobbies", lob), { playersCount: n }); } catch {}

    if (this.playersUnsub) { try { this.playersUnsub(); } catch {} this.playersUnsub = null; }
    if (this.chatUnsub)    { try { this.chatUnsub(); } catch {} this.chatUnsub    = null; }

    this.currentLobbyId = null;
    this.currentLobbyOwner = null;
  }

  // ------------------------- PLAYERS -------------------------
  async spawnLocal(state) {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) throw new Error("No lobby joined");
    const ref = doc(this.db, "lobbies", this.currentLobbyId, "players", uid);
    await setDoc(ref, {
      username: state.username || "player",
      character: state.character,
      x: Number(state.x) || 0,
      y: Number(state.y) || 0,
      dir: state.dir || "down",
      anim: state.anim || "stand",
      scale: Number(state.scale) || 3,
      typing: !!state.typing,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async updateState(partial) {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) return;
    const ref = doc(this.db, "lobbies", this.currentLobbyId, "players", uid);
    try {
      await updateDoc(ref, { ...partial, updatedAt: serverTimestamp() });
    } catch {
      try { await setDoc(ref, { ...partial, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
    }
  }

  subscribePlayers({ onAdd, onChange, onRemove }) {
    if (!this.currentLobbyId) return () => {};
    const uid = this.auth.currentUser?.uid;
    const col = collection(this.db, "lobbies", this.currentLobbyId, "players");
    if (this.playersUnsub) { try { this.playersUnsub(); } catch {} }

    this.playersUnsub = onSnapshot(col, (snap) => {
      snap.docChanges().forEach((ch) => {
        const id = ch.doc.id;
        if (id === uid) return; // local player drawn client-side
        if (ch.type === "added") onAdd && onAdd(id, ch.doc.data());
        else if (ch.type === "modified") onChange && onChange(id, ch.doc.data());
        else if (ch.type === "removed") onRemove && onRemove(id);
      });
    }, (err) => console.error("subscribePlayers:", err));

    return this.playersUnsub;
  }

  // --------------------------- CHAT ---------------------------
  async cleanupChatIfNeeded() {
    if (!this.currentLobbyId) return;
    try {
      const chatCol = collection(this.db, "lobbies", this.currentLobbyId, "chat");
      // Keep newest 24 (desc), delete anything older than that window
      const snap = await getDocs(query(chatCol, orderBy("createdAt", "desc"), limit(26)));
      if (snap.size > 24) {
        const old = snap.docs.slice(24);
        for (const d of old) { try { await deleteDoc(d.ref); } catch {} }
      }
    } catch {}
  }

  async sendChat(text) {
    if (!this.currentLobbyId) return;
    const uid = this.auth.currentUser?.uid;
    const user = this.auth.currentUser;
    const username = user?.displayName || (user?.email ? user.email.split("@")[0] : "player");

    const ref = collection(this.db, "lobbies", this.currentLobbyId, "chat");
    await addDoc(ref, { uid, username, text: String(text).slice(0, 200), createdAt: serverTimestamp() });

    // Owner trims to 24 so clients stay in sync
    if (this.currentLobbyOwner && this.currentLobbyOwner === uid) {
      try { await this.cleanupChatIfNeeded(); } catch {}
    }
  }

  subscribeChat(cb) {
    if (!this.currentLobbyId) return () => {};
    const qy = query(
      collection(this.db, "lobbies", this.currentLobbyId, "chat"),
      orderBy("createdAt", "asc"),
      limitToLast(24)
    );
    if (this.chatUnsub) { try { this.chatUnsub(); } catch {} }
    this.chatUnsub = onSnapshot(qy, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb && cb(msgs);
    }, (err) => console.error("subscribeChat:", err));
    return this.chatUnsub;
  }
}

// One-shot query helper (no import needed)
async function onSnapshotOnce(qry) {
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(qry, (snap) => { try { unsub(); } catch {} resolve(snap); },
                                 (err)  => { try { unsub(); } catch {} reject(err); });
  });
}
