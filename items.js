// items.js

// This object holds all the data for items available in the shop.
// Exporting it makes it available to be imported and used in other files.
export const SHOP_ITEMS = {
    // Original Items
    quagsireScale: { 
        name: "Quagsire Scale", 
        price: 100, 
        description: "Slowly regenerate health.",
        icon: "assets/items/quagsire_scale.png"
    },
    sableyeGem: { 
        name: "Sableye Gem", 
        price: 150, 
        description: "Coins are worth double.",
        icon: "assets/items/sableye_gem.png"
    },
    blastoiseBlaster: { 
        name: "Blastoise Blaster", 
        price: 200, 
        description: "Ranged attackers fire two projectiles.",
        icon: "assets/items/blastoise_blaster.png"
    },
    hypnosPendulum: { 
        name: "Hypno's Pendulum", 
        price: 120, 
        description: "Slows nearby players.",
        icon: "assets/items/hypnos_pendulum.png"
    },
    cyclizarMotor: { 
        name: "Cyclizar Motor", 
        price: 250, 
        description: "Doubles your speed.",
        icon: "assets/items/cyclizar_motor.png"
    },

    // New Items
    rockyHelmet: {
        name: "Rocky Helmet",
        price: 175,
        description: "Attackers take recoil damage from your melee attacks.",
        icon: "assets/items/rocky_helmet.png"
    },
    protectivePads: {
        name: "Protective Pads",
        price: 150,
        description: "Immunity to poison and sand tile effects.",
        icon: "assets/items/protective_pads.png"
    },
    scopeLens: {
        name: "Scope Lens",
        price: 225,
        description: "Grants a chance for attacks to deal critical damage.",
        icon: "assets/items/scope_lens.png"
    },
    shellBell: {
        name: "Shell Bell",
        price: 200,
        description: "Restore a small amount of HP when dealing damage.",
        icon: "assets/items/shell_bell.png"
    },
    ghostCharm: {
        name: "Ghost Charm",
        price: 300,
        description: "Activate to phase through a single wall.",
        icon: "assets/items/ghost_charm.png"
    },
    amuletCoin: {
        name: "Amulet Coin",
        price: 125,
        description: "Enemies have a chance to drop an extra coin.",
        icon: "assets/items/amulet_coin.png"
    }
};