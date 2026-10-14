# Torrent downloader CLI

A standalone Node.js CLI powered by [WebTorrent](https://webtorrent.io/docs).
Requires Node.js 22 or newer.

```sh
cd torrent-cli
yarn install --frozen-lockfile
node src/cli.mjs --help
node src/cli.mjs 'magnet:?xt=urn:btih:YOUR_INFO_HASH' -o ~/Downloads/torrents
node src/cli.mjs /path/to/file.torrent -o ~/Downloads/torrents
```

The magnet example is a placeholder; replace it with a complete magnet link.
Quote magnet links, because shells interpret `&` characters.
Optionally run `yarn link` to install the `torrent-dl` command locally.

## Behavior

- Downloads one torrent at a time; accepts BitTorrent v1 magnets or local `.torrent` files.
- Displays completion percentage, size, download/upload speed, peer count, and ETA.
- Stores each torrent in a `<name> - <hash-prefix>` subfolder of the output directory
  (default `./downloads`).
- Ctrl+C closes connections and keeps partial files. Rerun with the same source and output folder
  to verify existing pieces and resume. Keep the `.torrent` or magnet link for resuming.
- Exits after completion, unless `--seed` is passed. Uploads to peers while downloading.
- `--download-limit 1024` and `--upload-limit 256` cap traffic in KiB/s; zero blocks that direction.
- `--metadata-timeout 120` controls the metadata wait. Zero disables the timeout.
  Once metadata arrives, downloading waits for peers without a deadline.
- `--peer 127.0.0.1:6881` adds a known peer; repeat for multiple peers.
- Uses trackers, DHT, and local peer discovery. Does not automatically configure router port mappings.
- Exit status: 0 for completion/help, 1 for errors, 130 for interruption.

## Verification

```sh
yarn test
```

Tests use temporary files and local peers; no public torrent downloads are required.
# torrent-cli
