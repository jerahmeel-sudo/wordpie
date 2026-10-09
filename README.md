# Wordpie

A word game for 2 to 8 players. Change one letter of the current word to make a new real word before your clock runs out. Run out of time or give up and you're out. The last player standing wins.

- **On one phone**: players pass the device around.
- **Online with friends**: the host shares an invite link, and everyone plays on their own phone. No accounts or passwords.

## Files

| File | What it is |
|---|---|
| `index.html` | The game. Edit this one. |
| `build.mjs` | Builds the uploadable page from `index.html`. |
| `site/index.html` | The page to upload. Rebuilt by `node build.mjs`. |
| `site/firebase-config.js` | Your Firebase settings for online play. |
| `database.rules.json` | Security rules to paste into Firebase. |

After any change to `index.html`, rebuild:

```bash
node build.mjs
```

## Setup: online play with Firebase (about 10 minutes, free)

1. Go to https://console.firebase.google.com and click **Create a project**. Name it `wordpie`. You can turn Google Analytics off.
2. **Turn on anonymous sign-in.** Go to **Build → Authentication → Get started → Sign-in method**, then enable **Anonymous**. Players never see a sign-in screen. Each phone just gets a hidden ID, which is how rejoining works.
3. **Create the database.** Go to **Build → Realtime Database → Create database**:
   - Location: **Belgium (europe-west1)**, the closest option to Nigeria.
   - Start in **locked mode**.
4. **Paste the rules.** In the database, open the **Rules** tab, replace everything with the contents of `database.rules.json`, and click **Publish**.
5. **Register the web app.** Go to **Project settings (gear icon) → General → Your apps**, then click the web icon `</>`. Name it `wordpie` and leave Firebase Hosting unticked. Firebase shows a `firebaseConfig` block.
6. Copy `apiKey`, `authDomain`, `databaseURL`, `projectId` and `appId` into `site/firebase-config.js`. These values are meant to be public. The rules from step 4 protect the data.
7. **Allow your domain.** Go to **Authentication → Settings → Authorized domains → Add domain**, and add `wordpie.app`.

Until step 6 is done, the game only offers "On one phone".

## Setup: hosting on Cloudflare Workers (updates itself from GitHub)

The site runs as a Cloudflare Worker that serves static files. Its settings are in `wrangler.jsonc`.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create** and import the `wordpie` repository from GitHub.
2. Use these settings:
   - Project name: `wordpie` (must match `name` in `wrangler.jsonc`)
   - Build command: `node build.mjs`
   - Deploy command: `npx wrangler deploy`
   - Preview command: `npx wrangler preview`
3. Click **Deploy**.
4. In the Worker, go to **Settings → Domains & Routes → Add → Custom domain**, then enter `wordpie.app`.

From then on, every push to `main` rebuilds and publishes wordpie.app in about a minute. With preview builds turned on, other branches get their own test address.

Invite links look like `https://wordpie.app/join/K7QM2`. The `"not_found_handling": "single-page-application"` setting in `wrangler.jsonc` sends these addresses to `index.html`. Keep that setting, and don't add a `404.html` file.

## How online games work

- Each game lives in the database under `rooms/<CODE>`.
- Every move is saved as a single all-or-nothing database update (a transaction), so two phones can't both change the game at the same moment.
- The clock uses one shared deadline in server time, so a slow phone doesn't get extra seconds.
- If the current player's clock runs out, any player's phone can end that turn. The game keeps going even if the host's phone drops off.
- The game pauses the clock for up to 12 seconds while the dictionary checks a word. If neither dictionary can be reached, the word is accepted and marked "not checked" in the word chain.
- Players who leave or lose signal are marked offline. If it's their turn, their clock runs out.

Old games stay in the database. The free plan holds 1 GB, which is enough for a very large number of games. You can delete the `rooms` folder from the Firebase console at any time to clear them out.

## Google Analytics

The hosted site sends page views and these game events to Google Analytics property `G-FKQX3TD3JD`. The ID is set in `build.mjs`.

| Event | When it's sent | Details included |
|---|---|---|
| `game_start` | A game begins | `mode` (`one_phone` or `online`), `players`, `turn_seconds`, `word_check` |
| `word_played` | A word is accepted | `mode` |
| `game_over` | A game ends (online: counted once, by the host's phone) | `mode`, `players`, `words_played` |
| `online_game_create` | Someone creates an online game | `turn_seconds`, `word_check` |
| `online_game_join` | Someone joins from an invite | none |
| `invite_share` | The host copies the link or taps WhatsApp | `method` |

No player names or words are sent. To see live activity, go to **Reports → Realtime** in Google Analytics. Events show up in the main reports within about a day.

## How words are checked

1. **Wiktionary** is checked first. Plurals and verb forms count. Proper nouns, abbreviations and obsolete spellings don't.
2. **Free Dictionary API** (`api.dictionaryapi.dev`) is the backup.
3. If neither can be reached:
   - in one-phone mode, the players vote
   - in online mode, the word is accepted
   - in the claude.ai version, Claude checks the word
