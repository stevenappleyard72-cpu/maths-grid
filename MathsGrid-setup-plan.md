# MathsGrid Setup Plan

## Goal
Get the sibling `MathsGrid` project into a clean Git repo, determine the right implementation path, and make it deployable on Render or another web host with a better game and mobile experience.

## Assumptions
- `MathsGrid` is a Unity project, not a Node app.
- The current build may be incomplete, unstable, or poorly suited to mobile.
- Render can host the final browser build, but not a raw Unity editor project.
- If the Unity version is a poor fit, migration to a web app implementation is on the table.

## Phase 1: Inventory the project
1. Confirm the project root contains the Unity standard folders:
   - `Assets/`
   - `Packages/`
   - `ProjectSettings/`
2. Check the Unity editor version from `ProjectSettings/ProjectVersion.txt`.
3. Identify the first playable scene, menus, UI canvases, prefabs, scripts, and any custom build bootstrap code.
4. Check whether the project already has repo metadata, deployment config, or notes about the intended gameplay loop.
5. Record what the game is supposed to do in plain language before changing anything.

## Phase 2: Thorough game review
1. Play through the game from start to finish and verify the core loop.
2. Confirm the target-number rule works as intended.
3. Test drag sequences across the grid with a variety of expressions and layouts.
4. Verify that valid paths are accepted only when the dragged numbers and symbols actually evaluate to the target.
5. Verify that invalid paths are rejected clearly and do not silently fail.
6. Test edge cases such as:
   - negative numbers
   - subtraction chains
   - multiplication and division order
   - repeated symbols
   - path reuse rules
   - diagonal versus orthogonal dragging, if applicable
   - partial gestures and cancelled drags
7. Check whether the game explains the rules well enough for a first-time player.
8. Check whether the win state, score state, hint state, or round state is understandable at a glance.
9. Check whether the game has any softlocks, broken input, or misleading feedback.

## Phase 3: Mechanics review
1. Review how the solution is hidden in the grid.
2. Decide whether the puzzle should feel discoverable, pattern-based, or largely trial-and-error.
3. Review grid size and density:
   - Is the grid large enough to offer interesting paths?
   - Is it small enough to stay readable on mobile?
   - Does the current grid create too many dead ends or too few viable solutions?
4. Review symbol frequency and balance:
   - how many numbers should appear
   - how often operators should appear
   - whether duplicate numbers make the puzzle too easy or too noisy
5. Decide which operators belong in the game:
   - addition
   - subtraction
   - multiplication
   - division
   - exponentiation / to-the-power-of
   - parentheses or grouping, if any
6. Confirm how advanced operators should be represented visually so they are readable in a grid.
7. Decide whether exponentiation should exist at all, and if so whether it should be rare, tutorial-only, or part of the regular difficulty curve.
8. Review whether the player can infer a valid route before dragging, or whether the game needs stronger hints.
9. Check whether the solution path is fair:
   - not hidden too deeply
   - not requiring pixel-perfect dragging
   - not dependent on obscure math conventions
10. Check whether the game should expose partial feedback such as current expression, current value, and remaining distance to target.

## Phase 4: UX and visual review
1. Review the visual hierarchy of the home screen, game screen, and results screen.
2. Check if the game is readable on small phones, tablets, and desktop.
3. Review spacing, typography, contrast, button sizing, and touch target size.
4. Check whether the grid and surrounding UI feel intentional or look like a prototype.
5. Review motion and feedback:
   - drag highlights
   - success and failure feedback
   - transitions between rounds
   - loading or restart states
6. Check whether the game feels stable and polished or visually noisy.
7. Capture what should change to make it look and feel closer in quality to `bird-royale`.

## Phase 5: Decide the implementation path
1. After review, decide whether the current Unity project is worth improving in place.
2. Prefer keeping Unity only if:
   - the gameplay is already close to correct
   - the project is easy to maintain in Unity
   - the mobile/web build behaves well enough after fixing
3. Prefer migration to a web app if:
   - the Unity project is awkward or brittle
   - the UI is hard to make responsive
   - the game logic would be simpler to ship in HTML/CSS/JS
   - the browser/mobile experience is poor in Unity WebGL
4. If migrating, use the `bird-royale` project as the structural reference for the web app architecture, deployment, and mobile layout approach.
5. Do not migrate until the current project has been reviewed well enough to justify that decision.

## Phase 6: Git setup
1. Initialize Git in `MathsGrid` if it is not already a repository.
2. Add a Unity-friendly `.gitignore`.
3. Verify only source assets and project settings are tracked.
4. Exclude generated folders such as:
   - `Library/`
   - `Logs/`
   - `Temp/`
   - `Obj/`
   - `Build/`
   - `Builds/`
5. Create the first commit and push to a new GitHub repo.
6. If asset size is large, decide whether Git LFS is needed before pushing.

## Phase 7: Fix or migrate the game
1. If staying in Unity, fix the actual gameplay bugs and usability problems identified in the review.
2. If migrating, rebuild the game logic first before polishing the UI.
3. Preserve the core target-number mechanic exactly.
4. Recreate the grid interaction so dragging feels reliable on mouse and touch.
5. Make the rules visible in the interface so the player can learn without guessing.
6. Add clear success, failure, and retry states.
7. Design the mobile layout first so the game fits the screen cleanly.
8. Make the UI look finished rather than placeholder-quality.
9. Keep the code split between logic, rendering, and input handling where possible.

## Phase 8: Web deployment readiness
1. Install the Unity WebGL module for the exact editor version used by the project.
2. Switch the build target to WebGL.
3. Confirm the first scene is included in Build Settings.
4. Review player settings for browser compatibility and mobile input.
5. Build the project locally to a dedicated output folder such as `Builds/WebGL`.
6. If migrating away from Unity, instead create a web app build pipeline that produces a browser-ready static site.

## Phase 9: Render deployment
1. Decide whether to deploy the built WebGL output as a static site.
2. If yes, point Render at the exported build folder that contains `index.html`.
3. Confirm asset paths and compression settings work on static hosting.
4. Test the deployed site on mobile and desktop.
5. If the project becomes a web app, set up Render for that stack instead of WebGL.

## Phase 10: Final review
1. Verify the deployed build loads without console errors.
2. Verify the game is playable on mobile browsers.
3. Verify the repo is clean and only intentional files are tracked.
4. Document any remaining caveats, especially if a native downloadable build is still desired.
5. Confirm the game is understandable to a new player without outside explanation.
6. Confirm the game feels visually deliberate and not like a rough prototype.
7. Confirm the build path is repeatable.

## Notes for execution
- Keep changes minimal and focused on deployment readiness.
- Prefer inspecting the controlling files before editing.
- If the project is not ready for WebGL, stop and note the blocker rather than guessing.
- If the project should be migrated, treat the migration as a full rebuild of the front end and keep the original Unity project only as a reference.