# EphemeralChat

Plugin [Vencord](https://vencord.dev) : dans un MP, coche **Chat éphémère** (clic droit sur la conversation) et tes messages sont supprimés après un délai réglable (1 min à 6 h, 10 min par défaut).

Les messages sont sauvegardés dans `VencordData/EphemeralChat.json`. Coche **Voir les messages éphémères** pour les réafficher en bleu dans la conversation. Seuls les messages supprimés par le plugin sont concernés, pas ceux que tu supprimes toi-même.

Desktop uniquement (il écrit un fichier).

## Installation

```sh
cd Vencord/src/userplugins
git clone <url-du-repo> ephemeralChat.desktop
cd ../.. && pnpm build
```

Le dossier doit garder le suffixe `.desktop`, sinon le plugin est aussi compilé pour la version web, où il ne peut pas fonctionner.
