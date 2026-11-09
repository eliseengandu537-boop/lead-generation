/** Shared by the caller filters and the public-data worker. Suggestions never
 * restrict what the caller can type. Queries are matched against source facts. */
export const provinceDefinitions = [
  { code: "GP", name: "Gauteng", aliases: ["GP", "Gauteng", "ZA-GP"] },
  {
    code: "WC",
    name: "Western Cape",
    aliases: ["WC", "Western Cape", "ZA-WC"],
  },
  {
    code: "EC",
    name: "Eastern Cape",
    aliases: ["EC", "Eastern Cape", "ZA-EC"],
  },
  {
    code: "KZN",
    name: "KwaZulu-Natal",
    aliases: [
      "KZN",
      "NL",
      "ZN",
      "KwaZulu-Natal",
      "KwaZulu Natal",
      "ZA-KZN",
      "ZA-NL",
    ],
  },
  { code: "FS", name: "Free State", aliases: ["FS", "Free State", "ZA-FS"] },
  { code: "LP", name: "Limpopo", aliases: ["LP", "LIM", "Limpopo", "ZA-LP"] },
  {
    code: "MP",
    name: "Mpumalanga",
    aliases: ["MP", "MPU", "Mpumalanga", "ZA-MP"],
  },
  {
    code: "NW",
    name: "North West",
    aliases: ["NW", "North West", "Northwest", "ZA-NW"],
  },
  {
    code: "NC",
    name: "Northern Cape",
    aliases: ["NC", "Northern Cape", "ZA-NC"],
  },
] as const;
export const salesNiches = [
  "Construction",
  "Electricians",
  "Plumbers",
  "Auto spares",
  "Shopping centres",
  "Real estate",
  "Hardware stores",
  "Steel suppliers",
  "Scrap yards",
  "Engineering",
];
export const businessSuggestions = Array.from(
  new Set([
    ...salesNiches,
    "Restaurants",
    "Beauty",
    "Plumbers",
    "Electricians",
    "Dentists",
    "Hair salons",
    "Car repair",
    "Construction companies",
    "Accountants",
    "Lawyers",
    "Cleaning services",
    "Guest houses",
    "Hardware stores",
    "Bakeries",
    "Gyms",
    "Real estate agencies",
    "Florists",
    "Veterinarians",
  ]),
);
export const areaSuggestions = [
  "South Africa",
  ...provinceDefinitions.map((row) => row.name),
  "Johannesburg",
  "Pretoria",
  "Cape Town",
  "Durban",
  "Gqeberha",
  "Bloemfontein",
  "Polokwane",
  "Mbombela",
  "Kimberley",
  "Rustenburg",
  "East London",
  "George",
  "Stellenbosch",
  "Soweto",
  "Sandton",
  "Centurion",
  "Midrand",
  "Benoni",
  "Boksburg",
  "Roodepoort",
  "Kempton Park",
  "Germiston",
  "Krugersdorp",
  "Vereeniging",
  "Vanderbijlpark",
];
export const normalizedSearch = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ +/g, " ");
export const allBusinessTypes = (value: string) =>
  [
    "",
    "all",
    "any",
    "all businesses",
    "all business types",
    "any business",
    "any business type",
  ].includes(normalizedSearch(value));
export const allSouthAfrica = (value: string) =>
  [
    "",
    "all",
    "sa",
    "za",
    "south africa",
    "all south africa",
    "all of south africa",
    "nationwide",
  ].includes(normalizedSearch(value));
export function provinceFor(value: string) {
  const key = normalizedSearch(value);
  return provinceDefinitions.find((row) =>
    row.aliases.some((alias) => normalizedSearch(alias) === key),
  );
}

const synonyms: Record<string, string[]> = {
  beauty: ["beauty", "hair", "nail", "barber", "spa", "salon"],
  plumber: ["plumber", "plumbing"],
  electrician: ["electrician", "electrical"],
  dentist: ["dentist", "dental", "dentistry"],
  restaurant: ["restaurant", "pizzeria"],
  "car repair": [
    "car repair",
    "auto repair",
    "automotive repair",
    "mechanic",
    "motor repair",
  ],
  construction: ["construction", "builder", "building contractor"],
  lawyer: ["lawyer", "attorney", "legal"],
  accountant: ["accountant", "accounting"],
  "guest house": ["guest house", "guesthouse", "bed breakfast"],
  "real estate": ["real estate", "estate agent"],
  "auto spare": [
    "auto part",
    "car part",
    "motor spare",
    "automotive part",
    "vehicle part",
    "spare part",
    "auto accessory",
  ],
  "shopping centre": [
    "shopping centre",
    "shopping center",
    "shopping mall",
    "mall",
  ],
  "hardware store": ["hardware", "building material", "building supply"],
  "steel supplier": [
    "steel",
    "metal supplier",
    "steel fabricator",
    "metalwork",
  ],
  "scrap yard": [
    "scrap",
    "scrapyard",
    "junkyard",
    "salvage yard",
    "metal recycling",
    "recycling center",
    "recycling centre",
  ],
  engineering: [
    "engineering",
    "engineer",
    "machine shop",
    "machining",
    "fabrication",
  ],
  gym: ["gym", "fitness"],
  veterinarian: ["veterinarian", "veterinary", "vet"],
};
const singular = (value: string) =>
  value.length > 3 && value.endsWith("s") && !value.endsWith("ss")
    ? value.slice(0, -1)
    : value;
/** Each group is an AND of terms; groups are OR alternatives. */
export function businessTermGroups(value: string): string[][] {
  if (allBusinessTypes(value)) return [];
  return value
    .split(/[,;&|]+/)
    .slice(0, 10)
    .flatMap((part) => {
      const terms = normalizedSearch(part)
        .split(" ")
        .map(singular)
        .filter(
          (term) =>
            term &&
            ![
              "business",
              "companie",
              "company",
              "agencie",
              "agency",
              "service",
              "the",
              "and",
            ].includes(term),
        )
        .slice(0, 8);
      if (!terms.length) return [[normalizedSearch(part)]];
      const alternatives = synonyms[terms.join(" ")] || [terms.join(" ")];
      return alternatives.map((item) => item.split(" "));
    });
}
export function termPattern(term: string) {
  return `(^| )${term.replace(/[^a-z0-9]/g, "")}(s|es)?( |$)`;
}
export function matchesBusinessType(value: string, facts: string) {
  const groups = businessTermGroups(value),
    haystack = normalizedSearch(facts);
  return (
    !groups.length ||
    groups.some((group) =>
      group.every((term) => new RegExp(termPattern(term)).test(haystack)),
    )
  );
}
// Require category evidence for these niches: a mall branch or a craft shop
// named "Scrap Shop" is not a shopping centre or an industrial scrap yard.
export const categoryOnlyBusinessType = (value: string) =>
  /^(shopping (centres?|centers?|malls?)|malls?|steel suppliers?|scrap yards?)$/.test(
    normalizedSearch(value),
  );
export type ProspectAddress = {
  country?: string;
  region?: string;
  locality?: string;
  freeform?: string;
};
export function matchesSouthAfricanArea(
  value: string,
  address: ProspectAddress,
  fallback = "",
) {
  if (allSouthAfrica(value)) return true;
  const province = provinceFor(address.region || "");
  const haystack = normalizedSearch(
    [address.locality, address.freeform, province?.name, fallback]
      .filter(Boolean)
      .join(" "),
  );
  return value
    .split(",")
    .filter((part) => part.trim() && !allSouthAfrica(part))
    .every((part) => {
      const selected = provinceFor(part);
      return selected
        ? selected.code === province?.code ||
            haystack.includes(normalizedSearch(selected.name))
        : haystack.includes(normalizedSearch(part));
    });
}

export function matchesProspectingScope(
  lead: {
    company?: unknown;
    industry?: unknown;
    location?: unknown;
    websitePresence?: unknown;
    websiteEvidence?: unknown;
  },
  config: {
    categories?: unknown;
    cities?: unknown;
    requireMissingWebsite?: unknown;
  },
) {
  const evidence =
    lead.websiteEvidence && typeof lead.websiteEvidence === "object"
      ? (lead.websiteEvidence as Record<string, unknown>)
      : {};
  const address =
    evidence.address && typeof evidence.address === "object"
      ? (evidence.address as ProspectAddress)
      : {};
  const categoryFacts = [
    lead.industry,
    evidence.category,
    ...(Array.isArray(evidence.categoryHierarchy)
      ? evidence.categoryHierarchy
      : []),
  ].join(" ");
  const facts = [lead.company, categoryFacts].join(" ");
  const categories = Array.isArray(config.categories)
    ? config.categories.map(String)
    : ["ALL"];
  const areas = Array.isArray(config.cities)
    ? config.cities.map(String)
    : ["South Africa"];
  return (
    (config.requireMissingWebsite === false ||
      lead.websitePresence === "NO_WEBSITE_LISTED") &&
    categories.some((value) =>
      matchesBusinessType(
        value,
        categoryOnlyBusinessType(value) ? categoryFacts : facts,
      ),
    ) &&
    areas.some((value) =>
      matchesSouthAfricanArea(value, address, String(lead.location || "")),
    )
  );
}
