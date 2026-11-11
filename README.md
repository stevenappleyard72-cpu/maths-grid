# Sum Surge

MathsGrid reimagined as a quick number-connecting arcade game. Connect at least two neighbouring tiles (diagonals count) to add up to one of three targets. Cleared tiles disappear, the columns fall, and fresh numbers arrive.

Long chains and charged tiles earn extra points. Consecutive clears within seven seconds build a multiplier up to ×5. Five clears unlock ten seconds of double points. Rush and Daily start with 90 seconds and award two seconds per clear; Zen has no timer. Three hints and two shuffles are available per run, each resetting the combo.

## Run locally

Use Node.js 24.15+ (or Node.js 22.22.2+).

```sh
npm ci
npm run dev
```

Open http://localhost:4173. On PowerShell systems that block `npm.ps1`, use `npm.cmd`.

```sh
npm test
npm run build
npm start
```

The Express server serves the production build on port 4173 (or `PORT`). The game works entirely in the browser; scores and audio settings are saved on the current device. Daily uses the London calendar date and a deterministic board/refill sequence; player choices determine how the sequence unfolds. No accounts or external assets are required.

## Controls

- Drag through adjacent tiles and release on the target, or tap one tile at a time.
- Drag back one tile to undo; Escape clears a selection or pauses.
- Keyboard: Tab into the grid, arrow keys to move, Space/Enter to select, Backspace to undo.
- Leaving the tab pauses the timer and sound. Music and all audio have separate controls.

The new pure rules live in `src/surgeEngine.js`, the procedural Web Audio instruments in `src/audio.js`, and the interface in `src/main.js`. The original equation engine remains in `src/gameEngine.js` with its existing tests for reference.
