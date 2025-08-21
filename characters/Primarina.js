import { Player } from '../Player.js';

export class Primarina extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    useAbility() {
        if (this.state.abilityCooldown > 0) return;
        this.state.abilityTargetingMode = 'bubble';
        // Cooldown will be set in main.js after a successful target
    }
}