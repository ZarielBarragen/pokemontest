import { Player } from '../Player.js';

/**
 * Represents Hypno, who can put other players to sleep.
 */
export class Hypno extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Hypnotizes a target player, putting them to sleep if they are in range.
     * @param {object} targetPlayer - The remote player to hypnotize.
     */
    useAbility(targetPlayer) {
        if (!targetPlayer) return;

        const dist = Math.hypot(this.state.x - targetPlayer.x, this.state.y - targetPlayer.y);
        
        if (dist <= this.config.ability.range) {
            let duration = 5000;
            if (this.state.equippedItem === 'hypnosPendulum') {
                duration = 8000;
            }
            this.net.applyStatus(targetPlayer.uid, { type: 'sleep', duration: duration, from: this.net.auth.currentUser.uid });
            this.state.abilityCooldown = this.config.ability.cooldown;
        } else {
            console.log("Target is out of range for Hypnosis.");
        }
    }
}
