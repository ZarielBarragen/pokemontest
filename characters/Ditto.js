import { Player } from '../Player.js';

/**
 * Represents Ditto, who can transform into other characters.
 */
export class Ditto extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Transforms Ditto into a target player's character.
     * @param {object} targetPlayer - The remote player object to transform into.
     */
    useAbility(targetPlayer) {
        if (this.state.isTransformed || !targetPlayer) return;

        this.state.isTransformed = true;
        this.state.originalCharacterKey = this.characterKey;
        const targetKey = targetPlayer.originalCharacterKey || targetPlayer.character;

        // The actual asset changing will be handled in main.js
        console.log(`Ditto is transforming into ${targetKey}`);

        this.net.broadcastAbility({ name: 'transform', targetCharacterKey: targetKey });
        this.state.abilityCooldown = this.config.ability.cooldown;
    }

    /**
     * Reverts Ditto's transformation back to its original form.
     */
    revertAbility() {
        if (!this.state.isTransformed) return;
        
        const originalKey = this.state.originalCharacterKey;
        this.state.isTransformed = false;
        this.state.originalCharacterKey = null;

        console.log(`Ditto is reverting to its original form.`);
        this.net.broadcastAbility({ name: 'transform', targetCharacterKey: originalKey, isRevert: true });
    }
}
