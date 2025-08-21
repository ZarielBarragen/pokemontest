// Spinda.js

import { Player } from '../Player.js';

export class Spinda extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    /**
     * Activates Confusion Dance.
     * This triggers the visual effect for the local player and broadcasts it to others.
     */
    useAbility() {
        if (this.state.abilityCooldown > 0) return;

        this.state.abilityCooldown = this.config.ability.cooldown;
        this.sfx.select.play(0.7, 1.1);

        // FIX: Use this.game.activeEffects instead of this.state.activeEffects
        this.game.activeEffects.set(this.net.auth.currentUser.uid, {
            name: 'confusionDance',
            x: this.state.x,
            y: this.state.y,
            timer: 10.0, 
            by: this.net.auth.currentUser.uid,
        });

        this.net.broadcastAbility({
            name: 'confusionDance',
            position: { x: this.state.x, y: this.state.y }
        });
    }
}