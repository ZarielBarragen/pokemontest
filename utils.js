// This is the game's base tile size.
export const TILE = 48;

// This helper function checks if a player is facing a target.
// We're moving it here from main.js so enemies can use it too.
export function isFacing(player, target) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;

    switch (player.dir) {
        case 'right':     return dx > 0 && Math.abs(dx) > Math.abs(dy);
        case 'left':      return dx < 0 && Math.abs(dx) > Math.abs(dy);
        case 'down':      return dy > 0 && Math.abs(dy) > Math.abs(dx);
        case 'up':        return dy < 0 && Math.abs(dy) > Math.abs(dx);
        case 'downRight': return dx > 0 && dy > 0;
        case 'downLeft':  return dx < 0 && dy > 0;
        case 'upRight':   return dx > 0 && dy < 0;
        case 'upLeft':    return dx < 0 && dy < 0;
    }
    return false;
}