# Overclock

A block puzzle set on a circuit board, for iOS, Android and the web. Built with Expo SDK 57 and React Native.

## Play

```sh
npm install
npx expo start --go
```

- Phone: install Expo Go from the App Store or Google Play, then scan the QR code with the camera (iOS) or Expo Go (Android). Without `--go`, `expo start` targets a development build (see Builds and updates); press `s` in the terminal to switch.
- Browser: press `w` in the Expo terminal, or run `npx expo start --web`.
- Static web build: `npx expo export -p web` writes a self-contained site to `dist/`.

## Rules

- A new game starts with a few parts already on the board.
- Drag parts from the three sockets (U1–U3) onto the 8×8 board.
- Fill a row or column to clear it. Rows and columns clear together.
- When all three parts are placed, a new set is dealt. Every new set has at least one part that fits in some rotation.
- The game ends when no remaining part fits in any rotation.
- Past 20,000 points the game gets harder: sets lean toward bigger parts with fewer single squares, cores turn up less often, and new terminals sit farther apart (up to a 12-square circuit). It reaches full strength at 80,000.
- Tap **?** at the top of the screen for a summary of these rules. It opens on its own the first time you play. Sound and vibration are switched on and off there too.

## Rotation

- Press the Rotate button under a part to turn it 90° clockwise. Rotations are free and unlimited.
- A glowing Rotate button means that part only fits after rotating. A greyed-out part doesn't fit in any rotation.

## Circuits

- A power input (+) and an output (−) sit in the margin around the board, each beside one square on any of the four edges. They're always far enough apart that a circuit takes at least 7 squares.
- Fill the square next to each terminal and connect them with an unbroken chain of filled squares, touching edge to edge, to complete a circuit.
- A spark runs from + to − along the shortest path. Then the path and every filled square touching it edge to edge clear together. It counts as a clearing move for combos, and any cores caught in the clear detonate.
- Both terminals then move to new spots, never to a pair that's already connected. While dragging, a placement that would complete a circuit highlights its path and every filled square touching it in violet, a colour no part uses, with a lightning mark on each so the highlight doesn't depend on seeing colour.

## Cores

- Some sets include a part with a glowing core cell. Cores come in two kinds:
  - **Line cores** (gold square frame) blast their entire row and column.
  - **Area cores** (round, with a pink centre) blast the 3×3 square around them.
- A core detonates when a cleared line contains it.
- A core caught in another core's blast detonates as well, so cores of either kind can chain.

## Daily circuit

- Tap the calendar at the top left for today's daily circuit. Everyone gets the same starting board and parts, and the same deals for the same moves, from a seed for the local date.
- You get one try a day: the daily has no restart. When it ends, its result stays up for the rest of the day, with a Share button. Where the browser can't share, it copies the result instead.
- Finishing the daily on consecutive days builds a streak. Your endless game is kept and resumes when you switch back.
- At local midnight, or when the app returns to the foreground on a new day, a dot on the calendar shows the new daily is waiting. A daily you're partway through at midnight can still be finished and counts for its own day.

## Stats

- Tap the peak score at the top left to see your stats.
- Endless: games played, average score and peak score. A game counts when no part fits, or when you restart after placing a part.
- Daily circuit: dailies played, best daily score, current streak and best streak.
- All games, daily included: lines cleared, circuits completed, best combo, most cores set off by one move, and boards emptied.

## Scoring

- 10 points per cell placed.
- Clearing n lines in one move scores 50·n·(n+1) (100, 300, 600, 1,000…), multiplied by the current combo.
- Each extra cell destroyed by a core adds 40.
- The combo grows with each clearing move and resets after 3 moves in a row without a clear.
- Completing a circuit adds 50 per square on its path and 40 per square touching the path, except squares in a line cleared by the same move.
- Emptying the whole board adds 3,000.

## Sound

- Effects play when you lift, rotate or place a part, clear lines, set off a core, run a circuit spark, empty the board, and when the game ends.
- They mix with other audio, and the phone's silent switch mutes them.
- Line clears rise a whole tone with each step of the combo, up to an octave.
- The effects are synthesized in code: `node scripts/make-sounds.mjs` rewrites the WAV files in `assets/sounds/`.

Peak score, stats, the game in progress, today's daily circuit and your last daily result, the sound and vibration settings, and whether you've seen the rules are saved on the device (AsyncStorage, which is `localStorage` on the web).

## Dragging

- Touch: the part's centre floats about two cells above your finger and moves 1.4× as far, so your finger stays clear of where it lands.
- Mouse: the part sits on the cursor and moves with it 1:1.
- The shadow and the drop use the nearest open spot within one cell of the part.
- Screen readers: double-tap a socket to choose its part, then double-tap a board square to place the part with its top-left corner there. Each socket says when its part only fits after rotating or doesn't fit at all, every square reads its contents, and the result of each placement is announced.

## Scripts

```sh
npm test              # unit tests (Jest)
npm run lint          # ESLint via expo lint
npm run typecheck     # tsc --noEmit
npm run format:check  # Prettier
```

## Builds and updates

The app is linked to the EAS project `@jchen27/overclock`. Profiles live in `eas.json`, and each one publishes to the update channel of the same name. The iOS app is iPhone only; iPads run it in iPhone mode.

The store listing, screenshots, privacy answers and the launch checklist are in [store/README.md](store/README.md). The web version, privacy policy and support page are live at https://overclock.expo.app/.

- Development build, a dev client with hot reload: `npx eas-cli@latest build --profile development --platform ios`
- Preview build, an internal test build without dev tools: `npx eas-cli@latest build --profile preview --platform android`
- Store build, with the build number bumped automatically: `npx eas-cli@latest build --profile production --platform all`
- Upload the latest production build to TestFlight: `npx eas-cli@latest submit --platform ios`
- Ship JS changes over the air: `npx eas-cli@latest update --channel preview --environment preview --message "..."`
- Every merge to `main` runs the Deploy workflow (`.github/workflows/deploy.yml`). It publishes an update to the `preview` channel and redeploys the web version to https://overclock.expo.app/. To update the store apps, run the workflow by hand from the Actions tab with the `production` channel. It needs an `EXPO_TOKEN` repository secret, made at https://expo.dev/settings/access-tokens.
- Over-the-air updates only reach builds with the same app `version` (runtime policy `appVersion`). Bump `version` in `app.json` whenever a change adds or upgrades a native module, then make new builds.
- iOS device builds need an Apple Developer account, and development and preview builds need the device registered first (`npx eas-cli@latest device:create`). Store submission needs Apple Developer or Google Play developer membership.

## Layout

```
App.tsx                 font loading, splash screen, safe-area provider
src/Game.tsx            game screen: state transitions, timers, layout
src/engine.ts           pure game logic: pieces, rotation, line clears, cores, circuits and terminals, scoring, save validation
src/daily.ts            daily circuit: day numbers, seeded deals, streaks, share text
src/stats.ts            lifetime stats, updated from each move and finished game
src/drag.ts             drag geometry, nearest-spot targeting and the clear preview
src/useDragGestures.ts  pan gestures, shared values, layout measuring, preview state
src/fx.ts               builds the line-clear effects for a placement
src/describe.ts         screen-reader descriptions of parts, squares and placements
src/storage.ts          saved game and its migrations, peak score, stats, daily run and result, settings, help-seen flag
src/haptics.ts          vibration patterns
src/sound.ts            sound effects
src/theme.ts            colors, fonts, board sizing
src/format.ts           number formatting
src/components/         Board, Tray, Ghost, Shadow, Hud, Sheet, Help, Stats, Fx, GameOver, Led, ErrorBoundary, Background, Icons
src/__tests__/          unit tests
scripts/make-sounds.mjs synthesizes the sound effects into assets/sounds/
public/                 privacy and support pages, copied into the web build
store/                  store listing, screenshots and launch checklist; App Store text is in store.config.json
```
