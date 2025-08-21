import { TILE, isFacing } from './utils.js';

const DIR_VECS = {
  down:[0,1], downRight:[1,1], right:[1,0], upRight:[1,-1],
  up:[0,-1], upLeft:[-1,-1], left:[-1,0], downLeft:[-1,1], 
};
function vecToDir(vx, vy){
  if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) return "down";
  const angle = Math.atan2(vy, vx) * 180 / Math.PI;
  if (angle > -22.5 && angle <= 22.5) return "right";
  if (angle > 22.5 && angle <= 67.5) return "downRight";
  if (angle > 67.5 && angle <= 112.5) return "down";
  if (angle > 112.5 && angle <= 157.5) return "downLeft";
  if (angle > 157.5 || angle <= -157.5) return "left";
  if (angle > -157.5 && angle <= -112.5) return "upLeft";
  if (angle > -112.5 && angle <= -67.5) return "up";
  if (angle > -67.5 && angle <= -22.5) return "upRight";
  return "down";
}


/**
 * Base class for all enemy types.
 */
class Enemy {
    constructor(id, x, y, config) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.hp = config.hp;
        this.maxHp = config.hp;
        this.speed = config.speed;
        this.damage = config.damage;
        this.detectionRange = config.detectionRange;
        this.attackRange = config.attackRange;
        this.attackCooldown = 0;
        this.target = null;
        this.isDefeated = false;
        this.isBubbled = false;     // NEW
        this.bubbleTimer = 0;       // NEW
        this.isConfused = false; 
    }

    findClosestPlayer(players) {
        let closestPlayer = null;
        let minPlayerDist = Infinity;

        for (const player of players) {
            if (player.isPhasing || player.isFlying) continue; 
            
            const dist = Math.hypot(player.x - this.x, player.y - this.y);
            if (dist < minPlayerDist) {
                minPlayerDist = dist;
                closestPlayer = player;
            }
        }
        return { player: closestPlayer, distance: minPlayerDist };
    }

    takeDamage(amount, fromCharacterKey = null) {
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp <= 0) {
            this.isDefeated = true;
        }
        return this.hp;
    }

    update(dt, players, map, net) {
        // To be implemented by subclasses
    }

    draw(ctx, cam, isHighlighted = false) {
        // To be implemented by subclasses
    }
}

/**
 * Turret: A stationary enemy that fires projectiles.
 */
export class Turret extends Enemy {
    constructor(id, x, y, config) {
        super(id, x, y, config);
        this.projectileSpeed = config.projectileSpeed;
    }


    update(dt, players, map, net) {
        if (this.isBubbled) return; // Cannot act while bubbled
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        if (this.attackCooldown > 0) return;

        const { player, distance } = this.findClosestPlayer(players);
        
        if (player && distance < this.detectionRange) {
            let hasLineOfSight = true;
            const steps = Math.floor(distance / (TILE / 4));
            for (let i = 1; i <= steps; i++) {
                const checkX = this.x + (player.x - this.x) * (i / steps);
                const checkY = this.y + (player.y - this.y) * (i / steps);
                const tileX = Math.floor(checkX / TILE);
                const tileY = Math.floor(checkY / TILE);
                if (map.walls[tileY]?.[tileX]) {
                    hasLineOfSight = false;
                    break;
                }
            }

            if (hasLineOfSight) {
                this.attackCooldown = 2.0;
                
                let dx = player.x - this.x;
                let dy = player.y - this.y;

                if (this.isConfused) {
                    dx *= -1;
                    dy *= -1;
                }
                
                const dist = Math.hypot(dx, dy);
                
                const vx = (dx / dist) * this.projectileSpeed;
                const vy = (dy / dist) * this.projectileSpeed;

                net.fireProjectile({
                    ownerId: this.id,
                    isEnemyProjectile: true,
                    x: this.x, y: this.y,
                    vx, vy, damage: this.damage, life: 3.0
                });
            }
        }
    }

    draw(ctx, cam, isHighlighted = false) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 16;

        if (isHighlighted) {
            ctx.save();
            ctx.filter = 'drop-shadow(0 0 10px #6495ED) brightness(1.6)';
        }

        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 80, 80, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 40, 40, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (isHighlighted) {
            ctx.restore();
        }

        if (this.isBubbled) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#87CEEB";
            ctx.beginPath();
            ctx.arc(sx, sy, radius * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }
}

/**
 * Brawler: A mobile enemy that chases and performs melee attacks.
 */
export class Brawler extends Enemy {
    constructor(id, x, y, config) {
        super(id, x, y, config);
        this.attackAnimTimer = 0;
        this.handOffset1 = 0;
        this.handOffset2 = 0;
        this.dir = 'down';
    }

    update(dt, players, map, net) {
        if (this.isBubbled) return; // Cannot act while bubbled
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        
        const { player, distance } = this.findClosestPlayer(players);
        this.target = player;

        if (this.target && distance < this.detectionRange) {
            let dx = this.target.x - this.x;
            let dy = this.target.y - this.y;

            if (this.isConfused) {
                dx *= -1;
                dy *= -1;
            }

            this.dir = vecToDir(dx, dy);

            if (distance > this.attackRange || this.isConfused) {
                const moveSpeed = this.isConfused ? this.speed * 0.7 : this.speed;
                const moveX = (dx / distance) * moveSpeed * dt;
                const moveY = (dy / distance) * moveSpeed * dt;
                
                const nextX = this.x + moveX;
                const nextY = this.y + moveY;
                const tileX = Math.floor(nextX / TILE);
                const tileY = Math.floor(nextY / TILE);

                if (tileX >= 0 && tileX < map.w && !map.walls[Math.floor(this.y / TILE)][tileX]) {
                    this.x = nextX;
                }
                if (tileY >= 0 && tileY < map.h && !map.walls[tileY][Math.floor(this.x / TILE)]) {
                    this.y = nextY;
                }
                
            } else if (this.attackCooldown <= 0) {
                this.attackCooldown = 1.5;
                this.attackAnimTimer = 1.0;
                net.performMeleeAttack({ by: this.id, isEnemy: true, damage: this.damage, range: this.attackRange + 10 });
            }
        }
        
        if (this.attackAnimTimer > 0) this.attackAnimTimer -= dt;
    }

    draw(ctx, cam, isHighlighted = false) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 18;

        if (isHighlighted) {
            ctx.save();
            ctx.filter = 'drop-shadow(0 0 10px #6495ED) brightness(1.6)';
        }

        if (this.attackAnimTimer > 0) {
            const animProgress = 1.0 - this.attackAnimTimer;
            if (animProgress < 0.5) {
                this.handOffset1 = animProgress * 2 * 20;
                this.handOffset2 = 0;
            } else {
                this.handOffset1 = (1 - (animProgress-0.5)*2) * 20;
                this.handOffset2 = (animProgress-0.5) * 2 * 20;
            }
        } else {
            this.handOffset1 = 0;
            this.handOffset2 = 0;
        }

        ctx.fillStyle = '#c2a374';
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();

        const dirVec = DIR_VECS[this.dir] || [0, 1];
        const perpendicularVec = { x: -dirVec[1], y: dirVec[0] };

        const handDist = radius * 0.9;
        const fistSize = 8;
        
        const hand1_base_x = sx + perpendicularVec.x * handDist;
        const hand1_base_y = sy + perpendicularVec.y * handDist;
        const hand2_base_x = sx - perpendicularVec.x * handDist;
        const hand2_base_y = sy - perpendicularVec.y * handDist;
        
        const hand1_punch_x = hand1_base_x + dirVec[0] * this.handOffset1;
        const hand1_punch_y = hand1_base_y + dirVec[1] * this.handOffset1;
        
        const hand2_punch_x = hand2_base_x + dirVec[0] * this.handOffset2;
        const hand2_punch_y = hand2_base_y + dirVec[1] * this.handOffset2;

        ctx.fillStyle = '#9c825d';
        ctx.beginPath();
        ctx.arc(hand1_punch_x, hand1_punch_y, fistSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hand2_punch_x, hand2_punch_y, fistSize, 0, Math.PI * 2);
        ctx.fill();

        if (isHighlighted) {
            ctx.restore();
        }

        if (this.isBubbled) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#87CEEB";
            ctx.beginPath();
            ctx.arc(sx, sy, radius * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }
}

/**
 * Weeping Angel: A phasing, fast enemy that can only be killed by specific heroes
 * or by being looked at.
 */
export class WeepingAngel extends Enemy {
    constructor(id, x, y, config) {
        super(id, x, y, config);
        this.stareTimer = 0;
        this.isBeingLookedAt = false;
        this.validAttackers = ['Sableye', 'Mimikyu', 'Decidueye', 'Gengar', 'Hisuian Zoroark'];
        this.despawnTimer = 90;
    }

    takeDamage(amount, fromCharacterKey = null) {
        if (this.validAttackers.includes(fromCharacterKey)) {
            super.takeDamage(amount);
        }
        return this.hp;
    }

    update(dt, players, map, net) {
        if (this.isBubbled) return; // Cannot act while bubbled
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        
        const { player, distance } = this.findClosestPlayer(players);
        this.target = player;

        if (!this.target) {
            this.despawnTimer -= dt;
            if (this.despawnTimer <= 0) {
                this.isDefeated = true;
            }
            return;
        }

        this.despawnTimer = 90;

        this.isBeingLookedAt = players.some(p => {
            const dist = Math.hypot(p.x - this.x, p.y - this.y);
            return dist < TILE * 10 && isFacing(p, this);
        });

        if (this.isBeingLookedAt) {
            this.stareTimer += dt;
            if (this.stareTimer >= 3.0) {
                this.isDefeated = true;
            }
        } else {
            this.stareTimer = 0;
            let dx = this.target.x - this.x;
            let dy = this.target.y - this.y;

            if (this.isConfused) {
                dx *= -1;
                dy *= -1;
            }

            this.x += (dx / distance) * this.speed * dt;
            this.y += (dy / distance) * this.speed * dt;

            if (distance < this.attackRange && this.attackCooldown <= 0 && !this.isConfused) {
                this.attackCooldown = 2.0;
                 net.performMeleeAttack({ by: this.id, isEnemy: true, damage: this.damage, range: this.attackRange });
            }
        }
    }

    draw(ctx, cam, isHighlighted = false) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 20;

        if (isHighlighted) {
            ctx.save();
            ctx.filter = 'drop-shadow(0 0 10px #6495ED) brightness(1.6)';
        }

        ctx.globalAlpha = this.isBeingLookedAt ? (Math.random() * 0.5 + 0.3) : 0.8;
        
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(sx - 7, sy - 5, 3, 0, Math.PI * 2);
        ctx.arc(sx + 7, sy - 5, 3, 0, Math.PI * 2);
        ctx.fill();

        if (isHighlighted) {
            ctx.restore();
        }
        
        if (this.isBubbled) {
            // We draw the bubble before resetting globalAlpha
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#87CEEB";
            ctx.beginPath();
            ctx.arc(sx, sy, radius * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1.0;
    }
}