import { Player } from '../Player.js';

/**
 * Represents Cacturne, who can lay a sand trap on the ground.
 */
export class Cacturne extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Places a Sand Snare trap at the targeted tile location.
     * @param {object} targetTile - An object with {x, y} properties for the tile coordinates.
     */
    useAbility(targetTile) {
        if (!targetTile) return;

        this.net.broadcastAbility({ name: 'sandSnare', tileX: targetTile.x, tileY: targetTile.y });
        this.state.abilityCooldown = this.config.ability.cooldown;
    }
}
