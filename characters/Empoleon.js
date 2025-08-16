import { Player } from '../Player.js';

/**
 * Represents Empoleon, who has a passive Aqua Shield ability.
 * The logic for this is handled in the main update loop.
 */
export class Empoleon extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    // No active ability to use. The Aqua Shield is passive.
}
