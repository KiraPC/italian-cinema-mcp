# italian-cinema-mcp — brief for the coding agent

A local MCP server (stdio) that lets an LLM compare cinema showtimes across Italian
multiplexes, so the user can ask "what's on tonight after 20:00 near me?" and get every
option from every chain in one answer.

Everything in this repo is written in **English**: code, comments, README, commits.

## Guiding principle: the consumer is an LLM

The model already knows Italian geography and can tell that "HEART OF THE BEAST - NEL
PROFONDO SELVAGGIO" and "Heart of the Beast" are the same film. So the server does **not**:

- keep a static registry of cinemas with coordinates or geo filters;
- normalise or deduplicate titles across chains;
- merge special editions (e.g. "Infinity Vision") into their parent film.

What the server **does** is what the model cannot do on its own:

1. make the HTTP calls, in parallel across cinemas (bounded concurrency, e.g. 4);
2. **shrink the output**. A raw UCI programming response is ~115 KB per cinema (HTML
   descriptions, poster URLs, promotions). Tools must return a compact text format,
   close to the example below, never the upstream JSON;
3. cheap filters that save tokens: time window and case-insensitive title substring;
4. short in-memory cache (showtimes ~5 min, cinema lists ~24 h).

## Tools

| Tool | Input | Output |
|---|---|---|
| `list_cinemas` | `chain?` (`uci` \| `thespace`) | every cinema: id, name, chain, city (as given upstream) |
| `list_films` | `cinema_ids[]`, `date?` | titles with duration and the cinemas showing them, no times |
| `get_showtimes` | `cinema_ids[]`, `date?`, `from_time?`, `to_time?`, `title_contains?` | film → cinema → showtimes with format, language, sold-out flag, booking URL |

- Cinema ids are namespaced by chain: `uci:uci-cinemas-romaest-roma`, `thespace:1021`.
- `date` is `YYYY-MM-DD`, default today **in Europe/Rome**. Times are `HH:MM` Europe/Rome.
- Tool descriptions must tell the model the intended flow: `list_cinemas` once, pick the
  ids itself, `list_films` for a cheap overview, then `get_showtimes` with filters.
- Errors from one cinema must not fail the whole call: return the others plus a short
  note on which cinema failed.

Example of the compact shape `get_showtimes` should produce (format details are yours):

```
Resident Evil (1h55)
  UCI Roma Est        19:10, 21:40, 22:30, 23:50
  The Space Moderno   19:10, 22:45
  UCI Porta di Roma   19:10 IMAX, 22:10
Heart of the Beast (2h05)
  ...
Booking: <one short URL per showtime only if asked via a flag, or a compact form>
```

Keep booking links available but do not let them dominate the output (e.g. an
`include_links` flag, default false).

## Upstream APIs (unofficial, no auth, verified 2026-09-24)

### UCI Cinemas (33 venues)

Base: `https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api`
Headers: `Accept: application/json`, `Referer: https://ucicinemas.it`, a browser User-Agent.

- `GET /theatres` → list (id, name, slug, is_luxe, latitude, …). Use the **slug** as id.
- `GET /theatres/{slug}` → details incl. `city`, `region`, `address`, `screens`.
- `GET /theatres/{slug}/programmingDays` → array of `YYYY-MM-DD`.
- `GET /theatres/{slug}/programming/{YYYY-MM-DD}` → `{data: [movie]}` where
  `movie.title`, `movie.screens[] = {<screenType>: [version]}`,
  `version.language.slug` (ITA, ENG…), `version.duration` ("03:05"),
  `version.performances[] = {day, actual_start_at "HH:MM", starts_at, ends_at,
  room, price_starting_from, cart_link}`. `cart_link` is relative to `https://ucicinemas.it`.
  Filter performances by `day == requested date` (the payload may contain others).

### The Space Cinema (35 venues)

Base: `https://www.thespacecinema.it/api/microservice/showings`
Headers: `Accept: application/json`, `Referer: https://www.thespacecinema.it/`, browser UA.

- `GET /cinemas` → `{result: [{alpha, cinemas: [{cinemaId, cinemaName, fullName, …}]}]}`.
  No city field: `fullName` usually contains city/province — expose it as is.
- `GET /cinemas/{cinemaId}/films?showingDate=YYYY-MM-DDT00:00:00&minEmbargoLevel=3&includesSession=true&includeSessionAttributes=true`
  → `{result: [film]}` with `film.filmTitle` (UPPERCASE), `runningTime` (minutes),
  `film.showingGroups[].sessions[] = {startTime, endTime, screenName, isSoldOut,
  bookingUrl (relative), attributes[] with attributeType Language/Session (2D, 3D,
  IMAX…)}`. Filter sessions whose `startTime` date is the requested date.
- Other endpoints under this base (e.g. `/films`, `/cinemas/{id}`) return 401: don't use them.

Both APIs are unofficial and may change. Keep each chain in its own connector behind a
common interface (e.g. `listCinemas()`, `getProgramming(cinemaId, date)` returning a
normalised internal model), so adding Webtic or 18tickets later means one new file.

## Tech and quality

- TypeScript, Node LTS, official `@modelcontextprotocol/sdk`, stdio transport, `zod` for
  input schemas. Native `fetch`. No heavy frameworks.
- Tests with `vitest`: unit tests for each connector's mapping using **saved fixture
  responses** (record a real response once into `test/fixtures/`, trimmed if huge), plus an
  opt-in live smoke test (`LIVE=1`) that hits the real APIs.
- README: what it is, the unofficial-API disclaimer, how to build, and how to register it
  in Claude Code (`claude mcp add …`) and Claude Desktop.

## Git rules

- Conventional commits in English (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Commit on `main` in small steps. **Do not push** — the maintainer reviews and pushes.
- Never change `git config` and never invent author identities or co-author trailers.

## Scope of the first delivery (MVP)

UCI + The Space connectors, the three tools, fixtures + tests, README. When done, verify
end to end by running the server and calling `get_showtimes` for a few real cinemas in
two different cities (e.g. Rome and Milan) for today, and report the output.

Out of scope for now: remote HTTP transport, Webtic/18tickets connectors, seat maps.
