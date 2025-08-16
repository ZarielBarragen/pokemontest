import { Player } from '../Player.js';

/**
 * Represents Smeargle, who can copy the active ability of another player.
 */
export class Smeargle extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext) {
        super(state, assets, net, sfx, characterKey, gameContext, CHARACTERS);
    }

    /**
     * Copies the active ability of a target player.
     * @param {object} targetPlayer - The remote player whose ability to copy.
     */
    useAbility(targetPlayer) {
        if (!targetPlayer) return;

        const targetCharacterKey = targetPlayer.originalCharacterKey || targetPlayer.character;
        
        // Use the injected master list instead of a global variable
        const targetCharacterConfig = this.ALL_CHARS[targetCharacterKey];

        // Check if the target has an ability and it's active (not passive)
        if (targetCharacterConfig?.ability?.type === 'active') {
            this.state.copiedAbility = { ...targetCharacterConfig.ability };
            console.log(`Smeargle copied ${this.state.copiedAbility.name}!`);
        } else {
            // If the target has no active ability, we'll store a "dud" passive ability
            this.state.copiedAbility = { name: 'None', type: 'passive' };
            console.log("Target has no active ability to copy.");
        }
    }
}