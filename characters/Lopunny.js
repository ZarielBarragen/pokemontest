// characters/Lopunny.js

import { Player } from '../Player.js';

export class Lopunny extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    useAbility(tryStartSuperHop) {
        if (this.state.abilityCooldown > 0) return;
        
        // --- FIX: Check that the function exists before calling it ---
        if (typeof tryStartSuperHop === 'function') {
            tryStartSuperHop();
            this.state.abilityCooldown = this.config.ability.cooldown;
        } else {
            console.error("Super Hop failed: The tryStartSuperHop function was not provided correctly.");
        }
    }
}