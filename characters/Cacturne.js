import { Player } from '../Player.js';

/**
 * Represents Cacturne, a character that can place sand traps on the ground.
 * The logic for creating the trap is contained entirely within this file.
 */
export class Cacturne extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext) {
        // Pass the new gameContext to the parent Player class
        super(state, assets, net, sfx, characterKey, gameContext);
    }

    /**
     * Executes the Sand Snare ability at a targeted location.
     * This function creates the 3x3 trap locally and tells the server to create it for others.
     * @param {object} target - An object containing the tile coordinates {x, y} of the click.
     */
    useAbility(target) {
        if (!target || target.x === null || target.y === null || !this.game.sandTiles) return;

        // Set the cooldown from characters.json
        this.state.abilityCooldown = this.config.ability.cooldown;

        // --- Local Action: Create the trap immediately for the player ---
        // The sand trap lasts for 5 seconds (as defined in your main.js update loop)
        for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
                const key = `${target.x + x},${target.y + y}`;
                this.game.sandTiles.set(key, { life: 5 });
            }
        }

        // --- Network Action: Tell other players where to create the trap ---
        this.net.broadcastAbility({
            name: 'sandSnare',
            tileX: target.x,
            tileY: target.y
        });
    }
}