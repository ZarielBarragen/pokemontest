import { Player } from '../Player.js';

/**
 * Represents Decidueye, whose passive ability gives ranged attacks a homing property.
 * This logic is handled within the `tryRangedAttack` function in main.js.
 */
export class Decidueye extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    // No active ability to use.
}
