// main.js — select → lobby list → create/join → multiplayer + chat (seeded maps)
// global to avoid strict-mode ReferenceError on auth
let localUsername = "";
let lobbyUnsub = null; // unsubscribe fn for lobby snapshot

// Safe unsubscribe wrapper for lobby snapshot
function unsubscribeLobby(){
  if (typeof lobbyUnsub === 'function'){
    try { lobbyUnsub(); } catch(e){ console.warn('lobbyUnsub threw during unsubscribe', e); }
    lobbyUnsub = null;
  }
}
// global selected character key for select screen
let selectedKey = null;


// Remote players registry
const remote = new Map();
// Enemy and projectile registries
const enemies = new Map();
const projectiles = [];
const playerProjectiles = [];

import { Net, firebaseConfig } from "./net.js";
const net = new Net(firebaseConfig);

// ---------- Canvas ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
// These constants define the game's internal resolution.
// CSS will scale the canvas visually.
const CANVAS_W = 960, CANVAS_H = 640;
canvas.width = CANVAS_W; canvas.height = CANVAS_H;

// ---------- Overlays / UI ----------
const playerHudEl = document.getElementById("player-hud");
const overlaySelect  = document.getElementById("select");
const gridEl         = document.getElementById("charGrid");
const overlayLobbies = document.getElementById("lobbies");
const lobbyListEl    = document.getElementById("lobbyList");
const lobbyHintEl    = document.getElementById("lobbyHint");
const newLobbyNameEl = document.getElementById("newLobbyName");
const createLobbyBtn = document.getElementById("createLobbyBtn");
const refreshBtn     = document.getElementById("refreshLobbiesBtn");
const backBtn        = document.getElementById("backToSelectBtn");
const authEl         = document.getElementById("auth");
const formEl         = document.getElementById("authForm");
const userEl         = document.getElementById("authUser");
const passEl         = document.getElementById("authPass");
const toggleEl       = document.getElementById("authToggle");
const titleEl        = document.getElementById("authTitle");
const errEl          = document.getElementById("authErr");
const inputSelectOverlay = document.getElementById("input-select");
const keyboardBtn = document.getElementById("keyboardBtn");
const screenBtn = document.getElementById("screenBtn");
const mobileControls = document.getElementById("mobile-controls");
const authSubmitBtn = document.getElementById("authSubmit");
const chatBtnMobile = document.getElementById("chat-btn-mobile");
const backBtnMobile = document.getElementById("back-btn-mobile");
const mobileChatOverlay = document.getElementById("mobile-chat-overlay");
const mobileChatForm = document.getElementById("mobile-chat-form");
const mobileChatInput = document.getElementById("mobile-chat-input");


// ---------- Chat HUD (mount/unmount inside lobbies only) ----------
let chatLogEl = null;
let chatUnsubLocal = null;
let chatMessages = [];
let lastProcessedChatTimestamp = 0;

function renderChatLog(){
  if (!chatLogEl) return;
  chatLogEl.innerHTML = "";
  const msgs = (chatMessages || []).slice(-24);
  for (const m of msgs){
    const div = document.createElement("div");
    div.className = "chatItem";
    div.textContent = `${m.username || "player"}: ${m.text}`;
    chatLogEl.appendChild(div);
  }
  // Local draft while typing (not sent to Firestore)
  if (chatMode){
    const draft = document.createElement("div");
    draft.className = "chatItem chatDraft";
    draft.style.opacity = 0.7;
    draft.style.fontStyle = "italic";
    draft.textContent = `${localUsername||"you"} (typing): ${chatBuffer || ""}`;
    chatLogEl.appendChild(draft);
  }
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function mountChatLog(){
  if (chatLogEl) return;
  chatLogEl = document.createElement("div");
  chatLogEl.id = "chatLog";
  document.body.appendChild(chatLogEl);
  renderChatLog();
}

function unmountChatLog(){
  if (chatUnsubLocal){ try{ chatUnsubLocal(); }catch{} chatUnsubLocal = null; }
  if (chatLogEl){ chatLogEl.remove(); chatLogEl = null; }
  if (inputMode === 'touch') {
      mobileControls.classList.add("hidden");
  }
  playerHudEl.classList.add("hidden");
}

// ---------- Settings ----------
const TILE = 48;
const MAP_SCALE = 3;
const SPEED = TILE * 2.6;
function currentSpeedMult(){ const cfg = CHARACTERS[selectedKey]; return (cfg && cfg.speed) ? cfg.speed : 1.0; }
const WALK_FPS = 10, IDLE_FPS = 6, HOP_FPS = 12, HURT_FPS = 12, ATTACK_FPS = 12;
const IDLE_INTERVAL = 5;
const HOP_HEIGHT = Math.round(TILE * 0.55);
const BASELINE_NUDGE_Y = 0;

const PLAYER_R = 12; // Player collision radius
const ENEMY_R = 16;  // Enemy collision radius
const PROJECTILE_R = 6; // Projectile collision radius (adjusted for 8-bit square)
const GAP_W       = Math.round(TILE * 0.60);
const EDGE_DARK   = "#06161b";
const EDGE_DARKER = "#031013";
const EDGE_LIP    = "rgba(255,255,255,0.08)";

const TEX = { floor: null, wall: null };
const BG_TILE_SCALE = 3.0; // visual scale for floor & wall tiles (option 2)

loadImage("assets/background/floor.png").then(im => TEX.floor = im).catch(()=>{});
loadImage("assets/background/wall.png").then(im => TEX.wall  = im).catch(()=>{});

// ---------- SFX ----------
function makeAudioPool(url, poolSize = 6){
  const pool = Array.from({length: poolSize}, () => new Audio(url));
  return {
    play(vol = 1, rate = 1){
      const a = pool.find(ch => ch.paused) || pool[0].cloneNode(true);
      a.volume = vol; a.playbackRate = rate;
      try{ a.currentTime = 0; }catch{}
      a.play().catch(()=>{});
    }
  };
}
const sfx = {
  hover:  makeAudioPool("assets/sfx/blipHover.wav"),
  select: makeAudioPool("assets/sfx/blipSelect.wav"),
  jump:   makeAudioPool("assets/sfx/jump.wav"),
};

// ---------- Chat filter ----------
const BANNED_PATTERNS = [
  new RegExp("\\b" + "n" + "[^a-z0-9]{0,3}" + "[i1!|l]" + "[^a-z0-9]{0,3}" + "[gq9]" + "[^a-z0-9]{0,3}" + "[gq9]" + "[^a-z0-9]{0,3}" + "[e3]" + "[^a-z0-9]{0,3}" + "r" + "\\b","i"),
  new RegExp("\\b" + "f" + "[^a-z0-9]{0,3}" + "[a@4]" + "[^a-z0-9]{0,3}" + "[gq9]" + "[^a-z0-9]{0,3}" + "[gq9]" + "[^a-z0-9]{0,3}" + "[o0]" + "[^a-z0-9]{0,3}" + "[t+]" + "\\b","i")
];
const normalize = s => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\u200b|\u200c|\u200d/g,"");
function censorMessage(t){ const n=normalize(t); return BANNED_PATTERNS.some(rx=>rx.test(n)) ? null : t; }

// ---------- Characters ----------
function makeRowDirGrid() {
  return {
    down:{row:0,start:0}, downRight:{row:1,start:0}, right:{row:2,start:0}, upRight:{row:3,start:0},
    up:{row:4,start:0},   upLeft:{row:5,start:0},    left:{row:6,start:0},   downLeft:{row:7,start:0},
  };
}
let CHARACTERS = {};

// **FIX**: Embed character data directly to prevent 404 errors.
const CHARACTERS_DATA = {
  "$schemaVersion": 1,
  "defaults": { "scale": 3, "speed": 1.0, "hp": 100, "idle": { "sheet": "Idle-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" }, "hurt": { "sheet": "Hurt-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "attack": { "sheet": "Attack-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" }, "shoot": { "sheet": "SpAttack-Anim.png", "cols": 11, "rows": 8, "framesPerDir": 11, "dirGrid": "row" } },
  "characters": {
    "Sableye": { "name": "Sableye", "base": "assets/Sableye/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 150, "ranged": true, "projectileColor": "#4B0082", "shoot": { "sheet": "SpAttack-Anim.png", "cols": 17, "rows": 8, "framesPerDir": 17, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" } },
    "Ditto": { "name": "Ditto", "base": "assets/Ditto/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 120, "idle": { "sheet": "Idle-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 5, "rows": 8, "framesPerDir": 5, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Hisuian Zoroark": { "name": "Hisuian Zoroark", "base": "assets/Hisuian Zoroark/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.0, "hp": 160, "attack": { "cols": 13, "rows": 8, "framesPerDir": 13 }, "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Hypno": { "name": "Hypno", "base": "assets/Hypno/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 185, "idle": { "sheet": "Idle-Anim.png", "cols": 8, "rows": 8, "framesPerDir": 8, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Mimikyu": { "name": "Mimikyu", "base": "assets/Mimikyu/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 155, "ranged": true, "projectileColor": "#C71585", "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Quagsire": { "name": "Quagsire", "base": "assets/Quagsire/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 195, "ranged": true, "projectileColor": "#87CEEB", "shoot": { "sheet": "Shoot-Anim.png", "cols": 11, "rows": 8, "framesPerDir": 11, "dirGrid": "row" }, "idle": { "sheet": "Idle-Anim.png", "cols": 7, "rows": 8, "framesPerDir": 7, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Smeargle": { "name": "Smeargle", "base": "assets/Smeargle/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 155, "idle": { "sheet": "Idle-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Corviknight": { "name": "Corviknight", "base": "assets/Corviknight/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 198, "attack": { "cols": 15, "rows": 8, "framesPerDir": 15 }, "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Cacturne": { "name": "Cacturne", "base": "assets/Cacturne/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 170, "ranged": true, "projectileColor": "#006400", "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Decidueye": { "name": "Decidueye", "base": "assets/Decidueye/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 178, "ranged": true, "projectileColor": "#FFA500", "attack": { "cols": 14, "rows": 8, "framesPerDir": 14 }, "shoot": { "sheet": "Shoot-Anim.png", "cols": 12, "rows": 8, "framesPerDir": 12, "dirGrid": "row" }, "idle": { "sheet": "Idle-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Blaziken": { "name": "Blaziken", "base": "assets/Blaziken/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 180, "attack": { "cols": 9, "rows": 8, "framesPerDir": 9 }, "idle": { "sheet": "Idle-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Snorlax": { "name": "Snorlax", "base": "assets/Snorlax/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 260, "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Chandelure": { "name": "Chandelure", "base": "assets/Chandelure/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 160, "ranged": true, "projectileColor": "#00008B", "attack": { "cols": 13, "rows": 8, "framesPerDir": 13 }, "shoot": { "sheet": "SpAttack-Anim.png", "cols": 14, "rows": 8, "framesPerDir": 14, "dirGrid": "row" }, "idle": { "sheet": "Idle-Anim.png", "cols": 8, "rows": 8, "framesPerDir": 8, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 8, "rows": 8, "framesPerDir": 8, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Empoleon": { "name": "Empoleon", "base": "assets/Empoleon/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 184, "attack": { "cols": 14, "rows": 8, "framesPerDir": 14 }, "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Jolteon": { "name": "Jolteon", "base": "assets/Jolteon/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 165, "ranged": true, "projectileColor": "#FFFF00", "shoot": { "sheet": "SpAttack-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" }, "idle": { "sheet": "Idle-Anim.png", "cols": 2, "rows": 8, "framesPerDir": 2, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Pangoro": { "name": "Pangoro", "base": "assets/Pangoro/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 195, "attack": { "cols": 12, "rows": 8, "framesPerDir": 12 }, "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Scrafty": { "name": "Scrafty", "base": "assets/Scrafty/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 165, "attack": { "cols": 13, "rows": 8, "framesPerDir": 13 }, "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Cyclizar": { "name": "Cyclizar", "base": "assets/Cyclizar/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 170, "attack": { "cols": 13, "rows": 8, "framesPerDir": 13 }, "idle": { "sheet": "Idle-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Axew": { "name": "Axew", "base": "assets/Axew/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 146, "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Obstagoon": { "name": "Obstagoon", "base": "assets/Obstagoon/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 193, "attack": { "cols": 14, "rows": 8, "framesPerDir": 14 }, "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Primarina": { "name": "Primarina", "base": "assets/Primarina/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.02, "hp": 180, "ranged": true, "projectileColor": "#FFC0CB", "shoot": { "sheet": "SpAttack-Anim.png", "cols": 13, "rows": 8, "framesPerDir": 13, "dirGrid": "row" }, "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 7, "rows": 8, "framesPerDir": 7, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Dewgong": { "name": "Dewgong", "base": "assets/Dewgong/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.01, "hp": 190, "idle": { "sheet": "Idle-Anim.png", "cols": 6, "rows": 8, "framesPerDir": 6, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 7, "rows": 8, "framesPerDir": 7, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Scolipede": { "name": "Scolipede", "base": "assets/Scolipede/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.12, "hp": 160, "ranged": true, "projectileColor": "#6A0DAD", "idle": { "sheet": "Idle-Anim.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } },
    "Lycanroc": { "name": "Lycanroc", "base": "assets/Lycanroc/", "portrait": "portrait.png", "scale": 3.0, "speed": 1.08, "hp": 185, "idle": { "sheet": "Idle-Anim.png", "cols": 14, "rows": 8, "framesPerDir": 14, "dirGrid": "row" }, "walk": { "sheet": "walk.png", "cols": 4, "rows": 8, "framesPerDir": 4, "dirGrid": "row" }, "hop": { "sheet": "Hop-Anim.png", "cols": 10, "rows": 8, "framesPerDir": 10, "dirGrid": "row" } }
  }
};

function processCharacterData() {
    const data = CHARACTERS_DATA;
    const def = data.defaults || {};
    function mergeAnim(defAnim={}, chAnim={}){
      const d = defAnim || {};
      const c = chAnim || {};
      return {
        sheet: c.sheet || d.sheet,
        cols: (c.cols ?? d.cols),
        rows: (c.rows ?? d.rows),
        framesPerDir: (c.framesPerDir ?? d.framesPerDir),
        dirGrid: makeRowDirGrid()
      };
    }
    const out = {};
    for (const [key, ch] of Object.entries(data.characters || {})) {
      out[key] = {
        name: ch.name || key,
        base: ch.base,
        portrait: ch.portrait || (def.portrait || 'portrait.png'),
        scale: ch.scale ?? def.scale ?? 3,
        speed: ch.speed ?? def.speed ?? 1.0,
        hp: ch.hp ?? def.hp ?? 100,
        ranged: ch.ranged ?? false,
        projectileColor: ch.projectileColor || "#FFFFFF",
        idle: mergeAnim(def.idle, ch.idle),
        walk: mergeAnim(def.walk, ch.walk),
        hop:  mergeAnim(def.hop,  ch.hop),
        hurt: mergeAnim(def.hurt, ch.hurt),
        attack: mergeAnim(def.attack, ch.attack),
        shoot: ch.ranged ? mergeAnim(def.shoot, ch.shoot) : null,
      };
    }
    
    if (Object.keys(out).length) {
      CHARACTERS = out;
    }
}


let authMode = "signup";
toggleEl.onclick = ()=>{
    authMode = (authMode === "signup") ? "login" : "signup";
    titleEl.textContent = (authMode === "signup") ? "Sign up" : "Log in";
    authSubmitBtn.textContent = (authMode === "signup") ? "Create account" : "Log in";
    toggleEl.textContent = (authMode === "signup") ? "Already have an account? Log in" : "Need an account? Sign up";
};

formEl.addEventListener("submit", async (e)=>{
  e.preventDefault();
  errEl.textContent = "";
  const u = userEl.value.trim().toLowerCase();
  const p = passEl.value;
  if (!/^[a-z0-9_]{3,16}$/.test(u)) { errEl.textContent = "3–16 chars a–z, 0–9, _"; return; }
  try{
    if (authMode === "signup") await net.signUp(u, p);
    else await net.logIn(u, p);
  }catch(err){
    if (err?.code === "auth/too-many-requests") errEl.textContent = "Too many attempts. Wait a few minutes and try again.";
    else errEl.textContent = (err?.code || "Auth error").replace("auth/","");
  }
});
const logoutBtn = document.createElement("button");
logoutBtn.textContent = "Sign out";
logoutBtn.className = "button8 signout";
Object.assign(logoutBtn.style,{position:"fixed",top:"12px",right:"12px",zIndex:"9999",display:"none"});
logoutBtn.onclick = () => net.logOut().catch(()=>{});
document.body.appendChild(logoutBtn);

let inputMode = 'keyboard';

net.onAuth(user=>{
  if (user){
    localUsername = user.displayName || (user.email ? user.email.split("@")[0] : "player");
    authEl.classList.add("hidden");
    logoutBtn.style.display = "inline-block";
    inputSelectOverlay.classList.remove("hidden");
  } else {
    logoutBtn.style.display = "none";
    authEl.classList.remove("hidden");
    overlaySelect.classList.add("hidden");
    overlayLobbies.classList.add("hidden");
    unmountChatLog(); // ensure chat UI gone when signed out
    mobileControls.classList.add("hidden");
  }
});

keyboardBtn.onclick = () => {
    inputMode = 'keyboard';
    mobileControls.classList.add("hidden");
    inputSelectOverlay.classList.add("hidden");
    overlaySelect.classList.remove("hidden");
};

screenBtn.onclick = () => {
    inputMode = 'touch';
    mobileControls.classList.remove("hidden");
    inputSelectOverlay.classList.add("hidden");
    overlaySelect.classList.remove("hidden");
    setupMobileControls();
};

const touchState = new Map();

function setupMobileControls() {
    const controls = document.getElementById('mobile-controls');

    const handleTouchStart = (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            if (target && target.dataset.key) {
                const key = target.dataset.key;
                keys.add(key);
                touchState.set(touch.identifier, key); 
            }
        }
    };

    const handleTouchEnd = (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touchState.has(touch.identifier)) {
                const key = touchState.get(touch.identifier);
                keys.delete(key);
                touchState.delete(touch.identifier); 
            }
        }
    };

    const handleTouchMove = (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            const currentKey = touchState.get(touch.identifier);
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetKey = target ? target.dataset.key : null;

            if (currentKey !== targetKey) {
                if (currentKey) {
                    keys.delete(currentKey);
                }
                if (targetKey) {
                    keys.add(targetKey);
                    touchState.set(touch.identifier, targetKey);
                } else {
                    touchState.delete(touch.identifier);
                }
            }
        }
    };
    
    if (!controls.dataset.listenersAdded) {
        controls.addEventListener('touchstart', handleTouchStart, { passive: false });
        controls.addEventListener('touchend', handleTouchEnd, { passive: false });
        controls.addEventListener('touchcancel', handleTouchEnd, { passive: false });
        controls.addEventListener('touchmove', handleTouchMove, { passive: false });
        controls.dataset.listenersAdded = 'true';
    }
}


// ---------- Select UI ----------
function buildSelectUI(){
  gridEl.innerHTML = "";
  Object.entries(CHARACTERS).forEach(([key, c])=>{
    const btn = document.createElement("button");
    btn.className = "card small-card";
    btn.dataset.key = key;

    const img = document.createElement("img");
    img.src = c.base + c.portrait; img.alt = c.name;

    const span = document.createElement("span");
    span.textContent = c.name;

    btn.append(img, span);

    const hoverBlip = () => sfx.hover.play(0.35, 1 + (Math.random()*0.06 - 0.03));
    btn.addEventListener("mouseenter", hoverBlip);
    btn.addEventListener("focus", hoverBlip);

    btn.onclick = () => {
      selectedKey = key;
      sfx.select.play(0.5);
      overlaySelect.classList.add("hidden");
      showLobbies();
    };

    gridEl.appendChild(btn);
  });
}

// ---------- Lobbies ----------
let isJoiningLobby = false;

function renderLobbyList(list){
  lobbyListEl.innerHTML = "";
  lobbyHintEl.style.display = list.length ? "none" : "block";
  list.forEach(lob=>{
    const wrap = document.createElement("button");
    wrap.className = "card";
    wrap.style.textAlign = "left";
    wrap.style.alignItems = "flex-start";
    const w = lob.mapMeta?.w ?? "?";
    const h = lob.mapMeta?.h ?? "?";
    wrap.innerHTML = `
      <div style="display:grid;gap:6px;">
        <div><strong>${lob.name}</strong></div>
        <div style="font-size:11px;opacity:.9">Players: ${lob.playersCount|0}</div>
        <div style="font-size:11px;opacity:.8">Map: ${w}×${h}</div>
      </div>
    `;
    wrap.onclick = () => {
        if (isJoiningLobby) return;
        joinLobbyFlow(lob.id, wrap);
    };
    lobbyListEl.appendChild(wrap);
  });
}

function showLobbies(){
  overlayLobbies.classList.remove("hidden");
  if (lobbyUnsub) try{ unsubscribeLobby(); }catch{}
  net.cleanupEmptyLobbies().catch(()=>{}).catch(()=>{});
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
}
backBtn.onclick = ()=>{
  overlayLobbies.classList.add("hidden");
  overlaySelect.classList.remove("hidden"); 
  if (inputMode === 'touch') {
      mobileControls.classList.add("hidden");
  }
};
refreshBtn.onclick = ()=>{
  if (lobbyUnsub) { try{ unsubscribeLobby(); }catch{} lobbyUnsub = null; }
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
};

// ---------- Seeded map meta ----------
function randSeed(){ return (Math.random()*0xFFFFFFFF)>>>0; }
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }

createLobbyBtn.onclick = async ()=>{
  const btnLabel = createLobbyBtn.textContent;
  createLobbyBtn.disabled = true;
  createLobbyBtn.textContent = "Creating…";
  try{
    const cfg = CHARACTERS[selectedKey];
    if (!cfg) throw new Error("Pick a character first");
    const visW = Math.floor(canvas.width / TILE);
    const visH = Math.floor(canvas.height / TILE);
    const w = visW * MAP_SCALE;
    const h = visH * MAP_SCALE;
    const seed = randSeed();
    const lobbyId = await net.createLobby((newLobbyNameEl.value||"").trim(), { w,h,seed });
    await net.joinLobby(lobbyId);
    const map = generateMap(w, h, seed);
    await startWithCharacter(cfg, map);
    watchdogEnsureGame(cfg, map);
    overlayLobbies.classList.add("hidden");
    mountChatLog();
    startChatSubscription();
    playerHudEl.classList.remove("hidden");
  } catch(e){
    console.error("Create lobby failed:", e);
    alert("Create lobby failed: " + (e?.message || e));
  } finally {
    createLobbyBtn.disabled = false;
    createLobbyBtn.textContent = btnLabel;
  }
};

async function joinLobbyFlow(lobbyId, btnEl){
  isJoiningLobby = true;
  const originalHTML = btnEl.innerHTML;
  btnEl.innerHTML = `<div><strong>Joining...</strong></div>`;
  
  try{
    const cfg = CHARACTERS[selectedKey];
    if (!cfg) { alert("Pick a character first"); return; }
    const lobby = await net.getLobby(lobbyId);
    const { w,h,seed } = lobby.mapMeta || {};
    await net.joinLobby(lobbyId);
    const map = generateMap(w||48,h||32,seed??1234);
    await startWithCharacter(cfg, map);
    watchdogEnsureGame(cfg, map);
    overlayLobbies.classList.add("hidden");
    mountChatLog();
    startChatSubscription();
    playerHudEl.classList.remove("hidden");
  } catch(e){
    console.error("Join lobby failed:", e);
    alert("Join lobby failed: " + (e?.message || e));
  } finally {
    isJoiningLobby = false;
    if(btnEl) btnEl.innerHTML = originalHTML;
  }
}


function watchdogEnsureGame(cfg, map){
  // If for any reason state.ready/map didn't initialize, retry once after a tick
  setTimeout(()=>{
    if (!state.map || !state.ready){
      try { startWithCharacter(cfg, map); } catch {}
    }
  }, 600);
}
// ---------- Game state ----------
const keys = new Set();
let chatMode=false, chatBuffer="", chatTypingDots=0, chatShowTime=4.5;


// --- Net sync throttling ---
let _netAccum = 0;
const NET_INTERVAL = 0.12;   // ~8 Hz
let _heartbeat = 0;
let _lastSent = { x: NaN, y: NaN, dir: "", anim: "", character: "", typing: null, hp: 100, maxHp: 100 };

function _hasMeaningfulChange() {
  const dx = Math.abs(state.x - _lastSent.x);
  const dy = Math.abs(state.y - _lastSent.y);
  const moved = (dx + dy) > 0.6;
  return moved ||
         state.dir !== _lastSent.dir ||
         state.anim !== _lastSent.anim ||
         selectedKey !== _lastSent.character ||
         state.typing !== _lastSent.typing ||
         state.hp !== _lastSent.hp;
}

function makePingPong(n){
  // produce [0..n-1, n-2..1] for ping-pong frame order
  n = Math.max(1, n|0);
  const seq = [];
  for (let i=0;i<n;i++) seq.push(i);
  for (let i=n-2;i>0;i--) seq.push(i);
  return seq;
}

const state = {
  x:0, y:0, dir:"down",
  moving:false, prevMoving:false,
  frameTime:0, frameStep:0, frameOrder: makePingPong(4),
  anim:"stand", idleAccum:0,
  scale:3,
  walkImg:null, idleImg:null, hopImg:null, hurtImg: null, attackImg: null, shootImg: null,
  animMeta:{walk:null, idle:null, hop:null, hurt: null, attack: null, shoot: null},
  hopping:false,
  hop:{sx:0,sy:0,tx:0,ty:0,t:0,dur:0,z:0},
  map:null, cam:{x:0,y:0},
  ready:false,
  showGrid:false, showBoxes:false,
  say:null, sayTimer:0,
  typing:false,
  hp: 100,
  maxHp: 100,
  invulnerableTimer: 0,
  attackCooldown: 0,
  attacking: false,
};

// ---------- Input ----------
function goBackToSelect() {
    remote.clear();
    enemies.clear();
    projectiles.length = 0;
    playerProjectiles.length = 0;
    net.leaveLobby().catch(()=>{});
    state.ready = false;
    unmountChatLog();
    overlayLobbies.classList.add("hidden");
    overlaySelect.classList.remove("hidden");
    mobileControls.classList.add("hidden");
    mobileChatOverlay.classList.add("hidden");
    mobileChatInput.blur();
}

window.addEventListener("keydown", e=>{
  if (chatMode){
    if (e.key === "Enter"){
      e.preventDefault();
      const clean = censorMessage(chatBuffer.trim());
      chatMode = false; state.typing = false; net.updateState({ typing:false }).catch(()=>{});
      if (clean && clean.length){
        state.say = clean; state.sayTimer = chatShowTime; net.sendChat(clean).catch(()=>{});
      }
      chatBuffer = "";
      renderChatLog();
      return;
    }
    if (e.key === "Escape"){
      e.preventDefault();
      chatMode = false; chatBuffer = ""; state.typing = false; net.updateState({ typing:false }).catch(()=>{});
      renderChatLog();
      return;
    }
    if (e.key === "Backspace"){ e.preventDefault(); chatBuffer = chatBuffer.slice(0, -1); renderChatLog(); return; }
    if (e.key.length === 1){ if (chatBuffer.length < 140) { chatBuffer += e.key; renderChatLog(); } return; }
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab"].includes(e.key)){ e.preventDefault(); return; }
  }

  // Prevent default browser action for game keys
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w", "a", "s", "d", "W", "A", "S", "D", " ", "j", "J", "k", "K"].includes(e.key)) e.preventDefault();

  if (e.key === "Enter"){ chatMode = true; chatBuffer = ""; state.typing = true; net.updateState({ typing:true }).catch(()=>{}); renderChatLog(); return; }
  if (e.key === "Escape"){
    goBackToSelect();
    return;
  }
  if (e.key.toLowerCase() === "g") state.showGrid = !state.showGrid;
  if (e.key.toLowerCase() === "b") state.showBoxes = !state.showBoxes;
  
  keys.add(e.key);
});
window.addEventListener("keyup", e=>{ if (!chatMode) keys.delete(e.key); });

backBtnMobile.onclick = goBackToSelect;

chatBtnMobile.onclick = () => {
  mobileChatOverlay.classList.remove("hidden");
  mobileChatInput.focus();
};

mobileChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = mobileChatInput.value.trim();
    const clean = censorMessage(text);
    
    if (clean && clean.length) {
        state.say = clean;
        state.sayTimer = chatShowTime;
        net.sendChat(clean).catch(() => {});
    }
    
    mobileChatInput.value = "";
    mobileChatOverlay.classList.add("hidden");
    mobileChatInput.blur();
});


// ---------- Map generation (seeded) ----------

function analyzeBitmap(sheet, sx, sy, sw, sh){
  const tmp = document.createElement("canvas");
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, sw, sh);

  let minX=sw, minY=sh, maxX=-1, maxY=-1;
  try {
    const data = tctx.getImageData(0,0,sw,sh).data;
    for (let y=0; y<sh; y++){
      for (let x=0; x<sw; x++){
        if (data[(y*sw + x)*4 + 3] > 8){
          if (x<minX) minX=x; if (y<minY) minY=y;
          if (x>maxX) maxX=x; if (y>maxY) maxY=y;
        }
      }
    }
  } catch {
    return { sx:sx, sy:sy, sw, sh, ox:sw/2, oy:sh-8 + BASELINE_NUDGE_Y };
  }
  if (maxX<minX || maxY<minY){
    return { sx:sx, sy:sy, sw, sh, ox:sw/2, oy:sh-8 + BASELINE_NUDGE_Y };
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const anchorX = (minX + maxX) / 2;
  const anchorY = maxY + BASELINE_NUDGE_Y;
  return { sx:sx+minX, sy:sy+minY, sw:cropW, sh:cropH, ox:anchorX-minX, oy:anchorY-minY };
}

// Slice a sprite sheet into direction -> frames[] using a row-based grid.
function sliceSheet(sheet, cols, rows, dirGrid, framesPerDir){
  const out = {};
  if (!sheet || !cols || !rows || !dirGrid || !framesPerDir) return out;
  const cw = Math.floor(sheet.width / Math.max(1, cols));
  const ch = Math.floor(sheet.height / Math.max(1, rows));

  for (const [dir, info] of Object.entries(dirGrid)){
    const r = Math.max(0, Math.min(rows-1, info.row|0));
    const start = Math.max(0, Math.min(cols-1, info.start|0));
    const strip = [];
    for (let i=0; i<framesPerDir; i++){
      const c = Math.min(cols-1, start + i);
      const sx = c * cw;
      const sy = r * ch;
      const frame = analyzeBitmap(sheet, sx, sy, cw, ch);
      strip.push(frame);
    }
    out[dir] = strip;
  }
  return out;
}

// ---------- Asset Loading ----------
const _assetCache = new Map();

async function loadCharacterAssets(key) {
  if (_assetCache.has(key)) return _assetCache.get(key);

  const cfg = CHARACTERS[key];
  if (!cfg) {
    console.warn(`No config for character key: ${key}`);
    return null;
  }

  try {
    const promises = [
      loadImage(cfg.base + cfg.walk.sheet),
      loadImage(cfg.base + cfg.idle.sheet),
      loadImage(cfg.base + cfg.hop.sheet),
      loadImage(cfg.base + cfg.hurt.sheet),
      loadImage(cfg.base + cfg.attack.sheet),
      cfg.shoot ? loadImage(cfg.base + cfg.shoot.sheet) : Promise.resolve(null),
      loadImage(cfg.base + cfg.portrait)
    ];

    const [wRes, iRes, hRes, huRes, aRes, sRes, pRes] = await Promise.allSettled(promises);

    if (wRes.status !== "fulfilled" || iRes.status !== "fulfilled") {
      throw new Error(`Core sheets (walk/idle) missing for ${key}`);
    }

    const walkImg = wRes.value;
    const idleImg = iRes.value;
    const hopImg = (hRes.status === "fulfilled") ? hRes.value : null;
    const hurtImg = (huRes.status === "fulfilled") ? huRes.value : null;
    const attackImg = (aRes.status === "fulfilled") ? aRes.value : null;
    const shootImg = (sRes.status === "fulfilled") ? sRes.value : null;
    const portraitImg = (pRes.status === "fulfilled") ? pRes.value : null;

    const meta = {
      walk: sliceSheet(walkImg, cfg.walk.cols, cfg.walk.rows, cfg.walk.dirGrid, cfg.walk.framesPerDir),
      idle: sliceSheet(idleImg, cfg.idle.cols, cfg.idle.rows, cfg.idle.dirGrid, cfg.idle.framesPerDir),
      hop: hopImg ? sliceSheet(hopImg, cfg.hop.cols, cfg.hop.rows, cfg.hop.dirGrid, cfg.hop.framesPerDir) : {},
      hurt: hurtImg ? sliceSheet(hurtImg, cfg.hurt.cols, cfg.hurt.rows, cfg.hurt.dirGrid, cfg.hurt.framesPerDir) : {},
      attack: attackImg ? sliceSheet(attackImg, cfg.attack.cols, cfg.attack.rows, cfg.attack.dirGrid, cfg.attack.framesPerDir) : {},
      shoot: shootImg && cfg.shoot ? sliceSheet(shootImg, cfg.shoot.cols, cfg.shoot.rows, cfg.shoot.dirGrid, cfg.shoot.framesPerDir) : {},
    };

    const assets = { cfg, walk: walkImg, idle: idleImg, hop: hopImg, hurt: hurtImg, attack: attackImg, shoot: shootImg, portrait: portraitImg, meta };
    _assetCache.set(key, assets);
    return assets;

  } catch (err) {
    console.error(`Failed to load assets for ${key}:`, err);
    return null;
  }
}

// ---------- Net listeners ----------
function startNetListeners(){
  // NEW: Subscribe to hits for PvP damage
  net.subscribeToHits(hit => {
      if (state.invulnerableTimer > 0) return;

      state.hp = Math.max(0, state.hp - hit.damage);
      state.invulnerableTimer = 0.7;
      state.anim = 'hurt';
      state.frameStep = 0;
      state.frameTime = 0;
      net.updateState({ hp: state.hp }); // Report my new HP to others

      if (state.hp <= 0) {
          console.log("Player has been defeated!");
          goBackToSelect(); // For now, just go back to select screen
      }
  });
  
  return net.subscribePlayers({
    onAdd: async (uid, data)=>{
      const assets = await loadCharacterAssets(data.character);
      if (!assets) return;
      remote.set(uid, {
        uid: uid,
        username: data.username, character: data.character,
        x:data.x, y:data.y, dir:data.dir, anim:data.anim || "stand",
        typing: !!data.typing,
        scale: assets.cfg.scale ?? 3,
        frameTime: 0, frameStep: 0,
        idlePlaying: data.anim === "idle",
        hopT: 0, hopDur: (assets.cfg.hop?.framesPerDir || 1)/HOP_FPS, z: 0,
        say:null, sayTimer:0,
        hp: data.hp ?? assets.cfg.hp,
        maxHp: assets.cfg.hp,
        assets,
        history: [{ t: performance.now()/1000, x: data.x, y: data.y }],
        lastProcessedAttackTs: 0,
        showHpBarTimer: 0, // This will be triggered on damage
      });
    },
    onChange: (uid, data)=>{
      const r = remote.get(uid); if (!r) return;
      r.x = data.x ?? r.x; r.y = data.y ?? r.y;
      if (!r.history) r.history=[];
      r.history.push({ t: performance.now()/1000, x: r.x, y: r.y });
      if (r.history.length>40) r.history.shift();
      r.dir = data.dir ?? r.dir;
      r.typing = !!data.typing;
      
      // If remote player took damage, trigger hurt animation and HP bar
      if (data.hp < r.hp) {
          r.anim = 'hurt';
          r.frameStep = 0;
          r.frameTime = 0;
          r.showHpBarTimer = 2.0; // Show HP bar for 2 seconds
      }
      r.hp = data.hp ?? r.hp;

      if (typeof data.anim === "string" && data.anim !== r.anim){
        r.anim = data.anim; r.frameTime = 0; r.frameStep = 0;
        r.idlePlaying = (r.anim === "idle");
        if (r.anim === "hop"){ r.hopT = 0; r.hopDur = (r.assets?.cfg?.hop?.framesPerDir || 1)/HOP_FPS; r.z = 0; }
        else { r.hopT = 0; r.z = 0; }
      }
      if (data.character && data.character !== r.character){
        loadCharacterAssets(data.character).then(a=>{
          r.assets=a; r.character=data.character; r.scale=a.cfg.scale??3; r.hopDur=(a.cfg.hop?.framesPerDir||1)/HOP_FPS;
          r.maxHp = a.cfg.hp;
          if (r.hp > r.maxHp) r.hp = r.maxHp;
        });
      }
      r.username = data.username ?? r.username;
    },
    onRemove: (uid)=> remote.delete(uid)
  });
}

// ---------- Chat subscription (only when mounted) ----------
function startChatSubscription(){
  if (chatUnsubLocal){ try{ chatUnsubLocal(); }catch{} chatUnsubLocal = null; }
  lastProcessedChatTimestamp = 0;
  chatUnsubLocal = net.subscribeChat((msgs)=>{
    chatMessages = msgs || [];
    renderChatLog();

    if (msgs.length > 0) {
        const latestMsg = msgs[msgs.length - 1];
        if (latestMsg.ts > lastProcessedChatTimestamp) {
            lastProcessedChatTimestamp = latestMsg.ts;
            const r = remote.get(latestMsg.uid);
            if (r) {
                r.say = latestMsg.text;
                r.sayTimer = 5.0;
            }
        }
    }
  });
}

// ---------- Boot character in map ----------
async function startWithCharacter(cfg, map){
  state.ready = false;
  state.animMeta = { walk:{}, idle:{}, hop:{}, hurt:{}, attack:{}, shoot:{} };
  state.scale = cfg.scale ?? 3;
  state.map = map;
  state.maxHp = cfg.hp;
  state.hp = cfg.hp;

  try{
    const assets = await loadCharacterAssets(selectedKey);
    if (!assets) throw new Error("Failed to load character assets");

    state.walkImg = assets.walk;
    state.idleImg = assets.idle;
    state.hopImg  = assets.hop;
    state.hurtImg = assets.hurt;
    state.attackImg = assets.attack;
    state.shootImg = assets.shoot;
    state.animMeta = assets.meta;

    const spawn = tileCenter(map.spawn.x, map.spawn.y);
    state.x = spawn.x + (Math.random()*8 - 4);
    state.y = spawn.y + (Math.random()*8 - 4);
    state.dir = "down"; state.anim = "stand"; state.hopping = false;
    state.frameOrder = makePingPong(cfg.walk.framesPerDir);
    state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;
    state.say = null; state.sayTimer = 0; state.typing = false;
    state.invulnerableTimer = 0;
    state.attackCooldown = 0;

    spawnEnemies(map);
    updateCamera();
    state.ready = true;

    await net.spawnLocal({
      username: localUsername || "player",
      character: selectedKey,
      x: state.x, y: state.y, dir: state.dir,
      anim: state.anim, scale: state.scale, typing:false,
      hp: state.hp, maxHp: state.maxHp
    });
    startNetListeners();
  } catch (err){
    console.error(err);
    alert(`Failed to load ${cfg.name}. Check assets/ paths or server.`);
  }
}

// ---------- Movement / hop / camera ----------
const DIR_VECS = {
  down:[0,1], downRight:[1,1], right:[1,0], upRight:[1,-1],
  up:[0,-1], upLeft:[-1,-1], left:[-1,0], downLeft:[-1,1], 
};
function getInputVec(){
  if (chatMode) return {vx:0, vy:0};
  const up = keys.has("w") || keys.has("ArrowUp");
  const down = keys.has("s") || keys.has("ArrowDown");
  const left = keys.has("a") || keys.has("ArrowLeft");
  const right = keys.has("d") || keys.has("ArrowRight");
  let vx=0, vy=0;
  if (up) vy -= 1; if (down) vy += 1;
  if (left) vx -= 1; if (right) vx += 1;
  if (vx && vy){ const inv = 1/Math.sqrt(2); vx *= inv; vy *= inv; }
  return {vx, vy};
}
function vecToDir(vx, vy){
  if (!vx && !vy) return state.dir;
  if (vx>0 && vy===0) return "right";
  if (vx<0 && vy===0) return "left";
  if (vy>0 && vx===0) return "down";
  if (vy<0 && vx===0) return "up";
  if (vx>0 && vy>0)   return "downRight";
  if (vx<0 && vy>0)   return "downLeft";
  if (vx<0 && vy<0)   return "upLeft";
  if (vx>0 && vy<0)   return "upRight";
  return state.dir;
}
function updateCamera(){
  const mapPxW = state.map.w * TILE;
  const mapPxH = state.map.h * TILE;
  state.cam.x = clamp(state.x - canvas.width  /2, 0, Math.max(0, mapPxW - canvas.width));
  state.cam.y = clamp(state.y - canvas.height /2, 0, Math.max(0, mapPxH - canvas.height));
}
function resolvePlayerCollisions(nx, ny){
  let x = nx, y = ny;
  const myR = PLAYER_R * (state.scale || 3);
  for (const r of remote.values()){
    const rr = PLAYER_R * (r.scale || 3);
    const minD = myR + rr;
    const dx = x - r.x, dy = y - r.y;
    const d = Math.hypot(dx,dy);
    if (d > 0 && d < minD){
      const push = (minD - d) + 0.5;
      x += (dx / d) * push;
      y += (dy / d) * push;
    }
  }
  x = clamp(x, TILE*0.5, state.map.w*TILE - TILE*0.5);
  y = clamp(y, TILE*0.5, state.map.h*TILE - TILE*0.5);
  return {x,y};
}
function tryMove(dt, vx, vy){
  const stepX = vx * SPEED * currentSpeedMult() * dt;
  const stepY = vy * SPEED * currentSpeedMult() * dt;

  if (stepX){
    const oldX = state.x;
    let newX = clamp(oldX + stepX, TILE*0.5, state.map.w*TILE - TILE*0.5);
    const ty = Math.floor(state.y / TILE);
    const tx0 = Math.floor(oldX / TILE);
    const tx1 = Math.floor(newX / TILE);
    if (tx1 !== tx0){
      if (!canWalk(tx1, ty, state.map)){ newX = oldX; }
      else {
        const xB = stepX > 0 ? tx0+1 : tx0;
        if (!state.hopping && state.map.edgesV[ty][xB]) newX = oldX;
      }
    }
    state.x = newX;
  }
  if (stepY){
    const oldY = state.y;
    let newY = clamp(oldY + stepY, TILE*0.5, state.map.h*TILE - TILE*0.5);
    const tx = Math.floor(state.x / TILE);
    const ty0 = Math.floor(oldY / TILE);
    const ty1 = Math.floor(newY / TILE);
    if (ty1 !== ty0){
      if (!canWalk(tx, ty1, state.map)){ newY = oldY; }
      else {
        const yB = stepY > 0 ? ty0+1 : ty0;
        if (!state.hopping && state.map.edgesH[yB][tx]) newY = oldY;
      }
    }
    state.y = newY;
  }
  const adj = resolvePlayerCollisions(state.x, state.y);
  state.x = adj.x; state.y = adj.y;
}
function tryStartHop(){
  if (!state.ready || state.hopping || state.anim === 'hurt' || state.attacking) return;
  const cfg = CHARACTERS[selectedKey];
  const strip = state.animMeta.hop?.[state.dir];
  if (!cfg?.hop || !state.hopImg || !strip || strip.length === 0) return;

  const {vx,vy} = getInputVec();
  let dx = Math.sign(vx), dy = Math.sign(vy);
  if (!dx && !dy){ const v = DIR_VECS[state.dir]; dx=v[0]; dy=v[1]; }

  const tx0 = Math.floor(state.x / TILE);
  const ty0 = Math.floor(state.y / TILE);
  let tx = tx0 + dx, ty = ty0 + dy;
  if (!canWalk(tx,ty,state.map)){ tx = tx0; ty = ty0; }

  const start = {x: state.x, y: state.y};
  const end   = tileCenter(tx,ty);

  state.hopping = true;
  sfx.jump.play(0.6, 1 + (Math.random()*0.08 - 0.04));

  state.anim = "hop";
  state.frameOrder = [...Array(cfg.hop.framesPerDir).keys()];
  state.frameStep = 0; state.frameTime = 0;
  state.hop = { sx:start.x, sy:start.y, tx:end.x, ty:end.y, t:0, dur: cfg.hop.framesPerDir / HOP_FPS, z:0 };
  state.idleAccum = 0;
}

// ---------- Animation helpers ----------
function currentFrame(){
  let meta, strip, idx;
  if (state.anim === "walk"){
    meta = state.animMeta.walk; strip = meta?.[state.dir];
    idx = state.frameOrder[state.frameStep % state.frameOrder.length] % strip.length; return strip[idx];
  }
  if (state.anim === "idle"){
    meta = state.animMeta.idle; strip = meta?.[state.dir];
    idx = state.frameOrder[state.frameStep % state.frameOrder.length] % strip.length; return strip[idx];
  }
  if (state.anim === "hop"){
    meta = state.animMeta.hop; strip = meta?.[state.dir];
    if (!strip) return null;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "hurt") {
    meta = state.animMeta.hurt; strip = meta?.[state.dir];
    if (!strip) return null;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "attack") {
    meta = state.animMeta.attack; strip = meta?.[state.dir];
    if (!strip) return null;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "shoot") {
    meta = state.animMeta.shoot; strip = meta?.[state.dir];
    if (!strip) return null;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  meta = state.animMeta.idle; strip = meta?.[state.dir]; return strip ? strip[0] : null;
}

// ---------- Draw helpers ----------
const BG_FLOOR = "#08242b", BG_WALL  = "#12333c";
function isOverGapWorld(x, y){
  const m = state.map; if (!m) return false;
  const ty = Math.floor(y / TILE);
  const xbCandidates = [Math.round(x / TILE), Math.round(x / TILE) - 1];
  for (const xb of xbCandidates){
    if (ty >= 0 && ty < m.h && xb >= 1 && xb < m.w){
      if (m.edgesV[ty][xb] && Math.abs(x - xb*TILE) < GAP_W * 0.5) return true;
    }
  }
  const ybCandidates = [Math.round(y / TILE), Math.round(y / TILE) - 1];
  for (const yb of ybCandidates){
    if (yb >= 1 && yb < m.h){
      const tx = Math.floor(x / TILE);
      if (m.edgesH[yb][tx] && Math.abs(y - yb*TILE) < GAP_W * 0.5) return true;
    }
  }
  return false;
}
function drawMap(){
  const m = state.map; if (!m) return;
  const xs = Math.max(0, Math.floor(state.cam.x / TILE));
  const ys = Math.max(0, Math.floor(state.cam.y / TILE));
  const xe = Math.min(m.w-1, Math.ceil((state.cam.x + canvas.width ) / TILE));
  const ye = Math.min(m.h-1, Math.ceil((state.cam.y + canvas.height) / TILE));

  if (TEX.floor){
    for (let y=ys; y<=ye; y++){
      for (let x=xs; x<=xe; x++){
        const fx = x*TILE - state.cam.x - (BG_TILE_SCALE-1)*TILE/2;
        const fy = y*TILE - state.cam.y - (BG_TILE_SCALE-1)*TILE/2;
        ctx.drawImage(TEX.floor, 0,0, TEX.floor.width, TEX.floor.height, fx, fy, TILE*BG_TILE_SCALE, TILE*BG_TILE_SCALE);
        }
    }
  } else { ctx.fillStyle = BG_FLOOR; ctx.fillRect(0,0,canvas.width,canvas.height); }

  for (let y=ys; y<=ye; y++){
    for (let x=xs; x<=xe; x++){
      if (!m.walls[y][x]) continue;
      const dx = x*TILE - state.cam.x, dy = y*TILE - state.cam.y;
      if (TEX.wall){
        const wx = dx - (BG_TILE_SCALE-1)*TILE/2; const wy = dy - (BG_TILE_SCALE-1)*TILE/2;
        ctx.save();
        ctx.beginPath(); ctx.rect(dx, dy, TILE, TILE); ctx.clip();
        ctx.drawImage(TEX.wall, 0,0, TEX.wall.width, TEX.wall.height, wx, wy, TILE*BG_TILE_SCALE, TILE*BG_TILE_SCALE);
        ctx.restore();
      } else { ctx.fillStyle = BG_WALL; ctx.fillRect(dx, dy, TILE, TILE); }
    }
  }

  for (let y=ys; y<=ye; y++){
    for (let xb=Math.max(1,xs); xb<=Math.min(m.w-1, xe); xb++){
      if (!m.edgesV[y][xb]) continue;
      const cx = xb*TILE - state.cam.x, y0 = y*TILE - state.cam.y;
      ctx.fillStyle = EDGE_DARK;   ctx.fillRect(Math.floor(cx - GAP_W/2), y0, GAP_W, TILE);
      ctx.fillStyle = EDGE_DARKER; ctx.fillRect(Math.floor(cx - GAP_W/6), y0, Math.ceil(GAP_W/3), TILE);
      ctx.fillStyle = EDGE_LIP;    ctx.fillRect(Math.floor(cx - GAP_W/2) - 1, y0, 1, TILE);
                                   ctx.fillRect(Math.floor(cx + GAP_W/2),     y0, 1, TILE);
    }
  }
  for (let yb=Math.max(1,ys); yb<=Math.min(m.h-1,ye); yb++){
    for (let x=xs; x<=xe; x++){
      if (!m.edgesH[yb][x]) continue;
      const cy = yb*TILE - state.cam.y, x0 = x*TILE - state.cam.x;
      ctx.fillStyle = EDGE_DARK;   ctx.fillRect(x0, Math.floor(cy - GAP_W/2), TILE, GAP_W);
      ctx.fillStyle = EDGE_DARKER; ctx.fillRect(x0, Math.floor(cy - GAP_W/6), TILE, Math.ceil(GAP_W/3));
      ctx.fillStyle = EDGE_LIP;    ctx.fillRect(x0, Math.floor(cy - GAP_W/2) - 1, TILE, 1);
                                   ctx.fillRect(x0, Math.floor(cy + GAP_W/2),     TILE, 1);
    }
  }
}
function drawNameTagAbove(name, frame, wx, wy, z, scale){
  if (!frame) return;
  const topWorldY = wy - frame.oy * scale - (z || 0);
  const sx = Math.round(wx - state.cam.x);
  const sy = Math.round(topWorldY - state.cam.y) - 8;
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText(name, sx, sy);
  ctx.fillStyle = "#ffea7a";
  ctx.fillText(name, sx, sy);
}
function drawShadow(wx, wy, z, scale, overGap){
  const squash  = z ? 1 - 0.35*Math.sin(Math.min(1, z / (HOP_HEIGHT*scale)) * Math.PI) : 1;
  const shw     = Math.max(6, Math.floor(12 * scale * squash));
  const shh     = Math.max(3, Math.floor( 5 * scale * squash));
  ctx.globalAlpha = overGap ? 0.08 : 0.25;
  ctx.beginPath();
  ctx.ellipse(Math.round(wx - state.cam.x), Math.round(wy - state.cam.y - 1), shw, shh, 0, 0, Math.PI*2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalAlpha = 1;
}

// NEW chat bubble (anchored to top of current frame + word wrap)
function drawChatBubble(text, typing, frame, wx, wy, z, scale){
  const topWorldY = wy - frame.oy * scale - (z || 0);
  const sxCenter  = Math.round(wx - state.cam.x);
  const topScreenY= Math.round(topWorldY - state.cam.y);

  ctx.font = '12px "Press Start 2P", monospace';
  ctx.textAlign = "left";
  const lineH = 14;
  const padX = 6, padY = 6;
  const MAX_W = 200;

  let lines = [];
  if (typing) {
    lines = ["..."];
  } else {
    const words = String(text).split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line.length ? line + " " + w : w;
      if (ctx.measureText(test).width <= MAX_W) {
        line = test;
      } else {
        if (line) lines.push(line);
        if (ctx.measureText(w).width > MAX_W) {
          let cur = "";
          for (const ch of w) {
            const t2 = cur + ch;
            if (ctx.measureText(t2).width > MAX_W) { lines.push(cur); cur = ch; }
            else cur = t2;
          }
          if (cur) lines.push(cur);
          line = "";
        } else {
          line = w;
        }
      }
    }
    if (line) lines.push(line);
  }

  const textW = lines.reduce((m, s)=>Math.max(m, ctx.measureText(s).width), 0);
  const bw = Math.ceil(textW) + padX*2;
  const bh = lines.length * lineH + padY*2;

  const bx = Math.round(sxCenter - bw/2);
  const by = Math.round(topScreenY - 10 - bh);

  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "#0b1c21";
  ctx.fillRect(bx, by, bw, bh);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#2a6473";
  ctx.lineWidth = 2;
  ctx.strokeRect(bx+0.5, by+0.5, bw-1, bh-1);
  ctx.restore();

  ctx.fillStyle = "#dff8ff";
  if (typing){
    const cx = bx + bw/2;
    const baseY = by + padY + lineH - 4;
    for (let i=0;i<3;i++){
      const phase = (chatTypingDots + i*0.25) % 3;
      const up = Math.sin(phase / 3 * Math.PI*2) * 2;
      ctx.beginPath();
      ctx.arc(cx - 10 + i*10, baseY + up, 2.5, 0, Math.PI*2);
      ctx.fill();
    }
  } else {
    let y = by + padY + 12;
    for (const s of lines){
      ctx.fillText(s, bx + padX, y);
      y += lineH;
    }
  }
}

// ---------- Update / Draw loop ----------
let frameDt = 1/60;
let last = 0;

function updatePlayerHUD() {
    if (!state.ready || !net.auth.currentUser) {
        playerHudEl.innerHTML = '';
        return;
    }

    playerHudEl.innerHTML = ''; // Clear previous state

    const p = {
        uid: net.auth.currentUser.uid,
        username: localUsername,
        character: selectedKey,
        hp: state.hp,
        maxHp: state.maxHp,
        assets: { cfg: CHARACTERS[selectedKey] }
    };

    if (!p.assets?.cfg) return;

    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.uid = p.uid;

    const portrait = document.createElement('img');
    portrait.className = 'portrait';
    const charCfg = CHARACTERS[p.character];
    if (charCfg) {
        portrait.src = charCfg.base + charCfg.portrait;
    }
    
    const info = document.createElement('div');
    info.className = 'info';

    const usernameEl = document.createElement('div');
    usernameEl.className = 'username';
    usernameEl.textContent = p.username;

    const hpBarBg = document.createElement('div');
    hpBarBg.className = 'hp-bar-bg';
    
    const hpBar = document.createElement('div');
    hpBar.className = 'hp-bar';
    const hpPercent = (p.hp / p.maxHp) * 100;
    hpBar.style.width = `${hpPercent}%`;

    hpBarBg.appendChild(hpBar);
    info.appendChild(usernameEl);
    info.appendChild(hpBarBg);
    card.appendChild(portrait);
    card.appendChild(info);
    playerHudEl.appendChild(card);
}

// Helper function to get the smoothed, interpolated position of a remote player
function getRemotePlayerSmoothedPos(r) {
    if (r.history && r.history.length >= 2){
      const now = performance.now() / 1000;
      const LAG = 0.12; // This is the same as NET_INTERVAL
      const target = now - LAG;
      let a = r.history[0], b = r.history[r.history.length - 1];
      for (let i = 1; i < r.history.length; i++){
        if (r.history[i].t >= target){
          a = r.history[i - 1] || r.history[i];
          b = r.history[i];
          break;
        }
      }
      const denom = Math.max(0.0001, b.t - a.t);
      const t = Math.max(0, Math.min(1, (target - a.t) / denom));
      const smx = a.x + (b.x - a.x) * t;
      const smy = a.y + (b.y - a.y) * t;
      return { x: smx, y: smy };
    }
    return { x: r.x, y: r.y }; // Fallback to raw position
}


function update(dt){
  if (keys.has(" ")) {
    tryStartHop();
  }
  
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer -= dt;
  }
  if (state.attackCooldown > 0) {
    state.attackCooldown -= dt;
  }
  
  if (keys.has("j") || keys.has("J")) {
    tryMeleeAttack();
  }
  if (keys.has("k") || keys.has("K")) {
    tryRangedAttack();
  }

  const {vx, vy} = getInputVec();
  state.prevMoving = state.moving;
  state.moving = !!(vx || vy);

  if (!state.hopping && state.anim !== 'hurt' && !state.attacking){
    state.dir = vecToDir(vx, vy);

    if (state.moving){
      tryMove(dt, vx, vy);
      const wFrames = CHARACTERS[selectedKey].walk.framesPerDir;
      if (state.anim !== "walk"){
        state.anim = "walk"; state.frameOrder = makePingPong(wFrames);
        state.frameStep = 0; state.frameTime = 0;
      }
      state.idleAccum = 0;
      state.frameTime += dt;
      const tpf = 1 / WALK_FPS;
      while (state.frameTime >= tpf){ state.frameTime -= tpf; state.frameStep = (state.frameStep + 1) % state.frameOrder.length; }
    } else {
      const iFrames = CHARACTERS[selectedKey].idle.framesPerDir;
      if (state.prevMoving && !state.moving){
        state.anim = "stand"; state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;
      }
      if (state.anim !== "idle") state.idleAccum += dt;
      if (state.anim !== "idle" && state.idleAccum >= IDLE_INTERVAL){
        state.anim = "idle"; state.frameOrder = makePingPong(iFrames); state.frameStep = 0; state.frameTime = 0;
      }
      if (state.anim === "idle"){
        state.frameTime += dt;
        const tpf = 1 / IDLE_FPS;
        while (state.frameTime >= tpf){
          state.frameTime -= tpf;
          state.frameStep += 1;
          if (state.frameStep >= state.frameOrder.length){
            state.anim = "stand"; state.frameStep = 0; state.idleAccum -= IDLE_INTERVAL; if (state.idleAccum < 0) state.idleAccum = 0; break;
          }
        }
      }
    }
    updateCamera();
  } else if (state.anim === 'hurt') {
    state.frameTime += dt;
    const tpf = 1 / HURT_FPS;
    const hurtFrames = CHARACTERS[selectedKey].hurt.framesPerDir;
    const frameOrder = [...Array(hurtFrames).keys()];
    while (state.frameTime >= tpf) {
      state.frameTime -= tpf;
      state.frameStep += 1;
    }
    if (state.frameStep >= frameOrder.length) {
      state.anim = 'stand';
      state.frameStep = 0;
    }
  } else if (state.attacking) {
    state.frameTime += dt;
    const tpf = 1 / ATTACK_FPS;
    const animData = (state.attackType === 'melee') ? CHARACTERS[selectedKey].attack : CHARACTERS[selectedKey].shoot;
    const attackFrames = animData.framesPerDir;
    const frameOrder = [...Array(attackFrames).keys()];
    while (state.frameTime >= tpf) {
      state.frameTime -= tpf;
      state.frameStep += 1;
    }
    if (state.frameStep >= frameOrder.length) {
      state.attacking = false;
      state.anim = 'stand';
      state.frameStep = 0;
    }
  } else if (state.hopping) {
    state.hop.t = Math.min(1, state.hop.t + dt / state.hop.dur);
    const p = state.hop.t, e = 0.5 - 0.5 * Math.cos(Math.PI * p);
    state.x = lerp(state.hop.sx, state.hop.tx, e);
    state.y = lerp(state.hop.sy, state.hop.ty, e);
    state.hop.z = Math.sin(Math.PI * p) * (HOP_HEIGHT * state.scale);
    state.frameTime += dt;
    const tpf = 1 / HOP_FPS;
    while (state.frameTime >= tpf){ state.frameTime -= tpf; state.frameStep += 1; }
    updateCamera();
    if (state.hop.t >= 1){
      state.hopping = false; state.anim = state.moving ? "walk" : "stand";
      state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;
    }
    const adj = resolvePlayerCollisions(state.x, state.y);
    state.x = adj.x; state.y = adj.y;
  }

  if (state.sayTimer > 0){ state.sayTimer -= dt; if (state.sayTimer <= 0){ state.sayTimer = 0; state.say = null; } }
  if (state.typing){ chatTypingDots = (chatTypingDots + dt*3) % 3; }

  updateEnemies(dt);
  updateProjectiles(dt);
  updatePlayerProjectiles(dt);

  if (selectedKey && state.ready){
    _netAccum += dt; _heartbeat += dt;
    if (_netAccum >= NET_INTERVAL){
      _netAccum = 0;
      if (_hasMeaningfulChange() || _heartbeat >= 3){
        net.updateState({ x:state.x, y:state.y, dir:state.dir, anim:state.anim, character:selectedKey, typing: state.typing, hp: state.hp });
        _lastSent = { x: state.x, y: state.y, dir: state.dir, anim: state.anim, character: selectedKey, typing: state.typing, hp: state.hp };
        _heartbeat = 0;
      }
    }
  }
}
function draw(){
  ctx.fillStyle = '#061b21';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  if (!state.map) {
    ctx.font = '14px "Press Start 2P", monospace';
    ctx.fillStyle = '#9bd5e0';
    ctx.textAlign = 'center';
    ctx.fillText('Loading map…', canvas.width/2, canvas.height/2);
    return;
  }
  drawMap();
  updatePlayerHUD();

  const actors = [];
  
  for (const enemy of enemies.values()) {
      actors.push({
          kind: "enemy",
          ...enemy
      });
  }

  for (const r of remote.values()){
    const assets = r.assets; if (!assets) continue;
    
    let meta, strip, frames, fps, order;
    
    switch(r.anim) {
        case "walk":
            meta = assets.meta.walk;
            frames = assets.cfg.walk.framesPerDir;
            fps = WALK_FPS;
            order = makePingPong(Math.max(frames, 1));
            break;
        case "hop":
            meta = assets.meta.hop;
            frames = assets.cfg.hop?.framesPerDir || 1;
            fps = HOP_FPS;
            order = [...Array(Math.max(frames, 1)).keys()];
            break;
        case "hurt":
            meta = assets.meta.hurt;
            frames = assets.cfg.hurt.framesPerDir;
            fps = HURT_FPS;
            order = [...Array(Math.max(frames, 1)).keys()];
            break;
        case "attack":
            meta = assets.meta.attack;
            frames = assets.cfg.attack.framesPerDir;
            fps = ATTACK_FPS;
            order = [...Array(Math.max(frames, 1)).keys()];
            break;
        case "shoot":
            meta = assets.meta.shoot;
            frames = assets.cfg.shoot.framesPerDir;
            fps = ATTACK_FPS;
            order = [...Array(Math.max(frames, 1)).keys()];
            break;
        default: // idle or stand
            meta = assets.meta.idle;
            frames = assets.cfg.idle.framesPerDir;
            fps = IDLE_FPS;
            order = makePingPong(Math.max(frames, 1));
            break;
    }
    
    strip = meta[r.dir] || meta.down || Object.values(meta)[0];
    if (!strip || !strip.length) continue;


    if ((r.anim === "walk") || (r.anim === "hop") || (r.anim === "hurt") || (r.anim === "attack") || (r.anim === "shoot") || (r.anim === "idle" && r.idlePlaying)){
      r.frameTime += frameDt;
      const tpf = 1 / fps;
      while (r.frameTime >= tpf){
        r.frameTime -= tpf;
        if (["hop", "hurt", "attack", "shoot"].includes(r.anim)){
          if (r.frameStep < order.length - 1) r.frameStep += 1;
        } else {
          r.frameStep = (r.frameStep + 1) % order.length;
          if (r.anim === "idle" && r.idlePlaying && r.frameStep === 0) r.idlePlaying = false;
        }
      }
    }
    const frameIdx = order.length ? order[Math.min(r.frameStep, order.length-1)] % strip.length : 0;
    const f = strip[frameIdx];

    if (r.anim === "hop"){
      r.hopT = Math.min(1, r.hopT + (frameDt / Math.max(0.001, r.hopDur)));
      r.z = Math.sin(Math.PI * r.hopT) * (HOP_HEIGHT * r.scale);
    } else { r.hopT = 0; r.z = 0; }
    
    const src = r.anim === "hop" ? assets.hop :
                r.anim === "walk" ? assets.walk :
                r.anim === "hurt" ? assets.hurt :
                r.anim === "attack" ? assets.attack :
                r.anim === "shoot" ? assets.shoot :
                assets.idle;

    const smoothedPos = getRemotePlayerSmoothedPos(r);
    const smx = smoothedPos.x;
    const smy = smoothedPos.y;
    
    if (r.sayTimer > 0) r.sayTimer = Math.max(0, r.sayTimer - frameDt);
    else r.say = null;
    
    if (r.showHpBarTimer > 0) r.showHpBarTimer -= frameDt;

    actors.push({
      kind:"remote", uid: r.uid, name: r.username || "player",
      x:smx, y:smy, z:r.z, frame:f, src, scale:r.scale,
      typing:r.typing, say:r.say, sayTimer:r.sayTimer
    });
  }

  const lf = currentFrame();
  if (state.ready && lf){
    const z = state.hopping ? state.hop.z : 0;
    const src = state.anim === "hop" ? state.hopImg : 
                (state.anim === "walk" ? state.walkImg : 
                (state.anim === "hurt" ? state.hurtImg : 
                (state.anim === "attack" ? state.attackImg :
                (state.anim === "shoot" ? state.shootImg : state.idleImg))));
    actors.push({
      kind:"local", name: localUsername || "you",
      x:state.x, y:state.y, z, frame:lf, src, scale:state.scale,
      typing: state.typing, say: state.say, sayTimer: state.sayTimer
    });
  }

  actors.sort((a,b)=> (a.y - (a.z || 0)*0.35) - (b.y - (b.z || 0)*0.35));
  
  for (const a of actors){
    if (a.kind === 'enemy') {
        const sx = Math.round(a.x - state.cam.x);
        const sy = Math.round(a.y - state.cam.y);
        drawShadow(a.x, a.y, 0, 3.0, false);
        ctx.beginPath();
        ctx.arc(sx, sy, ENEMY_R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 80, 80, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 40, 40, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        const hpw = 30, hph = 5;
        const hpx = sx - hpw/2, hpy = sy - ENEMY_R - 10;
        ctx.fillStyle = '#333';
        ctx.fillRect(hpx, hpy, hpw, hph);
        ctx.fillStyle = '#f44';
        ctx.fillRect(hpx, hpy, hpw * (a.hp / a.maxHp), hph);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(hpx, hpy, hpw, hph);
        continue;
    }
  
    const f = a.frame, scale = a.scale;
    const dw = f.sw * scale, dh = f.sh * scale;
    const dx = Math.round(a.x - f.ox * scale - state.cam.x);
    const dy = Math.round(a.y - f.oy * scale - state.cam.y - a.z);

    const overGap = isOverGapWorld(a.x, a.y);
    drawShadow(a.x, a.y, a.z, a.scale, overGap);
    
    if (a.kind === 'local' && state.invulnerableTimer > 0) {
        ctx.globalAlpha = (Math.floor(performance.now() / 80) % 2 === 0) ? 0.4 : 1.0;
    }

    ctx.drawImage(a.src, f.sx, f.sy, f.sw, f.sh, dx, dy, dw, dh);
    
    ctx.globalAlpha = 1.0;

    drawNameTagAbove(a.name, f, a.x, a.y, a.z, a.scale);

    if (a.kind === 'remote') {
        const r = remote.get(a.uid);
        if (r && r.showHpBarTimer > 0) {
            const hpw = 40, hph = 5;
            const topWorldY = a.y - a.frame.oy * a.scale - (a.z || 0);
            const hpx = Math.round(a.x - state.cam.x) - hpw / 2;
            const hpy = Math.round(topWorldY - state.cam.y) - 20;

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(hpx - 1, hpy - 1, hpw + 2, hph + 2);
            ctx.fillStyle = '#555';
            ctx.fillRect(hpx, hpy, hpw, hph);
            const hpColor = r.hp / r.maxHp > 0.5 ? '#5cff5c' : r.hp / r.maxHp > 0.2 ? '#ffc34d' : '#ff4d4d';
            ctx.fillStyle = hpColor;
            ctx.fillRect(hpx, hpy, hpw * (r.hp / r.maxHp), hph);
        }
    }

    if (a.typing)      drawChatBubble("", true,  a.frame, a.x, a.y, a.z, a.scale);
    else if (a.say)    drawChatBubble(a.say, false, a.frame, a.x, a.y, a.z, a.scale);
  }
  
  // Draw projectiles on top of everything
  for (const p of projectiles) {
      ctx.beginPath();
      ctx.arc(p.x - state.cam.x, p.y - state.cam.y, PROJECTILE_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 165, 0, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
  }
  // Draw player projectiles
  for (const p of playerProjectiles) {
      // FIX 2 & 3: 8-bit square projectile with correct color
      ctx.fillStyle = p.color || '#FFFF00';
      ctx.fillRect(Math.round(p.x - state.cam.x - 4), Math.round(p.y - state.cam.y - 4), 8, 8);
  }
}
function loop(ts){
  const now = ts || 0;
  const dt = Math.min(0.033, (now - last)/1000); 
  last = now;
  if (state.ready) update(dt);
  frameDt = dt;
  draw();
  requestAnimationFrame(loop);
}

// ---------- Enemy and Projectile Logic ----------
function spawnEnemies(map) {
    enemies.clear();
    projectiles.length = 0;
    const enemyRng = mulberry32(map.seed);
    let spawned = 0;
    const maxEnemies = Math.floor((map.w * map.h) / 200); // Scale enemies with map size
    const validSpawns = [];
    for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            if (!map.walls[y][x]) {
                validSpawns.push({ x, y });
            }
        }
    }
    for (let i = validSpawns.length - 1; i > 0; i--) {
        const j = Math.floor(enemyRng() * (i + 1));
        [validSpawns[i], validSpawns[j]] = [validSpawns[j], validSpawns[i]];
    }
    for (const pos of validSpawns) {
        if (spawned >= maxEnemies) break;
        const distToPlayer = Math.hypot(pos.x - map.spawn.x, pos.y - map.spawn.y);
        if (distToPlayer < 10) continue;
        const id = `enemy_${spawned}`;
        const worldPos = tileCenter(pos.x, pos.y);
        enemies.set(id, {
            id,
            x: worldPos.x,
            y: worldPos.y,
            hp: 50,
            maxHp: 50,
            dir: 'down',
            attackCooldown: 0,
            detectionRange: TILE * 7,
            projectileSpeed: TILE * 5,
            damage: 10,
        });
        spawned++;
    }
}

function updateEnemies(dt) {
    if (!state.ready) return;
    for (const enemy of enemies.values()) {
        if (enemy.attackCooldown > 0) {
            enemy.attackCooldown -= dt;
        }
        const dx = state.x - enemy.x;
        const dy = state.y - enemy.y;
        const dist = Math.hypot(dx, dy);

        if (dist < enemy.detectionRange && enemy.attackCooldown <= 0) {
            enemy.attackCooldown = 2.0; // 2 second cooldown
            const vx = (dx / dist) * enemy.projectileSpeed;
            const vy = (dy / dist) * enemy.projectileSpeed;
            projectiles.push({
                x: enemy.x,
                y: enemy.y,
                vx, vy,
                damage: enemy.damage,
                life: 3.0 // 3 seconds lifetime
            });
        }
    }
}

function updateProjectiles(dt) {
    if (!state.ready) return;
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        if (p.life <= 0) {
            projectiles.splice(i, 1);
            continue;
        }
        
        // Check collision with local player
        if (state.invulnerableTimer <= 0) {
            const dist = Math.hypot(p.x - state.x, p.y - state.y);
            if (dist < PLAYER_R + PROJECTILE_R) {
                state.hp = Math.max(0, state.hp - p.damage);
                state.invulnerableTimer = 0.7; // 0.7 seconds of invulnerability
                state.anim = 'hurt';
                state.frameStep = 0;
                state.frameTime = 0;
                projectiles.splice(i, 1);
                net.updateState({ hp: state.hp });
                if (state.hp <= 0) {
                    console.log("Player has been defeated!");
                    goBackToSelect();
                }
            }
        }
    }
}

function updatePlayerProjectiles(dt) {
    if (!state.ready) return;
    for (let i = playerProjectiles.length - 1; i >= 0; i--) {
        const p = playerProjectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        if (p.life <= 0) {
            playerProjectiles.splice(i, 1);
            continue;
        }

        // Only check collisions for projectiles owned by the local player
        if (p.ownerId !== net.auth.currentUser.uid) {
            continue;
        }

        let hit = false;
        // Check collision with enemies
        for (const enemy of enemies.values()) {
            const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
            if (dist < ENEMY_R + PROJECTILE_R) {
                enemy.hp = Math.max(0, enemy.hp - p.damage);
                hit = true;
                if (enemy.hp <= 0) {
                    // Respawn enemy logic...
                    const enemyRng = mulberry32(state.map.seed + enemies.size);
                    const validSpawns = [];
                    for (let y = 1; y < state.map.h - 1; y++) {
                        for (let x = 1; x < state.map.w - 1; x++) {
                            if (!state.map.walls[y][x]) validSpawns.push({ x, y });
                        }
                    }
                    const spawnPos = validSpawns[Math.floor(enemyRng() * validSpawns.length)];
                    const worldPos = tileCenter(spawnPos.x, spawnPos.y);
                    enemy.x = worldPos.x; enemy.y = worldPos.y; enemy.hp = enemy.maxHp;
                }
                break; 
            }
        }
        if (hit) { playerProjectiles.splice(i, 1); continue; }

        // Check collision with remote players
        for (const player of remote.values()) {
            const smoothedPos = getRemotePlayerSmoothedPos(player);
            const dist = Math.hypot(p.x - smoothedPos.x, p.y - smoothedPos.y);
            if (dist < PLAYER_R + PROJECTILE_R) {
                net.dealDamage(player.uid, p.damage).catch(e => console.error("Deal damage failed", e));
                hit = true;
                break;
            }
        }
        if (hit) { playerProjectiles.splice(i, 1); }
    }
}

function tryMeleeAttack() {
    if (!state.ready || state.attacking || state.attackCooldown > 0) return;

    state.attacking = true;
    state.attackType = 'melee';
    state.anim = 'attack';
    state.frameStep = 0;
    state.frameTime = 0;
    state.attackCooldown = 0.5;

    const attackRange = TILE * 1.5;
    const damage = CHARACTERS[selectedKey].ranged ? 15 : 25;

    for (const enemy of enemies.values()) {
        const dist = Math.hypot(state.x - enemy.x, state.y - enemy.y);
        if (dist < attackRange) {
            enemy.hp = Math.max(0, enemy.hp - damage);
            if (enemy.hp <= 0) {
                // Respawn logic...
            }
        }
    }
    
    // PvP Melee Damage
    for (const player of remote.values()) {
        const smoothedPos = getRemotePlayerSmoothedPos(player);
        const dist = Math.hypot(state.x - smoothedPos.x, state.y - smoothedPos.y);
        if (dist < attackRange) {
            net.dealDamage(player.uid, damage).catch(e => console.error("Deal damage failed", e));
        }
    }
}

function tryRangedAttack() {
    const cfg = CHARACTERS[selectedKey];
    if (!state.ready || !cfg.ranged || state.attacking || state.attackCooldown > 0) return;

    state.attacking = true;
    state.attackType = 'ranged';
    state.anim = 'shoot';
    state.frameStep = 0;
    state.frameTime = 0;
    state.attackCooldown = 0.8;

    const projectileSpeed = TILE * 8;
    const [vx, vy] = DIR_VECS[state.dir];

    // Projectile origin from center
    const frame = currentFrame();
    const startY = state.y - (frame ? (frame.oy * state.scale / 2) : (TILE * state.scale / 4));

    playerProjectiles.push({
        x: state.x,
        y: startY,
        vx: vx * projectileSpeed,
        vy: vy * projectileSpeed,
        damage: 20,
        life: 2.0,
        ownerId: net.auth.currentUser.uid, // Track owner for PvP
        color: cfg.projectileColor || '#FFFF00' // Projectile color
    });
}


// ---------- Init ----------
function init() {
    processCharacterData();
    buildSelectUI();
    requestAnimationFrame(loop);
}

init();


// ---------- Utils ----------
function loadImage(src){
  return new Promise((res, rej)=>{
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function tileCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function canWalk(tx, ty, map) {
  return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && !map.walls[ty][tx];
}

function generateMap(w, h, seed=1234){
  const rnd = mulberry32((seed>>>0) ^ 0x9E3779B9);
  const walls = Array.from({length:h}, ()=> Array(w).fill(true));
  const edgesV = Array.from({length:h}, ()=> Array(w+1).fill(false));
  const edgesH = Array.from({length:h+1}, ()=> Array(w).fill(false));

  const hallW = 2;
  const radius = 1;
  const margin = Math.max(3, radius+2);
  const cellStep = Math.max(hallW + 3, Math.floor(Math.min(w,h)/8));

  const gx0 = margin, gy0 = margin;
  const gx1 = w - margin - 1, gy1 = h - margin - 1;
  const cols = Math.max(2, Math.floor((gx1 - gx0) / cellStep));
  const rows = Math.max(2, Math.floor((gy1 - gy0) / cellStep));

  const nodes = [];
  for (let r=0; r<=rows; r++){
    for (let c=0; c<=cols; c++){
      const jitterX = Math.floor((rnd()-0.5) * Math.max(1, cellStep*0.2));
      const jitterY = Math.floor((rnd()-0.5) * Math.max(1, cellStep*0.2));
      const x = gx0 + Math.floor(c * ((gx1-gx0)/Math.max(1,cols))) + jitterX;
      const y = gy0 + Math.floor(r * ((gy1-gy0)/Math.max(1,rows))) + jitterY;
      nodes.push({x: Math.max(margin, Math.min(w-margin-1, x)),
                  y: Math.max(margin, Math.min(h-margin-1, y)),
                  ix: c, iy: r, i: r*(cols+1)+c});
    }
  }
  const idx = (c,r)=> r*(cols+1)+c;

  const visited = new Set();
  const stack = [];
  const startC = Math.floor(rnd()*(cols+1));
  const startR = Math.floor(rnd()*(rows+1));
  stack.push([startC, startR]);
  const links = new Set();

  const dirs4 = [[0,-1],[1,0],[0,1],[-1,0]];
  while (stack.length){
    const [c,r] = stack[stack.length-1];
    const here = idx(c,r);
    visited.add(here);
    const nbs = [];
    for (const [dx,dy] of dirs4){
      const nc = c+dx, nr = r+dy;
      if (nc<0||nr<0||nc>cols||nr>rows) continue;
      const j = idx(nc,nr);
      if (!visited.has(j)) nbs.push([nc,nr]);
    }
    for (let i=nbs.length-1;i>0;i--){
      const j = Math.floor(rnd()*(i+1)); const t = nbs[i]; nbs[i] = nbs[j]; nbs[j] = t;
    }
    if (nbs.length){
      const [nc,nr] = nbs[0];
      const a = Math.min(here, idx(nc,nr));
      const b = Math.max(here, idx(nc,nr));
      links.add(a+"-"+b);
      stack.push([nc,nr]);
    } else {
      stack.pop();
    }
  }

  const diagDirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
  const extraDiags = Math.floor((cols+1)*(rows+1)*0.15);
  for (let k=0;k<extraDiags;k++){
    const c = Math.floor(rnd()*(cols+1));
    const r = Math.floor(rnd()*(rows+1));
    const [dx,dy] = diagDirs[Math.floor(rnd()*diagDirs.length)];
    const nc = c+dx, nr = r+dy;
    if (nc<0||nr<0||nc>cols||nr>rows) continue;
    const a = Math.min(idx(c,r), idx(nc,nr));
    const b = Math.max(idx(c,r), idx(nc,nr));
    links.add(a+"-"+b);
  }

  function carveDisk(cx, cy, rad){
    for (let yy = cy-rad; yy<=cy+rad; yy++){
      if (yy<=0 || yy>=h-1) continue;
      for (let xx = cx-rad; xx<=cx+rad; xx++){
        if (xx<=0 || xx>=w-1) continue;
        const dx = xx-cx, dy = yy-cy;
        if (dx*dx + dy*dy <= rad*rad) walls[yy][xx] = false;
      }
    }
  }
  function carveLine(x0,y0,x1,y1, rad){
    x0|=0; y0|=0; x1|=0; y1|=0;
    let dx = Math.abs(x1-x0), sx = x0<x1 ? 1 : -1;
    let dy = -Math.abs(y1-y0), sy = y0<y1 ? 1 : -1;
    let err = dx + dy, e2;
    while (true){
      carveDisk(x0, y0, rad);
      if (x0===x1 && y0===y1) break;
      e2 = 2*err;
      if (e2 >= dy){ err += dy; x0 += sx; }
      if (e2 <= dx){ err += dx; y0 += sy; }
    }
  }

  const nodeRadius = Math.max(2, radius+1);
  nodes.forEach(n => carveDisk(n.x, n.y, nodeRadius));
  for (const key of links){
    const [a,b] = key.split("-").map(s=>+s);
    const na = nodes[a], nb = nodes[b];
    carveLine(na.x, na.y, nb.x, nb.y, radius);
  }

  for (let pass=0; pass<2; pass++){
    for (let y=1; y<h-1; y++){
      for (let x=1; x<w-1; x++){
        if (walls[y][x]){
          let floorN=0;
          for (let yy=y-1; yy<=y+1; yy++)
            for (let xx=x-1; xx<=x+1; xx++)
              if (!(xx===x&&yy===y) && !walls[yy][xx]) floorN++;
          if (floorN >= 6) walls[y][x] = false;
        }
      }
    }
  }
  
  // Add jump gaps in narrow corridors
  const gapChance = 0.25;
  // Vertical gaps
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!walls[y][x-1] && !walls[y][x] &&
          walls[y-1][x-1] && walls[y-1][x] &&
          walls[y+1][x-1] && walls[y+1][x] &&
          rnd() < gapChance) {
        edgesV[y][x] = true;
      }
    }
  }
  // Horizontal gaps
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!walls[y-1][x] && !walls[y][x] &&
          walls[y-1][x-1] && walls[y][x-1] &&
          walls[y-1][x+1] && walls[y][x+1] &&
          rnd() < gapChance) {
        edgesH[y][x] = true;
      }
    }
  }


  let sx = nodes.length ? nodes[0].x|0 : 1;
  let sy = nodes.length ? nodes[0].y|0 : 1;
  outer: for (let tries=0; tries<500; tries++){
    const tx = 1 + Math.floor(rnd()*(w-2));
    const ty = 1 + Math.floor(rnd()*(h-2));
    if (!walls[ty][tx]){ sx=tx; sy=ty; break outer; }
  }

  return { w, h, walls, edgesV, edgesH, spawn: {x:sx, y:sy}, seed: seed };
}
