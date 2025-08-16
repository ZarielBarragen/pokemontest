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
    }

    findClosestPlayer(players) {
        let closestPlayer = null;
        let minPlayerDist = Infinity;

        for (const player of players) {
            if (player.isPhasing) continue; // Ignore phasing players
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
    }

    update(dt, players, map, net) {
        // To be implemented by subclasses
    }

    draw(ctx, cam) {
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
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        if (this.attackCooldown > 0) return;

        const { player, distance } = this.findClosestPlayer(players);
        
        if (player && distance < this.detectionRange) {
            this.attackCooldown = 2.0; // Fire every 2 seconds
            
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            
            const vx = (dx / dist) * this.projectileSpeed;
            const vy = (dy / dist) * this.projectileSpeed;

            // The host simulates and broadcasts projectiles
            net.fireProjectile({
                ownerId: this.id, // Mark projectile as from an enemy
                isEnemyProjectile: true,
                x: this.x, y: this.y,
                vx, vy, damage: this.damage, life: 3.0
            });
        }
    }

    draw(ctx, cam) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 16;

        // Simple drawing for a turret
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 80, 80, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 40, 40, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();
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
    }

    update(dt, players, map, net) {
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        
        const { player, distance } = this.findClosestPlayer(players);
        this.target = player;

        if (this.target && distance < this.detectionRange) {
            if (distance > this.attackRange) {
                // Chase player
                const dx = this.target.x - this.x;
                const dy = this.target.y - this.y;
                const moveX = (dx / distance) * this.speed * dt;
                const moveY = (dy / distance) * this.speed * dt;
                this.x += moveX;
                this.y += moveY;
            } else if (this.attackCooldown <= 0) {
                // Attack player
                this.attackCooldown = 1.5;
                this.attackAnimTimer = 1.0;
                // Host notifies clients that an attack happened so they can deal damage
                net.performMeleeAttack({ by: this.id, isEnemy: true, damage: this.damage, range: this.attackRange });
            }
        }
        
        if (this.attackAnimTimer > 0) this.attackAnimTimer -= dt;
    }

    draw(ctx, cam) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 18;

        // Animate punches if attacking
        if (this.attackAnimTimer > 0) {
            const animProgress = 1.0 - (this.attackAnimTimer / 1.0);
            if (animProgress < 0.5) {
                this.handOffset1 = animProgress * 2 * 20; // Punch out
            } else {
                this.handOffset1 = (1 - (animProgress-0.5)*2) * 20; // Retract
                this.handOffset2 = (animProgress-0.5) * 2 * 20; // Second punch
            }
        } else {
            this.handOffset1 = 0;
            this.handOffset2 = 0;
        }

        // Body
        ctx.fillStyle = '#c2a374';
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Hands
        ctx.fillStyle = '#9c825d';
        ctx.beginPath();
        ctx.arc(sx - radius, sy, 8, 0, Math.PI * 2);
        ctx.arc(sx - radius - this.handOffset2, sy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx + radius, sy, 8, 0, Math.PI * 2);
        ctx.arc(sx + radius + this.handOffset1, sy, 8, 0, Math.PI * 2);
        ctx.fill();
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
        this.validAttackers = ['Sableye', 'Mimikyu', 'Decidueye'];
    }

    takeDamage(amount, fromCharacterKey = null) {
        if (this.validAttackers.includes(fromCharacterKey)) {
            super.takeDamage(amount); // Call the parent method to take damage
        }
        // Otherwise, it takes no damage
    }

    update(dt, players, map, net) {
        const { player, distance } = this.findClosestPlayer(players);
        this.target = player;

        if (!this.target) return;

        // Check if any player is looking at the angel
        this.isBeingLookedAt = players.some(p => {
            const dist = Math.hypot(p.x - this.x, p.y - this.y);
            // "Looking at" is simplified to being close and facing its general direction
            return dist < TILE * 10 && isFacing(p, this);
        });

        if (this.isBeingLookedAt) {
            this.stareTimer += dt;
            if (this.stareTimer >= 3.0) {
                this.isDefeated = true; // Disappears after 3 seconds of being watched
            }
        } else {
            this.stareTimer = 0;
            // Chase player (phases through walls, so no collision check)
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            this.x += (dx / distance) * this.speed * dt;
            this.y += (dy / distance) * this.speed * dt;

            // Attack player if in range
            if (distance < this.attackRange && this.attackCooldown <= 0) {
                this.attackCooldown = 2.0;
                 net.performMeleeAttack({ by: this.id, isEnemy: true, damage: this.damage, range: this.attackRange });
            }
        }
        
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
    }

    draw(ctx, cam) {
        const sx = Math.round(this.x - cam.x);
        const sy = Math.round(this.y - cam.y);
        const radius = 20;

        // Flicker when being looked at
        ctx.globalAlpha = this.isBeingLookedAt ? (Math.random() * 0.5 + 0.3) : 0.8;
        
        // Body
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        // Eyes
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(sx - 7, sy - 5, 3, 0, Math.PI * 2);
        ctx.arc(sx + 7, sy - 5, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1.0;
    }
}