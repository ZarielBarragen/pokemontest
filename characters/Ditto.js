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
     * @returns {string|null} The character key to transform into, or null if failed.
     */
    useAbility(targetPlayer) {
        if (this.state.isTransformed || !targetPlayer) return null;

        this.state.isTransformed = true;
        this.state.originalCharacterKey = this.characterKey;
        const targetKey = targetPlayer.originalCharacterKey || targetPlayer.character;

        this.net.broadcastAbility({ name: 'transform', targetCharacterKey: targetKey });
        this.state.abilityCooldown = this.config.ability.cooldown;
        
        return targetKey; // Return the key to transform into
    }

    /**
     * Reverts Ditto's transformation back to its original form.
     * @returns {string|null} The original character key to revert to, or null if not transformed.
     */
    revertAbility() {
        if (!this.state.isTransformed) return null;
        
        const originalKey = this.state.originalCharacterKey;
        this.state.isTransformed = false;
        this.state.originalCharacterKey = null;
        this.state.abilityCooldown = 0; // FIX: Reset cooldown

        this.net.broadcastAbility({ name: 'transform', targetCharacterKey: originalKey, isRevert: true });
        return originalKey; // Return the key to revert to
    }
}
