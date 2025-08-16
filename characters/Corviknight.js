import { Player } from '../Player.js';

/**
 * Represents Corviknight, who has a passive flight ability.
 * The flight logic is handled during the hop action in the main game loop.
 */
export class Corviknight extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    // No active ability to use.
}
