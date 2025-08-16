import { Player } from '../Player.js';

/**
 * Represents Hisuian Zoroark, a character with the ability to create an illusion of another player.
 */
export class HisuianZoroark extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Activates the illusion ability, targeting another player.
     * This changes the player's appearance to match the target for all other players.
     * @param {object} target - The remote player object to create an illusion of.
     * @returns {string} The character key of the target to apply the visual change locally.
     */
    useAbility(target) {
        if (!target) return null;

        this.state.isIllusion = true;
        
        // Store a lightweight version of the target for replication
        this.state.illusionTarget = {
            uid: target.uid,
            username: target.username,
            character: target.character,
            level: target.level
        };

        // Broadcast to other players that the illusion has started
        this.net.broadcastAbility({ name: 'illusion', target: this.state.illusionTarget });

        // Return the target's character key to change the local player's assets
        return target.character;
    }

    /**
     * Reverts the illusion, returning the player to their original appearance.
     * @returns {string} The original character key to revert the visual change locally.
     */
    revertAbility() {
        if (!this.state.isIllusion) return null;

        this.state.isIllusion = false;
        this.state.illusionTarget = null;
        
        // The cooldown is defined in characters.json as 20
        this.state.abilityCooldown = this.config.ability.cooldown;

        // Broadcast to other players that the illusion has ended
        this.net.broadcastAbility({ name: 'revertIllusion' });

        // Return the original key to change assets back
        return this.state.originalCharacterKey;
    }
}