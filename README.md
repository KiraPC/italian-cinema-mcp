# italian-cinema-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io/) server that lets an
LLM compare showtimes across Italian cinema chains. Spawn it as an MCP host
(`claude`, `Cursor`, …) and ask things like "what's on tonight after 20:00 near
me?" — the server fans the question out to UCI Cinemas and The Space Cinema,
shrinks the ~100 KB per-cinema JSON payload into a compact text view, and
returns every option in one answer.

## Status

MVP. UCI Cinemas (33 venues) and The Space Cinema (35 venues) are both wired
in. Both upstream APIs are unofficial and may change without notice.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by UCI Cinemas
or The Space Cinema, and "UCI Cinemas", "The Space Cinema", and any other
brand or venue names referenced here are the property of their respective
owners. The server relies on the same undocumented JSON endpoints that the
official websites call from the browser; it does not authenticate, and those
endpoints may change, rate-limit, or stop working at any time without notice.
It is intended for personal use; requests are cached (cinema metadata for
24 h, showtimes for 5 min) and dispatched with bounded concurrency so
upstream is only contacted when the user actually asks something.

## Tools

| Tool          | Inputs                                                                                                                | Output                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `list_cinemas`| `chain?` (`uci` \| `thespace`)                                                                                         | every cinema: id, name, chain, city                                                |
| `list_films`  | `cinema_ids[]`, `date?`                                                                                               | titles with duration and the cinemas showing them, no times                       |
| `get_showtimes` | `cinema_ids[]`, `date?`, `from_time?`, `to_time?`, `title_contains?`, `include_links?`                              | film → cinema → showtimes with format, language, sold-out flag, booking URL      |

Cinema ids are namespaced by chain — `uci:uci-cinemas-romaest-roma`,
`thespace:1021`. `date` is `YYYY-MM-DD`, defaults to today in `Europe/Rome`.
Times are `HH:MM` Europe/Rome.

Recommended call flow: `list_cinemas` once → pick ids → `list_films` for a
cheap overview → `get_showtimes` with `title_contains` or a time window.

Errors from one cinema never fail the whole call; the rest are returned
alongside a short note about which cinema failed and why.

Booking links are off by default (`include_links=true` to surface them).

## Example output

```
Resident Evil (1h30)
The Space Roma Moderno           22:45
The Space Roma Parco de' Medici  21:05, 22:25, 23:25
UCI Porta di Roma                22:10
UCI Roma Est                     21:40, 22:30, 23:50
```

Showtime tags: just `HH:MM` by default. Only non-default format/language
gets a tag — `21:30 IMAX`, `20:20 EN`, `22:10 OV`, `21:30 ISENSE`. Italian
is the default and is never printed. Sold-out shows add `(sold out)`.
Booking links are off by default; pass `include_links=true` to surface them.

## Build

```bash
npm install
npm run build      # tsc → dist/
npm run dev        # tsx src/server.ts (no build step)
npm test           # vitest, offline only
LIVE=1 npm test    # also runs the live smoke tests against UCI and The Space
```

Requirements: Node.js >= 20 (uses the global `fetch`).

## Run

The server speaks MCP over stdio, so an MCP host launches it as a subprocess.
Register it once and forget it.

### Claude Code

```bash
claude mcp add --transport stdio --scope user italian-cinema-mcp \
  -- node /absolute/path/to/italian-cinema-mcp/dist/server.js
```

(or `npm run dev` if you prefer running from source).

### Claude Desktop

Add the server in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "italian-cinema-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/italian-cinema-mcp/dist/server.js"]
    }
  }
}
```

## Tests

`npm test` runs vitest on:

- unit tests for the date helper, the formatter, and per-chain connector
  mappers (fixture-driven, no network);
- the cinema service tests (filtering, per-cinema failures, batch merging);
- an opt-in live smoke test (`LIVE=1`) that hits both upstream APIs.

Fixtures under `test/fixtures/{uci,thespace}/` are trimmed real responses, kept
in-repo so `npm test` doesn't need network access.

## Project layout

```
src/
  server.ts               MCP server with three tools
  service.ts              CinemaService: chains, caching, parallel fetch, filter
  connectors/uci.ts       UCI Cinemas connector
  connectors/thespace.ts  The Space Cinema connector
  format.ts               compact text renderer for showtimes
  cache.ts                tiny TTL cache
  http.ts                 fetch wrapper, retries, session cookie replay
  dates.ts                today-in-Rome, date validation, time compare
  types.ts                internal model shared by all connectors
test/
  *.test.ts               vitest unit tests
  fixtures/{uci,thespace} saved real responses, trimmed
scripts/
  mcp-call.mjs            tiny JSON-RPC stdio driver used to verify end-to-end
  AGENTS.md               design brief
```

## Upstream APIs (unofficial, no auth)

### UCI Cinemas

`https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api`

- `GET /theatres` — list (id, name, slug, is_luxe, latitude, …). The `slug` is
  the cinema id.
- `GET /theatres/{slug}/programming/{YYYY-MM-DD}` — the programming for one
  day. `cart_link` is relative to `https://ucicinemas.it`.

### The Space Cinema

`https://www.thespacecinema.it/api/microservice/showings`

- `GET /cinemas` — `{result: [{alpha, cinemas: [cinema]}]}`. No city field:
  `fullName` is best-effort, exposed as-is.
- `GET /cinemas/{cinemaId}/films?showingDate=YYYY-MM-DDT00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`
  One query string, not all separate. `bookingUrl` is relative to
  `https://www.thespacecinema.it/`.

An in-memory cookie jar in `src/http.ts` preserves the session cookies the
site sets across calls, the way a browser would, so consecutive requests in
the same session are accepted. We do not perform any challenge solving or
attempt to bypass upstream policies — we only store and replay whatever the
server gave us. Cinema metadata is cached for 24 h, showtimes for 5 min
(`src/service.ts`).

## Out of scope (for now)

Remote HTTP transport, Webtic/18tickets connectors, seat maps.
