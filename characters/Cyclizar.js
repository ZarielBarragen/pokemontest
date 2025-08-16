import { Player } from '../Player.js';

/**
 * Represents Cyclizar, who can activate a temporary speed boost and empower its next attack.
 */
export class Cyclizar extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Activates Ride By Slash, granting a speed boost and empowering the next melee attack.
     */
    useAbility() {
        this.state.rideBySlashActive = true;
        this.state.rideBySlashTimer = this.config.ability.duration;
        this.state.abilityCooldown = this.config.ability.cooldown;
        console.log("Cyclizar used Ride By Slash!");
    }
}
