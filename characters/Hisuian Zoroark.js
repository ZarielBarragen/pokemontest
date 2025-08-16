import { Player } from '../Player.js';

/**
 * Represents Hisuian Zoroark, a character with the ability to create an illusion of another player.
 */
export class HisuianZoroark extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext) {
        super(state, assets, net, sfx, characterKey, gameContext);
    }

    /**
     * Activates the illusion ability, targeting another player.
     * This changes the player's appearance to match the target for all other players.
     * @param {object} target - The remote player object to create an illusion of.
     * @returns {object} An object indicating a visual-only change is needed.
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

        // Return an object to signal a visual-only change, not a full transformation.
        return { visualKey: target.character, isIllusion: true };
    }

    /**
     * Reverts the illusion, returning the player to their original appearance.
     * @returns {object} An object indicating a visual-only change is needed.
     */
    revertAbility() {
        if (!this.state.isIllusion) return null;

        this.state.isIllusion = false;
        this.state.illusionTarget = null;
        
        // The cooldown is defined in characters.json as 20
        this.state.abilityCooldown = this.config.ability.cooldown;

        // Broadcast to other players that the illusion has ended
        this.net.broadcastAbility({ name: 'revertIllusion' });

        // Also return an object here for consistency.
        return { visualKey: this.state.originalCharacterKey, isIllusion: true };
    }
}