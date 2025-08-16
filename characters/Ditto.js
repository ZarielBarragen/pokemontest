character_classes["Ditto"] = class extends Character {
    constructor(player, game) {
        super(player, game);
        this.sprite = new Sprite(this.game.contexts.players, "assets/Ditto/walk.png", 4, 1, 0, 0, 32, 32, 150);
    }

    on_key_down(e) {
        // When 'e' is pressed and Ditto is NOT already transformed
        if (e.key === 'e' && !this.player.is_transformed) {
            // Find a nearby player to transform into
            for (let other_player of this.game.players) {
                // Check for collision and ensure it's not another Ditto
                if (other_player !== this.player && this.player.is_colliding_with(other_player) && other_player.characterName !== "Ditto") {
                    this.transform(other_player);
                    break; // Transform and stop searching
                }
            }
        }
    }

    transform(target_player) {
        // Set the player's transformation state
        this.player.original_character = "Ditto";
        this.player.is_transformed = true;
        // Change the character
        this.player.change_character(target_player.characterName);
    }
}
