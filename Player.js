/**
 * A base Player class designed to be extended by specific character modules.
 * It holds the shared logic and properties that all characters will use.
 */
export class Player {
    /**
     * @param {object} state The global state object from main.js.
     * @param {object} assets The pre-loaded assets for this character.
     * @param {object} net The network handler instance.
     * @param {object} sfx The sound effects pool.
     * @param {string} characterKey The name of the character (e.g., "Sableye").
     * @param {object} gameContext An object containing shared game maps (e.g., sandTiles).
     */
    constructor(state, assets, net, sfx, characterKey, gameContext = {}) {
        this.state = state;
        this.assets = assets;
        this.net = net;
        this.sfx = sfx;
        this.characterKey = characterKey;
        
        // The character's configuration from characters.json
        this.config = assets.cfg;

        // This gives the class access to shared game maps like sandTiles, poisonTiles, etc.
        this.game = gameContext;
    }

    /**
     * A placeholder for activating a character's primary ability.
     * This method is meant to be overridden by each specific character's class.
     * @param {object} [target] - Optional target for the ability (e.g., another player or a location).
     */
    useAbility(target) {
        console.log(`${this.characterKey} does not have an active ability.`);
    }

    /**
     * A placeholder for deactivating or reverting a character's ability (like for Ditto or Zoroark).
     * This method is meant to be overridden by character classes that have a toggled or temporary ability.
     */
    revertAbility() {
        // Most characters won't need this, but it's here for those that do.
    }
}