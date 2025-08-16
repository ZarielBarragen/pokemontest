import { Player } from '../Player.js';

/**
 * Represents Smeargle, who can copy the ability of another player.
 */
export class Smeargle extends Player {
    constructor(state, assets, net, sfx, characterKey) {
        super(state, assets, net, sfx, characterKey);
    }

    /**
     * Copies the active ability of a target player.
     * @param {object} targetPlayer - The remote player whose ability to copy.
     */
    useAbility(targetPlayer) {
        if (!targetPlayer) return;

        const targetCharacterKey = targetPlayer.originalCharacterKey || targetPlayer.character;
        // We need access to the global CHARACTERS object for this.
        // This is a good example of why we might pass a 'game context' object
        // to our player classes in a more advanced setup.
        const targetCharacterConfig = window.CHARACTERS[targetCharacterKey];

        if (targetCharacterConfig?.ability?.type === 'active') {
            this.state.copiedAbility = { ...targetCharacterConfig.ability };
            console.log(`Smeargle copied ${this.state.copiedAbility.name}!`);
            // Cooldown is handled when the copied ability is used.
        } else {
            console.log("Target has no active ability to copy.");
        }
    }
}
