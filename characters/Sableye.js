import { Player } from '../Player.js';

/**
 * Represents Sableye, a character with the ability to phase through objects.
 */
export class Sableye extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    /**
     * Toggles Sableye's phasing ability on and off.
     * While phasing, Sableye can move through walls and other players
     * but may be subject to other effects (like damage over time).
     */
    useAbility() {
        this.state.isPhasing = !this.state.isPhasing;
        this.state.phaseDamageTimer = 0; // Reset damage timer on toggle
        this.net.updateState({ isPhasing: this.state.isPhasing });

        // Apply cooldown only when phasing ends
        if (!this.state.isPhasing) {
            this.state.abilityCooldown = this.config.ability.cooldown;
        }
    }
}
