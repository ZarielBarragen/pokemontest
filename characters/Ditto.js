import { Player } from '../Player.js';

/**
 * Represents Ditto, who can transform into other non-Ditto players.
 */
export class Ditto extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext) {
        super(state, assets, net, sfx, characterKey, gameContext);
    }

    /**
     * Activates the transform ability, targeting another player.
     * @param {object} target - The remote player object to transform into.
     * @returns {string|null} The character key of the target to apply the visual change locally, or null if invalid.
     */
    useAbility(target) {
        // Can't transform into another Ditto or if no target is provided
        if (!target || target.character === 'Ditto') {
            return null;
        }

        this.state.isTransformed = true;
        this.state.originalCharacterKey = 'Ditto'; // Hardcode the original key

        // Tell other players what we transformed into
        this.net.broadcastAbility({
            name: 'transform',
            targetCharacterKey: target.character
        });

        // Return the new character key so main.js can change the assets locally
        return target.character;
    }

    /**
     * Reverts the transformation back to Ditto.
     * @returns {string} The original character key ("Ditto") to revert the visual change locally.
     */
    revertAbility() {
        if (!this.state.isTransformed) return null;

        this.state.isTransformed = false;
        
        // The cooldown is defined in characters.json
        this.state.abilityCooldown = this.config.ability.cooldown;

        // Tell other players we have reverted
        this.net.broadcastAbility({
            name: 'transform',
            isRevert: true
        });

        // Return the original key to change assets back
        return this.state.originalCharacterKey;
    }
}