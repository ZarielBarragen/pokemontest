import { Player } from '../Player.js';

/**
 * Represents Quagsire, who has a passive regeneration ability.
 * Since the ability is passive, it doesn't have an active `useAbility` method.
 * The logic for regeneration will be handled in the main game loop by checking the character's config.
 */
export class Quagsire extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    // No active ability to use.
}
