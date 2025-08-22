// main.js — select → lobby list → create/join → multiplayer + chat (seeded maps)
// global to avoid strict-mode ReferenceError on auth
let localUsername = "";
let lobbyUnsub = null; // unsubscribe fn for lobby snapshot
let onlineCountUnsub = null; // NEW: Unsubscribe fn for the online count listener

// Safe unsubscribe wrapper for lobby snapshot
function unsubscribeLobby(){
  if (typeof lobbyUnsub === 'function'){
    try { lobbyUnsub(); } catch(e){ console.warn('lobbyUnsub threw during unsubscribe', e); }
    lobbyUnsub = null;
  }
}
// global selected character key for select screen
let selectedKey = null;
let localPlayer = null; // This will hold the instance of our player's class


// Remote players registry
const remote = new Map();
// Enemy and projectile registries
const enemies = new Map();
const projectiles = [];
const playerProjectiles = [];
const coins = new Map();
const healthPacks = new Map();
const poisonTiles = new Map();
const sandTiles = new Map();
const droppedItems = new Map();
const activeEffects = new Map();

const gameContext = {
    enemies,
    projectiles,
    playerProjectiles,
    coins,
    healthPacks,
    poisonTiles,
    sandTiles,
    activeEffects
};


import { generateMap, mulberry32 } from './mapGenerator.js';
import { Net, firebaseConfig } from "./net.js";
import { Player } from './Player.js';
import { Turret, Brawler, WeepingAngel } from './enemies.js';
import { TILE, isFacing } from './utils.js';
import { Sableye } from './characters/Sableye.js';
import { Ditto } from './characters/Ditto.js';
import { HisuianZoroark } from './characters/Hisuian Zoroark.js';
import { Hypno } from './characters/Hypno.js';
import { Quagsire } from './characters/Quagsire.js';
import { Smeargle } from './characters/Smeargle.js';
import { Corviknight } from './characters/Corviknight.js';
import { Cacturne } from './characters/Cacturne.js';
import { Decidueye } from './characters/Decidueye.js';
import { Empoleon } from './characters/Empoleon.js';
import { Cyclizar } from './characters/Cyclizar.js';
import { Scolipede } from './characters/Scolipede.js';
import { Altaria } from './characters/Altaria.js';
import { Gengar } from './characters/Gengar.js';
import { Excadrill } from './characters/Excadrill.js';
import { Chandelure } from './characters/Chandelure.js';
import { Primarina } from './characters/Primarina.js';
import { Dewgong } from './characters/Dewgong.js';
import { Lopunny } from './characters/Lopunny.js';
import { Spinda } from './characters/Spinda.js';
import { SHOP_ITEMS } from './items.js';

// ---- HELPER FUNCTIONS AND VARIABLES ----
// For network update throttling
const NET_INTERVAL = 0.1;
let _netAccum = 0;
let _heartbeat = 0;
let _lastSent = {};
let dailyShopItems = {};
let shopCountdownInterval = null;

function _hasMeaningfulChange() {
  if (!state.ready || !_lastSent) return false;

  const posChanged = Math.abs(state.x - (_lastSent.x || 0)) > 0.5 || Math.abs(state.y - (_lastSent.y || 0)) > 0.5;
  const dirChanged = state.dir !== (_lastSent.dir || "");
  const animChanged = state.anim !== (_lastSent.anim || "");

  return posChanged || dirChanged || animChanged;
}

function makePingPong(n) {
  if (n <= 1) return [0];
  const arr = [...Array(n).keys()];
  const reverse = arr.slice(1, -1).reverse();
  return [...arr, ...reverse];
}
// ------------------------------------


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
const createPlainsLobbyBtn = document.getElementById("createPlainsLobbyBtn");
const createForestLobbyBtn = document.getElementById("createForestLobbyBtn");
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
const leaveLobbyBtn = document.getElementById("leaveLobbyBtn");
const onlineCountEl = document.getElementById("online-count");
const shopIcon = document.getElementById("shop-icon");
const shopModal = document.getElementById("shop-modal");
const closeShopBtn = document.getElementById("close-shop-btn");
const shopItemsContainer = document.getElementById("shop-items");
const inventoryDisplay = document.getElementById("inventory-display");
const inventoryItemsContainer = document.getElementById("inventory-items");
const leaderboardEl = document.getElementById("leaderboard");
const abilityBtn = document.getElementById("ability-btn");
const abilityBtnText = abilityBtn.querySelector(".mobile-action-btn-text");
const abilityCooldownOverlay = abilityBtn.querySelector(".cooldown-overlay");
const playerViewerModal = document.getElementById("player-viewer-modal");
const viewerCanvas = document.getElementById("viewer-canvas");
const viewerCtx = viewerCanvas.getContext("2d");
const viewerStatsEl = document.getElementById("viewer-stats");
const closeViewerBtn = document.getElementById("close-viewer-btn");
viewerCtx.imageSmoothingEnabled = false;


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
    if (m.system) {
        div.classList.add("system");
    }
    const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="chat-ts">[${time}]</span> `;
    if (m.system) {
        div.innerHTML += m.text;
    } else {
        div.innerHTML += `<strong>${m.username || "player"}:</strong> ${m.text}`;
    }
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
  mobileControls.classList.add("hidden");
  playerHudEl.classList.add("hidden");
}

// ---------- Settings ----------
const MAP_SCALE = 3;
const SPEED = TILE * 2.6;

// --- AFK TIMER ---
const AFK_TIMEOUT = 300; // 300 seconds = 5 minutes

function currentSpeedMult(){
    const cfg = CHARACTERS[selectedKey];
    let mult = (cfg && cfg.speed) ? cfg.speed : 1.0;
    if (state.rideBySlashActive) mult *= 1.5;
    if (state.toxicSprintActive) mult *= 1.5;
    if (state.equippedItem === 'cyclizarMotor') {
        mult *= (selectedKey === 'Cyclizar' ? 3 : 2);
    }
    const playerTileKey = `${Math.floor(state.x / TILE)},${Math.floor(state.y / TILE)}`;

    if (state.equippedItem === 'protectivePads' && selectedKey === 'Scolipede' && (poisonTiles.has(playerTileKey) || sandTiles.has(playerTileKey))) {
        mult *= 1.2; // 20% speed boost
    }
    
    if (sandTiles.has(playerTileKey)) {
        if (state.equippedItem !== 'protectivePads') {
             mult *= 0.7; // 30% slow
        }
    }
    return mult;
}

const WALK_FPS = 10, IDLE_FPS = 6, HOP_FPS = 12, HURT_FPS = 12, ATTACK_FPS = 12, SLEEP_FPS = 4;
const IDLE_INTERVAL = 5;
const HOP_HEIGHT = Math.round(TILE * 0.55);
const BASELINE_NUDGE_Y = 0;

const PLAYER_R = 12; // Player collision radius
const ENEMY_R = 16;  // Enemy collision radius
const PROJECTILE_R = 6; // Projectile collision radius (adjusted for 8-bit square)
const COIN_R = 10;
const HEALTH_PACK_R = 10;
const COIN_SCALE = 0.025; // Further reduced coin size
const GAP_W       = Math.round(TILE * 0.60);
const EDGE_DARK   = "#06161b";
const EDGE_DARKER = "#031013";
const EDGE_LIP    = "rgba(255,255,255,0.08)";

const TEX = {
    floor: null, wall: null, coin: null, health: null,
    grass: null, water: null, grass_water_transition: null, palm_tree: null,
    poison: null, sand: null,
    grass_tiles: null, pine_tree: null,
    questGiver: null
};
const BG_TILE_SCALE = 3.0;

loadImage("assets/background/floor.png").then(im => TEX.floor = im).catch(()=>{});
loadImage("assets/background/wall.png").then(im => TEX.wall  = im).catch(()=>{});
loadImage("assets/coin.png").then(im => TEX.coin = im).catch(() => {});
loadImage("assets/health.png").then(im => TEX.health = im).catch(() => {});
loadImage("assets/background/grass.png").then(im => TEX.grass = im).catch(() => {});
loadImage("assets/background/water.png").then(im => TEX.water = im).catch(() => {});
loadImage("assets/background/grass_water_transition.png").then(im => TEX.grass_water_transition = im).catch(() => {});
loadImage("assets/background/palm_tree.png").then(im => TEX.palm_tree = im).catch(() => {});
loadImage("assets/background/poison.png").then(im => TEX.poison = im).catch(() => {});
loadImage("assets/background/sand.png").then(im => TEX.sand = im).catch(() => {});
loadImage("assets/background/grass_tiles.png").then(im => TEX.grass_tiles = im).catch(() => {});
loadImage("assets/background/pine_tree.png").then(im => TEX.pine_tree = im).catch(() => {});
loadImage("assets/questGiver/questGiver.png").then(im => TEX.questGiver = im).catch(()=>{});

// ---- QUEST GIVER AND QUEST SYSTEM ----
const questGiver = {
    x: 0, y: 0,
    w: 48, h: 96, // width and height for interaction
    flip: false,
    isHovered: false,
    dialogue: null,
    dialogueTimer: 0,
    proximityRadius: TILE * 4,
    interactionRadius: TILE * 1.5,
    hasSpoken: false
};

const QUEST_POOL = [
    {
        type: 'collectCoins',
        amount: 20,
        dialogue: "Psst! Shiny things catch your eye? Bring me 20 coins, and I'll make it worth your while.",
        taskText: "Collect 20 coins.",
        reward: { type: 'levelUp', amount: 1 },
        rewardText: "1 Level Up"
    },
    {
        type: 'killBrawlers',
        amount: 5,
        dialogue: "Those big brutes stomping around? Take out 5 of them for me. I've got a handsome reward waiting.",
        taskText: "Defeat 5 Brawler enemies.",
        reward: { type: 'multi', levels: 2, coins: 40 },
        rewardText: "2 Level Ups and 40 Coins"
    },
    {
        type: 'killEnemies',
        amount: 10,
        dialogue: "Feeling tough? Clear out 10 of any vermin you find in this place, and I'll line your pockets with 50 coins.",
        taskText: "Defeat 10 enemies of any type.",
        reward: { type: 'coins', amount: 50 },
        rewardText: "50 Coins"
    },
    {
        type: 'killTurrets',
        amount: 8,
        dialogue: "See those stationary contraptions spitting fire? They're a real nuisance. Dismantle 8 of them for me.",
        taskText: "Defeat 8 Turret enemies.",
        reward: { type: 'coins', amount: 75 },
        rewardText: "75 Coins"
    },
    {
        type: 'survive',
        amount: 120, // 120 seconds = 2 minutes
        dialogue: "Sometimes the best offense is not getting hit. Just stay alive for 2 minutes and I'll call it a job well done.",
        taskText: "Survive for 2 minutes.",
        reward: { type: 'levelUp', amount: 1 },
        rewardText: "1 Level Up"
    },
    {
        type: 'visitCorner',
        amount: 1, 
        dialogue: "I hear there's something interesting in the top-left corner of this place. Go check it out for me, will you?",
        taskText: "Travel to the top-left corner of the map.",
        reward: { type: 'coins', amount: 30 },
        rewardText: "30 Coins"
    },
    {
        type: 'killAngels',
        amount: 1,
        dialogue: "Have you seen that terrifying, weeping thing? Take it down. I don't care how, just get it done. There's a special reward in it for you.",
        taskText: "Defeat 1 Weeping Angel.",
        reward: { type: 'randomItem' },
        rewardText: "A random item from the shop!"
    },
    {
        type: 'clearZone',
        amount: 25,
        dialogue: "This whole area is crawling with pests. Thin the herd significantly—take out 25 enemies—and you'll be handsomely rewarded.",
        taskText: "Defeat 25 enemies of any type.",
        reward: { type: 'multi', levels: 3, coins: 100 },
        rewardText: "3 Level Ups and 100 Coins"
    }
];
// ------------------------------------

// ---------- SFX & Music ----------
const lobbyMusic = new Audio('assets/sfx/lobby.mp3');
lobbyMusic.loop = true;
lobbyMusic.volume = 0.3;

const dungeonMusic = new Audio('assets/sfx/dungeon.mp3');
dungeonMusic.loop = true;
dungeonMusic.volume = 0.3;

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
  coin:   makeAudioPool("assets/sfx/pickupCoin.wav"),
  heal:   makeAudioPool("assets/sfx/heal.wav"),
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
window.CHARACTERS = CHARACTERS; // Make it globally accessible for character classes

const characterClassMap = {
    "Sableye": Sableye,
    "Ditto": Ditto,
    "Hisuian Zoroark": HisuianZoroark,
    "Hypno": Hypno,
    "Quagsire": Quagsire,
    "Smeargle": Smeargle,
    "Corviknight": Corviknight,
    "Cacturne": Cacturne,
    "Decidueye": Decidueye,
    "Empoleon": Empoleon,
    "Cyclizar": Cyclizar,
    "Scolipede": Scolipede,
    "Altaria": Altaria,
    "Gengar": Gengar,
    "Excadrill": Excadrill,
    "Chandelure": Chandelure,
    "Primarina": Primarina,
    "Dewgong": Dewgong,
    "Lopunny": Lopunny,
    "Spinda": Spinda,
};

// We will fetch this from the JSON file now
async function fetchCharacterData() {
    try {
        const response = await fetch('characters.json');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Could not fetch characters.json:", error);
        return null;
    }
}


async function processCharacterData() {
    const data = await fetchCharacterData();
    if (!data) return;

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
        strength: ch.strength ?? def.strength ?? 15,
        ranged: ch.ranged ?? false,
        rangedStrength: ch.rangedStrength ?? def.rangedStrength ?? 20,
        rangedSpeed: ch.rangedSpeed ?? def.rangedSpeed ?? 1.0,
        projectileColor: ch.projectileColor || "#FFFFFF",
        ability: ch.ability || null, // Add ability
        idle: mergeAnim(def.idle, ch.idle),
        walk: mergeAnim(def.walk, ch.walk),
        hop:  mergeAnim(def.hop,  ch.hop),
        hurt: mergeAnim(def.hurt, ch.hurt),
        attack: mergeAnim(def.attack, ch.attack),
        shoot: ch.ranged ? mergeAnim(def.shoot, ch.shoot) : null,
        sleep: mergeAnim(def.sleep, ch.sleep) // Add sleep animation
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
  if (!/^[a-z0-9_]{3,16}$/.test(u)) { errEl.textContent = "3–16 chars a–z, 0-9, _"; return; }
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
    try { lobbyMusic.pause(); lobbyMusic.currentTime = 0; } catch(e) {}
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
    mobileControls.classList.add("hidden"); // Explicitly hide here
    inputSelectOverlay.classList.add("hidden");
    overlaySelect.classList.remove("hidden");
    setupMobileControls();
};

// Joystick state variables
let joystick = {
  active: false,
  touchId: null,
  baseX: 0,
  baseY: 0,
  stickX: 0,
  stickY: 0,
  dx: 0,
  dy: 0,
};

function setupMobileControls() {
    const controls = document.getElementById('mobile-controls');
    const joystickContainer = document.getElementById('joystick-container');
    const joystickThumb = document.getElementById('joystick-thumb');
    
    const handleMove = (e) => {
        if (!joystick.active) return;
        e.preventDefault();

        let touch = null;
        for (const t of e.changedTouches) {
            if (t.identifier === joystick.touchId) {
                touch = t;
                break;
            }
        }
        if (!touch) return;

        joystick.stickX = touch.clientX;
        joystick.stickY = touch.clientY;

        let dx = joystick.stickX - joystick.baseX;
        let dy = joystick.stickY - joystick.baseY;
        const distance = Math.hypot(dx, dy);
        const maxDistance = 50; // Max distance the thumb can move from center

        if (distance > maxDistance) {
            dx = (dx / distance) * maxDistance;
            dy = (dy / distance) * maxDistance;
        }
        
        joystick.dx = dx / maxDistance;
        joystick.dy = dy / maxDistance;

        joystickThumb.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
    };

    const handleEnd = (e) => {
        if (!joystick.active) return;
        let touchEnded = false;
        for (const t of e.changedTouches) {
            if (t.identifier === joystick.touchId) {
                touchEnded = true;
                break;
            }
        }
        if (!touchEnded) return;
        
        joystick.active = false;
        joystick.touchId = null;
        joystick.dx = 0;
        joystick.dy = 0;
        
        joystickContainer.style.transition = 'opacity 0.2s ease-out';
        joystickContainer.style.opacity = '0';
        joystickThumb.style.transform = `translate(-50%, -50%)`;
        
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);
        window.removeEventListener('touchcancel', handleEnd);
    };

    const handleStart = (e) => {
        if (!state.ready) return; // Only activate controls when game is ready
        const touch = e.changedTouches[0];

        // FIX: Prevent joystick from activating over UI elements, allowing scrolling.
        const targetElement = e.target;
        if (targetElement.closest('#shop-modal, #shop-icon, #chatLog, .inventory-display, button, a')) {
            return;
        }

        // --- NEW FIX: Check if touch is over the quest giver ---
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const touchWorldX = (touch.clientX - rect.left) * scaleX + state.cam.x;
        const touchWorldY = (touch.clientY - rect.top) * scaleY + state.cam.y;

        const isOverQuestGiver = touchWorldX > questGiver.x - questGiver.w / 2 &&
                                 touchWorldX < questGiver.x + questGiver.w / 2 &&
                                 touchWorldY > questGiver.y - questGiver.h &&
                                 touchWorldY < questGiver.y;

        if (isOverQuestGiver) {
            return; // Do not activate the joystick
        }
        // --- END OF NEW FIX ---


        if (touch.clientX < window.innerWidth / 2) {
            e.preventDefault();
            if (joystick.active) return;

            joystick.touchId = touch.identifier;
            joystick.active = true;
            joystick.baseX = touch.clientX;
            joystick.baseY = touch.clientY;
            joystick.stickX = touch.clientX;
            joystick.stickY = touch.clientY;

            joystickContainer.style.transition = 'none';
            joystickContainer.style.left = `${touch.clientX}px`;
            joystickContainer.style.top = `${touch.clientY}px`;
            joystickContainer.style.opacity = '1';
            
            window.addEventListener('touchmove', handleMove, { passive: false });
            window.addEventListener('touchend', handleEnd, { passive: false });
            window.addEventListener('touchcancel', handleEnd, { passive: false });
        }
    };

    const touchState = new Map();
    const handleActionStart = (e) => {
        if (!state.ready) return; // Only activate controls when game is ready
        // Check changedTouches for touches on the right side of the screen
        for (const t of e.changedTouches) {
             if (t.clientX >= window.innerWidth / 2) {
                e.preventDefault();
                const target = t.target.closest('.mobile-action-btn');
                if (target && target.dataset.key) {
                    const key = target.dataset.key;
                    keys.add(key);
                    touchState.set(t.identifier, key);
                }
            }
        }
    };

    const handleActionEnd = (e) => {
        for (const touch of e.changedTouches) {
            if (touchState.has(touch.identifier)) {
                e.preventDefault();
                const key = touchState.get(touch.identifier);
                keys.delete(key);
                touchState.delete(touch.identifier);
            }
        }
    };

    if (!controls.dataset.listenersAdded) {
        window.addEventListener('touchstart', (e) => {
            handleStart(e);
            handleActionStart(e);
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            handleActionEnd(e);
        }, { passive: false });

        window.addEventListener('touchcancel', (e) => {
            handleActionEnd(e);
        }, { passive: false });
        
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
let leaderboardInterval = null;
let leaderboardUnsub = null;

// ===================================================================
// ============= NEW: Central Cleanup Function for Leaks ==============
// ===================================================================
function cleanupLobbyScreenListeners() {
    if (typeof lobbyUnsub === 'function') {
        try { lobbyUnsub(); } catch(e) {}
        lobbyUnsub = null;
    }
    if (typeof onlineCountUnsub === 'function') {
        try { onlineCountUnsub(); } catch(e) {}
        onlineCountUnsub = null;
    }
    stopLeaderboardCycle();
}

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
  // Use the new, more thorough cleanup function
  cleanupLobbyScreenListeners(); 
  
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
  // Store the unsubscribe function when you create the listener
  onlineCountUnsub = net.subscribeOnlineCount(count => {
      onlineCountEl.textContent = count;
  });
  startLeaderboardCycle();
}

function startLeaderboardCycle() {
    let currentLeaderboard = 'level';

    function updateLeaderboard() {
        if (leaderboardUnsub) leaderboardUnsub();
        leaderboardUnsub = net.subscribeToLeaderboard(currentLeaderboard, (data) => {
            renderLeaderboard(currentLeaderboard, data);
        });
        currentLeaderboard = currentLeaderboard === 'level' ? 'coins' : 'level';
    }

    updateLeaderboard();
    leaderboardInterval = setInterval(updateLeaderboard, 10000);
}

function stopLeaderboardCycle() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    if (leaderboardUnsub) leaderboardUnsub();
    leaderboardEl.innerHTML = "";
}

function renderLeaderboard(type, data) {
    const title = type === 'level' ? 'Top Players by Level' : 'Richest Players';
    let listHtml = '<ol>';
    // Sort data before rendering
    const sortedData = [...data].sort((a, b) => (b[type] || 0) - (a[type] || 0));
    sortedData.forEach(player => {
        const value = type === 'level' ? `Lvl ${player.level}` : `${player.coins} Coins`;
        const playerName = player.username || 'Anonymous';
        listHtml += `<li>${playerName} - ${value}</li>`;
    });
    listHtml += '</ol>';
    leaderboardEl.innerHTML = `<h3>${title}</h3>${listHtml}`;
}


backBtn.onclick = ()=>{
  overlayLobbies.classList.add("hidden");
  overlaySelect.classList.remove("hidden");
  mobileControls.classList.add("hidden");
  cleanupLobbyScreenListeners(); // Use the new cleanup function
};

refreshBtn.onclick = ()=>{
  // Clean up before refreshing to prevent duplicate listeners
  cleanupLobbyScreenListeners();
  // Re-subscribe
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
  onlineCountUnsub = net.subscribeOnlineCount(count => {
    onlineCountEl.textContent = count;
  });
  startLeaderboardCycle();
};

// ---------- Seeded map meta ----------
function randSeed(){ return (Math.random()*0xFFFFFFFF)>>>0; }

createLobbyBtn.onclick = () => createLobbyFlow('dungeon');
createPlainsLobbyBtn.onclick = () => createLobbyFlow('plains');
createForestLobbyBtn.onclick = () => createLobbyFlow('forest');

async function createLobbyFlow(type) {
    let btn;
    if (type === 'dungeon') btn = createLobbyBtn;
    else if (type === 'plains') btn = createPlainsLobbyBtn;
    else btn = createForestLobbyBtn;

    const btnLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creating…";

    try {
        const cfg = CHARACTERS[selectedKey];
        if (!cfg) throw new Error("Pick a character first");
        
        const visW = Math.floor(canvas.width / TILE);
        const visH = Math.floor(canvas.height / TILE);
        const w = visW * MAP_SCALE;
        const h = visH * MAP_SCALE;

        const seed = randSeed();
        const lobbyId = await net.createLobby((newLobbyNameEl.value || "").trim(), { w, h, seed, type });
        await net.joinLobby(lobbyId);
        const map = generateMap(w, h, seed, type);
        await startWithCharacter(cfg, map);
        watchdogEnsureGame(cfg, map);
        overlayLobbies.classList.add("hidden");
        mountChatLog();
        startChatSubscription();
        playerHudEl.classList.remove("hidden");
        leaveLobbyBtn.classList.remove("hidden");
        shopIcon.classList.remove("hidden");
        inventoryDisplay.classList.remove("hidden");
        
        cleanupLobbyScreenListeners(); // Add this line here
        
        if (inputMode === 'touch') {
            mobileControls.classList.remove("hidden");
        }
        if (type === 'dungeon') {
            dungeonMusic.play().catch(() => {});
        } else {
            lobbyMusic.play().catch(() => {});
        }
    } catch (e) {
        console.error("Create lobby failed:", e);
        alert("Create lobby failed: " + (e?.message || e));
    } finally {
        btn.disabled = false;
        btn.textContent = btnLabel;
    }
}

async function joinLobbyFlow(lobbyId, btnEl){
  isJoiningLobby = true;
  const originalHTML = btnEl.innerHTML;
  btnEl.innerHTML = `<div><strong>Joining...</strong></div>`;
  
  try{
    const cfg = CHARACTERS[selectedKey];
    if (!cfg) { alert("Pick a character first"); return; }
    const lobby = await net.getLobby(lobbyId);
    const { w,h,seed, type } = lobby.mapMeta || {};
    await net.joinLobby(lobbyId);
    const map = generateMap(w||48,h||32,seed??1234, type);
    await startWithCharacter(cfg, map);
    watchdogEnsureGame(cfg, map);
    overlayLobbies.classList.add("hidden");
    mountChatLog();
    startChatSubscription();
    playerHudEl.classList.remove("hidden");
    leaveLobbyBtn.classList.remove("hidden");
    shopIcon.classList.remove("hidden");
    inventoryDisplay.classList.remove("hidden");

    cleanupLobbyScreenListeners(); // And add this line here
    
    if (inputMode === 'touch') {
        mobileControls.classList.remove("hidden");
    }
    if (type === 'dungeon') {
        dungeonMusic.play().catch(() => {});
    } else {
        lobbyMusic.play().catch(() => {});
    }
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
let lastTapHandledTime = 0;

const state = {
  x:0, y:0, dir:"down",
  moving:false, prevMoving:false,
  frameTime:0, frameStep:0, frameOrder: makePingPong(4),
  anim:"stand", idleAccum:0,
  scale:3,
  walkImg:null, idleImg:null, hopImg:null, hurtImg: null, attackImg: null, shootImg: null, sleepImg: null,
  animMeta:{walk:null, idle:null, hop:null, hurt: null, attack: null, shoot: null, sleep: null},
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
  level: 1,
  xp: 0,
  xpToNextLevel: 100,
  coins: 0,
  abilityCooldown: 0,
  isPhasing: false,
  phaseDamageTimer: 0,
  isTransformed: false,
  originalCharacterKey: null,
  isIllusion: false,
  illusionTarget: null,
  isAsleep: false,
  sleepTimer: 0,
  abilityTargetingMode: null,
  highlightedPlayers: [],
  regenTimer: 0,
  inventory: {},
  equippedItem: null,
  isFlying: false,
  copiedAbility: null,
  rideBySlashActive: false,
  rideBySlashTimer: 0,
  toxicSprintActive: false,
  toxicSprintTimer: 0,
  aquaShieldActive: false,
  aquaShieldTimer: 0,
  aquaShieldCooldown: 0,
  mouseTile: {x: null, y: null},
  isPoisoned: false,
  poisonTimer: 0,
  lastPoisonTick: 0,
  playerViewMode: false,
  afkTimer: 0,
  currentQuest: null,
  weepingAngelSpawnTimer: 20,
  ghostCharmCooldown: 0,
  ghostCharmCharges: 1,
  darkRoomActive: false,
  darkRoomTimer: 0,
  isDarkRoomCaster: false,
  isBubbled: false,
  bubbleTimer: 0,
  isConfused: false,
  confusionTimer: 0
};

let viewerState = {
    active: false,
    reqId: null,
    assets: null,
    frameStep: 0,
    frameTime: 0,
    frameOrder: []
};

// --- AFK TIMER ---
function resetAfkTimer() {
    state.afkTimer = 0;
}

function resetPlayerState() {
    state.isPhasing = false;
    state.phaseDamageTimer = 0;
    state.isTransformed = false;
    state.originalCharacterKey = null;
    state.isIllusion = false;
    state.illusionTarget = null;
    state.isAsleep = false;
    state.sleepTimer = 0;
    state.abilityTargetingMode = null;
    state.highlightedPlayers = [];
    state.isFlying = false;
    state.copiedAbility = null;
    state.rideBySlashActive = false;
    state.rideBySlashTimer = 0;
    state.toxicSprintActive = false;
    state.toxicSprintTimer = 0;
    state.aquaShieldActive = false;
    state.aquaShieldTimer = 0;
    state.aquaShieldCooldown = 0;
}

// ---------- Input ----------
function goBackToSelect(isSafeLeave = false) {
    if (!isSafeLeave) {
        const newLevel = Math.max(1, state.level - 1);
        if (newLevel < state.level) {
            net.updatePlayerStats({ level: newLevel, xpSet: 0 });
        }
    }
    try { lobbyMusic.pause(); lobbyMusic.currentTime = 0; } catch(e) {}
    try { dungeonMusic.pause(); dungeonMusic.currentTime = 0; } catch(e) {}

    resetPlayerState();

    keys.clear();
    remote.clear();
    enemies.clear();
    coins.clear();
    healthPacks.clear();
    poisonTiles.clear();
    sandTiles.clear();
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
    leaveLobbyBtn.classList.add("hidden");
    shopIcon.classList.add("hidden");
    inventoryDisplay.classList.add("hidden");
}

leaveLobbyBtn.onclick = () => goBackToSelect(true);

let lastMouseX = 0, lastMouseY = 0;
canvas.addEventListener('mousemove', e => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

window.addEventListener("keydown", e=>{
  if (chatMode){
    if (e.key === "'") {
      e.preventDefault();
    }
    if (e.key === "Enter"){
      e.preventDefault();
      const clean = censorMessage(chatBuffer.trim());
      chatMode = false; state.typing = false; net.updateState({ typing:false }).catch(()=>{});
      if (clean && clean.length){
        state.say = clean;
        state.sayTimer = chatShowTime;
        net.sendChat(clean).catch(()=>{});
        resetAfkTimer(); // --- AFK TIMER ---
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

  if (e.key === "Escape"){
    if (viewerState.active) {
        closePlayerViewer();
        return;
    }
    if (state.abilityTargetingMode) {
        state.abilityTargetingMode = null;
        state.highlightedPlayers = [];
    } else {
        goBackToSelect(true);
    }
    return;
  }
  
  if (!state.ready || state.isAsleep) return;

  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w", "a", "s", "d", "W", "A", "S", "D", " ", "j", "J", "k", "K", "e", "E"].includes(e.key)) e.preventDefault();

  if (e.key === "Enter"){ chatMode = true; chatBuffer = ""; state.typing = true; net.updateState({ typing:true }).catch(()=>{}); renderChatLog(); return; }

  if (e.key.toLowerCase() === "q") {
    state.playerViewMode = !state.playerViewMode;
    if (!state.playerViewMode) {
        closePlayerViewer();
    }
  }

  if (e.key.toLowerCase() === "g") state.showGrid = !state.showGrid;
  if (e.key.toLowerCase() === "b") state.showBoxes = !state.showBoxes;
  
  keys.add(e.key);
});
window.addEventListener("keyup", e=>{ if (!chatMode) keys.delete(e.key); });
window.addEventListener("blur", () => {
  keys.clear();
});

// --- NEW FUNCTION TO HANDLE BOTH CLICKS AND TAPS ---
function handleCanvasTap(e) {
    // Debounce to prevent touch and click firing together
    const now = performance.now();
    if (now - lastTapHandledTime < 500) {
        e.preventDefault(); // Also prevent any follow-up events
        return;
    }
    lastTapHandledTime = now;

    resetAfkTimer(); // --- AFK TIMER ---
    
    // Determine coordinates from either mouse or touch event
    const touch = e.changedTouches ? e.changedTouches[0] : e;
    if (!touch) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (touch.clientX - rect.left) * scaleX;
    const mouseY = (touch.clientY - rect.top) * scaleY;
    const worldX = mouseX + state.cam.x;
    const worldY = mouseY + state.cam.y;
    
    // --- Logic for interacting with the quest giver ---
    if (questGiver.isHovered || (Math.hypot(worldX - questGiver.x, worldY - (questGiver.y - questGiver.h/2)) < questGiver.interactionRadius)) {
        if (!state.playerViewMode && !state.abilityTargetingMode) {
             openQuestModal();
             return; // End here to not process other interactions
        }
    }

    if (state.playerViewMode) {
        let clickedActor = null;

        const distToSelf = Math.hypot(worldX - state.x, worldY - state.y);
        if (distToSelf < PLAYER_R * 2) {
            clickedActor = {
                uid: net.auth.currentUser.uid,
                isLocal: true,
                username: localUsername,
                level: state.level,
                xp: state.xp,
                playerKills: state.playerKills,
                enemyKills: state.enemyKills,
                character: state.isIllusion ? state.illusionTarget.character : selectedKey,
                equippedItem: state.equippedItem,
            };
        }

        if (!clickedActor) {
            for (const [uid, player] of remote.entries()) {
                const dist = Math.hypot(worldX - player.x, worldY - player.y);
                if (dist < PLAYER_R * 2) {
                    clickedActor = {
                        uid: uid,
                        isLocal: false,
                        character: player.isIllusion ? player.illusionTarget.character : player.character,
                        equippedItem: player.equippedItem,
                    };
                    break;
                }
            }
        }
        
        if (clickedActor) {
            openPlayerViewer(clickedActor);
        }
        return;
    }
    
    if (state.abilityTargetingMode === 'bubble') {
        let clickedTarget = null;

        // Prioritize clicking enemies
        for (const [id, enemy] of enemies.entries()) {
            if (enemy.isBubbled) continue; // Can't bubble an already bubbled enemy
            const dist = Math.hypot(worldX - enemy.x, worldY - enemy.y);
            if (dist < ENEMY_R * 2) {
                clickedTarget = { type: 'enemy', id };
                break;
            }
        }

        // If no enemy was clicked, check for players
        if (!clickedTarget) {
            for (const [uid, player] of remote.entries()) {
                if (player.isBubbled) continue;
                const dist = Math.hypot(worldX - player.x, worldY - player.y);
                if (dist < PLAYER_R * 2) {
                    clickedTarget = { type: 'player', id: uid };
                    break;
                }
            }
        }

        if (clickedTarget) {
            activateTargetedAbility(clickedTarget);
        }
        
        // Always exit targeting mode after a click, successful or not
        state.abilityTargetingMode = null;
        state.highlightedPlayers = [];
        return; // Prevent other click logic from running
    }
    
    if (!state.abilityTargetingMode) return;

    if (state.abilityTargetingMode === 'sandSnare') {
        const tileX = Math.floor(worldX / TILE);
        const tileY = Math.floor(worldY / TILE);
        activateTargetedAbility({ x: tileX, y: tileY });
        state.abilityTargetingMode = null;
        state.highlightedPlayers = [];
        return;
    }

    let clickedPlayer = null;
    for (const [uid, player] of remote.entries()) {
        const dist = Math.hypot(worldX - player.x, worldY - player.y);
        if (dist < PLAYER_R * 2) {
            clickedPlayer = { uid, ...player };
            break;
        }
    }

    if (clickedPlayer) {
        activateTargetedAbility(clickedPlayer);
    }

    state.abilityTargetingMode = null;
    state.highlightedPlayers = [];
}

// Add listeners for both mouse and touch
canvas.addEventListener('click', handleCanvasTap);
canvas.addEventListener('touchend', handleCanvasTap);


backBtnMobile.onclick = () => goBackToSelect(true);

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
        resetAfkTimer(); // --- AFK TIMER ---
    }
    
    mobileChatInput.value = "";
    mobileChatOverlay.classList.add("hidden");
    mobileChatInput.blur();
});


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
      cfg.sleep ? loadImage(cfg.base + cfg.sleep.sheet) : Promise.resolve(null),
      loadImage(cfg.base + cfg.portrait)
    ];

    const [wRes, iRes, hRes, huRes, aRes, sRes, slRes, pRes] = await Promise.allSettled(promises);

    if (wRes.status !== "fulfilled" || iRes.status !== "fulfilled") {
      throw new Error(`Core sheets (walk/idle) missing for ${key}`);
    }

    const walkImg = wRes.value;
    const idleImg = iRes.value;
    const hopImg = (hRes.status === "fulfilled") ? hRes.value : null;
    const hurtImg = (huRes.status === "fulfilled") ? huRes.value : null;
    const attackImg = (aRes.status === "fulfilled") ? aRes.value : null;
    const shootImg = (sRes.status === "fulfilled") ? sRes.value : null;
    const sleepImg = (slRes.status === "fulfilled") ? slRes.value : null;
    const portraitImg = (pRes.status === "fulfilled") ? pRes.value : null;

    const meta = {
      walk: sliceSheet(walkImg, cfg.walk.cols, cfg.walk.rows, cfg.walk.dirGrid, cfg.walk.framesPerDir),
      idle: sliceSheet(idleImg, cfg.idle.cols, cfg.idle.rows, cfg.idle.dirGrid, cfg.idle.framesPerDir),
      hop: hopImg ? sliceSheet(hopImg, cfg.hop.cols, cfg.hop.rows, cfg.hop.dirGrid, cfg.hop.framesPerDir) : {},
      hurt: hurtImg ? sliceSheet(hurtImg, cfg.hurt.cols, cfg.hurt.rows, cfg.hurt.dirGrid, cfg.hurt.framesPerDir) : {},
      attack: attackImg ? sliceSheet(attackImg, cfg.attack.cols, cfg.attack.rows, cfg.attack.dirGrid, cfg.attack.framesPerDir) : {},
      shoot: shootImg && cfg.shoot ? sliceSheet(shootImg, cfg.shoot.cols, cfg.shoot.rows, cfg.shoot.dirGrid, cfg.shoot.framesPerDir) : {},
      sleep: sleepImg && cfg.sleep ? sliceSheet(sleepImg, cfg.sleep.cols, cfg.sleep.rows, cfg.sleep.dirGrid, cfg.sleep.framesPerDir) : {},
    };

    const assets = { cfg, walk: walkImg, idle: idleImg, hop: hopImg, hurt: hurtImg, attack: attackImg, shoot: shootImg, sleep: sleepImg, portrait: portraitImg, meta };
    _assetCache.set(key, assets);
    return assets;

  } catch (err) {
    console.error(`Failed to load assets for ${key}:`, err);
    return null;
  }
}

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

// ---------- Net listeners ----------
function startNetListeners(){
  net.subscribeToHits(async hit => {
      if (state.invulnerableTimer > 0 || state.aquaShieldActive) return;

      if (state.isBubbled) {
          state.isBubbled = false;
          state.bubbleTimer = 0;
          net.broadcastAbility({ name: 'popBubble', targetId: net.auth.currentUser.uid });
      }

      if (state.isIllusion) {
          const result = localPlayer.revertAbility();
          if (result && result.isIllusion) {
              await applyVisualChange(result.visualKey);
          }
      }
      
      if (state.isAsleep) {
          state.isAsleep = false;
          state.sleepTimer = 0;
          net.updateState({ isAsleep: false });
      }

      if (state.darkRoomActive && !state.isDarkRoomCaster) {
          state.darkRoomActive = false;
          state.darkRoomTimer = 0;
      }

      state.hp = Math.max(0, state.hp - hit.damage);
      state.invulnerableTimer = 0.7;
      state.anim = 'hurt';
      state.frameStep = 0;
      state.frameTime = 0;
      net.updateState({ hp: state.hp });
      
      if(hit.from) {
          const attacker = remote.get(hit.from) || {uid: net.auth.currentUser.uid};
          if(attacker) {
              addXp(5, attacker.uid);
          }
      }

      if (state.hp <= 0) {
          goBackToSelect();
      }
  });

net.subscribeToProjectiles(p_data => {
    if (p_data.isEnemyProjectile) {
        projectiles.push({
            x: p_data.x,
            y: p_data.y,
            vx: p_data.vx,
            vy: p_data.vy,
            damage: p_data.damage,
            life: p_data.life
        });
    }
    else if (p_data.ownerId !== net.auth.currentUser.uid) {
        playerProjectiles.push({
            x: p_data.x,
            y: p_data.y,
            vx: p_data.vx,
            vy: p_data.vy,
            damage: p_data.damage,
            life: p_data.life,
            ownerId: p_data.ownerId,
            color: p_data.color,
            homing: p_data.homing,
            targetId: p_data.targetId
        });
    }
});
  
net.subscribeToMeleeAttacks(attackData => {
    if (attackData.isEnemy) {
        if (state.invulnerableTimer > 0 || state.aquaShieldActive || state.isPhasing) return;
        
        const enemy = enemies.get(attackData.by);
        if (!enemy) return;

        const dist = Math.hypot(state.x - enemy.x, state.y - enemy.y);
        if (dist < attackData.range) {
            if (state.isBubbled) {
                state.isBubbled = false;
                net.broadcastAbility({ name: 'popBubble', targetId: net.auth.currentUser.uid });
            }
            state.hp = Math.max(0, state.hp - attackData.damage);
            state.invulnerableTimer = 0.7;
            state.anim = 'hurt';
            state.frameStep = 0;
            state.frameTime = 0;
            net.updateState({ hp: state.hp });
            if (state.hp <= 0) {
                goBackToSelect();
            }
        }
    } else {
        const attackerId = attackData.by;
        const remotePlayer = remote.get(attackerId);
        if (remotePlayer) {
            remotePlayer.anim = 'attack';
            remotePlayer.frameStep = 0;
            remotePlayer.frameTime = 0;
        }
    }
});

  net.subscribeToAbilities(abilityData => {
      if (abilityData.by === net.auth.currentUser.uid) return;
      const player = remote.get(abilityData.by);

      switch (abilityData.name) {
          case 'transform':
              if(player) handleRemoteTransform(player, abilityData.targetCharacterKey, abilityData.isRevert);
              break;
          case 'illusion':
              if(player) handleRemoteIllusion(player, abilityData.target);
              break;
          case 'revertIllusion':
              if(player) handleRemoteRevertIllusion(player);
              break;
          case 'toxicSprint':
              poisonTiles.set(`${abilityData.tileX},${abilityData.tileY}`, { life: 3 });
              break;
          case 'sandSnare':
              for (let y = -1; y <= 1; y++) {
                  for (let x = -1; x <= 1; x++) {
                      const key = `${abilityData.tileX + x},${abilityData.tileY + y}`;
                      sandTiles.set(key, { life: 5 });
                  }
              }
              break;
          case 'darkRoom':
              state.darkRoomActive = true;
              state.darkRoomTimer = 5.0;
              state.isDarkRoomCaster = (abilityData.by === net.auth.currentUser.uid);
              if (net.auth.currentUser.uid === net.currentLobbyOwner) {
                  const enemiesData = {};
                  for (const [id, enemy] of enemies.entries()) {
                      enemiesData[id] = {
                          id: enemy.id,
                          type: enemy.constructor.name,
                          x: enemy.x,
                          y: enemy.y,
                          config: {
                              hp: enemy.maxHp,
                              maxHp: enemy.maxHp,
                              speed: enemy.speed,
                              damage: enemy.damage,
                              detectionRange: enemy.detectionRange,
                              attackRange: enemy.attackRange,
                              projectileSpeed: enemy.projectileSpeed || 0
                          }
                      };
                  }
                  window.savedEnemies = enemiesData;

                  for (const id of enemies.keys()) {
                      net.removeEnemy(id);
                  }
              }
              break;
          case 'trapInBubble':
              const targetInfo = abilityData.target;
              if (targetInfo.type === 'player') {
                  const targetPlayer = remote.get(targetInfo.id);
                  if (targetPlayer) {
                      targetPlayer.isBubbled = true;
                      targetPlayer.bubbleTimer = 5.0; 
                  }
                  if (targetInfo.id === net.auth.currentUser.uid) {
                      state.isBubbled = true;
                      state.bubbleTimer = 5.0;
                  }
              } else if (targetInfo.type === 'enemy') {
                  const targetEnemy = enemies.get(targetInfo.id);
                  if (targetEnemy) {
                      targetEnemy.isBubbled = true;
                      targetEnemy.bubbleTimer = 5.0;
                  }
              }
              break;
          case 'popBubble':
              const playerToPop = remote.get(abilityData.targetId);
              if (playerToPop) playerToPop.isBubbled = false;
              if (abilityData.targetId === net.auth.currentUser.uid) {
                  state.isBubbled = false;
              }
              break;
          case 'popBubbleEnemy':
              const enemyToPop = enemies.get(abilityData.targetId);
              if (enemyToPop) enemyToPop.isBubbled = false;
              break;
          case 'confusionDance':
              activeEffects.set(abilityData.by, {
                  name: 'confusionDance',
                  x: abilityData.position.x,
                  y: abilityData.position.y,
                  timer: 10.0,
                  by: abilityData.by
              });
              break;
      }
  });

  net.subscribeToStatusEvents(event => {
      if (event.type === 'sleep') {
          let duration = event.duration;
          if (event.from) {
              const attacker = remote.get(event.from);
              if (attacker && attacker.equippedItem === 'hypnosPendulum') {
                  duration = 8000;
              }
          }
          state.isAsleep = true;
          state.sleepTimer = duration / 1000;
          state.anim = 'sleep';
          state.frameStep = 0;
          state.frameTime = 0;
          net.updateState({ isAsleep: true });
      }
  });


net.subscribeEnemies({
    onAdd: (id, data) => {
        const { type, x, y, config } = data;
        if (!config) {
            console.error("Enemy created without config!", id, data);
            return;
        }
        let enemyInstance;
        switch (type) {
            case 'Brawler':      enemyInstance = new Brawler(id, x, y, config); break;
            case 'WeepingAngel': enemyInstance = new WeepingAngel(id, x, y, config); break;
            case 'Turret':
            default:             enemyInstance = new Turret(id, x, y, config); break;
        }
        enemies.set(id, enemyInstance);
    },
    onChange: (id, data) => {
        const enemy = enemies.get(id);
        if (enemy) {
            enemy.x = data.x;
            enemy.y = data.y;
            enemy.hp = data.hp;
            enemy.targetId = data.targetId;
        }
    },
    onRemove: (id) => {
        enemies.delete(id);
    }
  });

  net.subscribeCoins({
      onAdd: (id, data) => {
          coins.set(id, data);
      },
      onRemove: (id) => {
          coins.delete(id);
      }
  });
  
  net.subscribeHealthPacks({
      onAdd: (id, data) => {
          healthPacks.set(id, data);
      },
      onRemove: (id) => {
          healthPacks.delete(id);
      }
  });

  net.subscribeItemDrops({
      onAdd: (id, data) => {
          droppedItems.set(id, data);
      },
      onRemove: (id) => {
          droppedItems.delete(id);
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
        maxHp: data.maxHp ?? assets.cfg.hp,
        level: data.level || 1,
        assets,
        history: [{ t: performance.now()/1000, x: data.x, y: data.y }],
        lastProcessedAttackTs: 0,
        showHpBarTimer: 0,
        isPhasing: data.isPhasing || false,
        isAsleep: data.isAsleep || false,
        isTransformed: data.isTransformed || false,
        isIllusion: data.isIllusion || false,
        illusionTarget: data.illusionTarget || null,
        originalCharacterKey: data.originalCharacterKey || data.character,
        isBubbled: false,
        bubbleTimer: 0,
        equippedItem: data.equippedItem || null,
      });
    },
    onChange: (uid, data)=>{
      const r = remote.get(uid); if (!r) return;
      r.x = data.x ?? r.x; r.y = data.y ?? r.y;
      if (!r.history) r.history=[];
      r.history.push({ t: performance.now()/1000, x: r.x, y: r.y });
      if (r.history.length > 40) r.history.shift();
      r.dir = data.dir ?? r.dir;
      r.typing = !!data.typing;
      r.level = data.level ?? r.level;
      r.isPhasing = data.isPhasing ?? r.isPhasing;
      r.equippedItem = data.equippedItem ?? r.equippedItem;
      r.maxHp = data.maxHp ?? r.maxHp;
      if (r.hp > r.maxHp) r.hp = r.maxHp;
      
      if (data.isAsleep === false && r.isAsleep === true) {
          r.isAsleep = false;
          r.anim = 'stand';
      } else {
         r.isAsleep = data.isAsleep ?? r.isAsleep;
      }
      
      if (data.hp < r.hp) {
          if (r.isIllusion) {
              handleRemoteRevertIllusion(r);
          }
          if (r.isAsleep) {
              r.isAsleep = false;
          }
          if (r.isBubbled) {
              r.isBubbled = false;
          }
          r.anim = 'hurt';
          r.frameStep = 0;
          r.frameTime = 0;
          r.showHpBarTimer = 2.0;
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
    onRemove: (uid, val)=> {
        remote.delete(uid);
    }
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
            if (!latestMsg.system) {
                const r = remote.get(latestMsg.uid);
                if (r) {
                    r.say = latestMsg.text;
                    r.sayTimer = 5.0;
                }
            }
        }
    }
  });
}

// ---------- Boot character in map ----------
async function startWithCharacter(cfg, map){
  resetPlayerState();
  state.ready = false;
  
  const stats = await net.getUserStats();
  state.level = stats.level;
  state.xp = stats.xp;
  state.coins = stats.coins;
  state.playerKills = stats.playerKills;
  state.enemyKills = stats.enemyKills;
  state.inventory = stats.inventory || {};
  state.equippedItem = stats.equippedItem || null;
  state.xpToNextLevel = 100 * Math.pow(1.2, state.level - 1);

  state.animMeta = { walk:{}, idle:{}, hop:{}, hurt:{}, attack:{}, shoot:{}, sleep:{} };
  state.scale = cfg.scale ?? 3;
  state.map = map;
  gameContext.map = map;
  state.maxHp = cfg.hp;
  state.hp = cfg.hp;

  try{
    const assets = await loadCharacterAssets(selectedKey);
    if (!assets) throw new Error("Failed to load character assets");

    const PlayerClass = characterClassMap[selectedKey] || Player;
    localPlayer = new PlayerClass(state, assets, net, sfx, selectedKey, gameContext, CHARACTERS);

    state.walkImg = assets.walk;
    state.idleImg = assets.idle;
    state.hopImg  = assets.hop;
    state.hurtImg = assets.hurt;
    state.attackImg = assets.attack;
    state.shootImg = assets.shoot;
    state.sleepImg = assets.sleep;
    state.animMeta = assets.meta;

    const spawn = tileCenter(map.spawn.x, map.spawn.y);
    state.x = spawn.x + (Math.random()*8 - 4);
    state.y = spawn.y + (Math.random()*8 - 4);

    // ---- SPAWN QUEST GIVER ----
    // Place him a few tiles to the right of the player's spawn
    const qg_tileX = map.spawn.x + 3;
    const qg_tileY = map.spawn.y;
    questGiver.x = qg_tileX * TILE + TILE / 2;
    questGiver.y = qg_tileY * TILE + TILE / 2;
    // He is on the right of spawn, so flip him to face left (towards the player)
    questGiver.flip = true;
    state.currentQuest = null; // Reset quest on new map
    // -------------------------

    state.dir = "down"; state.anim = "stand"; state.hopping = false;
    state.frameOrder = makePingPong(cfg.walk.framesPerDir);
    state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;
    state.say = null; state.sayTimer = 0; state.typing = false;
    state.invulnerableTimer = 0;
    state.attackCooldown = 0;
    state.abilityCooldown = 0;

    if (net.auth.currentUser?.uid === net.currentLobbyOwner) {
        spawnEnemies(map);
        spawnCoins(map);
        spawnHealthPacks(map);
    }
    
    updateCamera();
    state.ready = true;

    await net.spawnLocal({
      username: localUsername || "player",
      character: selectedKey,
      x: state.x, y: state.y, dir: state.dir,
      anim: state.anim, scale: state.scale, typing:false,
      hp: state.hp, maxHp: state.maxHp, level: state.level,
      originalCharacterKey: selectedKey,
      equippedItem: state.equippedItem
    });
    startNetListeners();
    updateInventoryUI();
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
  if (inputMode === 'touch' && joystick.active) {
      const { dx, dy } = joystick;
      return { vx: dx, vy: dy };
  }
  
  if (chatMode || state.isAsleep || state.isBubbled) return {vx:0, vy:0};
  const up = keys.has("w") || keys.has("ArrowUp");
  const down = keys.has("s") || keys.has("ArrowDown");
  const left = keys.has("a") || keys.has("ArrowLeft");
  const right = keys.has("d") || keys.has("ArrowRight");
  let vx=0, vy=0;
  if (up) vy -= 1; if (down) vy += 1;
  if (left) vx -= 1; if (right) vx += 1;
  if (vx && vy){ const inv = 1/Math.sqrt(2); vx *= inv; vy *= inv; }
  
  if (state.isConfused) {
      vx *= -1;
      vy *= -1;
  }
  return {vx, vy};
}
function vecToDir(vx, vy){
  if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) return state.dir;

  const angle = Math.atan2(vy, vx) * 180 / Math.PI;

  if (angle > -22.5 && angle <= 22.5) return "right";
  if (angle > 22.5 && angle <= 67.5) return "downRight";
  if (angle > 67.5 && angle <= 112.5) return "down";
  if (angle > 112.5 && angle <= 157.5) return "downLeft";
  if (angle > 157.5 || angle <= -157.5) return "left";
  if (angle > -157.5 && angle <= -112.5) return "upLeft";
  if (angle > -112.5 && angle <= -67.5) return "up";
  if (angle > -67.5 && angle <= -22.5) return "upRight";
  
  return state.dir;
}
function updateCamera(){
  const mapPxW = state.map.w * TILE;
  const mapPxH = state.map.h * TILE;
  state.cam.x = clamp(state.x - canvas.width  /2, 0, Math.max(0, mapPxW - canvas.width));
  state.cam.y = clamp(state.y - canvas.height /2, 0, Math.max(0, mapPxH - canvas.height));
}

function resolvePlayerCollisions(nx, ny){
  if (state.isPhasing) return { x: nx, y: ny };
  let x = nx, y = ny;
  const myR = PLAYER_R;
  for (const r of remote.values()){
    if (r.isPhasing) continue;
    const rr = PLAYER_R;
    const minD = myR + rr;

    const remotePos = getRemotePlayerSmoothedPos(r);
    const dx = x - remotePos.x;
    const dy = y - remotePos.y;
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
        if (!state.hopping && !state.isPhasing && state.map.edgesV[ty][xB]) newX = oldX;
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
        if (!state.hopping && !state.isPhasing && state.map.edgesH[yB][tx]) newY = oldY;
      }
    }
    state.y = newY;
  }
}
function tryStartHop(){
  if (!state.ready || state.hopping || state.anim === 'hurt' || state.attacking || state.isAsleep || state.isBubbled) return;
  const cfg = CHARACTERS[selectedKey];
  
  if (cfg.ability?.name === 'flight') {
      toggleFlight();
      sfx.jump.play(0.6, 1 + (Math.random() * 0.08 - 0.04));
      return;
  }
  
  const strip = state.animMeta.hop?.[state.dir];
  if (!cfg?.hop || !state.hopImg || !strip || strip.length === 0) return;

  const {vx,vy} = getInputVec();
  let dx = Math.sign(vx), dy = Math.sign(vy);
  if (!dx && !dy){ const v = DIR_VECS[state.dir]; dx=v[0]; dy=v[1]; }

  const tx0 = Math.floor(state.x / TILE);
  const ty0 = Math.floor(state.y / TILE);
  let tx = tx0 + dx;
  let ty = ty0 + dy;

  if (!canWalk(tx, ty, state.map)) {
    const m = state.map;
    if (m && m.type === 'plains' && ty >= 0 && ty < m.h && tx >= 0 && tx < m.w && m.walls[ty][tx] === 2) {
      const tx2 = tx0 + dx * 2;
      const ty2 = ty0 + dy * 2;
      if (tx2 >= 0 && ty2 >= 0 && tx2 < m.w && ty2 < m.h && canWalk(tx2, ty2, m)) {
        tx = tx2;
        ty = ty2;
      } else {
        tx = tx0;
        ty = ty0;
      }
    } else {
      tx = tx0;
      ty = ty0;
    }
  }

  const start = { x: state.x, y: state.y };
  const end = tileCenter(tx, ty);

  state.hopping = true;
  sfx.jump.play(0.6, 1 + (Math.random()*0.08 - 0.04));

  state.anim = "hop";
  state.frameOrder = [...Array(cfg.hop.framesPerDir).keys()];
  state.frameStep = 0; state.frameTime = 0;
  state.hop = { sx:start.x, sy:start.y, tx:end.x, ty:end.y, t:0, dur: cfg.hop.framesPerDir / HOP_FPS, z:0 };
  state.idleAccum = 0;
}

function tryStartSuperHop() {
    if (!state.ready || state.hopping || state.anim === 'hurt' || state.attacking) return;
    
    const SUPER_HOP_DISTANCE = 4;
    const [vx, vy] = DIR_VECS[state.dir];

    let targetX = Math.floor(state.x / TILE);
    let targetY = Math.floor(state.y / TILE);
    let finalPos = { x: targetX, y: targetY };

    for (let i = 1; i <= SUPER_HOP_DISTANCE; i++) {
        const nextX = targetX + vx * i;
        const nextY = targetY + vy * i;
        if (canWalk(nextX, nextY, state.map)) {
            finalPos = { x: nextX, y: nextY };
        } else {
            break;
        }
    }

    const start = { x: state.x, y: state.y };
    const end = tileCenter(finalPos.x, finalPos.y);

    state.hopping = true;
    sfx.jump.play(0.7, 1.2);

    state.anim = "hop";
    const hopFrames = CHARACTERS[selectedKey].hop.framesPerDir;
    state.frameOrder = [...Array(hopFrames).keys()];
    state.frameStep = 0;
    state.frameTime = 0;
    state.hop = { sx: start.x, sy: start.y, tx: end.x, ty: end.y, t: 0, dur: (hopFrames / HOP_FPS) * 1.5, z: 0 };
    state.idleAccum = 0;
}

// ---------- Animation helpers ----------
function currentFrame(){
  let meta, strip, idx;
  const fallbackFrame = state.animMeta.idle?.down?.[0] || null;

  if (state.anim === "walk"){
    meta = state.animMeta.walk; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = state.frameOrder[state.frameStep % state.frameOrder.length] % strip.length; return strip[idx];
  }
  if (state.anim === "idle"){
    meta = state.animMeta.idle; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = state.frameOrder[state.frameStep % state.frameOrder.length] % strip.length; return strip[idx];
  }
  if (state.anim === "hop"){
    meta = state.animMeta.hop; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "hurt") {
    meta = state.animMeta.hurt; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "attack") {
    meta = state.animMeta.attack; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "shoot") {
    meta = state.animMeta.shoot; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  if (state.anim === "sleep") {
    meta = state.animMeta.sleep; strip = meta?.[state.dir] || meta?.down; // Sleep might not have all directions
    if (!strip || !strip.length) return fallbackFrame;
    idx = state.frameOrder[state.frameStep % state.frameOrder.length] % strip.length; return strip[idx];
  }
  // Stand animation should use the first idle frame for the current direction
  if (state.anim === "stand"){
    meta = state.animMeta.idle; strip = meta?.[state.dir];
    if (!strip || !strip.length) return fallbackFrame;
    return strip[0];
  }
  
  return fallbackFrame;
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
  const xe = Math.min(m.w - 1, Math.ceil((state.cam.x + canvas.width) / TILE));
  const ye = Math.min(m.h - 1, Math.ceil((state.cam.y + canvas.height) / TILE));

  const overlap = 2; 

  if (m.type === 'forest') {
      const ts = TEX.grass_tiles;
      if (ts && m.tiles) {
          const tileW = ts.width / 10;
          const tileH = ts.height / 7;
          for (let y = ys; y <= ye; y++) {
              for (let x = xs; x <= xe; x++) {
                  const tileData = m.tiles[y][x];
                  if (tileData) {
                      const dx = x * TILE - state.cam.x;
                      const dy = y * TILE - state.cam.y;
                      ctx.drawImage(ts, 
                        tileData.x * tileW, tileData.y * tileH, tileW, tileH, 
                        dx - overlap / 2, dy - overlap / 2, TILE + overlap, TILE + overlap
                      );
                  }
              }
          }
      }
  } else if (m.type === 'plains') {
    for (let y = ys; y <= ye; y++) {
      for (let x = xs; x <= xe; x++) {
        const dx = x * TILE - state.cam.x;
        const dy = y * TILE - state.cam.y;
        const cell = m.walls[y][x];
        let tileToDraw = null;
        if (cell === 2) {
            tileToDraw = TEX.water;
        } else {
            tileToDraw = TEX.grass;
        }

        if(tileToDraw) {
            ctx.drawImage(tileToDraw, 0, 0, tileToDraw.width, tileToDraw.height, 
                dx - overlap / 2, dy - overlap / 2, TILE + overlap, TILE + overlap
            );
        }
      }
    }
  } else { // Dungeon (default) rendering
      if (TEX.floor) {
        for (let y = ys; y <= ye; y++) {
          for (let x = xs; x <= xe; x++) {
            const fx = x * TILE - state.cam.x - (BG_TILE_SCALE - 1) * TILE / 2;
            const fy = y * TILE - state.cam.y - (BG_TILE_SCALE - 1) * TILE / 2;
            ctx.drawImage(TEX.floor, 0, 0, TEX.floor.width, TEX.floor.height, fx, fy, TILE * BG_TILE_SCALE, TILE * BG_TILE_SCALE);
          }
        }
      } else {
        ctx.fillStyle = BG_FLOOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      for (let y = ys; y <= ye; y++) {
        for (let x = xs; x <= xe; x++) {
          if (!m.walls[y][x]) continue;
          const dx = x * TILE - state.cam.x;
          const dy = y * TILE - state.cam.y;
          if (TEX.wall) {
            const wx = dx - (BG_TILE_SCALE - 1) * TILE / 2;
            const wy = dy - (BG_TILE_SCALE - 1) * TILE / 2;
            ctx.save();
            ctx.beginPath();
            ctx.rect(dx, dy, TILE, TILE);
            ctx.clip();
            ctx.drawImage(TEX.wall, 0, 0, TEX.wall.width, TEX.wall.height, wx, wy, TILE * BG_TILE_SCALE, TILE * BG_TILE_SCALE);
            ctx.restore();
          } else {
            ctx.fillStyle = BG_WALL;
            ctx.fillRect(dx, dy, TILE, TILE);
          }
        }
      }
      for (let y = ys; y <= ye; y++) {
        for (let xb = Math.max(1, xs); xb <= Math.min(m.w - 1, xe); xb++) {
          if (!m.edgesV[y][xb]) continue;
          const cx = xb * TILE - state.cam.x;
          const y0 = y * TILE - state.cam.y;
          ctx.fillStyle = EDGE_DARK;
          ctx.fillRect(Math.floor(cx - GAP_W / 2), y0, GAP_W, TILE);
          ctx.fillStyle = EDGE_DARKER;
          ctx.fillRect(Math.floor(cx - GAP_W / 6), y0, Math.ceil(GAP_W / 3), TILE);
          ctx.fillStyle = EDGE_LIP;
          ctx.fillRect(Math.floor(cx - GAP_W / 2) - 1, y0, 1, TILE);
          ctx.fillRect(Math.floor(cx + GAP_W / 2), y0, 1, TILE);
        }
      }
      for (let yb = Math.max(1, ys); yb <= Math.min(m.h - 1, ye); yb++) {
        for (let x = xs; x <= xe; x++) {
          if (!m.edgesH[yb][x]) continue;
          const cy = yb * TILE - state.cam.y;
          const x0 = x * TILE - state.cam.x;
          ctx.fillStyle = EDGE_DARK;
          ctx.fillRect(x0, Math.floor(cy - GAP_W / 2), TILE, GAP_W);
          ctx.fillStyle = EDGE_DARKER;
          ctx.fillRect(x0, Math.floor(cy - GAP_W / 6), TILE, Math.ceil(GAP_W / 3));
          ctx.fillStyle = EDGE_LIP;
          ctx.fillRect(x0, Math.floor(cy - GAP_W / 2) - 1, TILE, 1);
          ctx.fillRect(x0, Math.floor(cy + GAP_W / 2), TILE, 1);
        }
      }
  }

  for (const [key, tile] of poisonTiles.entries()) {
    const [x, y] = key.split(',').map(Number);
    if (x >= xs && x <= xe && y >= ys && y <= ye) {
        if (TEX.poison) {
            ctx.drawImage(TEX.poison, x * TILE - state.cam.x, y * TILE - state.cam.y, TILE, TILE);
        }
    }
  }
  for (const [key, tile] of sandTiles.entries()) {
    const [x, y] = key.split(',').map(Number);
    if (x >= xs && x <= xe && y >= ys && y <= ye) {
        if (TEX.sand) {
            ctx.drawImage(TEX.sand, x * TILE - state.cam.x, y * TILE - state.cam.y, TILE, TILE);
        }
    }
  }
}

function drawNameTagAbove(name, level, frame, wx, wy, z, scale){
  if (!frame) return;
  const topWorldY = wy - frame.oy * scale - (z || 0);
  const sx = Math.round(wx - state.cam.x);
  const sy = Math.round(topWorldY - state.cam.y) - 8;

  ctx.font = '10px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  const levelText = `Lvl ${level}`;
  const levelY = sy - 14;
  ctx.strokeText(levelText, sx, levelY);
  ctx.fillStyle = "#ddd";
  ctx.fillText(levelText, sx, levelY);

  ctx.font = '12px "Press Start 2P", monospace';
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

function updateAbilityUI() {
    if (!state.ready || !abilityBtn) return;

    let text = "ABILITY";
    let currentAbility = localPlayer.config.ability;

    if (selectedKey === 'Smeargle' && state.copiedAbility) {
        currentAbility = state.copiedAbility;
        text = state.copiedAbility.name.toUpperCase();
    }

    if (abilityBtnText && abilityBtnText.textContent !== text) {
        abilityBtnText.textContent = text;
    }

    if (state.abilityCooldown > 0) {
        abilityBtn.disabled = true;
        abilityCooldownOverlay.textContent = Math.ceil(state.abilityCooldown);
        abilityCooldownOverlay.style.opacity = '1';
    } else {
        abilityBtn.disabled = false;
        abilityCooldownOverlay.style.opacity = '0';
    }
}


function updatePlayerHUD() {
    if (!state.ready || !net.auth.currentUser) {
        playerHudEl.innerHTML = '';
        return;
    }
    
    const character = state.isIllusion ? CHARACTERS[state.illusionTarget.character] : CHARACTERS[selectedKey];
    const username = state.isIllusion ? state.illusionTarget.username : localUsername;
    const level = state.isIllusion ? state.illusionTarget.level : state.level;

    playerHudEl.innerHTML = `
      <div class="player-card">
        <img class="portrait" src="${character.base + character.portrait}">
        <div class="info">
          <div class="username">Lvl ${level} ${username}</div>
          <div class="hp-bar-bg">
            <div class="hp-bar" style="width: ${ (state.hp / state.maxHp) * 100}%;"></div>
          </div>
          <div class="xp-bar-bg">
            <div class="xp-bar" style="width: ${ (state.xp / state.xpToNextLevel) * 100}%;"></div>
          </div>
        </div>
        <div class="coins">
          <img src="assets/coin.png" class="coin-icon">
          <span>${state.coins}</span>
        </div>
      </div>
    `;
}

function getRemotePlayerSmoothedPos(r) {
    if (!r.history || r.history.length < 2) {
        return { x: r.x, y: r.y };
    }

    const now = performance.now() / 1000;
    const RENDER_DELAY = 0.1;
    const renderTime = now - RENDER_DELAY;

    let before = null;
    let after = null;

    for (let i = r.history.length - 1; i >= 0; i--) {
        if (r.history[i].t <= renderTime) {
            before = r.history[i];
            after = r.history[i + 1];
            break;
        }
    }

    if (!before) {
        before = r.history[r.history.length - 2] || r.history[r.history.length - 1];
        after = r.history[r.history.length - 1];
    }
    
    if (!after) {
        return { x: before.x, y: before.y };
    }


    const timeDiff = after.t - before.t;
    if (timeDiff <= 0) {
        return { x: before.x, y: before.y };
    }

    const interpolationFactor = (renderTime - before.t) / timeDiff;

    const smoothedX = lerp(before.x, after.x, interpolationFactor);
    const smoothedY = lerp(before.y, after.y, interpolationFactor);

    return { x: smoothedX, y: smoothedY };
}


function update(dt){
  if (state.ready) {
      state.afkTimer += dt;
      if (state.afkTimer > AFK_TIMEOUT) {
          alert("You have been kicked for being idle.");
          goBackToSelect(true);
          return; // Stop the rest of the update
      }
  }

  if (keys.has(" ")) {
    tryStartHop();
    keys.delete(" ");
  }
  
  updateAbilityUI();

  if (keys.has("e")) {
      handleAbilityKeyPress();
      keys.delete("e");
  }
  
  if (state.invulnerableTimer > 0) {
    state.invulnerableTimer -= dt;
  }
  if (state.attackCooldown > 0) {
    state.attackCooldown -= dt;
  }
  if (state.abilityCooldown > 0) {
      state.abilityCooldown -= dt;
  }
  
  if (keys.has("j") || keys.has("J")) {
    tryMeleeAttack();
  }
  if (keys.has("k") || keys.has("K")) {
    tryRangedAttack();
  }

  const myConfig = CHARACTERS[selectedKey];
  let regenRate = 0;
  let regenInterval = Infinity;

  if (myConfig && myConfig.ability && myConfig.ability.type === 'passive' && myConfig.ability.name === 'regenerate') {
      regenRate = myConfig.ability.rate;
      regenInterval = myConfig.ability.interval;
  }
  if (state.equippedItem === 'quagsireScale') {
      regenRate += (selectedKey === 'Quagsire' ? 2 : 1);
      regenInterval = Math.min(regenInterval, 2);
  }

  if (regenRate > 0) {
      state.regenTimer += dt;
      if (state.regenTimer >= regenInterval) {
          state.regenTimer = 0;
          if (state.hp < state.maxHp) {
              state.hp = Math.min(state.maxHp, state.hp + regenRate);
              net.updateState({ hp: state.hp });
          }
      }
  }

  if (myConfig?.ability?.name === 'aquaShield') {
      if (state.aquaShieldCooldown > 0) {
          state.aquaShieldCooldown -= dt;
      } else if (!state.aquaShieldActive) {
          state.aquaShieldActive = true;
          state.aquaShieldTimer = myConfig.ability.duration;
          state.aquaShieldCooldown = myConfig.ability.cooldown;
      }
  }
  if (state.aquaShieldActive) {
      state.aquaShieldTimer -= dt;
      if (state.aquaShieldTimer <= 0) {
          state.aquaShieldActive = false;
      }
  }
  
  if (state.isPhasing) {
      state.phaseDamageTimer += dt;
      if (state.phaseDamageTimer >= 10) {
          state.phaseDamageTimer = 0;
          const damage = Math.floor(state.maxHp / 16);
          state.hp = Math.max(0, state.hp - damage);
          net.updateState({ hp: state.hp });
          if (state.hp <= 0) {
              goBackToSelect();
          }
      }
  }

  if (state.isAsleep) {
      state.sleepTimer -= dt;
      if (state.sleepTimer <= 0) {
          state.isAsleep = false;
          state.anim = 'stand';
          net.updateState({ isAsleep: false });
      }
  }

  if (state.rideBySlashActive) {
      state.rideBySlashTimer -= dt;
      if (state.rideBySlashTimer <= 0) {
          state.rideBySlashActive = false;
      }
  }
  if (state.toxicSprintActive) {
      state.toxicSprintTimer -= dt;
      if (state.toxicSprintTimer <= 0) {
          state.toxicSprintActive = false;
      } else {
          const tileX = Math.floor(state.x / TILE);
          const tileY = Math.floor(state.y / TILE);
          net.broadcastAbility({ name: 'toxicSprint', tileX, tileY });
          poisonTiles.set(`${tileX},${tileY}`, { life: 3 });
      }
  }

  for (const [key, tile] of poisonTiles.entries()) {
      tile.life -= dt;
      if (tile.life <= 0) {
          poisonTiles.delete(key);
      }
  }
  for (const [key, tile] of sandTiles.entries()) {
      tile.life -= dt;
      if (tile.life <= 0) {
          sandTiles.delete(key);
      }
  }

    const playerTileKey = `${Math.floor(state.x / TILE)},${Math.floor(state.y / TILE)}`;
    let isImmuneToGroundEffects = false;
    if (state.equippedItem === 'protectivePads') {
        isImmuneToGroundEffects = true;
    }
    
    if (poisonTiles.has(playerTileKey) && !state.isPoisoned && !isImmuneToGroundEffects) {
        state.isPoisoned = true;
        state.poisonTimer = 5;
        state.lastPoisonTick = 0;
    }

    if (state.isPoisoned) {
        state.poisonTimer -= dt;
        state.lastPoisonTick -= dt;

        if (state.lastPoisonTick <= 0) {
            state.hp = Math.max(0, state.hp - 2);
            net.updateState({ hp: state.hp });
            if (state.hp <= 0) goBackToSelect();
            state.lastPoisonTick = 1;
        }

        if (state.poisonTimer <= 0 || !poisonTiles.has(playerTileKey)) {
            state.isPoisoned = false;
        }
    }

    if (state.ghostCharmCooldown > 0) {
        state.ghostCharmCooldown -= dt;
    } else if (state.ghostCharmCharges < 1) {
        state.ghostCharmCharges = 1;
    }

    if (state.darkRoomActive) {
        state.darkRoomTimer -= dt;
        if (state.darkRoomTimer <= 0) {
            state.darkRoomActive = false;

            if (net.auth.currentUser.uid === net.currentLobbyOwner) {
                if (window.savedEnemies) {
                    net.setInitialEnemies(window.savedEnemies);
                    window.savedEnemies = null;
                }
            }
        }
    }
    if (state.isBubbled) {
        state.bubbleTimer -= dt;
        if (state.bubbleTimer <= 0) {
            state.isBubbled = false;
        }
    }
    if (state.isConfused) {
        state.confusionTimer -= dt;
        if (state.confusionTimer <= 0) {
            state.isConfused = false;
        }
    }
    for (const [id, effect] of activeEffects.entries()) {
        effect.timer -= dt;
        if (effect.timer <= 0) {
            activeEffects.delete(id);
        }
    }

    if (!state.isConfused) {
        for (const [id, effect] of activeEffects.entries()) {
            if (effect.name === 'confusionDance') {
                const dist = Math.hypot(state.x - effect.x, state.y - effect.y);
                if (dist < TILE * 3) {
                    state.isConfused = true;
                    state.confusionTimer = 3.0;
                }
            }
        }
    }

  const {vx, vy} = getInputVec();
  state.prevMoving = state.moving;
  state.moving = !!(vx || vy);

  if (!state.hopping && !state.attacking && !state.isAsleep){
    state.dir = vecToDir(vx, vy);
    if (state.moving){
      tryMove(dt, vx, vy);
      resetAfkTimer(); // --- AFK TIMER ---
    }
  }

  if (state.anim === 'hurt') {
    state.frameTime += dt;
    const tpf = 1 / HURT_FPS;
    const hurtFrames = CHARACTERS[selectedKey].hurt.framesPerDir;
    const frameOrder = [...Array(hurtFrames).keys()];
    while (state.frameTime >= tpf) {
      state.frameTime -= tpf;
      state.frameStep += 1;
    }
    if (state.frameStep >= frameOrder.length) {
      state.anim = state.moving ? 'walk' : 'stand';
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

    if (state.hop.t >= 1){
      state.hopping = false; state.anim = state.moving ? "walk" : "stand";
      state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;
    }
  } else if (state.attacking) {
    state.frameTime += dt;
    const tpf = 1 / ATTACK_FPS;
    const animData = (state.attackType === 'melee') ? CHARACTERS[selectedKey].attack : CHARACTERS[selectedKey].shoot;
    const attackFrames = animData.framesPerDir;

    while (state.frameTime >= tpf) {
      state.frameTime -= tpf;
      state.frameStep += 1;
    }

    if (state.frameStep >= attackFrames) {
      state.attacking = false;
      state.anim = 'stand';
      state.frameStep = 0;
    }
  } else if (state.isAsleep) {
    state.frameTime += dt;
    const tpf = 1 / SLEEP_FPS;
    const sleepFrames = CHARACTERS[selectedKey].sleep.framesPerDir;
    state.frameOrder = makePingPong(sleepFrames);
    while (state.frameTime >= tpf) {
        state.frameTime -= tpf;
        state.frameStep = (state.frameStep + 1) % state.frameOrder.length;
    }
  } else {
    if (state.moving){
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
  }

  const adj = resolvePlayerCollisions(state.x, state.y);
  state.x = adj.x;
  state.y = adj.y;
  updateCamera();

  if (state.sayTimer > 0){ state.sayTimer -= dt; if (state.sayTimer <= 0){ state.sayTimer = 0; state.say = null; } }
  if (state.typing){ chatTypingDots = (chatTypingDots + dt*3) % 3; }

  updateEnemies(dt);
  updateProjectiles(dt);
  updatePlayerProjectiles(dt);
  checkCoinCollision();
  checkHealthPackCollision();
  checkItemDropCollision();

  if (selectedKey && state.ready){
    _netAccum += dt; _heartbeat += dt;
    if (_netAccum >= NET_INTERVAL){
      _netAccum = 0;
      if (_hasMeaningfulChange() || _heartbeat >= 3){
        const payload = {
            x:state.x, y:state.y, dir:state.dir, anim:state.anim,
            character:selectedKey, typing: state.typing, hp: state.hp, level: state.level,
            isPhasing: state.isPhasing, isAsleep: state.isAsleep
        };
        net.updateState(payload);
        _lastSent = { ..._lastSent, ...payload };
        _heartbeat = 0;
      }
    }
  }
  updateQuestGiver(dt);
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
  
  const cam = state.cam;
  const canvasW = canvas.width;
  const canvasH = canvas.height;
  const cullMargin = TILE * 4;

  if ((state.map.type === 'plains' || state.map.type === 'forest') && state.map.trees) {
      for (const tree of state.map.trees) {
          if (tree.x * TILE >= cam.x - cullMargin && tree.x * TILE <= cam.x + canvasW + cullMargin &&
              tree.y * TILE >= cam.y - cullMargin && tree.y * TILE <= cam.y + canvasH + cullMargin) {
              
              const treeTexture = state.map.type === 'plains' ? TEX.palm_tree : TEX.pine_tree;

              actors.push({
                  kind: "tree",
                  x: tree.x * TILE + TILE / 2,
                  y: (tree.y + 1) * TILE,
                  tileX: tree.x,
                  tileY: tree.y,
                  src: treeTexture
              });
          }
      }
  }
  
  for (const enemy of enemies.values()) {
      if (enemy.x >= cam.x - cullMargin && enemy.x <= cam.x + canvasW + cullMargin &&
          enemy.y >= cam.y - cullMargin && enemy.y <= cam.y + canvasH + cullMargin) {
          actors.push({
              kind: "enemy",
              id: enemy.id,
              x: enemy.x,
              y: enemy.y,
          });
      }
  }
  
  for (const coin of coins.values()) {
      if (coin.x >= cam.x - cullMargin && coin.x <= cam.x + canvasW + cullMargin &&
          coin.y >= cam.y - cullMargin && coin.y <= cam.y + canvasH + cullMargin) {
          actors.push({
              kind: "coin",
              x: coin.x,
              y: coin.y,
              ...coin
          });
      }
  }
  
  for (const pack of healthPacks.values()) {
      if (pack.x >= cam.x - cullMargin && pack.x <= cam.x + canvasW + cullMargin &&
          pack.y >= cam.y - cullMargin && pack.y <= cam.y + canvasH + cullMargin) {
          actors.push({
              kind: "healthpack",
              x: pack.x,
              y: pack.y,
              ...pack
          });
      }
  }

  for (const itemDrop of droppedItems.values()) {
      if (itemDrop.x >= cam.x - cullMargin && itemDrop.x <= cam.x + canvasW + cullMargin &&
          itemDrop.y >= cam.y - cullMargin && itemDrop.y <= cam.y + canvasH + cullMargin) {
          actors.push({
              kind: "itemDrop",
              x: itemDrop.x,
              y: itemDrop.y,
              itemId: itemDrop.itemId
          });
      }
  }

  for (const r of remote.values()){
    const assets = (r.isIllusion && r.illusionAssets) ? r.illusionAssets : r.assets;
    if (!assets) continue;
    
    let meta, strip, frames, fps, order;
    
    let currentAnim = r.anim;
    if (r.isAsleep) currentAnim = 'sleep';
    
    switch(currentAnim) {
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
        case "sleep":
            meta = assets.meta.sleep;
            frames = assets.cfg.sleep.framesPerDir;
            fps = SLEEP_FPS;
            order = makePingPong(Math.max(frames, 1));
            break;
        case "stand":
            meta = assets.meta.idle;
            frames = 1;
            fps = IDLE_FPS;
            order = [0];
            break;
        case "idle":
            meta = assets.meta.idle;
            frames = assets.cfg.idle.framesPerDir;
            fps = IDLE_FPS;
            order = makePingPong(Math.max(frames, 1));
            break;
        default:
            meta = assets.meta.idle;
            frames = assets.cfg.idle.framesPerDir;
            fps = IDLE_FPS;
            order = makePingPong(Math.max(frames, 1));
            break;
    }
    
    strip = meta[r.dir] || meta.down || Object.values(meta)[0];
    if (!strip || !strip.length) continue;


    if ((r.anim !== "stand") || (r.anim === "idle" && r.idlePlaying)){
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
                r.anim === "sleep" ? assets.sleep :
                assets.idle;

    const smoothedPos = getRemotePlayerSmoothedPos(r);
    const smx = smoothedPos.x;
    const smy = smoothedPos.y;
    
    if (r.sayTimer > 0) r.sayTimer = Math.max(0, r.sayTimer - frameDt);
    else r.say = null;
    
    if (r.showHpBarTimer > 0) r.showHpBarTimer -= frameDt;

    const displayName = r.isIllusion ? r.illusionTarget.username : r.username;
    const displayLevel = r.isIllusion ? r.illusionTarget.level : r.level;

    actors.push({
      kind:"remote", uid: r.uid, name: displayName || "player",
      x:smx, y:smy, z:r.z, frame:f, src, scale:r.scale,
      typing:r.typing, say:r.say, sayTimer:r.sayTimer, level: displayLevel,
      isPhasing: r.isPhasing,
      isHighlighted: state.highlightedPlayers.includes(r.uid)
    });
  }

  const lf = currentFrame();
  if (state.ready && lf){
    const z = state.hopping ? state.hop.z : (state.isFlying ? TILE * 1.5 : 0);
    const src = state.anim === "hop" ? state.hopImg :
                (state.anim === "walk" ? state.walkImg :
                (state.anim === "hurt" ? state.hurtImg :
                (state.anim === "attack" ? state.attackImg :
                (state.anim === "shoot" ? state.shootImg :
                (state.anim === "sleep" ? state.sleepImg : state.idleImg)))));
                
    const displayName = state.isIllusion ? state.illusionTarget.username : localUsername;
    const displayLevel = state.isIllusion ? state.illusionTarget.level : state.level;

    actors.push({
      kind:"local", name: displayName || "you",
      x:state.x, y:state.y, z, frame:lf, src, scale:state.scale,
      typing: state.typing, say: state.say, sayTimer: state.sayTimer, level: displayLevel,
      isPhasing: state.isPhasing
    });
  }

  actors.push({
    kind:"questGiver", x: questGiver.x, y: questGiver.y
  });

  actors.sort((a,b)=> a.y - b.y);
  
  for (const a of actors){
    if (a.kind === 'questGiver') {
        drawQuestGiver();
        continue;
    }
    if (a.kind === 'tree') {
        if(a.src) {
            let treeWidth, treeHeight, dy;
            const dx = a.tileX * TILE - state.cam.x - ( (TILE * 2) - TILE) / 2; // Center the 2-tile wide sprite

            if (state.map.type === 'forest') {
                treeWidth = TILE * 2;
                treeHeight = TILE * 4;
                dy = (a.tileY - 3) * TILE - state.cam.y; // Offset for tall pine tree
            } else { // Plains Palm Tree
                treeWidth = TILE * 2;
                treeHeight = TILE * 1;
                dy = (a.tileY) * TILE - state.cam.y; // Offset for 1-tile high palm tree
            }

            ctx.drawImage(a.src, dx, dy, treeWidth, treeHeight);
        }
        continue;
    }
    if (a.kind === 'enemy') {
        const enemy = enemies.get(a.id);
        if (enemy) {
            drawShadow(enemy.x, enemy.y, 0, 3.0, false);
            const isHighlighted = state.abilityTargetingMode === 'bubble';
            enemy.draw(ctx, state.cam, isHighlighted);
            const sx = Math.round(enemy.x - state.cam.x);
            const sy = Math.round(enemy.y - state.cam.y);
            const hpw = 30, hph = 5;
            const hpx = sx - hpw/2, hpy = sy - ENEMY_R - 10;
            ctx.fillStyle = '#333';
            ctx.fillRect(hpx, hpy, hpw, hph);
            ctx.fillStyle = '#f44';
            ctx.fillRect(hpx, hpy, hpw * (enemy.hp / enemy.maxHp), hph);
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(hpx, hpy, hpw, hph);
        }
        continue;
    }
    
    if (a.kind === 'coin') {
        if (TEX.coin) {
            const dw = TEX.coin.width * COIN_SCALE;
            const dh = TEX.coin.height * COIN_SCALE;
            const dx = a.x - state.cam.x - dw / 2;
            const dy = a.y - state.cam.y - dh / 2;

            ctx.save();
            ctx.drawImage(TEX.coin, dx, dy, dw, dh);
            
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = 'rgba(255, 223, 0, 0.5)';
            ctx.fillRect(dx, dy, dw, dh);
            ctx.restore();
        }
        continue;
    }
    
    if (a.kind === 'healthpack') {
        if(TEX.health) {
            const dw = TEX.health.width * COIN_SCALE;
            const dh = TEX.health.height * COIN_SCALE;
            ctx.drawImage(
                TEX.health,
                a.x - state.cam.x - dw / 2,
                a.y - state.cam.y - dh / 2,
                dw, dh
            );
        }
        continue;
    }
  
    if (a.kind === 'itemDrop') {
        const itemData = SHOP_ITEMS[a.itemId];
        if (itemData && itemData.icon) {
            const img = new Image();
            img.src = itemData.icon;
            if (img.complete) {
                const iconSize = 32;
                const dx = a.x - state.cam.x - iconSize / 2;
                const dy = a.y - state.cam.y - iconSize / 2;
                
                ctx.save();
                ctx.shadowColor = 'yellow';
                ctx.shadowBlur = 15;
                ctx.drawImage(img, dx, dy, iconSize, iconSize);
                ctx.restore();
            }
        }
        continue;
    }

    const f = a.frame, scale = a.scale;
    if (!f || !a.src) continue;

    const dw = f.sw * scale, dh = f.sh * scale;
    const dx = Math.round(a.x - f.ox * scale - state.cam.x);
    const dy = Math.round(a.y - f.oy * scale - state.cam.y - a.z);

    const overGap = isOverGapWorld(a.x, a.y);
    drawShadow(a.x, a.y, a.z, a.scale, overGap);
    
    ctx.save();

    if ((a.kind === 'local' && state.invulnerableTimer > 0) || a.isPhasing) {
        ctx.globalAlpha = (Math.floor(performance.now() / 80) % 2 === 0) ? 0.4 : 0.8;
    }

    const filters = [];
    if (state.playerViewMode && (a.kind === 'local' || a.kind === 'remote')) {
        filters.push('drop-shadow(0 0 8px #aaddff) brightness(1.6)');
    }
    if (a.isHighlighted) {
        filters.push('drop-shadow(0 0 8px #ffffaa) brightness(1.5)');
    }
    if (state.abilityTargetingMode === 'bubble' && a.kind === 'remote' && a.uid !== net.auth.currentUser.uid) {
        filters.push('drop-shadow(0 0 10px #6495ED) brightness(1.6)');
    }
    if (filters.length > 0) {
        ctx.filter = filters.join(' ');
    }

    ctx.drawImage(a.src, f.sx, f.sy, f.sw, f.sh, dx, dy, dw, dh);

    ctx.restore();

    const actorObject = a.kind === 'local' ? state : remote.get(a.uid);
    if (actorObject && actorObject.isBubbled) {
        const bubbleX = Math.round(a.x - state.cam.x);
        const bubbleY = Math.round(a.y - f.oy * scale / 2 - state.cam.y - a.z);
        const bubbleR = Math.max(dw, dh) * 0.6;

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#87CEEB";
        ctx.beginPath();
        ctx.arc(bubbleX, bubbleY, bubbleR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    const isAquaShielded = (a.kind === 'local' && state.aquaShieldActive) || (a.kind === 'remote' && remote.get(a.uid)?.aquaShieldActive);
    if (isAquaShielded) {
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(a.x - state.cam.x, a.y - state.cam.y, PLAYER_R * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(50, 150, 255, 0.5)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(150, 200, 255, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }
    
    drawNameTagAbove(a.name, a.level, f, a.x, a.y, a.z, a.scale);

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
  
  for (const p of projectiles) {
      ctx.beginPath();
      ctx.arc(p.x - state.cam.x, p.y - state.cam.y, PROJECTILE_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 165, 0, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
  }
  for (const p of playerProjectiles) {
      ctx.fillStyle = p.color || '#FFFF00';
      ctx.fillRect(Math.round(p.x - state.cam.x - 4), Math.round(p.y - state.cam.y - 4), 8, 8);
  }

    for (const effect of activeEffects.values()) {
        if (effect.name === 'confusionDance') {
            let caster = null;
            if (effect.by === net.auth.currentUser.uid) {
                caster = state;
            } else {
                caster = remote.get(effect.by);
            }

            if (caster) {
                const angle = (performance.now() / 150) % (Math.PI * 2);
                const radius = TILE * 1.5;
                ctx.fillStyle = 'rgba(255, 105, 180, 0.7)';
                
                const x1 = caster.x - state.cam.x + Math.cos(angle) * radius;
                const y1 = caster.y - state.cam.y + Math.sin(angle) * radius;
                ctx.beginPath();
                ctx.arc(x1, y1, 10, 0, Math.PI * 2);
                ctx.fill();
                
                const x2 = caster.x - state.cam.x + Math.cos(angle + Math.PI) * radius;
                const y2 = caster.y - state.cam.y + Math.sin(angle + Math.PI) * radius;
                ctx.beginPath();
                ctx.arc(x2, y2, 10, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    if (state.darkRoomActive) {
        ctx.save();
        if (state.isDarkRoomCaster) {
            const sx = Math.round(state.x - state.cam.x);
            const sy = Math.round(state.y - state.cam.y);
            const gradient = ctx.createRadialGradient(sx, sy, TILE * 2, sx, sy, TILE * 4);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = 'black';
        }
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        const lf = currentFrame();
        if (lf) {
            const z = state.hopping ? state.hop.z : (state.isFlying ? TILE * 1.5 : 0);
            const src = state.anim === "hop" ? state.hopImg :
                        (state.anim === "walk" ? state.walkImg :
                        (state.anim === "hurt" ? state.hurtImg :
                        (state.anim === "attack" ? state.attackImg :
                        (state.anim === "shoot" ? state.shootImg :
                        (state.anim === "sleep" ? state.sleepImg : state.idleImg)))));
            const dw = lf.sw * state.scale;
            const dh = lf.sh * state.scale;
            const dx = Math.round(state.x - lf.ox * state.scale - state.cam.x);
            const dy = Math.round(state.y - lf.oy * state.scale - state.cam.y - z);
            ctx.drawImage(src, lf.sx, lf.sy, lf.sw, lf.sh, dx, dy, dw, dh);
        }
    }

  if (state.abilityTargetingMode === 'sandSnare' && state.mouseTile.x !== null) {
      ctx.fillStyle = 'rgba(255, 223, 150, 0.4)';
      for (let y = -1; y <= 1; y++) {
          for (let x = -1; x <= 1; x++) {
              const tileX = (state.mouseTile.x + x) * TILE - state.cam.x;
              const tileY = (state.mouseTile.y + y) * TILE - state.cam.y;
              ctx.fillRect(tileX, tileY, TILE, TILE);
          }
      }
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
    const enemyTypes = {
        'dungeon': { Turret: 0.5, Brawler: 0.4, WeepingAngel: 0.1 },
        'plains':  { Turret: 0.4, Brawler: 0.5, WeepingAngel: 0.1 },
        'forest':  { Turret: 0.3, Brawler: 0.55, WeepingAngel: 0.15 }
    };
    const configs = {
        Turret:       { hp: 50, speed: 0,      damage: 10, detectionRange: TILE * 7,  attackRange: 0,      projectileSpeed: TILE * 5 },
        Brawler:      { hp: 80, speed: TILE * 1, damage: 15, detectionRange: TILE * 8,  attackRange: TILE * 1.2 },
        WeepingAngel: { hp: 100,speed: TILE * 2.5, damage: 25, detectionRange: TILE * 15, attackRange: TILE * 1 }
    };

    const weights = enemyTypes[map.type] || enemyTypes['dungeon'];
    const enemyRng = mulberry32(map.seed);
    const maxEnemies = Math.floor((map.w * map.h) / 200);
    
    const validSpawns = [];
    for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            if (!map.walls[y][x]) {
                const distToPlayer = Math.hypot(x - map.spawn.x, y - map.spawn.y);
                if (distToPlayer > 10) {
                    validSpawns.push({ x, y });
                }
            }
        }
    }
    for (let i = validSpawns.length - 1; i > 0; i--) {
        const j = Math.floor(enemyRng() * (i + 1));
        [validSpawns[i], validSpawns[j]] = [validSpawns[j], validSpawns[i]];
    }
    
    const enemiesData = {};
    let spawnedCount = 0;

    while(spawnedCount < maxEnemies && validSpawns.length > 0) {
        const pos = validSpawns.pop();
        const id = `enemy_${spawnedCount}`;
        const worldPos = tileCenter(pos.x, pos.y);
        
        let rand = enemyRng();
        let typeToSpawn = 'Turret';
        for (const [type, weight] of Object.entries(weights)) {
            if (rand < weight) {
                typeToSpawn = type;
                break;
            }
            rand -= weight;
        }

        enemiesData[id] = {
            id, type: typeToSpawn,
            x: worldPos.x, y: worldPos.y,
            config: configs[typeToSpawn]
        };
        spawnedCount++;
    }
    
    net.setInitialEnemies(enemiesData).catch(e => console.error("Failed to set initial enemies", e));
}
function spawnCoins(map) {
    coins.clear();
    const coinRng = mulberry32(map.seed + 1);
    let spawned = 0;
    const maxCoins = Math.floor((map.w * map.h) / 100);
    const validSpawns = [];
     for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            if (!map.walls[y][x]) {
                validSpawns.push({ x, y });
            }
        }
    }
    for (let i = validSpawns.length - 1; i > 0; i--) {
        const j = Math.floor(coinRng() * (i + 1));
        [validSpawns[i], validSpawns[j]] = [validSpawns[j], validSpawns[i]];
    }

    const coinsData = {};

    for (const pos of validSpawns) {
        if (spawned >= maxCoins) break;
        const id = `coin_${spawned}`;
        const worldPos = tileCenter(pos.x, pos.y);
        coinsData[id] = { id, x: worldPos.x, y: worldPos.y };
        spawned++;
    }

    net.setInitialCoins(coinsData).catch(e => console.error("Failed to set initial coins", e));
}

function spawnHealthPacks(map) {
    healthPacks.clear();
    const healthPackRng = mulberry32(map.seed + 2);
    let spawned = 0;
    const maxHealthPacks = Math.floor((map.w * map.h) / 400);
    const validSpawns = [];
    for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            if (!map.walls[y][x]) {
                validSpawns.push({ x, y });
            }
        }
    }
    for (let i = validSpawns.length - 1; i > 0; i--) {
        const j = Math.floor(healthPackRng() * (i + 1));
        [validSpawns[i], validSpawns[j]] = [validSpawns[j], validSpawns[i]];
    }

    const healthPacksData = {};

    for (const pos of validSpawns) {
        if (spawned >= maxHealthPacks) break;
        const id = `healthpack_${spawned}`;
        const worldPos = tileCenter(pos.x, pos.y);
        healthPacksData[id] = { id, x: worldPos.x, y: worldPos.y };
        spawned++;
    }

    net.setInitialHealthPacks(healthPacksData).catch(e => console.error("Failed to set initial health packs", e));
}


function updateEnemies(dt) {
    if (!state.ready) return;

    if (net.auth.currentUser?.uid !== net.currentLobbyOwner) return;

    for (const enemy of enemies.values()) {
        enemy.isConfused = false;
        for (const effect of activeEffects.values()) {
            if (effect.name === 'confusionDance') {
                const dist = Math.hypot(enemy.x - effect.x, enemy.y - effect.y);
                if (dist < TILE * 3) {
                    enemy.isConfused = true;
                    break; 
                }
            }
        }
    }
    
    state.weepingAngelSpawnTimer -= dt;
    if (state.weepingAngelSpawnTimer <= 0) {
        state.weepingAngelSpawnTimer = 20 + Math.random() * 20;
        
        const validSpawns = [];
        for (let y = 1; y < state.map.h - 1; y++) {
            for (let x = 1; x < state.map.w - 1; x++) {
                if (!state.map.walls[y][x]) {
                    validSpawns.push({ x, y });
                }
            }
        }

        if (validSpawns.length > 0) {
            const pos = validSpawns[Math.floor(Math.random() * validSpawns.length)];
            const id = `enemy_angel_${Date.now()}`;
            const worldPos = tileCenter(pos.x, pos.y);
            const angelConfig = { hp: 100, speed: TILE * 2.5, damage: 25, detectionRange: TILE * 15, attackRange: TILE * 1 };
            
            const angelData = {
                id, type: 'WeepingAngel',
                x: worldPos.x, y: worldPos.y,
                config: angelConfig
            };
            
            net.spawnNewEnemy(angelData);
        }
    }

    const allPlayers = [{ id: net.auth.currentUser.uid, x: state.x, y: state.y, isPhasing: state.isPhasing, isFlying: state.isFlying, dir: state.dir }];
    remote.forEach(p => allPlayers.push({ id: p.uid, x: p.x, y: p.y, isPhasing: p.isPhasing, isFlying: p.isFlying, dir: p.dir }));

    for (const enemy of enemies.values()) {
        enemy.update(dt, allPlayers, state.map, net);
        
        const targetId = enemy.target ? enemy.target.id : null;
        net.updateEnemyState(enemy.id, { x: enemy.x, y: enemy.y, hp: enemy.hp, targetId: targetId });
        
        if (enemy.isDefeated) {
            net.removeEnemy(enemy.id);
        }
    }
}
function updateProjectiles(dt) {
    if (!state.ready) return;
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (!p) {
            projectiles.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        if (p.life <= 0) {
            projectiles.splice(i, 1);
            continue;
        }
        
        if (state.invulnerableTimer <= 0 && !state.isPhasing && !state.isFlying) {
            const dist = Math.hypot(p.x - state.x, p.y - state.y);
            if (dist < PLAYER_R + PROJECTILE_R) {
                if (state.isBubbled) {
                    state.isBubbled = false;
                    net.broadcastAbility({ name: 'popBubble', targetId: net.auth.currentUser.uid });
                }
                state.hp = Math.max(0, state.hp - p.damage);
                state.invulnerableTimer = 0.7;
                state.anim = 'hurt';
                state.frameStep = 0;
                state.frameTime = 0;
                projectiles.splice(i, 1);
                net.updateState({ hp: state.hp });
                if (state.hp <= 0) {
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
        
        const removeCurrentProjectile = () => {
            playerProjectiles[i] = playerProjectiles[playerProjectiles.length - 1];
            playerProjectiles.pop();
        };

        if (!p) {
            removeCurrentProjectile();
            continue;
        }

        if (p.homing && p.targetId) {
            const target = enemies.get(p.targetId);
            if (target) {
                const projectileSpeed = TILE * 8;
                const dx = target.x - p.x;
                const dy = target.y - p.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 1) {
                    p.vx = (dx / dist) * projectileSpeed;
                    p.vy = (dy / dist) * projectileSpeed;
                }
            } else {
                p.homing = false;
                p.targetId = null;
            }
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;

        if (p.life <= 0) {
            removeCurrentProjectile();
            continue;
        }

        if (p.ownerId === net.auth.currentUser.uid) {
            let hit = false;
            
            for (const enemy of enemies.values()) {
                if (enemy.hp <= 0) continue;

                const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
                if (dist < ENEMY_R + PROJECTILE_R) {
                   if (enemy.isBubbled) {
                       net.broadcastAbility({ name: 'popBubbleEnemy', targetId: enemy.id });
                   }
                   const newHp = enemy.takeDamage(p.damage, selectedKey);
                    addXp(10);
                    if (newHp <= 0) {
                        handleEnemyDefeat(enemy);
                    } else {
                        net.updateEnemyState(enemy.id, { hp: newHp }).catch(e => console.error("Failed to update enemy HP", e));
                    }
                    if (state.equippedItem === 'shellBell' && state.hp < state.maxHp) {
                        let healAmount = Math.floor(p.damage * 0.05);
                        if (selectedKey === 'Chandelure') healAmount *= 2;
                        state.hp = Math.min(state.maxHp, state.hp + healAmount);
                        net.updateState({ hp: state.hp });
                    }
                    hit = true;
                    break;
                }
            }

            if (hit) {
                removeCurrentProjectile();
                continue;
            }

            for (const [uid, player] of remote.entries()) {
                if (player.isPhasing) continue;
                const smoothedPos = getRemotePlayerSmoothedPos(player);
                const dist = Math.hypot(p.x - smoothedPos.x, p.y - smoothedPos.y);
                if (dist < PLAYER_R + PROJECTILE_R) {
                    if (player.isBubbled) {
                        net.broadcastAbility({ name: 'popBubble', targetId: uid });
                    }
                    const isKill = (player.hp - p.damage) <= 0;
                    if(isKill) {
                        addXp(100);
                        net.incrementKillCount('player');
                        state.playerKills++;
                    }
                    net.dealDamage(uid, p.damage, isKill).catch(e => console.error("Deal damage failed", e));
                    if (state.equippedItem === 'shellBell' && state.hp < state.maxHp) {
                        let healAmount = Math.floor(p.damage * 0.05);
                        if (selectedKey === 'Chandelure') healAmount *= 2;
                        state.hp = Math.min(state.maxHp, state.hp + healAmount);
                        net.updateState({ hp: state.hp });
                    }
                    hit = true;
                    break;
                }
            }

            if (hit) {
                removeCurrentProjectile();
            }
        }
    }
}

function handleEnemyDefeat(enemy) {
    addXp(50);
    net.removeEnemy(enemy.id).catch(e => console.error("Failed to remove enemy", e));
    net.incrementKillCount('enemy');
    state.enemyKills++;

    if (enemy.isBubbled) {
        net.broadcastAbility({ name: 'popBubbleEnemy', targetId: enemy.id });
    }

    const ITEM_DROP_CHANCE = 0.15;
    const COIN_DROP_CHANCE = 0.80;

    if (Math.random() < ITEM_DROP_CHANCE) {
        const itemList = Object.keys(SHOP_ITEMS);
        const randomItemId = itemList[Math.floor(Math.random() * itemList.length)];
        const dropId = `drop_${Date.now()}_${Math.random()}`;
        
        net.createItemDrop(dropId, {
            itemId: randomItemId,
            x: enemy.x,
            y: enemy.y,
        });
    } 
    
    if (Math.random() < COIN_DROP_CHANCE) {
        const coinAmount = Math.floor(Math.random() * 10) + 5;
        state.coins += coinAmount;
        net.updatePlayerStats({ coins: coinAmount });
    }

    if (state.currentQuest && state.currentQuest.active) {
        const quest = state.currentQuest;
        if (quest.type === 'killEnemies' || quest.type === 'clearZone') {
            quest.progress++;
        }
        if (quest.type === 'killBrawlers' && enemy.constructor.name === 'Brawler') {
            quest.progress++;
        }
        if (quest.type === 'killTurrets' && enemy.constructor.name === 'Turret') {
            quest.progress++;
        }
        if (quest.type === 'killAngels' && enemy.constructor.name === 'WeepingAngel') {
            quest.progress++;
        }
    }
}

async function checkItemDropCollision() {
    if (!state.ready) return;
    const ITEM_PICKUP_R = 16;

    for (const [id, itemDrop] of droppedItems.entries()) {
        const dist = Math.hypot(state.x - itemDrop.x, state.y - itemDrop.y);
        if (dist < PLAYER_R + ITEM_PICKUP_R) {
            const item = { id: itemDrop.itemId, ...SHOP_ITEMS[itemDrop.itemId] };
            
            item.price = 0;
            await net.purchaseItem(item);
            
            const stats = await net.getUserStats();
            state.inventory = stats.inventory;
            updateInventoryUI();

            sfx.heal.play(0.8);

            net.removeItemDrop(id);
        }
    }
}

function checkCoinCollision() {
    if (!state.ready) return;
    for (const [id, coin] of coins.entries()) {
        const dist = Math.hypot(state.x - coin.x, state.y - coin.y);
        if (dist < PLAYER_R + COIN_R) {
            let coinValue = 1;
            if (state.equippedItem === 'sableyeGem') {
                coinValue = (selectedKey === 'Sableye' ? 4 : 2);
            }
            state.coins += coinValue;
            net.updatePlayerStats({ coins: coinValue });
            net.removeCoin(id);
            sfx.coin.play();
            if (state.currentQuest && state.currentQuest.active && state.currentQuest.type === 'collectCoins') {
                state.currentQuest.progress++;
            }
        }
    }
}

function checkHealthPackCollision() {
    if (!state.ready || state.hp >= state.maxHp) return;
    for (const [id, pack] of healthPacks.entries()) {
        const dist = Math.hypot(state.x - pack.x, state.y - pack.y);
        if (dist < PLAYER_R + HEALTH_PACK_R) {
            state.hp = Math.min(state.maxHp, state.hp + 50);
            net.updateState({ hp: state.hp });
            net.removeHealthPack(id);
            sfx.heal.play();
        }
    }
}


function addXp(amount) {
    state.xp += amount;
    net.updatePlayerStats({ xp: amount });

    while (state.xp >= state.xpToNextLevel) {
        state.level++;
        state.xp -= state.xpToNextLevel;
        state.xpToNextLevel = Math.floor(100 * Math.pow(1.2, state.level - 1));
        net.updatePlayerStats({ level: state.level, xpSet: state.xp });
    }
}

function tryMeleeAttack() {
    if (!state.ready || state.attacking || state.attackCooldown > 0 || state.isAsleep || state.isBubbled) return;
    resetAfkTimer();

    state.attacking = true;
    state.attackType = 'melee';
    state.anim = 'attack';
    state.frameStep = 0;
    state.frameTime = 0;
    state.attackCooldown = 0.5;

    net.performMeleeAttack().catch(e => console.error("Failed to broadcast melee attack", e));

    const attackRange = TILE * 1.5;
    const characterConfig = CHARACTERS[selectedKey];
    let damage = characterConfig.strength || 15;

    let critChance = 0;
    if (state.equippedItem === 'scopeLens') {
        critChance = (selectedKey === 'Decidueye') ? 0.25 : 0.10;
    }
    if (Math.random() < critChance) {
        damage *= 1.5;
    }

    if (state.rideBySlashActive) {
        damage *= 2;
        state.rideBySlashActive = false;
    }

    for (const enemy of enemies.values()) {
        if (enemy.hp <= 0) continue;

        const dist = Math.hypot(state.x - enemy.x, state.y - enemy.y);
        if (dist < attackRange && isFacing(state, enemy)) {
             if (enemy.isBubbled) {
                net.broadcastAbility({ name: 'popBubbleEnemy', targetId: enemy.id });
             }
             enemy.takeDamage(damage, selectedKey);
            addXp(10);
            if (state.equippedItem === 'shellBell' && state.hp < state.maxHp) {
                let healAmount = Math.floor(damage * 0.05);
                if (selectedKey === 'Chandelure') healAmount *= 2;
                state.hp = Math.min(state.maxHp, state.hp + healAmount);
                net.updateState({ hp: state.hp });
            }
            if (enemy.hp <= 0) {
                handleEnemyDefeat(enemy);
            } else {
                net.updateEnemyState(enemy.id, { hp: enemy.hp }).catch(e => console.error("Failed to update enemy HP", e));
            }
        }
    }

    for (const [uid, player] of remote.entries()) {
        if (player.isPhasing) continue;
        const smoothedPos = getRemotePlayerSmoothedPos(player);
        const dist = Math.hypot(state.x - smoothedPos.x, state.y - smoothedPos.y);
        if (dist < attackRange && isFacing(state, { x: smoothedPos.x, y: smoothedPos.y })) {
            if (player.isBubbled) {
                net.broadcastAbility({ name: 'popBubble', targetId: uid });
            }
            const isKill = (player.hp - damage) <= 0;
            if(isKill) {
                addXp(100);
                net.incrementKillCount('player');
                state.playerKills++;
            }
            net.dealDamage(uid, damage, isKill).catch(e => console.error("Deal damage failed", e));
            if (state.equippedItem === 'shellBell' && state.hp < state.maxHp) {
                let healAmount = Math.floor(damage * 0.05);
                if (selectedKey === 'Chandelure') healAmount *= 2;
                state.hp = Math.min(state.maxHp, state.hp + healAmount);
                net.updateState({ hp: state.hp });
            }
        }
    }
}

function tryRangedAttack() {
    const cfg = CHARACTERS[selectedKey];
    if (!state.ready || !cfg.ranged || state.attacking || state.attackCooldown > 0 || state.isAsleep || state.isBubbled) return;
    resetAfkTimer();

    state.attacking = true;
    state.attackType = 'ranged';
    state.anim = 'shoot';
    state.frameStep = 0;
    state.frameTime = 0;
    state.attackCooldown = 0.8;

    const baseProjectileSpeed = TILE * 8;
    const speedMultiplier = cfg.rangedSpeed || 1.0;
    const projectileSpeed = baseProjectileSpeed * speedMultiplier;

    let [vx, vy] = DIR_VECS[state.dir];
    let targetId = null;

    if (cfg.ability?.name === 'aimbot') {
        let closestEnemy = null;
        let minDistance = Infinity;
        for (const enemy of enemies.values()) {
            const dist = Math.hypot(enemy.x - state.x, enemy.y - state.y);
            if (dist < minDistance) {
                minDistance = dist;
                closestEnemy = enemy;
            }
        }
        if (closestEnemy) {
            targetId = closestEnemy.id;
            const dx = closestEnemy.x - state.x;
            const dy = closestEnemy.y - state.y;
            const dist = Math.hypot(dx, dy);
            vx = dx / dist;
            vy = dy / dist;
        }
    }

    const startY = state.y - (TILE * 0.5);
    
    let damage = cfg.rangedStrength || 20;

    let critChance = 0;
    if (state.equippedItem === 'scopeLens') {
        critChance = (selectedKey === 'Decidueye') ? 0.25 : 0.10;
    }
    if (Math.random() < critChance) {
        damage *= 1.5;
    }
    
    if (state.equippedItem === 'blastoiseBlaster' && selectedKey === 'Blastoise') {
        damage *= 2;
    }

    const fire = (offsetX = 0) => {
        const p_data = {
            x: state.x + offsetX,
            y: startY,
            vx: vx * projectileSpeed,
            vy: vy * projectileSpeed,
            damage: damage,
            life: 2.0,
            ownerId: net.auth.currentUser.uid,
            color: cfg.projectileColor || '#FFFF00',
            homing: cfg.ability?.name === 'aimbot',
            targetId: targetId
        };
        playerProjectiles.push(p_data);
        net.fireProjectile(p_data);
    };

    fire();
    if (state.equippedItem === 'blastoiseBlaster') {
        fire(5);
    }
}

// ---------- ABILITY LOGIC ----------

async function handleAbilityKeyPress() {
    if (!localPlayer || (state.abilityCooldown > 0 && !state.isIllusion) || state.isBubbled) return;
    resetAfkTimer();

    if (state.equippedItem === 'ghostCharm') {
        useGhostCharm();
        return;
    }

    if (localPlayer instanceof Lopunny) {
        localPlayer.useAbility(tryStartSuperHop); 
    } else {
        localPlayer.useAbility();
    }
}

async function activateTargetedAbility(target) {
    if (!localPlayer) return;

    if (state.abilityTargetingMode === 'bubble') {
        state.abilityCooldown = localPlayer.config.ability.cooldown;
        net.broadcastAbility({ name: 'trapInBubble', target: target });
        
        // Apply the effect locally immediately for responsiveness
        if (target.type === 'enemy') {
            const enemy = enemies.get(target.id);
            if (enemy) { enemy.isBubbled = true; enemy.bubbleTimer = 5.0; }
        } else if (target.type === 'player') {
            const player = remote.get(target.id);
            if (player) { player.isBubbled = true; player.bubbleTimer = 5.0; }
        }
        return; // Exit after handling the bubble ability
    }
    
    let ability = localPlayer.config.ability;
    if (selectedKey === 'Smeargle' && state.copiedAbility) {
        ability = state.copiedAbility;
    }
    
    const result = localPlayer.useAbility(target);
    if (result && result.isIllusion) {
        await applyVisualChange(result.visualKey);
    } else if (result) {
        await applyCharacterChange(result);
    }

    if (ability) {
        state.abilityCooldown = ability.cooldown;
    }
}

async function applyCharacterChange(newKey) {
    selectedKey = newKey;
    const assets = await loadCharacterAssets(newKey);
    if (assets) {
        state.walkImg = assets.walk;
        state.idleImg = assets.idle;
        state.hopImg = assets.hop;
        state.hurtImg = assets.hurt;
        state.attackImg = assets.attack;
        state.shootImg = assets.shoot;
        state.sleepImg = assets.sleep;
        state.animMeta = assets.meta;
        state.maxHp = assets.cfg.hp;
        state.hp = Math.min(state.hp, state.maxHp);
        state.scale = assets.cfg.scale;

        const PlayerClass = characterClassMap[newKey] || Player;
        localPlayer = new PlayerClass(state, assets, net, sfx, newKey, gameContext, CHARACTERS);
    }
}

async function applyVisualChange(newKey) {
    const assets = await loadCharacterAssets(newKey);
    if (assets) {
        state.walkImg = assets.walk;
        state.idleImg = assets.idle;
        state.hopImg = assets.hop;
        state.hurtImg = assets.hurt;
        state.attackImg = assets.attack;
        state.shootImg = assets.shoot;
        state.sleepImg = assets.sleep;
        state.animMeta = assets.meta;
    }
}


function toggleFlight() {
    state.isFlying = !state.isFlying;
}

async function handleRemoteTransform(player, targetKey, isRevert = false) {
    player.character = targetKey;
    player.isTransformed = !isRevert;
    
    const keyToLoad = isRevert ? player.originalCharacterKey : targetKey;

    player.assets = await loadCharacterAssets(keyToLoad);
    if (player.assets) {
        player.maxHp = player.assets.cfg.hp;
        player.scale = player.assets.cfg.scale;
    }
}

async function handleRemoteIllusion(player, target) {
    player.isIllusion = true;
    player.illusionTarget = target;
    const illusionAssets = await loadCharacterAssets(target.character);
    if (illusionAssets) {
        player.illusionAssets = illusionAssets;
    }
}

async function handleRemoteRevertIllusion(player) {
    player.isIllusion = false;
    player.illusionTarget = null;
    player.illusionAssets = null;
    player.assets = await loadCharacterAssets(player.originalCharacterKey);
}

// ---------- Shop and Inventory Logic ----------
function openShop() {
    selectDailyShopItems();
    shopModal.classList.remove("hidden");
    populateShop();

    const countdownEl = document.getElementById("shop-countdown");
    if (shopCountdownInterval) clearInterval(shopCountdownInterval);

    shopCountdownInterval = setInterval(() => {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);

        const diff = tomorrow.getTime() - now.getTime();
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / 1000 / 60) % 60);
        const seconds = Math.floor((diff / 1000) % 60);

        countdownEl.textContent = 
            `${hours.toString().padStart(2, '0')}:` +
            `${minutes.toString().padStart(2, '0')}:` +
            `${seconds.toString().padStart(2, '0')}`;

    }, 1000);
}

function closeShop() {
    shopModal.classList.add("hidden");
    if (shopCountdownInterval) {
        clearInterval(shopCountdownInterval);
        shopCountdownInterval = null;
    }
}

function selectDailyShopItems() {
    const date = new Date();
    const dateSeed = parseInt(`${date.getFullYear()}${date.getMonth()}${date.getDate()}`);
    const dailyRng = mulberry32(dateSeed);

    const itemList = Object.keys(SHOP_ITEMS);
    const availableItems = {};

    for (let i = itemList.length - 1; i > 0; i--) {
        const j = Math.floor(dailyRng() * (i + 1));
        [itemList[i], itemList[j]] = [itemList[j], itemList[i]];
    }

    for (let i = 0; i < 4 && i < itemList.length; i++) {
        const key = itemList[i];
        availableItems[key] = SHOP_ITEMS[key];
    }
    
    dailyShopItems = availableItems;
}

function useGhostCharm() {
    if (state.equippedItem !== 'ghostCharm' || state.ghostCharmCooldown > 0 || state.ghostCharmCharges < 1) return;

    const dir = DIR_VECS[state.dir] || [0, 0];
    const targetX = state.x + dir[0] * TILE;
    const targetY = state.y + dir[1] * TILE;

    const targetTileX = Math.floor(targetX / TILE);
    const targetTileY = Math.floor(targetY / TILE);

    if (state.map.walls[targetTileY]?.[targetTileX]) {
        const originalPhasing = state.isPhasing;
        state.isPhasing = true;
        
        state.x = targetX;
        state.y = targetY;

        state.isPhasing = originalPhasing;

        state.ghostCharmCharges = 0;
        let cooldown = 15;
        if (selectedKey === 'Hisuian Zoroark') {
            cooldown = 5;
        }
        state.ghostCharmCooldown = cooldown;
        sfx.jump.play(0.5, 0.8);
    }
}

function populateShop() {
    shopItemsContainer.innerHTML = "";
    for (const [id, item] of Object.entries(dailyShopItems)) {
        const itemEl = document.createElement("div");
        itemEl.className = "shop-item";
        itemEl.innerHTML = `
            <img src="${item.icon}" alt="${item.name}" class="shop-item-icon">
            <h4>${item.name}</h4>
            <p>${item.description}</p>
            <p>Cost: ${item.price} coins</p>
            <button class="button8" data-item-id="${id}">Buy</button>
        `;
        shopItemsContainer.appendChild(itemEl);
    }
}

shopItemsContainer.addEventListener('click', async (e) => {
    if (e.target.tagName === 'BUTTON') {
        const itemId = e.target.dataset.itemId;
        const item = { id: itemId, ...SHOP_ITEMS[itemId] };
        if (state.coins >= item.price) {
            await net.purchaseItem(item);
            const stats = await net.getUserStats();
            state.coins = stats.coins;
            state.inventory = stats.inventory;
            updateInventoryUI();
        } else {
            alert("Not enough coins!");
        }
    }
});

function updateInventoryUI() {
    inventoryItemsContainer.innerHTML = "";
    for (const [itemId, count] of Object.entries(state.inventory)) {
        const item = SHOP_ITEMS[itemId];
        if (item) {
            const imgEl = document.createElement("img");
            imgEl.className = "inventory-item";
            imgEl.src = item.icon;
            imgEl.alt = item.name;
            imgEl.dataset.itemId = itemId;

            if (state.equippedItem === itemId) {
                imgEl.classList.add("equipped");
            }
            
            inventoryItemsContainer.appendChild(imgEl);
        }
    }
}

function handleEquipItem(e) {
    e.preventDefault();
    
    const now = performance.now();
    if (now - lastTapHandledTime < 300) return;
    lastTapHandledTime = now;

    const itemEl = e.target.closest('.inventory-item');
    if (itemEl) {
        const itemId = itemEl.dataset.itemId;
        if (state.equippedItem === itemId) {
            state.equippedItem = null;
        } else {
            state.equippedItem = itemId;
        }
        net.equipItem(state.equippedItem);
        updateInventoryUI();
    }
}

inventoryItemsContainer.addEventListener('click', handleEquipItem);
inventoryItemsContainer.addEventListener('touchend', handleEquipItem);


shopIcon.onclick = openShop;
closeShopBtn.onclick = closeShop;


// ---------- Init ----------
async function init() {
    await processCharacterData();
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
    if (state.isPhasing || state.isFlying) return true;
    if (map.type === 'plains') {
        const waterPokemon = ["Quagsire", "Empoleon", "Primarina", "Dewgong"];
        if (map.walls[ty][tx] === 2) {
            return waterPokemon.includes(selectedKey);
        }
    }
  return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && !map.walls[ty][tx];
}

function viewerAnimationLoop() {
    if (!viewerState.active) return;

    const dt = (performance.now() - (viewerState.lastTime || performance.now())) / 1000;
    viewerState.lastTime = performance.now();

    viewerCtx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
    
    const assets = viewerState.assets;
    if (assets) {
        const strip = assets.meta.walk?.downRight;
        if (strip && strip.length > 0) {
            viewerState.frameTime += dt;
            const tpf = 1 / WALK_FPS;
            while (viewerState.frameTime >= tpf) {
                viewerState.frameTime -= tpf;
                viewerState.frameStep = (viewerState.frameStep + 1) % viewerState.frameOrder.length;
            }

            const frameIdx = viewerState.frameOrder[viewerState.frameStep];
            const frame = strip[frameIdx];

            const scale = 3;
            const dw = frame.sw * scale;
            const dh = frame.sh * scale;
            const dx = (viewerCanvas.width / 2) - (frame.ox * scale);
            const dy = (viewerCanvas.height / 2) - (frame.oy * scale) + 10;

            viewerCtx.drawImage(assets.walk, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, dw, dh);
        }
    }

    viewerState.reqId = requestAnimationFrame(viewerAnimationLoop);
}

async function openPlayerViewer(actorData) {
    if (viewerState.active) {
        closePlayerViewer();
    }

    playerViewerModal.classList.remove("hidden");
    viewerStatsEl.innerHTML = `<h3>Loading Stats...</h3>`;
    
    const fullStats = actorData.isLocal ? {
        username: actorData.username,
        level: actorData.level,
        xp: actorData.xp,
        playerKills: actorData.playerKills,
        enemyKills: actorData.enemyKills,
    } : await net.getPublicUserData(actorData.uid);
    
    const charCfg = CHARACTERS[actorData.character];
    
    viewerStatsEl.innerHTML = `
        <h3>${fullStats.username}</h3>
        <p><strong>Level:</strong> ${fullStats.level}</p>
        <p><strong>XP:</strong> ${fullStats.xp}</p>
        <p><strong>Player Kills:</strong> ${fullStats.playerKills}</p>
        <p><strong>Enemy Kills:</strong> ${fullStats.enemyKills}</p>
        <p><strong>Equipped Item:</strong> ${actorData.equippedItem || 'None'}</p>
        <hr>
        <h3>${charCfg.name} Stats</h3>
        <p><strong>Ability:</strong> ${charCfg.ability?.name || 'None'}</p>
        <p><strong>HP:</strong> ${charCfg.hp}</p>
        <p><strong>Strength:</strong> ${charCfg.strength}</p>
        <p><strong>Ranged Strength:</strong> ${charCfg.ranged ? charCfg.rangedStrength : 'N/A'}</p>
        <p><strong>Speed Multiplier:</strong> ${charCfg.speed}</p>
    `;

    viewerState.assets = await loadCharacterAssets(actorData.character);
    if (viewerState.assets) {
        viewerState.frameOrder = makePingPong(viewerState.assets.cfg.walk.framesPerDir);
        viewerState.frameStep = 0;
        viewerState.frameTime = 0;
        viewerState.active = true;
        viewerState.lastTime = performance.now();
        viewerAnimationLoop();
    }
}

function closePlayerViewer() {
    if (!viewerState.active) return;
    
    playerViewerModal.classList.add("hidden");
    viewerState.active = false;
    if (viewerState.reqId) {
        cancelAnimationFrame(viewerState.reqId);
    }
    viewerState.assets = null;
    viewerState.reqId = null;
}

closeViewerBtn.onclick = closePlayerViewer;

// ===============================================
// =========== QUEST GIVER LOGIC =================
// ===============================================

// Get references to the modal elements
const questModalEl = document.getElementById('quest-modal');
const questTitleEl = document.getElementById('quest-title');
const questGiverDialogueEl = document.getElementById('quest-giver-dialogue');
const questDetailsEl = document.getElementById('quest-details');
const questTaskEl = document.getElementById('quest-task');
const questRewardEl = document.getElementById('quest-reward');
const questActionsEl = document.getElementById('quest-actions');
const questProgressEl = document.getElementById('quest-progress');
const questProgressTextEl = document.getElementById('quest-progress-text');
const questCompleteEl = document.getElementById('quest-complete');

// --- Main Update Function (called in the game loop) ---
function updateQuestGiver(dt) {
    if (!TEX.questGiver) return; // Don't run if the image isn't loaded

    const dist = Math.hypot(state.x - questGiver.x, state.y - questGiver.y);

    // --- Proximity Dialogue ---
    if (dist < questGiver.proximityRadius && !questGiver.hasSpoken && !state.currentQuest) {
        questGiver.dialogue = "Hey you! Over here!";
        questGiver.dialogueTimer = 4.0;
        questGiver.hasSpoken = true;
    } else if (dist > questGiver.proximityRadius + TILE && questGiver.hasSpoken) {
        // --- CHANGE: Check if the player has an active quest when leaving ---
        if (state.currentQuest && state.currentQuest.active) {
            questGiver.dialogue = "Do a good job out there."; // The new line for after accepting a quest.
        } else {
            questGiver.dialogue = "Fine, be that way!"; // The original line if no quest was accepted.
        }
        questGiver.dialogueTimer = 3.0;
        questGiver.hasSpoken = false; // Allow him to speak again if player returns
    }

    // --- Quest Completion Dialogue ---
    if (state.currentQuest?.active && state.currentQuest.progress >= state.currentQuest.goal) {
        if (dist < questGiver.interactionRadius) {
             questGiver.dialogue = "Looks like you did it! Let's see the proof.";
             questGiver.dialogueTimer = 5.0;
        }
    }

    if (questGiver.dialogueTimer > 0) {
        questGiver.dialogueTimer -= dt;
        if (questGiver.dialogueTimer <= 0) questGiver.dialogue = null;
    }

    // --- Hover Detection ---
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseWorldX = (lastMouseX - rect.left) * scaleX + state.cam.x;
    const mouseWorldY = (lastMouseY - rect.top) * scaleY + state.cam.y;

    const isHovered = mouseWorldX > questGiver.x - questGiver.w / 2 &&
                      mouseWorldX < questGiver.x + questGiver.w / 2 &&
                      mouseWorldY > questGiver.y - questGiver.h && // hitbox top
                      mouseWorldY < questGiver.y;                  // hitbox bottom

    questGiver.isHovered = isHovered;
    canvas.style.cursor = isHovered ? 'pointer' : 'default';
}

// --- Drawing Function (called in the draw loop) ---
function drawQuestGiver() {
    if (!TEX.questGiver) return;

    const img = TEX.questGiver;
    // Scale the image up slightly
    const scale = 0.06;
    const dw = img.width * scale;
    const dh = img.height * scale;

    // Center horizontally, baseline at the feet
    const dx = Math.round(questGiver.x - state.cam.x);
    const dy = Math.round(questGiver.y - state.cam.y);

    drawShadow(questGiver.x, questGiver.y, 0, 3.0, false);

    ctx.save();
    if (questGiver.isHovered) {
        ctx.filter = 'drop-shadow(0 0 8px #66aaff) brightness(1.3)';
    }

    if (questGiver.flip) {
        ctx.scale(-1, 1);
        ctx.drawImage(img, -dx - dw / 2, dy - dh, dw, dh);
    } else {
        ctx.drawImage(img, dx - dw / 2, dy - dh, dw, dh);
    }
    ctx.restore();

    if (questGiver.dialogue) {
        // --- FIX: Calculate the bubble position correctly ---
        // Create a mock frame object similar to what players use.
        // The 'oy' (offset y) property represents the distance from the baseline (feet) to the top of the sprite.
        const questGiverFrame = { oy: dh }; 
        
        // Pass this frame to the drawChatBubble function. It will now correctly place
        // the bubble just above the quest giver's head.
        drawChatBubble(questGiver.dialogue, false, questGiverFrame, questGiver.x, questGiver.y, 0, 1.0);
    }
}

// --- Modal Management ---
function openQuestModal() {
    const quest = state.currentQuest;

    // Case 1: Player has an active quest that is COMPLETED
    if (quest?.active && quest.progress >= quest.goal) {
        questTitleEl.textContent = "A Job Well Done!";
        questGiverDialogueEl.textContent = "Excellent work! Here is your reward, as promised.";
        questDetailsEl.classList.add('hidden');
        questActionsEl.classList.add('hidden');
        questProgressEl.classList.add('hidden');
        questCompleteEl.classList.remove('hidden');
    }
    // Case 2: Player has an active quest that is IN PROGRESS
    else if (quest?.active) {
        questTitleEl.textContent = "Quest in Progress";
        questGiverDialogueEl.textContent = "You're not done yet! Get back to it.";
        questDetailsEl.classList.add('hidden');
        questActionsEl.classList.add('hidden');
        questCompleteEl.classList.add('hidden');
        questProgressEl.classList.remove('hidden');
        questProgressTextEl.textContent = `${quest.progress} / ${quest.goal}`;
    }
    // Case 3: Player has NO quest, offer a new one
    else {
        const newQuest = QUEST_POOL[Math.floor(Math.random() * QUEST_POOL.length)];
        state.currentQuest = { ...newQuest, goal: newQuest.amount, progress: 0, active: false };
        
        questTitleEl.textContent = "A Proposition!";
        questGiverDialogueEl.textContent = newQuest.dialogue;
        questTaskEl.textContent = newQuest.taskText;
        questRewardEl.textContent = newQuest.rewardText;

        questDetailsEl.classList.remove('hidden');
        questActionsEl.classList.remove('hidden');
        questProgressEl.classList.add('hidden');
        questCompleteEl.classList.add('hidden');
    }

    questModalEl.classList.remove('hidden');
}

async function giveQuestReward(quest) {
    if (!quest) return;
    const reward = quest.reward;

    if (reward.type === 'levelUp') {
        const xpNeeded = (state.xpToNextLevel - state.xp) + 1;
        addXp(xpNeeded);
    } else if (reward.type === 'coins') {
        state.coins += reward.amount;
        net.updatePlayerStats({ coins: reward.amount });
    } else if (reward.type === 'multi') {
        let xpForLevels = 0;
        let currentLevel = state.level;
        let currentXp = state.xp;
        let currentXpToNext = state.xpToNextLevel;
        for (let i = 0; i < reward.levels; i++) {
            xpForLevels += currentXpToNext - currentXp;
            currentXp = 0;
            currentLevel++;
            currentXpToNext = Math.floor(100 * Math.pow(1.2, currentLevel - 1));
        }
        addXp(xpForLevels + 1);
        
        state.coins += reward.coins;
        net.updatePlayerStats({ coins: reward.coins });
    } else if (reward.type === 'randomItem') {
        const itemList = Object.keys(SHOP_ITEMS);
        const randomItemId = itemList[Math.floor(Math.random() * itemList.length)];
        const item = { id: randomItemId, ...SHOP_ITEMS[randomItemId] };
        
        item.price = 0;
        await net.purchaseItem(item);
        
        const stats = await net.getUserStats();
        state.inventory = stats.inventory;
        updateInventoryUI();
    }
    sfx.heal.play(0.8);
}

// --- Click Handlers for Modal Buttons ---
document.getElementById('accept-quest-btn').onclick = () => {
    if (state.currentQuest) state.currentQuest.active = true;
    questModalEl.classList.add('hidden');
};

document.getElementById('decline-quest-btn').onclick = () => {
    state.currentQuest = null; // Player declined, so forget the quest
    questModalEl.classList.add('hidden');
};

document.getElementById('close-progress-btn').onclick = () => {
    questModalEl.classList.add('hidden');
};

document.getElementById('claim-reward-btn').onclick = () => {
    giveQuestReward(state.currentQuest);
    state.currentQuest = null; // Quest is finished and reward is claimed
    questModalEl.classList.add('hidden');
};