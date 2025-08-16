import { Player } from '../Player.js';

/**
 * Represents Smeargle, who can copy the ability of another player.
 */
export class Smeargle extends Player {
    constructor(state, assets, net, sfx, characterKey, gameContext) {
        super(state, assets, net, sfx, characterKey, gameContext);
    }

    /**
     * Copies the active ability of a target player.
     * @param {object} targetPlayer - The remote player whose ability to copy.
     */
    useAbility(targetPlayer) {
        if (!targetPlayer) return;

        console.log("--- Smeargle Debug Start ---");

        // 1. Let's see what the target player object looks like
        console.log("Target Player Object:", targetPlayer);

        const targetCharacterKey = targetPlayer.originalCharacterKey || targetPlayer.character;
        // 2. Let's confirm we're getting the correct character name (should be "Sableye")
        console.log("Resolved Target Key:", targetCharacterKey);

        const targetCharacterConfig = CHARACTERS[targetCharacterKey];
        // 3. Let's see the configuration object found for that key
        console.log("Target's Config from CHARACTERS:", targetCharacterConfig);

        // 4. Let's check the ability object specifically
        console.log("Target's Ability Object:", targetCharacterConfig?.ability);

        if (targetCharacterConfig?.ability?.type === 'active') {
            this.state.copiedAbility = { ...targetCharacterConfig.ability };
            console.log(`SUCCESS: Smeargle copied ${this.state.copiedAbility.name}!`);
        } else {
            console.error("FAILURE: Target has no active ability to copy.");
        }
        
        console.log("--- Smeargle Debug End ---");
    }
}