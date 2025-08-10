// main.js — character select → lobby list → join/create → shared map play

import { Net, firebaseConfig } from "./net.js";
const net = new Net(firebaseConfig);

let localUsername = null;
let selectedKey = null;
let lobbyUnsub = null;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const overlaySelect  = document.getElementById("select");
const gridEl         = document.getElementById("charGrid");
const overlayLobbies = document.getElementById("lobbies");
const lobbyListEl    = document.getElementById("lobbyList");
const lobbyHintEl    = document.getElementById("lobbyHint");
const newLobbyNameEl = document.getElementById("newLobbyName");
const createLobbyBtn = document.getElementById("createLobbyBtn");
const refreshBtn     = document.getElementById("refreshLobbiesBtn");
const backBtn        = document.getElementById("backToSelectBtn");

// ------- Settings -------
const TILE = 48;
const MAP_SCALE = 3;
const SPEED = TILE * 2.6;
const WALK_FPS = 10, IDLE_FPS = 6, HOP_FPS = 12;
const IDLE_INTERVAL = 5;
const HOP_HEIGHT = Math.round(TILE * 0.55);
const BASELINE_NUDGE_Y = 0;

const GAP_W       = Math.round(TILE * 0.38);
const EDGE_DARK   = "#06161b";
const EDGE_DARKER = "#031013";
const EDGE_LIP    = "rgba(255,255,255,0.08)";

const TEX = { floor: null, wall: null };
loadImage("assets/background/floor.png").then(im => TEX.floor = im).catch(()=>{});
loadImage("assets/background/wall.png").then(im => TEX.wall  = im).catch(()=>{});

const CANVAS_W = 960, CANVAS_H = 640;
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

const keys = new Set();

const state = {
  x:0, y:0, dir:"down",
  moving:false, prevMoving:false,
  frameTime:0, frameStep:0, frameOrder: makePingPong(4),
  anim:"stand", idleAccum:0,
  scale:3,
  walkImg:null, idleImg:null, hopImg:null,
  animMeta:{walk:null, idle:null, hop:null},
  hopping:false,
  hop:{sx:0,sy:0,tx:0,ty:0,t:0,dur:0,z:0},
  map:null, cam:{x:0,y:0},
  ready:false,
  showGrid:false, showBoxes:false
};

// ------- SFX -------
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

// ------- Characters -------
function makeRowDirGrid() {
  return {
    down:{row:0,start:0}, downRight:{row:1,start:0}, right:{row:2,start:0}, upRight:{row:3,start:0},
    up:{row:4,start:0},   upLeft:{row:5,start:0},    left:{row:6,start:0},   downLeft:{row:7,start:0},
  };
}
const CHARACTERS = {
  sableye:{ name:"Sableye", base:"assets/Sableye/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:8, rows:4, framesPerDir:4, dirGrid:{
      down:{row:0,start:0}, downRight:{row:0,start:4}, right:{row:1,start:0}, upRight:{row:1,start:4},
      up:{row:2,start:0}, upLeft:{row:2,start:4}, left:{row:3,start:0}, downLeft:{row:3,start:4},
    }},
    idle:{sheet:"Idle-Anim.png", cols:2, rows:8, framesPerDir:2, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  ditto:{ name:"Ditto", base:"assets/Ditto/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:5, rows:8, framesPerDir:5, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:2, rows:8, framesPerDir:2, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  hisuianZoroark:{ name:"Hisuian Zoroark", base:"assets/Hisuian Zoroark/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  hypno:{ name:"Hypno", base:"assets/Hypno/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:8, rows:8, framesPerDir:8, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  mimikyu:{ name:"Mimikyu", base:"assets/Mimikyu/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  quagsire:{ name:"Quagsire", base:"assets/Quagsire/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:7, rows:8, framesPerDir:7, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  smeargle:{ name:"Smeargle", base:"assets/Smeargle/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:2, rows:8, framesPerDir:2, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  corviknight:{ name:"Corviknight", base:"assets/Corviknight/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:6, rows:8, framesPerDir:6, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  cacturne:{ name:"Cacturne", base:"assets/Cacturne/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:6, rows:8, framesPerDir:6, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  decidueye:{ name:"Decidueye", base:"assets/Decidueye/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  blaziken:{ name:"Blaziken", base:"assets/Blaziken/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:2, rows:8, framesPerDir:2, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  snorlax:{ name:"Snorlax", base:"assets/Snorlax/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:6, rows:8, framesPerDir:6, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  chandelure:{ name:"Chandelure", base:"assets/Chandelure/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:8, rows:8, framesPerDir:8, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:8, rows:8, framesPerDir:8, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  emoleon:{ name:"Empoleon", base:"assets/Empoleon/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  },
  jolteon:{ name:"Jolteon", base:"assets/Jolteon/", portrait:"portrait.png", scale:3,
    walk:{sheet:"walk.png", cols:4, rows:8, framesPerDir:4, dirGrid:makeRowDirGrid()},
    idle:{sheet:"Idle-Anim.png", cols:2, rows:8, framesPerDir:2, dirGrid:makeRowDirGrid()},
    hop:{sheet:"Hop-Anim.png",  cols:10,rows:8, framesPerDir:10, dirGrid:makeRowDirGrid()}
  }
};

// ------- Auth overlay wiring -------
const authEl   = document.getElementById("auth");
const formEl   = document.getElementById("authForm");
const userEl   = document.getElementById("authUser");
const passEl   = document.getElementById("authPass");
const toggleEl = document.getElementById("authToggle");
const titleEl  = document.getElementById("authTitle");
const errEl    = document.getElementById("authErr");

let authMode = "signup";
toggleEl.onclick = () => {
  authMode = authMode === "signup" ? "login" : "signup";
  titleEl.textContent = authMode === "signup" ? "Sign up" : "Log in";
  document.getElementById("authSubmit").textContent =
    authMode === "signup" ? "Create account" : "Log in";
  errEl.textContent = "";
};
formEl.addEventListener("submit", async (e)=>{
  e.preventDefault();
  errEl.textContent = "";
  const u = userEl.value.trim().toLowerCase();
  const p = passEl.value;
  if (!/^[a-z0-9_]{3,16}$/.test(u)) { errEl.textContent = "3–16 chars a–z, 0–9, _"; return; }
  try{ if (authMode === "signup") await net.signUp(u, p); else await net.logIn(u, p); }
  catch (err){ errEl.textContent = (err.code || "Auth error").replace("auth/",""); }
});

const logoutBtn = document.createElement("button");
logoutBtn.textContent = "Sign out";
logoutBtn.className = "button8 signout";
logoutBtn.style.position = "fixed";
logoutBtn.style.top = "12px";
logoutBtn.style.right = "12px";
logoutBtn.style.zIndex = "9999";
logoutBtn.style.display = "none";
logoutBtn.onclick = () => net.logOut().catch(()=>{});
document.body.appendChild(logoutBtn);

net.onAuth(user=>{
  if (user){
    localUsername = user.displayName || (user.email ? user.email.split("@")[0] : "player");
    authEl.classList.add("hidden");
    logoutBtn.style.display = "inline-block";
    overlaySelect.classList.remove("hidden");   // go to character select
  } else {
    logoutBtn.style.display = "none";
    authEl.classList.remove("hidden");
    overlaySelect.classList.add("hidden");
    overlayLobbies.classList.add("hidden");
  }
});

// ------- Character select -------
function buildSelectUI(){
  gridEl.innerHTML = "";
  Object.entries(CHARACTERS).forEach(([key, c])=>{
    const btn = document.createElement("button");
    btn.className = "card"; btn.dataset.key = key;

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
buildSelectUI();

// ------- Lobbies UI -------
function renderLobbyList(list){
  lobbyListEl.innerHTML = "";
  lobbyHintEl.style.display = list.length ? "none" : "block";

  list.forEach(lob=>{
    const wrap = document.createElement("button");
    wrap.className = "card";
    wrap.style.textAlign = "left";
    wrap.style.alignItems = "flex-start";

    wrap.innerHTML = `
      <div style="display:grid;gap:6px;">
        <div><strong>${lob.name}</strong></div>
        <div style="font-size:11px;opacity:.9">Players: ${lob.playersCount}</div>
        <div style="font-size:11px;opacity:.8">Map: ${lob.w || "?"}×${lob.h || "?"}</div>
      </div>
    `;
    wrap.onclick = () => joinLobbyFlow(lob.id);
    lobbyListEl.appendChild(wrap);
  });
}

function showLobbies(){
  overlayLobbies.classList.remove("hidden");
  if (lobbyUnsub) try{ lobbyUnsub(); }catch{}
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
}
backBtn.onclick = ()=>{
  overlayLobbies.classList.add("hidden");
  overlaySelect.classList.remove("hidden");
};
refreshBtn.onclick = ()=>{
  if (lobbyUnsub) { try{ lobbyUnsub(); }catch{} lobbyUnsub = null; }
  lobbyUnsub = net.subscribeLobbies(renderLobbyList);
};

// ---- Create lobby (progress + timeout surfaced) ----
createLobbyBtn.onclick = async ()=>{
  const btnLabel = createLobbyBtn.textContent;
  createLobbyBtn.disabled = true;
  createLobbyBtn.textContent = "Creating…";
  try{
    const cfg = CHARACTERS[selectedKey];
    if (!cfg) throw new Error("Pick a character first");

    const visW = Math.floor(canvas.width / TILE);
    const visH = Math.floor(canvas.height / TILE);
    const map = generateMap(visW * MAP_SCALE, visH * MAP_SCALE);

    console.log("[Lobby] creating…");
    const lobbyId = await net.createLobby((newLobbyNameEl.value||"").trim(), map);
    console.log("[Lobby] created:", lobbyId);

    await net.joinLobby(lobbyId);
    console.log("[Lobby] joined:", lobbyId);

    await startWithCharacter(cfg, map);
    console.log("[Lobby] game started");

    overlayLobbies.classList.add("hidden");
  } catch(e){
    console.error("Create lobby failed:", e);
    alert("Create lobby failed: " + (e?.message || e));
  } finally {
    createLobbyBtn.disabled = false;
    createLobbyBtn.textContent = btnLabel;
  }
};

async function joinLobbyFlow(lobbyId){
  try{
    const cfg = CHARACTERS[selectedKey];
    if (!cfg) { alert("Pick a character first"); return; }
    const lobby = await net.getLobby(lobbyId);
    await net.joinLobby(lobbyId);
    await startWithCharacter(cfg, lobby.map);
    overlayLobbies.classList.add("hidden");
  } catch(e){
    console.error("Join lobby failed:", e);
    alert("Join lobby failed: " + (e?.message || e));
  }
}

// ------- Input -------
window.addEventListener("keydown", e=>{
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
  if (e.key === "Escape"){
    remote.clear();
    net.leaveLobby().catch(()=>{});
    state.ready = false;
    overlayLobbies.classList.add("hidden");
    overlaySelect.classList.remove("hidden");
    return;
  }
  if (e.key.toLowerCase() === "g") state.showGrid = !state.showGrid;
  if (e.key.toLowerCase() === "b") state.showBoxes = !state.showBoxes;
  if (e.key.toLowerCase() === "e") tryStartHop();
  keys.add(e.key);
});
window.addEventListener("keyup", e=> keys.delete(e.key));

// ------- Remote players cache -------
const remote = new Map();
const charCache = new Map();
function makePingPong(n){
  const f = [...Array(n).keys()];
  const b = [...Array(Math.max(n-2,0)).keys()].reverse().map(i => i+1);
  return f.concat(b);
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }

// Load assets for a character key
async function loadCharacterAssets(key){
  if (charCache.has(key)) return charCache.get(key);
  const cfg = CHARACTERS[key]; if (!cfg) return null;
  const [walk, idle, hop] = await Promise.all([
    loadImage(cfg.base + cfg.walk.sheet),
    loadImage(cfg.base + cfg.idle.sheet),
    loadImage(cfg.base + cfg.hop.sheet).catch(()=>null)
  ]);
  const assets = {
    cfg, walk, idle, hop,
    meta: {
      walk: sliceSheet(walk, cfg.walk.cols, cfg.walk.rows, cfg.walk.dirGrid, cfg.walk.framesPerDir),
      idle: sliceSheet(idle, cfg.idle.cols, cfg.idle.rows, cfg.idle.dirGrid, cfg.idle.framesPerDir),
      hop:  hop ? sliceSheet(hop,  cfg.hop.cols,  cfg.hop.rows,  cfg.hop.dirGrid,  cfg.hop.framesPerDir) : {}
    }
  };
  charCache.set(key, assets);
  return assets;
}

function startNetListeners(){
  const unsub = net.subscribePlayers({
    onAdd: async (uid, data)=>{
      const assets = await loadCharacterAssets(data.character);
      if (!assets) return;
      remote.set(uid, {
        username: data.username, character: data.character,
        x:data.x, y:data.y, dir:data.dir, anim:data.anim || "stand",
        scale: assets.cfg.scale ?? 3,
        frameTime: 0, frameStep: 0,
        assets
      });
    },
    onChange: (uid, data)=>{
      const r = remote.get(uid); if (!r) return;
      r.x = data.x ?? r.x; r.y = data.y ?? r.y;
      r.dir = data.dir ?? r.dir; r.anim = data.anim ?? r.anim;
      if (data.character && data.character !== r.character){
        loadCharacterAssets(data.character).then(a=>{ r.assets=a; r.character=data.character; r.scale=a.cfg.scale??3; });
      }
      r.username = data.username ?? r.username;
    },
    onRemove: (uid)=> remote.delete(uid)
  });
  return unsub;
}

// ------- Map generation / movement -------
function generateMap(w, h){
  const walls = Array.from({length:h}, (_,y)=>
    Array.from({length:w}, (_,x)=> (x===0||y===0||x===w-1||y===h-1)));

  const rects = 12 + Math.floor(Math.random()*8);
  for (let i=0;i<rects;i++){
    const rw = 2 + Math.floor(Math.random()*5);
    const rh = 2 + Math.floor(Math.random()*4);
    const rx = 1 + Math.floor(Math.random()*(w-rw-2));
    const ry = 1 + Math.floor(Math.random()*(h-rh-2));
    for (let y=ry; y<ry+rh; y++){
      for (let x=rx; x<rx+rw; x++){
        walls[y][x] = true;
      }
    }
  }

  const edgesV = Array.from({length:h}, ()=> Array(w+1).fill(false));
  const edgesH = Array.from({length:h+1}, ()=> Array(w).fill(false));

  const edgeSegments = 20 + Math.floor(Math.random()*12);
  for (let i=0;i<edgeSegments;i++){
    const vertical = Math.random() < 0.5;
    if (vertical){
      const xB = 1 + Math.floor(Math.random()*(w-1));
      const y0 = 1 + Math.floor(Math.random()*(h-2));
      const len = 3 + Math.floor(Math.random()*(h-4));
      for (let y=y0; y<Math.min(h-1, y0+len); y++){
        if (!walls[y][xB-1] && !walls[y][xB]) edgesV[y][xB] = true;
      }
    } else {
      const yB = 1 + Math.floor(Math.random()*(h-1));
      const x0 = 1 + Math.floor(Math.random()*(w-2));
      const len = 4 + Math.floor(Math.random()*(w-4));
      for (let x=x0; x<Math.min(w-1, x0+len); x++){
        if (!walls[yB-1][x] && !walls[yB][x]) edgesH[yB][x] = true;
      }
    }
  }

  let sx=1, sy=1;
  for (let tries=0; tries<400; tries++){
    const tx = 1 + Math.floor(Math.random()*(w-2));
    const ty = 1 + Math.floor(Math.random()*(h-2));
    if (!walls[ty][tx]){ sx=tx; sy=ty; break; }
  }

  return { w, h, walls, edgesV, edgesH, spawn:{x:sx, y:sy} };
}
function canWalk(tx,ty, map){ return tx>=0 && ty>=0 && tx<map.w && ty<map.h && !map.walls[ty][tx]; }
function tileCenter(tx,ty){ return {x: tx*TILE + TILE/2, y: ty*TILE + TILE/2}; }
function updateCamera(){
  const mapPxW = state.map.w * TILE;
  const mapPxH = state.map.h * TILE;
  state.cam.x = clamp(state.x - canvas.width  /2, 0, Math.max(0, mapPxW - canvas.width));
  state.cam.y = clamp(state.y - canvas.height /2, 0, Math.max(0, mapPxH - canvas.height));
}
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

// ------- Boot character inside a lobby map -------
async function startWithCharacter(cfg, map){
  state.ready = false;
  state.animMeta = { walk:{}, idle:{}, hop:{} };
  state.scale = cfg.scale ?? 3;

  if (!map){
    const visW = Math.floor(canvas.width / TILE);
    const visH = Math.floor(canvas.height / TILE);
    map = generateMap(visW * MAP_SCALE, visH * MAP_SCALE);
  }
  state.map = map;

  try{
    const [walkRes, idleRes, hopRes] = await Promise.allSettled([
      loadImage(cfg.base + cfg.walk.sheet),
      loadImage(cfg.base + cfg.idle.sheet),
      loadImage(cfg.base + cfg.hop.sheet)
    ]);

    if (walkRes.status !== "fulfilled") throw new Error("walk sheet missing");
    if (idleRes.status !== "fulfilled") throw new Error("idle sheet missing");

    state.walkImg = walkRes.value;
    state.idleImg = idleRes.value;
    state.hopImg  = (hopRes.status === "fulfilled") ? hopRes.value : null;

    state.animMeta.walk = sliceSheet(state.walkImg, cfg.walk.cols, cfg.walk.rows, cfg.walk.dirGrid, cfg.walk.framesPerDir);
    state.animMeta.idle = sliceSheet(state.idleImg, cfg.idle.cols, cfg.idle.rows, cfg.idle.dirGrid, cfg.idle.framesPerDir);
    state.animMeta.hop  = state.hopImg ? sliceSheet(state.hopImg, cfg.hop.cols, cfg.hop.rows, cfg.hop.dirGrid, cfg.hop.framesPerDir) : {};

    const spawn = tileCenter(map.spawn.x, map.spawn.y);
    state.x = spawn.x + (Math.random()*8 - 4);
    state.y = spawn.y + (Math.random()*8 - 4);
    state.dir = "down"; state.anim = "stand"; state.hopping = false;
    state.frameOrder = makePingPong(cfg.walk.framesPerDir);
    state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0;

    updateCamera();
    state.ready = true;

    try {
      await net.spawnLocal({
        username: localUsername || "player",
        character: selectedKey,
        x: state.x, y: state.y, dir: state.dir,
        anim: state.anim, scale: state.scale
      });
      startNetListeners();
    } catch(e) {
      console.warn("Net spawn failed (offline?)", e);
    }
  } catch (err){
    console.error(err);
    alert(`Failed to load ${cfg.name}. Check assets/ paths or server.`);
  }
}

// ------- Input & animation -------
const DIR_VECS = {
  down:[0,1], downRight:[1,1], right:[1,0], upRight:[1,-1],
  up:[0,-1], upLeft:[-1,-1], left:[-1,0], downLeft:[-1,1],
};
function getInputVec(){
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

function tryMove(dt, vx, vy){
  const map = state.map; if (!map) return;
  const stepX = vx * SPEED * dt;
  const stepY = vy * SPEED * dt;

  if (stepX){
    const oldX = state.x;
    let newX = clamp(oldX + stepX, TILE*0.5, map.w*TILE - TILE*0.5);
    const ty = Math.floor(state.y / TILE);
    const tx0 = Math.floor(oldX / TILE);
    const tx1 = Math.floor(newX / TILE);

    if (tx1 !== tx0){
      if (!canWalk(tx1, ty, map)){
        newX = oldX;
      } else {
        const xB = stepX > 0 ? tx0+1 : tx0;
        if (!state.hopping && map.edgesV[ty][xB]) newX = oldX;
      }
    }
    state.x = newX;
  }

  if (stepY){
    const oldY = state.y;
    let newY = clamp(oldY + stepY, TILE*0.5, map.h*TILE - TILE*0.5);
    const tx = Math.floor(state.x / TILE);
    const ty0 = Math.floor(oldY / TILE);
    const ty1 = Math.floor(newY / TILE);

    if (ty1 !== ty0){
      if (!canWalk(tx, ty1, map)){
        newY = oldY;
      } else {
        const yB = stepY > 0 ? ty0+1 : ty0;
        if (!state.hopping && map.edgesH[yB][tx]) newY = oldY;
      }
    }
    state.y = newY;
  }
}

function tryStartHop(){
  if (!state.ready || state.hopping) return;
  const cfg = CHARACTERS[selectedKey];
  const strip = state.animMeta.hop?.[state.dir];
  if (!cfg?.hop || !state.hopImg || !strip || strip.length === 0) return;

  const {vx,vy} = getInputVec();
  let dx = Math.sign(vx), dy = Math.sign(vy);
  if (!dx && !dy){ const v = DIR_VECS[state.dir]; dx = v[0]; dy = v[1]; }

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

function sliceSheet(img, cols, rows, dirGrid, framesPerDir){
  const CELL_W = Math.floor(img.width / cols);
  const CELL_H = Math.floor(img.height / rows);
  const trimCell = (row, col) => analyzeBitmap(img, col*CELL_W, row*CELL_H, CELL_W, CELL_H);

  const metaByDir = {};
  for (const [dir, def] of Object.entries(dirGrid)){
    const arr = [];
    for (let i=0; i<framesPerDir; i++) arr.push(trimCell(def.row, def.start + i));
    metaByDir[dir] = arr;
  }
  return metaByDir;
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
    idx = Math.min(state.frameStep, strip.length - 1); return strip[idx];
  }
  meta = state.animMeta.idle; strip = meta?.[state.dir]; return strip ? strip[0] : null;
}

// ------- Update / Draw -------
function update(dt){
  const {vx, vy} = getInputVec();
  state.prevMoving = state.moving;
  state.moving = !!(vx || vy);

  if (!state.hopping){
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
          state.frameTime -= tpf; state.frameStep += 1;
          if (state.frameStep >= state.frameOrder.length){
            state.anim = "stand"; state.frameStep = 0; state.idleAccum -= IDLE_INTERVAL; if (state.idleAccum < 0) state.idleAccum = 0; break;
          }
        }
      }
    }
    updateCamera();
  } else {
    const cfg = CHARACTERS[selectedKey];
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
      state.frameStep = 0; state.frameTime = 0; state.idleAccum = 0; updateCamera();
    }
  }

  if (selectedKey && state.ready){
    net.updateState({ x:state.x, y:state.y, dir:state.dir, anim:state.anim, character:selectedKey });
  }
}

const BG_FLOOR = "#08242b", BG_WALL  = "#12333c";

function drawMap(){
  const m = state.map; if (!m) return;
  const xs = Math.max(0, Math.floor(state.cam.x / TILE));
  const ys = Math.max(0, Math.floor(state.cam.y / TILE));
  const xe = Math.min(m.w-1, Math.ceil((state.cam.x + canvas.width ) / TILE));
  const ye = Math.min(m.h-1, Math.ceil((state.cam.y + canvas.height) / TILE));

  if (TEX.floor){
    for (let y=ys; y<=ye; y++){
      for (let x=xs; x<=xe; x++){
        ctx.drawImage(TEX.floor, 0,0, TEX.floor.width, TEX.floor.height,
          x*TILE - state.cam.x, y*TILE - state.cam.y, TILE, TILE);
      }
    }
  } else { ctx.fillStyle = BG_FLOOR; ctx.fillRect(0,0,canvas.width,canvas.height); }

  for (let y=ys; y<=ye; y++){
    for (let x=xs; x<=xe; x++){
      if (!m.walls[y][x]) continue;
      const dx = x*TILE - state.cam.x, dy = y*TILE - state.cam.y;
      if (TEX.wall){
        ctx.drawImage(TEX.wall, 0,0, TEX.wall.width, TEX.wall.height, dx, dy, TILE, TILE);
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

function draw(){
  drawMap();

  // Remote players
  for (const r of remote.values()){
    const assets = r.assets; if (!assets) continue;
    const meta = r.anim === "walk" ? assets.meta.walk
               : r.anim === "hop"  ? assets.meta.hop
               : assets.meta.idle;
    const strip = meta[r.dir] || meta.down || Object.values(meta)[0];
    if (!strip || !strip.length) continue;

    r.frameTime += 1/60;
    const frames = r.anim === "walk" ? assets.cfg.walk.framesPerDir
                 : r.anim === "hop"  ? (assets.cfg.hop?.framesPerDir || 1)
                 : assets.cfg.idle.framesPerDir;
    const order = [...Array(Math.max(frames,1)).keys(), ...Array(Math.max(frames-2,0)).keys().reverse().map(i=>i+1)];
    const idx = order[r.frameStep % order.length] % strip.length;
    if (r.frameTime >= 1/10){ r.frameTime = 0; r.frameStep = (r.frameStep+1)%order.length; }

    const f = strip[idx], scale = r.scale;
    const dw = f.sw * scale, dh = f.sh * scale;
    const dx = Math.round(r.x - f.ox * scale - state.cam.x);
    const dy = Math.round(r.y - f.oy * scale - state.cam.y);
    const src = r.anim === "walk" ? assets.walk : (r.anim === "hop" && assets.hop ? assets.hop : assets.idle);
    ctx.drawImage(src, f.sx, f.sy, f.sw, f.sh, dx, dy, dw, dh);

    drawNameTagAbove(r.username || "player", f, r.x, r.y, 0, r.scale);
  }

  // Local
  const f = currentFrame();
  if (state.ready && f){
    const scale = state.scale;
    const z = state.hopping ? state.hop.z : 0;
    const dw = f.sw * scale, dh = f.sh * scale;
    const dx = Math.round(state.x - f.ox * scale - state.cam.x);
    const dy = Math.round(state.y - f.oy * scale - state.cam.y - z);

    const overGap = isOverGapWorld(state.x, state.y);
    const squash  = state.hopping ? 1 - 0.35*Math.sin(Math.PI*state.hop.t) : 1;
    const shw     = Math.max(6, Math.floor(12 * scale * squash));
    const shh     = Math.max(3, Math.floor( 5 * scale * squash));
    ctx.globalAlpha = overGap ? 0.08 : 0.25;
    ctx.beginPath();
    ctx.ellipse(Math.round(state.x - state.cam.x), Math.round(state.y - state.cam.y - 1), shw, shh, 0, 0, Math.PI*2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.globalAlpha = 1;

    const src = state.anim === "hop" ? state.hopImg : (state.moving ? state.walkImg : state.idleImg);
    ctx.drawImage(src, f.sx, f.sy, f.sw, f.sh, dx, dy, dw, dh);

    drawNameTagAbove(localUsername || "you", f, state.x, state.y, z, state.scale);

    if (state.showBoxes){
      ctx.fillStyle = "white";
      ctx.fillRect(Math.round(state.x - state.cam.x)-1, Math.round(state.y - state.cam.y)-1, 3, 3);
      ctx.strokeStyle = "rgba(255,255,0,.85)";
      ctx.strokeRect(dx+0.5, dy+0.5, dw, dh);
    }
  }

  if (state.showGrid){
    const src = state.anim === "hop" ? state.hopImg : (state.moving ? state.walkImg : state.idleImg);
    if (src){
      const maxW = Math.min(canvas.width, src.width);
      const scale = maxW / src.width;
      ctx.globalAlpha = .9;
      ctx.drawImage(src, 0,0, src.width, src.height, 0,0, src.width*scale, src.height*scale);
      ctx.globalAlpha = 1;
    }
  }
}

// ------- Loop -------
let last = 0;
function loop(ts){
  const dt = Math.min(0.033, (ts - last)/1000);
  last = ts;
  if (state.ready) update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------- Utils -------
function loadImage(src){
  return new Promise((res, rej)=>{
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
