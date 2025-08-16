import { Player } from '../Player.js';

/**
 * Represents Scolipede, who can activate a toxic speed boost, leaving a poison trail.
 */
export class Scolipede extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Activates Toxic Sprint, boosting speed and leaving a trail of poison tiles.
     */
    useAbility() {
        this.state.toxicSprintActive = true;
        this.state.toxicSprintTimer = this.config.ability.duration;
        this.state.abilityCooldown = this.config.ability.cooldown;
        console.log("Scolipede used Toxic Sprint!");
    }
}
