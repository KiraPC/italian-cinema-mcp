import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CinemaService } from "./service.js";
import { UciConnector } from "./connectors/uci.js";
import { ThespaceConnector } from "./connectors/thespace.js";
import { formatProgramming } from "./format.js";
import { isValidDate, todayInRome } from "./dates.js";
import type { ChainId } from "./types.js";

const TIME_RE = /^\d{2}:\d{2}$/;
const CHAIN_VALUES = ["uci", "thespace"] as const;

const chainSchema = z
  .union([
    z.enum(CHAIN_VALUES),
    z.array(z.enum(CHAIN_VALUES)).min(1),
  ])
  .optional()
  .describe(
    "Restrict the query to one chain or a list of chains. Cinema ids that do " +
      "not belong to the allowed chain(s) are skipped. Use this for loyalty " +
      "promotions (e.g. only uci) or to compare apples to apples.",
  );

function buildService(): CinemaService {
  return new CinemaService([new UciConnector(), new ThespaceConnector()]);
}

function buildServer(service: CinemaService): McpServer {
  const server = new McpServer({
    name: "italian-cinema-mcp",
    version: "0.1.0",
  });

  const dateSchema = z
    .string()
    .refine(isValidDate, { message: "date must be YYYY-MM-DD" })
    .optional()
    .describe("YYYY-MM-DD in Europe/Rome; defaults to today.");

  const timeSchema = z
    .string()
    .regex(TIME_RE, { message: "time must be HH:MM (Europe/Rome)" })
    .optional()
    .describe("HH:MM in Europe/Rome; bounds are inclusive.");

  server.tool(
    "list_cinemas",
    "List every cinema we know about, optionally filtered to a single chain. " +
      "Call this once at the start of a session to discover cinema ids. " +
      "Ids are namespaced like `uci:slug` or `thespace:numericId` and are needed by the other tools.",
    {
      chain: z.enum(CHAIN_VALUES).optional().describe("uci or thespace; omit for both."),
    },
    async ({ chain }: { chain?: (typeof CHAIN_VALUES)[number] }) => {
      try {
        const cinemas = await service.listCinemas(chain as ChainId | undefined);
        const text = renderCinemas(cinemas);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Failed to list cinemas: ${describeError(err)}` },
          ],
        };
      }
    },
  );

  server.tool(
    "list_films",
    "Cheap overview of the films playing in the given cinemas on the given date, " +
      "without showtimes. Use this after list_cinemas to discover which films are worth " +
      "querying with get_showtimes. Pass chain to restrict to one chain or a list " +
      "of chains (e.g. chain: 'uci' for loyalty promotions); cinema ids that belong " +
      "to other chains are dropped.",
    {
      cinema_ids: z.array(z.string()).min(1).describe("Cinema ids from list_cinemas."),
      date: dateSchema,
      chain: chainSchema,
    },
    async ({
      cinema_ids,
      date,
      chain,
    }: {
      cinema_ids: string[];
      date?: string;
      chain?: (typeof CHAIN_VALUES)[number] | (typeof CHAIN_VALUES)[number][];
    }) => {
      const requestedDate = date ?? todayInRome();
      const allowed = normaliseChains(chain);
      try {
        const { films, failures } = await service.getFilmsForCinemas(
          cinema_ids,
          requestedDate,
          { chain: allowed },
        );
        const text = renderFilms(films, requestedDate) + renderFailures(failures);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Failed to list films: ${describeError(err)}` },
          ],
        };
      }
    },
  );

  server.tool(
    "get_showtimes",
    "Showtimes for the given cinemas on a date, with optional time window and title " +
      "substring filters. Returns a compact text view grouped by film and cinema: " +
      "time, and only the format/language tags that deviate from the chain default " +
      "(2D in Italian -> nothing; e.g. '21:30 IMAX', '20:20 EN', '21:30 ISENSE' otherwise). " +
      "Italian is the default language and is omitted; EN, OV are normalised. " +
      "Sold-out shows are tagged '(sold out)'. Booking links stay off by default; " +
      "pass include_links=true to add them. Pass chain to restrict to one chain " +
      "or a list (e.g. chain: 'uci' for loyalty promotions); cinema ids that " +
      "belong to other chains are dropped.\n\n" +
      "Time axis: each requested date is a 'cinema day' that spans " +
      "[date 06:00, date+1 06:00) in Europe/Rome. from_time/to_time earlier " +
      "than 06:00 means the next calendar day (e.g. to_time '01:00' is " +
      "'until 01:00+1'). Showtimes after midnight are rendered with a '+" +
      "1' marker ('22:00+1' is too far east to happen in practice; '00:30+1" +
      "' is the usual case). If a film has only out-of-window showtimes at " +
      "a cinema, that cinema line becomes 'cinema - none in window (N " +
      "earlier, last HH:MM)'; if the film has zero in-window shows anywhere, " +
      "an 'Outside the time window:' line is appended.",
    {
      cinema_ids: z.array(z.string()).min(1).describe("Cinema ids from list_cinemas."),
      date: dateSchema,
      from_time: timeSchema.describe("Earliest showtime to include (HH:MM)."),
      to_time: timeSchema.describe("Latest showtime to include (HH:MM)."),
      title_contains: z
        .string()
        .min(1)
        .optional()
        .describe("Case-insensitive substring the film title must contain."),
      include_links: z
        .boolean()
        .optional()
        .describe("If true, append the booking URL inside [brackets] next to each showtime."),
      chain: chainSchema,
    },
    async ({
      cinema_ids,
      date,
      from_time,
      to_time,
      title_contains,
      include_links,
      chain,
    }: {
      cinema_ids: string[];
      date?: string;
      from_time?: string;
      to_time?: string;
      title_contains?: string;
      include_links?: boolean;
      chain?: (typeof CHAIN_VALUES)[number] | (typeof CHAIN_VALUES)[number][];
    }) => {
      const requestedDate = date ?? todayInRome();
      const allowed = normaliseChains(chain);
      const result = await service.getProgramming(cinema_ids, requestedDate, {
        fromTime: from_time,
        toTime: to_time,
        titleContains: title_contains,
        chain: allowed,
      });
      const text =
        formatProgramming(result.programs, { includeLinks: Boolean(include_links) }) +
        renderFailures(result.failures);
      return { content: [{ type: "text", text: text || "No showtimes matched the filters." }] };
    },
  );

  return server;
}

function renderCinemas(cinemas: { id: string; chain: ChainId; name: string; city: string }[]): string {
  if (cinemas.length === 0) return "No cinemas available.";
  const lines: string[] = [`${cinemas.length} cinema(s):`];
  const sorted = [...cinemas].sort((a, b) => {
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    return a.name.localeCompare(b.name);
  });
  for (const c of sorted) {
    lines.push(`  ${c.id} — ${c.name} (${c.city || "—"})`);
  }
  return lines.join("\n");
}

function renderFilms(films: { title: string; cinemas: { name: string }[] }[], date: string): string {
  if (films.length === 0) return `No films scheduled on ${date}.`;
  const lines: string[] = [`Films on ${date}:`];
  for (const film of films) {
    const names = film.cinemas.map((c) => c.name).join(", ");
    lines.push(`  ${film.title} — ${names}`);
  }
  return lines.join("\n");
}

function renderFailures(failures: { cinemaId: string; message: string }[]): string {
  if (failures.length === 0) return "";
  const lines: string[] = ["", "Could not load these cinemas:"];
  for (const f of failures) {
    lines.push(`  ${f.cinemaId}: ${f.message}`);
  }
  return "\n" + lines.join("\n");
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function normaliseChains(
  input: ((typeof CHAIN_VALUES)[number]) | ((typeof CHAIN_VALUES)[number][]) | undefined,
): Set<ChainId> | undefined {
  if (input === undefined) return undefined;
  const list = Array.isArray(input) ? input : [input];
  return new Set(list as ChainId[]);
}

async function main(): Promise<void> {
  const service = buildService();
  const server = buildServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("italian-cinema-mcp ready (stdio)");
}

main().catch((err) => {
  console.error("italian-cinema-mcp failed to start:", err);
  process.exit(1);
});
