export default class Player {
    constructor(game, name, characterName, tile_x, tile_y) {
        this.game = game;
        this.name = name;
        this.characterName = characterName;

        // Position and movement
        this.tile_x = tile_x;
        this.tile_y = tile_y;
        this.pixel_x = this.tile_x * 32;
        this.pixel_y = this.tile_y * 32;
        this.base_speed = 2; // The player's normal speed
        this.speed = 2;      // The player's current speed (can be modified by effects)
        this.moving = false;
        this.target_pixel_x = this.pixel_x;
        this.target_pixel_y = this.pixel_y;

        // Stats
        this.max_health = 100;
        this.health = 100;
        this.level = 1;
        this.coins = 0;

        // Transformation state (for Ditto)
        this.is_transformed = false;
        this.original_character = null;

        // Status effects (for Scolipede's poison)
        this.status_effects = {};

        // Character-specific logic
        this.character = new character_classes[this.characterName](this, this.game);
        this.sprite = this.character.sprite;

        // UI Elements
        this.name_tag = new Text(this.game.contexts.players, this.name, this.pixel_x, this.pixel_y - 10);
        this.level_tag = new Text(this.game.contexts.players, "Lv " + this.level, this.pixel_x, this.pixel_y);
    }

    // Called every frame
    update(delta) {
        // Check for slowing traps from Cacturne
        if (this.game.is_sand_trap(this.tile_x, this.tile_y)) {
            this.speed = this.base_speed * 0.7; // Apply 30% slow
        } else {
            this.speed = this.base_speed; // Reset to normal speed
        }

        this.update_position(delta);
        this.character.update(delta);
        this.sprite.update(delta);

        // Update UI element positions
        this.name_tag.x = this.pixel_x + 16;
        this.name_tag.y = this.pixel_y - 10;
        this.level_tag.x = this.pixel_x + 16;
        this.level_tag.y = this.pixel_y;

        // Handle status effects
        this.handle_status_effects(delta);
    }

    handle_status_effects(delta) {
        // Handle poison
        if (this.status_effects.poison) {
            let poison = this.status_effects.poison;
            poison.duration -= delta;
            
            if (Date.now() - poison.last_tick > poison.interval) {
                this.take_damage(poison.damage);
                poison.last_tick = Date.now();
            }

            if (poison.duration <= 0) {
                delete this.status_effects.poison;
            }
        }
    }

    apply_poison(duration, damage, interval) {
        if (!this.status_effects.poison) {
            this.status_effects.poison = {
                duration: duration,
                damage: damage,
                interval: interval,
                last_tick: Date.now()
            };
        }
    }

    // Draws the player and their UI
    draw() {
        this.sprite.draw(this.pixel_x, this.pixel_y);
        this.name_tag.draw();
        this.level_tag.draw();
    }

    // Changes the player's character
    change_character(name) {
        this.characterName = name;
        this.character = new character_classes[name](this, this.game);
        this.sprite = this.character.sprite;

        // If we are reverting a transformation, reset the state
        if (this.is_transformed && name === this.original_character) {
            this.is_transformed = false;
            this.original_character = null;
        }
    }

    // Moves the player one tile in a direction
    move(dir_x, dir_y) {
        if (this.moving) return;

        let new_tile_x = this.tile_x + dir_x;
        let new_tile_y = this.tile_y + dir_y;

        if (this.game.is_walkable(new_tile_x, new_tile_y)) {
            this.tile_x = new_tile_x;
            this.tile_y = new_tile_y;
            this.target_pixel_x = this.tile_x * 32;
            this.target_pixel_y = this.tile_y * 32;
            this.moving = true;
            this.character.on_move();
        }
    }

    // Smoothly moves the player to their target position
    update_position(delta) {
        if (!this.moving) return;

        let diff_x = this.target_pixel_x - this.pixel_x;
        let diff_y = this.target_pixel_y - this.pixel_y;

        if (Math.abs(diff_x) < this.speed && Math.abs(diff_y) < this.speed) {
            this.pixel_x = this.target_pixel_x;
            this.pixel_y = this.target_pixel_y;
            this.moving = false;
            return;
        }

        if (Math.abs(diff_x) > 0) {
            this.pixel_x += Math.sign(diff_x) * this.speed;
        }
        if (Math.abs(diff_y) > 0) {
            this.pixel_y += Math.sign(diff_y) * this.speed;
        }
    }

    // Handles key presses
    on_key_down(e) {
        // Handle detransformation for Ditto
        if (this.is_transformed && e.key === 'e') {
            this.change_character(this.original_character);
            return; // Stop further key processing
        }
        this.character.on_key_down(e);
    }

    // Handles mouse clicks
    on_click(e) {
        this.character.on_click(e);
    }

    // Checks for collision with another entity
    is_colliding_with(other_player) {
        return this.tile_x === other_player.tile_x && this.tile_y === other_player.tile_y;
    }

    // Reduces health
    take_damage(amount) {
        this.health -= amount;
        if (this.health < 0) this.health = 0;
        
        // Break Hisuian Zoroark's illusion on taking damage
        if (this.characterName === "Hisuian Zoroark" && this.character.is_illusion_active) {
            this.character.revert_illusion();
        }
    }
}
