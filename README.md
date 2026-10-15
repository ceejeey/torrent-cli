# @beitroot/torrent-cli

A standalone Node.js CLI powered by [WebTorrent](https://webtorrent.io/docs).
Requires Node.js 22 or newer.

## Quick start (npx)

Run `npx` from outside this repo (inside it, npm resolves the local package and the bin is not linked).

```sh
npx -y -p @beitroot/torrent-cli torrent-cli --help
npx -y -p @beitroot/torrent-cli torrent-cli -i
npx -y -p @beitroot/torrent-cli torrent-cli 'magnet:?xt=urn:btih:YOUR_INFO_HASH' -o ~/Downloads/torrents
npx -y -p @beitroot/torrent-cli torrent-cli /path/to/file.torrent -o ~/Downloads/torrents
```

Or install globally:

```sh
npm install -g @beitroot/torrent-cli
torrent-cli --help
```

## Local development

```sh
cd torrent-cli
yarn install --frozen-lockfile
yarn start -- --help
yarn start -- -i
# or: node bin/torrent-cli.js -i
```

The magnet example is a placeholder; replace it with a complete magnet link.
Quote magnet links, because shells interpret `&` characters.

## Interactive mode

On a TTY:

- Running with no source (or `-i`) prompts for magnet/file, output folder, seed, and optional limits via `@clack/prompts`.
- Multi-file torrents open a file picker after metadata arrives unless `--no-select-files` is set.
- An Ink panel shows progress; press `q` to quit (keeps data) or `s` to toggle seeding after completion.

Non-TTY / scripted runs keep the classic single-line progress and skip prompts.

## Behavior

- Downloads one torrent at a time; accepts BitTorrent v1 magnets or local `.torrent` files.
- Displays completion percentage, size, download/upload speed, peer count, and ETA.
- Stores each torrent in a `<name> - <hash-prefix>` subfolder of the output directory
  (default `./downloads`).
- Ctrl+C or `q` closes connections and keeps partial files. Rerun with the same source and output folder
  to verify existing pieces and resume. Keep the `.torrent` or magnet link for resuming.
- Exits after completion, unless `--seed` is passed (or `s` enables seed in the UI). Uploads to peers while downloading.
- `--download-limit 1024` and `--upload-limit 256` cap traffic in KiB/s; zero blocks that direction.
- `--metadata-timeout 120` controls the metadata wait. Zero disables the timeout.
  Once metadata arrives, downloading waits for peers without a deadline.
- `--peer 127.0.0.1:6881` adds a known peer; repeat for multiple peers.
- Uses trackers, DHT, and local peer discovery. Does not automatically configure router port mappings.
- Exit status: 0 for completion/help, 1 for errors, 130 for interruption/cancel.

## Verification

```sh
yarn test
```

Tests use temporary files and local peers; no public torrent downloads are required.
