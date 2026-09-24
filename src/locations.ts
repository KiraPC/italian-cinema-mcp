// Static city/province for the known 35 The Space Cinema venues.
// venues are stable; the upstream API never returns a clean city field.
const CINEMA_LOCATION: Record<string, { city: string; province: string }> = {
  "1028": { city: "Beinasco", province: "Torino" },
  "1032": { city: "Belpasso", province: "Catania" },
  "1003": { city: "Bologna", province: "Bologna" },
  "1024": { city: "Casamassima", province: "Bari" },
  "1036": { city: "Catanzaro", province: "Catanzaro" },
  "1016": { city: "Cerro Maggiore", province: "Milano" },
  "1027": { city: "Corciano", province: "Perugia" },
  "1035": { city: "Firenze", province: "Firenze" },
  "1008": { city: "Genova", province: "Genova" },
  "1004": { city: "Grosseto", province: "Grosseto" },
  "1007": { city: "Guidonia Montecelio", province: "Roma" },
  "1034": { city: "Lamezia Terme", province: "Catanzaro" },
  "1012": { city: "Limena", province: "Padova" },
  "1017": { city: "Livorno", province: "Livorno" },
  "1002": { city: "Montebello della Battaglia", province: "Pavia" },
  "1026": { city: "Montesilvano", province: "Pescara" },
  "1019": { city: "Napoli", province: "Napoli" },
  "1033": { city: "Nola", province: "Napoli" },
  "1013": { city: "Parma", province: "Parma" },
  "1031": { city: "Parma", province: "Parma" },
  "1010": { city: "Pradamano", province: "Udine" },
  "1029": { city: "Quartucciu", province: "Cagliari" },
  "1021": { city: "Roma", province: "Roma" },
  "1025": { city: "Roma", province: "Roma" },
  "1020": { city: "Rozzano", province: "Milano" },
  "1015": { city: "Salerno", province: "Salerno" },
  "1014": { city: "Sestu", province: "Cagliari" },
  "1009": { city: "Silea", province: "Treviso" },
  "1001": { city: "Surbo", province: "Lecce" },
  "1006": { city: "Terni", province: "Terni" },
  "1018": { city: "Torino", province: "Torino" },
  "1011": { city: "Trieste", province: "Trieste" },
  "1023": { city: "Verona", province: "Verona" },
  "1022": { city: "Vicenza", province: "Vicenza" },
  "1030": { city: "Vimercate", province: "Monza-Brianza" },
};

export function locationFor(id: string): { city: string; province?: string } | undefined {
  const known = CINEMA_LOCATION[id];
  if (known) return known;
  return undefined;
}

export function parseFallbackLocation(input: {
  cinemaName?: string;
  fullName?: string;
  itemName?: string;
}): { city: string; province?: string } {
  const fallback = (value: string): { city: string; province?: string } => ({ city: value });
  if (input.itemName && input.itemName !== input.cinemaName) {
    return fallback(capitalise(input.itemName));
  }
  if (input.fullName) {
    const parts = input.fullName.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) {
      return fallback(input.cinemaName ?? "");
    }
    return { city: capitalise(parts[0]), province: parts[1] ? capitalise(parts[1]) : undefined };
  }
  return fallback(input.cinemaName ?? "");
}

function capitalise(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
