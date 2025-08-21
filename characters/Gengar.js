// characters/Gengar.js

import { Player } from '../Player.js';

export class Gengar extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    useAbility() {
        if (this.state.abilityCooldown > 0) return;

        this.state.isPhasing = !this.state.isPhasing;
        this.state.phaseDamageTimer = 0; // Reset timer when toggling
        this.net.updateState({ isPhasing: this.state.isPhasing });

        // A short cooldown prevents spamming the toggle
        this.state.abilityCooldown = this.config.ability.cooldown; 
    }
}