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
  orderByChild, limitToLast, serverTimestamp as rtdbServerTimestamp, startAt, runTransaction
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
    this._authUnsub = onAuthStateChanged(this.auth, async (u) => {
        if (u) {
            const userRef = ref(this.db, `users/${u.uid}`);
            const snap = await get(userRef);
            if (snap.exists()) {
                const userData = snap.val();
                if (!userData.username && u.email) {
                    const usernameFromEmail = u.email.split('@')[0];
                    await update(userRef, { username: usernameFromEmail });
                }
            } else if (u.email) {
                const usernameFromEmail = u.email.split('@')[0];
                await set(userRef, {
                    username: usernameFromEmail,
                    level: 1,
                    xp: 0,
                    coins: 0,
                    inventory: {}
                });
            }
        }
        this._authCb(u);
        this.setupPresence();
    });

    this.currentLobbyId = null;
    this.currentLobbyOwner = null;
    this.joinTimestamp = 0;

    this._playerRef = null;
    this._playerOnDisconnect = null;

    this.playersUnsubs = [];
    this.chatUnsub = null;
    this.lobbiesUnsub = null;

    window.addEventListener("beforeunload", () => { this.leaveLobby().catch(()=>{}); });
    window.addEventListener("unload",       () => { this.leaveLobby().catch(()=>{}); });
  }

  // ---------- AUTH & PRESENCE ----------
  setupPresence() {
      const uid = this.auth.currentUser?.uid;
      if (uid) {
          const userStatusDatabaseRef = ref(this.db, '/presence/' + uid);
          const isOfflineForDatabase = { state: 'offline', last_changed: rtdbServerTimestamp() };
          const isOnlineForDatabase = { state: 'online', last_changed: rtdbServerTimestamp() };

          onValue(ref(this.db, '.info/connected'), (snapshot) => {
              if (snapshot.val() === false) {
                  return;
              }
              onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
                  set(userStatusDatabaseRef, isOnlineForDatabase);
              });
          });
      }
  }
  
  subscribeOnlineCount(cb) {
      const connectionsRef = ref(this.db, '/presence');
      const handler = onValue(connectionsRef, (snap) => {
          let count = 0;
          if (snap.exists()) {
              snap.forEach(childSnap => {
                  if (childSnap.val().state === 'online') {
                      count++;
                  }
              });
          }
          cb(count);
      });
      return handler;
  }


  onAuth(cb){ this._authCb = cb; }
  _usernameToEmail(username){ return `${username}@poketest.local`; }

  async signUp(username, password){
    const email = this._usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    
    await set(ref(this.db, `users/${cred.user.uid}`), {
        username: username,
        level: 1,
        xp: 0,
        coins: 0,
        inventory: {}
    });

    return cred.user;
  }
  async logIn(username, password){
    const email = this._usernameToEmail(username);
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }
  async logOut(){
    const userStatusDatabaseRef = ref(this.db, '/presence/' + this.auth.currentUser.uid);
    await set(userStatusDatabaseRef, { state: 'offline', last_changed: rtdbServerTimestamp() });
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
      name: name || `Lobby ${Math.floor(Math.random() * 9999)}`,
      owner: uid,
      createdAt: rtdbServerTimestamp(),
      mapMeta: {
        w: Number(mapMeta?.w) || 48,
        h: Number(mapMeta?.h) || 32,
        seed: Number(mapMeta?.seed) || 1234,
        type: mapMeta?.type || 'dungeon',
      },
      active: true,
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
          mapMeta: meta.mapMeta || { w: 48, h: 32, seed: 1234, type: 'dungeon' },
          active: meta.active !== false,
          playersCount: Object.keys(players).length,
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
    this.joinTimestamp = Date.now();
    try {
      const s = await get(child(ref(this.db), `lobbies/${lobbyId}/meta`));
      this.currentLobbyOwner = s.exists() ? (s.val().owner || null) : null;
    } catch { this.currentLobbyOwner = null; }
    if (this.auth.currentUser.displayName) {
        this.sendChat(`${this.auth.currentUser.displayName} has joined the lobby.`, true);
    }
  }

// net.js

  async leaveLobby(){
      const lob = this.currentLobbyId;
      if (!lob) return;

      if (this.auth.currentUser.displayName) {
          this.sendChat(`${this.auth.currentUser.displayName} has left the lobby.`, true);
      }

      try {
        if (this._playerOnDisconnect) { try { await this._playerOnDisconnect.cancel(); } catch {} this._playerOnDisconnect = null; }
        if (this._playerRef) { await remove(this._playerRef); this._playerRef = null; }
      } catch {}

      // Check if the lobby is empty and schedule deletion
      const lobbyPlayersRef = ref(this.db, `lobbies/${lob}/players`);
      const snapshot = await get(lobbyPlayersRef);
      if (!snapshot.exists() || !snapshot.hasChildren()) {
          setTimeout(async () => {
              const currentSnapshot = await get(lobbyPlayersRef);
              if (!currentSnapshot.exists() || !currentSnapshot.hasChildren()) {
                  const lobbyRef = ref(this.db, `lobbies/${lob}`);
                  await remove(lobbyRef);
                  console.log(`Lobby ${lob} was empty for 10 seconds and has been deleted.`);
              }
          }, 10000); // 10 seconds
      }

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
      level: state.level || 1,
      originalCharacterKey: state.originalCharacterKey,
      equippedItem: state.equippedItem || null,
      ts: rtdbServerTimestamp()
    };
    await set(this._playerRef, payload);
    try { 
        this._playerOnDisconnect = onDisconnect(this._playerRef); 
        await this._playerOnDisconnect.remove(); 
    } catch (e) {
        console.error("Failed to set onDisconnect handler:", e);
    }
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
      onRemove && onRemove(snap.key, snap.val());
    });

    const unsub = () => { try{a();}catch{} try{c();}catch{} try{r();}catch{} };
    this.playersUnsubs.push(unsub);
    return unsub;
  }
  
    // ---------- USER STATS (persistent) ----------
  async getUserStats() {
      const uid = this.auth.currentUser?.uid;
      if (!uid) return { level: 1, xp: 0, coins: 0, inventory: {}, equippedItem: null };
      const userRef = ref(this.db, `users/${uid}`);
      const snap = await get(userRef);
      if (snap.exists()) {
          return snap.val();
      } else {
          const defaultStats = { level: 1, xp: 0, coins: 0, inventory: {}, equippedItem: null };
          await set(userRef, defaultStats);
          return defaultStats;
      }
  }

  async updatePlayerStats(statsUpdate) {
      const uid = this.auth.currentUser?.uid;
      if (!uid) return;
      const userRef = ref(this.db, `users/${uid}`);
      return runTransaction(userRef, (currentData) => {
          if (currentData) {
              if (statsUpdate.xp) {
                  currentData.xp = (currentData.xp || 0) + statsUpdate.xp;
              }
              if (statsUpdate.coins) {
                  currentData.coins = (currentData.coins || 0) + statsUpdate.coins;
              }
              if (statsUpdate.level) {
                  currentData.level = statsUpdate.level;
              }
               if (statsUpdate.xpSet !== undefined) { 
                  currentData.xp = statsUpdate.xpSet;
              }
          }
          return currentData;
      });
  }

  async purchaseItem(item) {
      const uid = this.auth.currentUser?.uid;
      if (!uid) return;
      const userRef = ref(this.db, `users/${uid}`);
      return runTransaction(userRef, (currentData) => {
          if (currentData && currentData.coins >= item.price) {
              currentData.coins -= item.price;
              if (!currentData.inventory) {
                  currentData.inventory = {};
              }
              currentData.inventory[item.id] = (currentData.inventory[item.id] || 0) + 1;
          }
          return currentData;
      });
  }

  async equipItem(itemId) {
      const uid = this.auth.currentUser?.uid;
      if (!uid) return;
      const userRef = ref(this.db, `users/${uid}`);
      await update(userRef, { equippedItem: itemId });
      await this.updateState({ equippedItem: itemId });
  }

  // ---------- Leaderboard ----------
  subscribeToLeaderboard(type, cb) {
      const usersRef = ref(this.db, 'users');
      const q = query(usersRef, orderByChild(type), limitToLast(5));

      const handler = onValue(q, (snap) => {
          const leaderboard = [];
          if (snap.exists()) {
              snap.forEach(childSnap => {
                  leaderboard.push(childSnap.val());
              });
          }
          cb(leaderboard);
      }, (error) => {
          console.error("Failed to fetch user data for leaderboard:", error);
      });
      return handler;
  }


  // ---------- STATUS EVENTS (e.g., Sleep) ----------
  async applyStatus(targetUid, status) {
    if (!this.currentLobbyId || !targetUid || !status) return;
    const refPath = ref(this.db, `lobbies/${this.currentLobbyId}/players/${targetUid}/status_events`);
    const newRef = push(refPath);
    await set(newRef, { ...status, from: this.auth.currentUser?.uid, ts: rtdbServerTimestamp() });
  }

  subscribeToStatusEvents(onEvent) {
    const uid = this.auth.currentUser?.uid;
    if (!this.currentLobbyId || !uid) return () => {};
    const statusRef = ref(this.db, `lobbies/${this.currentLobbyId}/players/${uid}/status_events`);
    const q = query(statusRef, orderByChild('ts'), startAt(this.joinTimestamp));
    const unsub = onChildAdded(q, (snap) => {
      const val = snap.val();
      try { onEvent && onEvent(val); } catch(e){ console.error(e); }
      remove(snap.ref).catch(()=>{});
    });
    this.playersUnsubs.push(unsub);
    return unsub;
  }

  // ---------- ABILITY EVENTS ----------
  async broadcastAbility(abilityData) {
      if (!this.currentLobbyId) return;
      const abilityEventsRef = ref(this.db, `lobbies/${this.currentLobbyId}/ability_events`);
      const newEventRef = push(abilityEventsRef);
      await set(newEventRef, {
          by: this.auth.currentUser?.uid,
          ...abilityData,
          ts: rtdbServerTimestamp()
      });
  }

  subscribeToAbilities(onAbility) {
      if (!this.currentLobbyId) return () => {};
      const abilityEventsRef = ref(this.db, `lobbies/${this.currentLobbyId}/ability_events`);
      const q = query(abilityEventsRef, orderByChild('ts'), startAt(this.joinTimestamp));

      const unsub = onChildAdded(q, (snap) => {
          const abilityData = snap.val();
          if (abilityData.by === this.auth.currentUser?.uid) {
              return;
          }
          onAbility(abilityData);
          remove(snap.ref).catch(e => console.error("Failed to remove ability event", e));
      });

      this.playersUnsubs.push(unsub);
      return unsub;
  }

  // ---------- PVP & CHAT (RTDB) ----------
  async dealDamage(targetUid, damage, isKill, fromAbility = null) {
    if (!this.currentLobbyId || !targetUid) return;
    const hitsRef = ref(this.db, `lobbies/${this.currentLobbyId}/players/${targetUid}/hits`);
    const newHitRef = push(hitsRef);
    const payload = {
      damage: damage,
      from: this.auth.currentUser?.uid,
      isKill: !!isKill,
      ts: rtdbServerTimestamp()
    };
    if (fromAbility) {
        payload.fromAbility = fromAbility;
    }
    await set(newHitRef, payload);
  }

  subscribeToHits(onHit) {
    const uid = this.auth.currentUser?.uid;
    if (!this.currentLobbyId || !uid) return () => {};

    const hitsRef = ref(this.db, `lobbies/${this.currentLobbyId}/players/${uid}/hits`);
    const q = query(hitsRef, orderByChild('ts'), startAt(this.joinTimestamp));

    const unsub = onChildAdded(q, (snap) => {
      onHit(snap.val());
      remove(snap.ref).catch(e => console.error("Failed to remove hit", e));
    });

    this.playersUnsubs.push(unsub);
    return unsub;
  }

  async fireProjectile(projectileData) {
      if (!this.currentLobbyId) return;
      const projectilesRef = ref(this.db, `lobbies/${this.currentLobbyId}/projectiles`);
      const newProjectileRef = push(projectilesRef);
      await set(newProjectileRef, {
          ...projectileData,
          ts: rtdbServerTimestamp()
      });
  }

  subscribeToProjectiles(onFire) {
      if (!this.currentLobbyId) return () => {};
      const projectilesRef = ref(this.db, `lobbies/${this.currentLobbyId}/projectiles`);
      const q = query(projectilesRef, orderByChild('ts'), startAt(this.joinTimestamp));

      const unsub = onChildAdded(q, (snap) => {
          const projectileData = snap.val();
          if (projectileData.ownerId === this.auth.currentUser?.uid) {
              return; 
          }
          onFire(projectileData);
      });

      this.playersUnsubs.push(unsub);
      return unsub;
  }
  
  async performMeleeAttack() {
    if (!this.currentLobbyId) return;
    const meleeAttacksRef = ref(this.db, `lobbies/${this.currentLobbyId}/melee_attacks`);
    const newAttackRef = push(meleeAttacksRef);
    await set(newAttackRef, {
      by: this.auth.currentUser?.uid,
      ts: rtdbServerTimestamp()
    });
  }

  subscribeToMeleeAttacks(onAttack) {
      if (!this.currentLobbyId) return () => {};
      const meleeAttacksRef = ref(this.db, `lobbies/${this.currentLobbyId}/melee_attacks`);
      const q = query(meleeAttacksRef, orderByChild('ts'), startAt(this.joinTimestamp));

      const unsub = onChildAdded(q, (snap) => {
          const attackData = snap.val();
          if (attackData.by === this.auth.currentUser?.uid) {
              return;
          }
          onAttack(attackData);
          remove(snap.ref).catch(e => console.error("Failed to remove melee attack event", e));
      });

      this.playersUnsubs.push(unsub);
      return unsub;
  }

  async sendChat(text, isSystemMessage = false){
    if (!this.currentLobbyId) return;
    const uid = this.auth.currentUser?.uid;
    const user = this.auth.currentUser;
    const username = user?.displayName || (user?.email ? user.email.split("@")[0] : "player");
    const msgRef = push(ref(this.db, `lobbies/${this.currentLobbyId}/chat`));
    
    const payload = {
        uid,
        username,
        text: String(text).slice(0, 200),
        ts: rtdbServerTimestamp()
    };
    if (isSystemMessage) {
        payload.system = true;
    }

    await set(msgRef, payload);

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

  // ---------- ENEMIES (RTDB) ----------
  async setInitialEnemies(enemiesData) {
    const uid = this.auth.currentUser?.uid;
    if (!this.currentLobbyId || uid !== this.currentLobbyOwner) return;
    const enemiesRef = ref(this.db, `lobbies/${this.currentLobbyId}/enemies`);
    await set(enemiesRef, enemiesData);
  }

  async updateEnemyState(enemyId, partialData) {
      if (!this.currentLobbyId || !enemyId) return;
      const enemyRef = ref(this.db, `lobbies/${this.currentLobbyId}/enemies/${enemyId}`);
      await update(enemyRef, partialData);
  }

  async removeEnemy(enemyId) {
      if (!this.currentLobbyId || !enemyId) return;
      const enemyRef = ref(this.db, `lobbies/${this.currentLobbyId}/enemies/${enemyId}`);
      await remove(enemyRef);
  }

  subscribeEnemies({ onAdd, onChange, onRemove }) {
      if (!this.currentLobbyId) return () => {};
      const base = ref(this.db, `lobbies/${this.currentLobbyId}/enemies`);

      const a = onChildAdded(base, (snap) => {
          onAdd && onAdd(snap.key, snap.val());
      });
      const c = onChildChanged(base, (snap) => {
          onChange && onChange(snap.key, snap.val());
      });
      const r = onChildRemoved(base, (snap) => {
          onRemove && onRemove(snap.key);
      });

      const unsub = () => { try{a();}catch{} try{c();}catch{} try{r();}catch{} };
      this.playersUnsubs.push(unsub);
      return unsub;
  }

    // ---------- COINS (RTDB) ----------
  async setInitialCoins(coinsData) {
      const uid = this.auth.currentUser?.uid;
      if (!this.currentLobbyId || uid !== this.currentLobbyOwner) return;
      const coinsRef = ref(this.db, `lobbies/${this.currentLobbyId}/coins`);
      await set(coinsRef, coinsData);
  }

  async removeCoin(coinId) {
      if (!this.currentLobbyId || !coinId) return;
      const coinRef = ref(this.db, `lobbies/${this.currentLobbyId}/coins/${coinId}`);
      await remove(coinRef);
  }

  subscribeCoins({ onAdd, onRemove }) {
      if (!this.currentLobbyId) return () => {};
      const base = ref(this.db, `lobbies/${this.currentLobbyId}/coins`);

      const a = onChildAdded(base, (snap) => {
          onAdd && onAdd(snap.key, snap.val());
      });
      const r = onChildRemoved(base, (snap) => {
          onRemove && onRemove(snap.key);
      });

      const unsub = () => { try{a();}catch{} try{r();}catch{} };
      this.playersUnsubs.push(unsub);
      return unsub;
  }
  
    // ---------- HEALTH PACKS (RTDB) ----------
  async setInitialHealthPacks(healthPacksData) {
      const uid = this.auth.currentUser?.uid;
      if (!this.currentLobbyId || uid !== this.currentLobbyOwner) return;
      const healthPacksRef = ref(this.db, `lobbies/${this.currentLobbyId}/healthPacks`);
      await set(healthPacksRef, healthPacksData);
  }

  async removeHealthPack(packId) {
      if (!this.currentLobbyId || !packId) return;
      const packRef = ref(this.db, `lobbies/${this.currentLobbyId}/healthPacks/${packId}`);
      await remove(packRef);
  }

  subscribeHealthPacks({ onAdd, onRemove }) {
      if (!this.currentLobbyId) return () => {};
      const base = ref(this.db, `lobbies/${this.currentLobbyId}/healthPacks`);

      const a = onChildAdded(base, (snap) => {
          onAdd && onAdd(snap.key, snap.val());
      });
      const r = onChildRemoved(base, (snap) => {
          onRemove && onRemove(snap.key);
      });

      const unsub = () => { try{a();}catch{} try{r();}catch{} };
      this.playersUnsubs.push(unsub);
      return unsub;
  }
}
