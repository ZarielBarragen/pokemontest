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
     */
    useAbility(targetPlayer) {
        if (this.state.isIllusion || !targetPlayer) return;

        this.state.isIllusion = true;
        this.state.illusionTarget = {
            username: targetPlayer.username,
            level: targetPlayer.level,
            character: targetPlayer.originalCharacterKey || targetPlayer.character
        };

        this.net.broadcastAbility({ name: 'illusion', target: this.state.illusionTarget });
        this.state.abilityCooldown = this.config.ability.cooldown;
    }

    /**
     * Reverts the illusion, returning Zoroark to its normal appearance.
     */
    revertAbility() {
        if (!this.state.isIllusion) return;

        this.state.isIllusion = false;
        this.state.illusionTarget = null;
        this.net.broadcastAbility({ name: 'revertIllusion' });
    }
}
