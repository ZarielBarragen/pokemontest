// mapGenerator.js

// A deterministic random number generator for seeded maps
export function mulberry32(a){ 
    return function(){ 
        let t=a+=0x6D2B79F5; 
        t=Math.imul(t^t>>>15,t|1); 
        t^=t+Math.imul(t^t>>>7,t|61); 
        return ((t^t>>>14)>>>0)/4294967296; 
    }; 
}

/**
 * Generates a procedural map based on a seed and type.
 * @returns {object} The generated map data object.
 */
export function generateMap(w, h, seed=1234, type = 'dungeon'){
  const rnd = mulberry32((seed >>> 0));

  if (type === 'forest') {
    const walls = Array.from({ length: h }, () => Array(w).fill(0));
    const tiles = Array.from({ length: h }, () => Array(w).fill(null));
    const trees = [];
    const edgesV = Array.from({ length: h }, () => Array(w + 1).fill(false));
    const edgesH = Array.from({ length: h + 1 }, () => Array(w).fill(false));

    const TILE_DEF = {
        PATH_V: { x: 4, y: 0 },
        PATH_H: { x: 6, y: 1 },
        PATH_END_N: { x: 7, y: 0 },
        PATH_END_S: { x: 7, y: 1 },
        PATH_END_W: { x: 5, y: 0 },
        PATH_END_E: { x: 6, y: 0 },
        PATH_CORNER_NW: { x: 8, y: 0 },
        PATH_CORNER_NE: { x: 9, y: 0 },
        PATH_CORNER_SW: { x: 9, y: 1 },
        PATH_CORNER_SE: { x: 8, y: 1 },
        PATH_T_NSW: { x: 4, y: 4 }, 
        PATH_T_NSE: { x: 5, y: 4 }, 
        PATH_T_WES: { x: 6, y: 4 }, 
        PATH_T_WEN: { x: 6, y: 3 }, 
        PATH_X: { x: 6, y: 1 }
    };

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            tiles[y][x] = (rnd() < 0.5) ? {x:0, y:0} : {x:1, y:0};
        }
    }

    const pathCoords = new Set();
    for (let p = 0; p < 3; p++) {
        let pathX = 2 + Math.floor(rnd() * (w - 4));
        let pathY = h - 1;
        let pathLen = Math.floor(w * h * 0.15);
        let lastDir = 'N';

        for (let i = 0; i < pathLen; i++) {
            pathX = Math.max(1, Math.min(w - 2, pathX));
            pathY = Math.max(1, Math.min(h - 2, pathY));
            pathCoords.add(`${pathX},${pathY}`);

            const dirs = {N:[0,-1], W:[-1,0], E:[1,0]};
            const r = rnd();
            let nextDir;

            if (r < 0.6) nextDir = lastDir;
            else if (r < 0.8) nextDir = 'W';
            else nextDir = 'E';
            
            const move = dirs[nextDir];
            if (move) {
                pathX += move[0];
                pathY += move[1];
            }
            lastDir = nextDir;
        }
    }
    
    const isPath = (x, y) => pathCoords.has(`${x},${y}`);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (isPath(x, y)) {
                const n = isPath(x, y - 1);
                const s = isPath(x, y + 1);
                const w_ = isPath(x - 1, y);
                const e = isPath(x + 1, y);

                if(n && s && w_ && e) tiles[y][x] = TILE_DEF.PATH_X;
                else if (n&&s&&w_) tiles[y][x] = TILE_DEF.PATH_T_NSW;
                else if (n&&s&&e) tiles[y][x] = TILE_DEF.PATH_T_NSE;
                else if (w_&&e&&s) tiles[y][x] = TILE_DEF.PATH_T_WES;
                else if (w_&&e&&n) tiles[y][x] = TILE_DEF.PATH_T_WEN;
                else if (n&&s) tiles[y][x] = TILE_DEF.PATH_V;
                else if (w_&&e) tiles[y][x] = TILE_DEF.PATH_H;
                else if (n&&w_) tiles[y][x] = TILE_DEF.PATH_CORNER_NW;
                else if (n&&e) tiles[y][x] = TILE_DEF.PATH_CORNER_NE;
                else if (s&&w_) tiles[y][x] = TILE_DEF.PATH_CORNER_SW;
                else if (s&&e) tiles[y][x] = TILE_DEF.PATH_CORNER_SE;
                else if (n) tiles[y][x] = TILE_DEF.PATH_END_S; 
                else if (s) tiles[y][x] = TILE_DEF.PATH_END_N;
                else if (w_) tiles[y][x] = TILE_DEF.PATH_END_E;
                else if (e) tiles[y][x] = TILE_DEF.PATH_END_W;
                else tiles[y][x] = TILE_DEF.PATH_H; 
            }
        }
    }
    
    // --- FIX 2: Create a better mix of grass and dirt ---
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            // If it's a dirt tile and not a path, give it a 50% chance to become grass
            if (!isPath(x, y) && tiles[y][x]?.y === 0) {
                if (rnd() < 0.5) {
                     tiles[y][x] = (rnd() < 0.5) ? {x:2, y:0} : {x:3, y:0};
                }
            }
        }
    }
    
    const treeChance = 0.3;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let isGrass = tiles[y][x]?.x === 2 || tiles[y][x]?.x === 3;
            if (isGrass && rnd() < treeChance) {
                 let isClearOfPath = true;
                 for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (isPath(x + dx, y + dy)) {
                            isClearOfPath = false; break;
                        }
                    }
                    if(!isClearOfPath) break;
                 }
                 if(isClearOfPath && y > 0) {
                    trees.push({ x, y });
                    walls[y][x] = 1;
                 }
            }
        }
    }

    // --- FIX 1: Ensure a truly random spawn point on the path ---
    const validSpawnPoints = Array.from(pathCoords).map(coord => {
        const [x, y] = coord.split(',').map(Number);
        return { x, y };
    });
    
    let spawn = { x: Math.floor(w / 2), y: h - 2 }; // Fallback
    if (validSpawnPoints.length > 0) {
        spawn = validSpawnPoints[Math.floor(rnd() * validSpawnPoints.length)];
    }
    
    return { w, h, walls, tiles, trees, edgesV, edgesH, spawn, seed, type };
  }
  
  // Existing Plains and Dungeon logic...
  if (type === 'plains') {
    const walls = Array.from({ length: h }, () => Array(w).fill(0));
    const edgesV = Array.from({ length: h }, () => Array(w + 1).fill(false));
    const edgesH = Array.from({ length: h + 1 }, () => Array(w).fill(false));
    const numWater = Math.max(1, Math.floor((w * h) / 600));
    for (let i = 0; i < numWater; i++) {
      const cx = Math.floor(rnd() * w);
      const cy = Math.floor(rnd() * h);
      const radius = 2 + Math.floor(rnd() * 4);
      for (let yy = Math.max(0, cy - radius); yy <= Math.min(h - 1, cy + radius); yy++) {
        for (let xx = Math.max(0, cx - radius); xx <= Math.min(w - 1, cx + radius); xx++) {
          if (Math.hypot(xx - cx, yy - cy) <= radius) {
            walls[yy][xx] = 2;
          }
        }
      }
    }
    const numTrees = Math.max(1, Math.floor((w * h) / 500));
    for (let i = 0; i < numTrees; i++) {
      const cx = Math.floor(rnd() * w);
      const cy = Math.floor(rnd() * h);
      const radius = 1 + Math.floor(rnd() * 3);
      for (let yy = Math.max(0, cy - radius); yy <= Math.min(h - 1, cy + radius); yy++) {
        for (let xx = Math.max(0, cx - radius); xx <= Math.min(w - 1, cx + radius); xx++) {
          if (Math.hypot(xx - cx, yy - cy) <= radius && walls[yy][xx] === 0) {
            walls[yy][xx] = 1;
          }
        }
      }
    }
    let spawn = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    let tries = 0;
    while (tries < 200) {
      const sx = Math.floor(rnd() * w);
      const sy = Math.floor(rnd() * h);
      if (walls[sy][sx] === 0) {
        spawn = { x: sx, y: sy };
        break;
      }
      tries++;
    }

    const riverCount = Math.max(1, Math.floor(Math.min(w, h) / 20));
    const dirs = [ [1,0], [0,1], [-1,0], [0,-1], [1,1], [-1,-1], [1,-1], [-1,1] ];
    for (let i = 0; i < riverCount; i++) {
      let rx = 2 + Math.floor(rnd() * Math.max(1, w - 4));
      let ry = 2 + Math.floor(rnd() * Math.max(1, h - 4));
      let [dx, dy] = dirs[Math.floor(rnd() * dirs.length)];
      const minLen = Math.floor(Math.min(w, h) * 0.5);
      const maxLen = Math.floor(Math.min(w, h) * 0.9);
      const length = minLen + Math.floor(rnd() * Math.max(1, maxLen - minLen + 1));
      for (let step = 0; step < length; step++) {
        if (rx < 0 || ry < 0 || rx >= w || ry >= h) break;
        if (!(rx === spawn.x && ry === spawn.y)) {
          walls[ry][rx] = 2;
        }
        if (rnd() < 0.25) {
          const possible = dirs.filter(([nx, ny]) => !(nx === -dx && ny === -dy));
          [dx, dy] = possible[Math.floor(rnd() * possible.length)];
        }
        rx += dx;
        ry += dy;
      }
    }
    return { w, h, walls, edgesV, edgesH, spawn, seed, type };
  }
  
  // Dungeon (default) generation
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
  
  const gapChance = 0.25;
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

  return { w, h, walls, edgesV, edgesH, spawn: {x:sx, y:sy}, seed: seed, type: type };
}