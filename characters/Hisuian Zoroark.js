import { Player } from '../Player.js';

/**
 * Represents Hisuian Zoroark, who can create illusions.
 */
export class HisuianZoroark extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Creates an illusion, making Zoroark appear as the target player.
     * @param {object} targetPlayer - The remote player to create an illusion of.
     * @returns {string|null} The character key for the illusion, or null if failed.
     */
    useAbility(targetPlayer) {
        if (this.state.isIllusion || !targetPlayer) return null;

        this.state.isIllusion = true;
        this.state.originalCharacterKey = this.characterKey; // Store original key
        this.state.illusionTarget = {
            username: targetPlayer.username,
            level: targetPlayer.level,
            character: targetPlayer.originalCharacterKey || targetPlayer.character
        };

        this.net.broadcastAbility({ name: 'illusion', target: this.state.illusionTarget });
        this.state.abilityCooldown = this.config.ability.cooldown;
        
        return this.state.illusionTarget.character;
    }

    /**
     * Reverts the illusion, returning Zoroark to its normal appearance.
     * @returns {string|null} The original character key to revert to, or null if not in illusion.
     */
    revertAbility() {
        if (!this.state.isIllusion) return null;

        const originalKey = this.state.originalCharacterKey;
        this.state.isIllusion = false;
        this.state.illusionTarget = null;
        this.state.originalCharacterKey = null;
        this.state.abilityCooldown = 0; // FIX: Reset cooldown
        this.net.broadcastAbility({ name: 'revertIllusion' });
        return originalKey;
    }
}
