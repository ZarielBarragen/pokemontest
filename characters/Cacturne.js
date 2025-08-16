character_classes["Cacturne"] = class extends Character {
    constructor(player, game) {
        super(player, game);
        this.sprite = new Sprite(this.game.contexts.players, "assets/Cacturne/walk.png", 4, 1, 0, 0, 32, 32, 150);
        
        // State for placing traps
        this.is_placing_trap = false;
    }

    on_key_down(e) {
        // Press 'e' to enter or exit trap placement mode
        if (e.key === 'e') {
            this.is_placing_trap = !this.is_placing_trap;
            // You could add a UI element here to show that trap mode is active
            console.log("Trap placement mode:", this.is_placing_trap);
        }
    }

    on_click(e) {
        // If in trap placement mode, try to place a trap where the user clicked
        if (this.is_placing_trap) {
            const rect = this.game.canvases.players.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const tile_x = Math.floor(x / 32);
            const tile_y = Math.floor(y / 32);

            // Place the trap and exit trap placement mode
            this.game.place_trap(tile_x, tile_y);
            this.is_placing_trap = false;
        }
    }
}
