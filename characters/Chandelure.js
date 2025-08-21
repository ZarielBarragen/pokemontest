// Chandelure.js

import { Player } from '../Player.js';

export class Chandelure extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    useAbility() {
        if (this.state.abilityCooldown > 0) return;

        // Set the cooldown first
        this.state.abilityCooldown = this.config.ability.cooldown;
        this.sfx.jump.play(0.5, 0.7); // Play a sound

        // **Crucially, apply the effect locally for the caster.**
        this.state.darkRoomActive = true;
        this.state.darkRoomTimer = 5.0; // This duration should match the effect logic in main.js
        this.state.isDarkRoomCaster = true; // This gives the caster the spotlight

        // If the caster is the lobby owner, they handle despawning/respawning enemies
        if (this.net.auth.currentUser.uid === this.net.currentLobbyOwner) {
            const enemiesData = {};
            for (const [id, enemy] of this.game.enemies.entries()) {
                enemiesData[id] = {
                    id: enemy.id,
                    type: enemy.constructor.name,
                    x: enemy.x,
                    y: enemy.y,
                    config: { hp: enemy.maxHp, maxHp: enemy.maxHp, speed: enemy.speed, damage: enemy.damage, detectionRange: enemy.detectionRange, attackRange: enemy.attackRange, projectileSpeed: enemy.projectileSpeed || 0 }
                };
            }
            window.savedEnemies = enemiesData;
            for (const id of this.game.enemies.keys()) {
                this.net.removeEnemy(id);
            }
        }
        
        // Now, broadcast to other players so their screens go black
        this.net.broadcastAbility({ name: 'darkRoom' });
    }
}