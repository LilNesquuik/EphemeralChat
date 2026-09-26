# EphemeralChat

A [Vencord](https://vencord.dev) plugin. In a DM, right-click the conversation and tick **Ephemeral Chat**: the messages you send there get deleted after a configurable delay (1 min to 6 h, 10 min by default).

Messages are saved to `VencordData/EphemeralChat.json`. Tick **Show Ephemeral Messages** to see them again in the conversation, highlighted in blue. Only messages deleted by the plugin are shown, not the ones you delete yourself.

Desktop only (it writes a file).

## Installation

```sh
cd Vencord/src/userplugins
git clone https://github.com/LilNesquuik/EphemeralChat ephemeralChat.desktop
cd ../.. && pnpm build
```

Keep the `.desktop` suffix on the folder, otherwise the plugin is also built for the web version, where it can't work.
