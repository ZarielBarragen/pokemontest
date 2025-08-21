// characters/Excadrill.js

import { Player } from '../Player.js';

export class Excadrill extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext, allCharsConfig) {
        super(state, assets, net, sfx, characterKey, gameContext, allCharsConfig);
    }

    // Excadrill has no special ability defined yet, but this is where it would go.
    useAbility() {
        console.log("Excadrill has no active ability.");
    }
}