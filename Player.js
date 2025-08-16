/**
 * Player.js - The base class for all playable characters in the game.
 * It handles all the shared logic, such as movement, animation, state management,
 * and drawing the character on the canvas. Character-specific abilities will
 * be handled in subclasses that extend this Player class.
 */
export class Player {
    /**
     * Constructs a new Player instance.
     * @param {object} state - The global game state object. This will be shared and modified by the player.
     * @param {object} assets - The loaded image assets and animation metadata for this character.
     * @param {object} net - The network handler instance for sending updates to the server.
     * @param {object} sfx - The sound effects pool.
     * @param {string} characterKey - The key of the character (e.g., "Sableye").
     */
    constructor(state, assets, net, sfx, characterKey) {
        this.state = state;
        this.assets = assets;
        this.net = net;
        this.sfx = sfx;
        this.characterKey = characterKey;
        this.config = assets.cfg;
    }

    /**
     * The main update loop for the player, called every frame.
     * @param {number} dt - Delta time, the time in seconds since the last frame.
     */
    update(dt) {
        // This is a placeholder for logic that runs every frame for all characters.
        // In a more advanced structure, you might handle things like passive regeneration here.
    }

    /**
     * Placeholder for activating a character's special ability.
     * This method is intended to be overridden by character subclasses.
     * @param {object} [target=null] - Optional target for the ability (e.g., another player).
     */
    useAbility(target = null) {
        console.log(`${this.config.name} has no active ability.`);
    }

    /**
     * Placeholder for reverting an ongoing ability effect, like a transformation.
     * This method can be overridden by character subclasses if their ability has a revert state.
     */
    revertAbility() {
        // Default behavior is to do nothing.
    }
}
