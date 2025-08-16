character_classes["Hisuian Zoroark"] = class extends Character {
    constructor(player, game) {
        super(player, game);
        this.sprite = new Sprite(this.game.contexts.players, "assets/Hisuian Zoroark/walk.png", 4, 1, 0, 0, 32, 32, 150);
        
        // Illusion state
        this.is_illusion_active = false;
        this.original_sprite = this.player.sprite;
        this.original_name = this.player.name;
        this.original_level = this.player.level;
    }

    on_key_down(e) {
        if (e.key === 'e') {
            if (this.is_illusion_active) {
                // Revert the illusion if already active
                this.revert_illusion();
            } else {
                // Create an illusion of a nearby player
                for (let other_player of this.game.players) {
                    if (other_player !== this.player && this.player.is_colliding_with(other_player)) {
                        this.create_illusion(other_player);
                        break;
                    }
                }
            }
        }
    }

    create_illusion(target_player) {
        if (this.is_illusion_active) return;

        this.is_illusion_active = true;
        
        // Store original visual data
        this.original_sprite = this.player.sprite;
        this.original_name = this.player.name_tag.text;
        this.original_level = this.player.level_tag.text;

        // Apply the illusion's visual data
        this.player.sprite = target_player.sprite;
        this.player.name_tag.text = target_player.name_tag.text;
        this.player.level_tag.text = target_player.level_tag.text;
    }

    revert_illusion() {
        if (!this.is_illusion_active) return;

        this.is_illusion_active = false;

        // Restore original visual data
        this.player.sprite = this.original_sprite;
        this.player.name_tag.text = this.original_name;
        this.player.level_tag.text = this.original_level;
    }
}
