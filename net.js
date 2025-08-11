// net.js — Firebase wiring for auth, lobbies, players, chat (Firestore-only)

// --- Firebase imports (ESM CDN) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, increment, query, orderBy, where, limit, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Your Firebase project config ---
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
  // Count docs in lobbies/{lobbyId}/players (server-side aggregate)
  async _countPlayers(lobbyId) {
    try {
      const col = collection(this.db, "lobbies", lobbyId, "players");
      const snap = await getCountFromServer(col);
      return snap.data().count || 0;
    } catch (e) { return 0; }
  }

  // Compare stored playersCount with actual and fix if different
  async _reconcilePlayersCount(lobbyId) {
    try {
      const actual = await this._countPlayers(lobbyId);
      const dref = doc(this.db, "lobbies", lobbyId);
      const ds = await getDoc(dref);
      if (!ds.exists()) return;
      const current = Number(ds.data().playersCount||0);
      if (current !== actual) {
        await updateDoc(dref, { playersCount: actual });
      }
    } catch {}
  }
export class Net {
  constructor(cfg = firebaseConfig) {
    this.app  = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db   = getFirestore(this.app);

    this._authCb = () => {};
    this._authUnsub = onAuthStateChanged(this.auth, (u) => this._authCb(u));

    // Lobby state
    this.currentLobbyId = null;
    this.playersUnsub = null;
    this.chatUnsub = null;

    // Make sure we leave cleanly
    window.addEventListener("beforeunload", () => this.leaveLobby().catch(()=>{}));
    window.addEventListener("unload",       () => this.leaveLobby().catch(()=>{}));
  }

  // -------------------- AUTH --------------------
  onAuth(cb) { this._authCb = cb; }

  // We synthesize an email from the username so we can use email/password auth.
  _usernameToEmail(username) {
    return `${username}@poketest.local`;
  }

  async signUp(username, password) {
    const email = this._usernameToEmail(username);
    const cred  = await createUserWithEmailAndPassword(this.auth, email, password);
    // store displayName = username
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

  // -------------------- LOBBIES --------------------
  async createLobby(name, mapMeta) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");

    // Must match Firestore rules keys: name, owner, createdAt, mapMeta, playersCount, active
    const ref = await addDoc(collection(this.db, "lobbies"), {
      name: name || `Lobby ${Math.floor(Math.random()*9999)}`,
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
    // newest first; you’ll see playersCount & mapMeta
    const q = query(
      collection(this.db, "lobbies"),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    return onSnapshot(q, async (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      cb(list);
      // Opportunistic fix of stale counts
      try { await Promise.all(list.map(l => this._reconcilePlayersCount(l.id))); } catch {}
    }, (err)=>console.error("subscribeLobbies:", err));
  }

  // Only delete your own empty lobbies (rules restrict delete to owner)
  async cleanupEmptyLobbies() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const q = query(
      collection(this.db, "lobbies"),
      where("owner","==",uid),
      where("playersCount","==",0),
      where("active","==",true),
      limit(10)
    );
    const snap = await onSnapshotOnce(q);
    for (const d of snap.docs) {
      try { await deleteDoc(doc(this.db,"lobbies",d.id)); } catch(e){ /* ignore permission errors */ }
    }
  }

  async joinLobby(lobbyId) {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error("Not signed in");

    // Set current lobby id and bump count
    this.currentLobbyId = lobbyId;
    try {
      await updateDoc(doc(this.db, "lobbies", lobbyId), { playersCount: increment(1) });
    } catch (e) {
      // If the lobby was just created and count field missing, ensure it exists
      try { await updateDoc(doc(this.db, "lobbies", lobbyId), { playersCount: increment(0) }); } catch {}
    }
  }

  async leaveLobby() {
    const uid = this.auth.currentUser?.uid;
    const lob = this.currentLobbyId;
    if (!lob) return;

    try {
      // Remove my player doc
      await deleteDoc(doc(this.db, "lobbies", lob, "players", uid));
    } catch {}

    try {
      await updateDoc(doc(this.db, "lobbies", lob), { playersCount: increment(-1) });
    } catch {}
    // Ensure exact count even if decrement failed earlier
    try { const n = await this._countPlayers(lob); await updateDoc(doc(this.db, "lobbies", lob), { playersCount: n }); } catch {}

    // Stop listeners
    if (this.playersUnsub) { try{ this.playersUnsub(); }catch{} this.playersUnsub = null; }
    if (this.chatUnsub)    { try{ this.chatUnsub(); }catch{} this.chatUnsub    = null; }

    this.currentLobbyId = null;
  }

  // -------------------- PLAYERS --------------------
  async spawnLocal(state) {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) throw new Error("No lobby joined");

    // players/{uid} inside the lobby
    const ref = doc(this.db, "lobbies", this.currentLobbyId, "players", uid);
    await setDoc(ref, {
      username: state.username || "player",
      character: state.character,
      x: Number(state.x)||0,
      y: Number(state.y)||0,
      dir: state.dir || "down",
      anim: state.anim || "stand",
      scale: Number(state.scale)||3,
      typing: !!state.typing,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // Partial updates from the game loop
  async updateState(partial) {
    const uid = this.auth.currentUser?.uid;
    if (!uid || !this.currentLobbyId) return;
    const ref = doc(this.db, "lobbies", this.currentLobbyId, "players", uid);
    try {
      await updateDoc(ref, { ...partial, updatedAt: serverTimestamp() });
    } catch (e) {
      // If the doc doesn't exist yet (rare race), fall back to setDoc
      try { await setDoc(ref, { ...partial, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
    }
  }

  // Subscribe to all players in the current lobby
  subscribePlayers({ onAdd, onChange, onRemove }) {
    if (!this.currentLobbyId) return () => {};
    const uid = this.auth.currentUser?.uid;
    const col = collection(this.db, "lobbies", this.currentLobbyId, "players");

    if (this.playersUnsub) { try{ this.playersUnsub(); }catch{} }
    this.playersUnsub = onSnapshot(col, (snap) => {
      snap.docChanges().forEach((ch) => {
        const id = ch.doc.id;
        // Skip our own doc for remote list; main.js draws the local player itself
        if (id === uid) return;

        if (ch.type === "added") {
          onAdd && onAdd(id, ch.doc.data());
        } else if (ch.type === "modified") {
          onChange && onChange(id, ch.doc.data());
        } else if (ch.type === "removed") {
          onRemove && onRemove(id);
        }
      });
    }, (err)=>console.error("subscribePlayers:", err));

    return this.playersUnsub;
  }

  // -------------------- CHAT --------------------
  async sendChat(text) {
    if (!this.currentLobbyId) return;
    const uid = this.auth.currentUser?.uid;
    const user = this.auth.currentUser;
    const username = user?.displayName || (user?.email ? user.email.split("@")[0] : "player");

    const ref = collection(this.db, "lobbies", this.currentLobbyId, "chat");
    await addDoc(ref, {
      uid, username, text: String(text).slice(0,200),
      createdAt: serverTimestamp()
    });
  }

  subscribeChat(cb) {
    if (!this.currentLobbyId) return () => {};
    const q = query(
      collection(this.db, "lobbies", this.currentLobbyId, "chat"),
      orderBy("createdAt", "asc"),
      limit(24)
    );

    if (this.chatUnsub) { try{ this.chatUnsub(); }catch{} }
    this.chatUnsub = onSnapshot(q, (snap)=>{
      const msgs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      cb && cb(msgs);
    }, (err)=>console.error("subscribeChat:", err));

    return this.chatUnsub;
  }
}

// -------------------- Helpers --------------------
async function onSnapshotOnce(qry) {
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(qry, (snap) => { unsub(); resolve(snap); }, (e)=>{ try{unsub();}catch{} reject(e); });
  });
}
