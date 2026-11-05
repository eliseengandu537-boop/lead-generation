import path from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { phoneNumber } from "./rules";
import {
  allSouthAfrica,
  businessTermGroups,
  normalizedSearch,
  provinceFor,
  termPattern,
} from "./prospect-search";

export const placesRelease = () =>
  z
    .string()
    .regex(/^20\d\d-\d\d-\d\d\.\d+$/)
    .parse(process.env.OVERTURE_RELEASE || "2026-10-21.0");
export type ProspectCandidate = {
  sourceRecordId: string;
  company: string;
  phone: string;
  email: string | null;
  industry: string;
  location: string;
  websitePresence: "NO_WEBSITE_LISTED";
  evidence: Record<string, unknown>;
};
export function candidateFromPlace(
  raw: Record<string, unknown>,
  release: string,
): ProspectCandidate | null {
  const json = (value: unknown): unknown => {
    try {
      return typeof value === "string" ? JSON.parse(value) : value;
    } catch {
      return null;
    }
  };
  const record = z
    .object({
      id: z.string().min(1).max(200),
      company: z.string().trim().min(2).max(240),
      phone: z.string(),
      category: z.string().trim().min(2).max(200),
      confidence: z.number().min(0.75).max(1),
      websites: z.unknown(),
      addresses: z.unknown(),
      sources: z.unknown(),
      lon: z.number(),
      lat: z.number(),
    })
    .safeParse(raw);
  if (!record.success) return null;
  const item = record.data,
    websites = json(item.websites);
  if (
    item.websites === undefined ||
    (typeof item.websites === "string" &&
      websites === null &&
      item.websites !== "null")
  )
    return null;
  if (
    Array.isArray(websites)
      ? websites.length > 0
      : websites !== null && websites !== undefined
  )
    return null;
  let phone: string;
  try {
    phone = phoneNumber(item.phone);
  } catch {
    return null;
  }
  if (!phone.startsWith("+27")) return null;
  const addresses = z
    .array(
      z
        .object({
          country: z.string().optional(),
          locality: z.string().optional(),
          region: z.string().optional(),
          freeform: z.string().optional(),
        })
        .passthrough(),
    )
    .safeParse(json(item.addresses));
  if (
    !addresses.success ||
    !addresses.data.some((address) => address.country === "ZA")
  )
    return null;
  const address = addresses.data.find((row) => row.country === "ZA")!;
  if (item.lon < 16 || item.lon > 33.1 || item.lat < -35 || item.lat > -22)
    return null;
  const category = item.category.toLowerCase();
  const beauty = /(^|_)(beauty|hair|nail|barber|spa)(_|$)/.test(category);
  const hierarchy = json(raw.categoryHierarchy);
  const restaurant =
    category.includes("restaurant") ||
    (Array.isArray(hierarchy) && hierarchy.includes("restaurant"));
  const province = provinceFor(address.region || "");
  const email = z.email().safeParse(raw.email);
  return {
    sourceRecordId: `OVERTURE:${item.id}`,
    company: item.company,
    phone,
    email: email.success ? email.data.toLowerCase() : null,
    industry: beauty
      ? "Beauty"
      : restaurant
        ? "Restaurants"
        : category
            .replaceAll("_", " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    location: [
      ...new Set(
        [
          address.locality || address.freeform,
          province?.name || "South Africa",
        ].filter(Boolean),
      ),
    ]
      .join(", ")
      .slice(0, 240),
    websitePresence: "NO_WEBSITE_LISTED",
    evidence: {
      provider: "Overture Maps Foundation",
      release,
      recordId: item.id,
      checkedAt: new Date().toISOString(),
      websiteField: websites || [],
      phones: [phone],
      category,
      categoryHierarchy: Array.isArray(hierarchy) ? hierarchy : [],
      address,
      confidence: item.confidence,
      sources: json(item.sources) || [],
      coordinates: { latitude: item.lat, longitude: item.lon },
      finding:
        "No website is listed in this source. This does not establish that no website exists elsewhere.",
      license: "https://docs.overturemaps.org/attribution/#places",
    },
  };
}

type ProspectQuery = {
  industry: string;
  city: string;
  exclude: string[];
  limit: number;
  cities?: string[];
  categories?: string[];
};
/** User text is bound as data. SQL operators and identifiers are fixed here. */
export function prospectQueryPredicate(options: ProspectQuery) {
  const params: string[] = [];
  const bind = (value: string) => {
    params.push(value);
    return `$${params.length}`;
  };
  const words = (expression: string) =>
    `trim(regexp_replace(lower(strip_accents(coalesce(${expression},''))), '[^a-z0-9]+', ' ', 'g'))`;
  const businessFacts = words(
    "concat_ws(' ', taxonomy.primary, array_to_string(taxonomy.hierarchy,' '), names.primary)",
  );
  const business = (query: string) => {
    const groups = businessTermGroups(query);
    return !groups.length
      ? "true"
      : `(${groups.map((group) => `(${group.map((term) => `regexp_matches(${businessFacts}, ${bind(termPattern(term))})`).join(" AND ")})`).join(" OR ")})`;
  };
  const areaFacts = words(
    "concat_ws(' ', addresses[1].locality, addresses[1].freeform)",
  );
  const region = words("addresses[1].region");
  const area = (query: string) => {
    if (allSouthAfrica(query)) return "true";
    const parts = query
      .split(",")
      .filter((part) => part.trim() && !allSouthAfrica(part));
    return `(${
      parts
        .map((part) => {
          const province = provinceFor(part);
          return province
            ? `list_contains(string_split(${bind(province.aliases.map(normalizedSearch).join("|"))},'|'),${region})`
            : `contains(${areaFacts},${bind(normalizedSearch(part))})`;
        })
        .join(" AND ") || "false"
    })`;
  };
  const excluded = options.exclude
    .map((value) => value.replace(/^OVERTURE:/, ""))
    .filter((value) => /^[\w:@.-]{1,200}$/.test(value))
    .slice(0, 20000)
    .join(",");
  const selectedBusiness = business(options.industry);
  const selectedArea = area(options.city);
  const allowedBusiness = (
    options.categories?.length ? options.categories : ["ALL"]
  )
    .map(business)
    .join(" OR ");
  const allowedArea = (
    options.cities?.length ? options.cities : ["South Africa"]
  )
    .map(area)
    .join(" OR ");
  const sql = `bbox.xmin BETWEEN 16 AND 33.1 AND bbox.ymin BETWEEN -35 AND -22 AND addresses[1].country='ZA' AND confidence>=0.75 AND (websites IS NULL OR len(websites)=0) AND len(phones)>0 AND ${selectedBusiness} AND ${selectedArea} AND (${allowedBusiness}) AND (${allowedArea}) AND NOT list_contains(string_split(${bind(excluded)},','),id)`;
  return { sql, params };
}

export async function fetchWebsiteProspects(
  options: ProspectQuery,
): Promise<{ checked: number; candidates: ProspectCandidate[] }> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const directory = path.resolve(".local/duckdb-extensions");
  await mkdir(directory, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:", {
    extension_directory: directory,
    memory_limit: "384MB",
    threads: "2",
  });
  const connection = await instance.connect();
  const timeout = setTimeout(() => connection.interrupt(), 150000);
  try {
    try {
      await connection.run("LOAD httpfs");
    } catch {
      await connection.run(
        "INSTALL httpfs FROM 'https://extensions.duckdb.org'; LOAD httpfs",
      );
    }
    await connection.run(
      "SET s3_region='us-west-2'; SET http_timeout=20; SET http_retries=1;",
    );
    const release = placesRelease();
    const predicate = prospectQueryPredicate(options);
    const result = await connection.runAndReadAll(
      `SELECT id, names.primary AS company, taxonomy.primary AS category, CAST(taxonomy.hierarchy AS JSON) AS categoryHierarchy, phones[1] AS phone, emails[1] AS email, CAST(websites AS JSON) AS websites, CAST(addresses AS JSON) AS addresses, CAST(sources AS JSON) AS sources, confidence, bbox.xmin AS lon, bbox.ymin AS lat FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=true) WHERE ${predicate.sql} LIMIT 200`,
      predicate.params,
    );
    const rows = result.getRowObjectsJson();
    return {
      checked: rows.length,
      candidates: rows
        .map((row) => candidateFromPlace(row, release))
        .filter((row): row is ProspectCandidate => Boolean(row))
        .slice(0, Math.min(50, Math.max(1, options.limit))),
    };
  } finally {
    clearTimeout(timeout);
    connection.closeSync();
    instance.closeSync();
  }
}
