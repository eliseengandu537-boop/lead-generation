import path from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { phoneNumber } from "./rules";
import {
  allSouthAfrica,
  categoryOnlyBusinessType,
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
export function publicPlaceFiles(
  rows: Record<string, unknown>[],
  release: string,
) {
  const allowed = new RegExp(
    `^https://overturemaps-us-west-2\\.s3\\.us-west-2\\.amazonaws\\.com/release/${release.replaceAll(".", "\\.")}/theme=places/type=place/part-[a-zA-Z0-9.-]+\\.parquet$`,
  );
  return [
    ...new Set(rows.map((row) => z.string().regex(allowed).parse(row.file))),
  ];
}
export type ProspectCandidate = {
  sourceRecordId: string;
  company: string;
  phone: string;
  email: string | null;
  industry: string;
  location: string;
  websitePresence: "NO_WEBSITE_LISTED" | "WEBSITE_LISTED";
  website: string;
  evidence: Record<string, unknown>;
};
export function candidateFromPlace(
  raw: Record<string, unknown>,
  release: string,
  options: { requireMissingWebsite?: boolean } = {},
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
  if (websites !== null && !Array.isArray(websites)) return null;
  const hasWebsite = Array.isArray(websites) && websites.length > 0;
  if (hasWebsite && options.requireMissingWebsite !== false) return null;
  if (raw.operatingStatus && raw.operatingStatus !== "open") return null;
  const listedWebsite = Array.isArray(websites)
    ? websites.find(
        (value) =>
          typeof value === "string" &&
          /^https?:\/\//i.test(value) &&
          z.url().safeParse(value).success,
      )
    : "";
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
    websitePresence: hasWebsite ? "WEBSITE_LISTED" : "NO_WEBSITE_LISTED",
    website: listedWebsite || "",
    evidence: {
      provider: "Overture Maps Foundation",
      release,
      recordId: item.id,
      checkedAt: new Date().toISOString(),
      websiteField: websites || [],
      operatingStatus: raw.operatingStatus || "unknown",
      phones: [phone],
      category,
      categoryHierarchy: Array.isArray(hierarchy) ? hierarchy : [],
      address,
      confidence: item.confidence,
      sources: json(item.sources) || [],
      coordinates: { latitude: item.lat, longitude: item.lon },
      finding: hasWebsite
        ? "A website is listed in this public source. Website content and phone reachability have not been verified."
        : "No website is listed in this source. This does not establish that no website exists elsewhere.",
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
  requireMissingWebsite?: boolean;
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
  const categoryFacts = words(
    "concat_ws(' ', taxonomy.primary, array_to_string(taxonomy.hierarchy,' '))",
  );
  const business = (query: string) => {
    const groups = businessTermGroups(query);
    const facts = categoryOnlyBusinessType(query)
      ? categoryFacts
      : businessFacts;
    return !groups.length
      ? "true"
      : `(${groups.map((group) => `(${group.map((term) => `regexp_matches(${facts}, ${bind(termPattern(term))})`).join(" AND ")})`).join(" OR ")})`;
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
  const sql = `bbox.xmin BETWEEN 16 AND 33.1 AND bbox.ymin BETWEEN -35 AND -22 AND addresses[1].country='ZA' AND confidence>=0.75 AND coalesce(operating_status,'open')='open' AND ${options.requireMissingWebsite === false ? "true" : "(websites IS NULL OR len(websites)=0)"} AND len(phones)>0 AND ${selectedBusiness} AND ${selectedArea} AND (${allowedBusiness}) AND (${allowedArea}) AND NOT list_contains(string_split(${bind(excluded)},','),id)`;
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
    // Discover only fragments overlapping South Africa. Scanning the global S3
    // glob first makes every search inspect unrelated continents' file metadata.
    const index = await connection.runAndReadAll(
      `SELECT assets.aws.href AS file FROM read_parquet('https://stac.overturemaps.org/${release}/collections.parquet') WHERE collection='place' AND bbox.xmin<=33.1 AND bbox.xmax>=16 AND bbox.ymin<=-22 AND bbox.ymax>=-35`,
    );
    const files = publicPlaceFiles(index.getRowObjectsJson(), release);
    if (!files.length) return { checked: 0, candidates: [] };
    // URLs are restricted to this release's official public S3 parquet objects;
    // their allowlist excludes SQL delimiters and alternate hosts.
    const source = `[${files.map((file) => `'${file}'`).join(",")}]`;
    const predicate = prospectQueryPredicate(options);
    const result = await connection.runAndReadAll(
      `SELECT id, names.primary AS company, taxonomy.primary AS category, CAST(taxonomy.hierarchy AS JSON) AS categoryHierarchy, operating_status AS operatingStatus, phones[1] AS phone, emails[1] AS email, CAST(websites AS JSON) AS websites, CAST(addresses AS JSON) AS addresses, CAST(sources AS JSON) AS sources, confidence, bbox.xmin AS lon, bbox.ymin AS lat FROM read_parquet(${source}, hive_partitioning=true) WHERE ${predicate.sql} LIMIT ${Math.max(200, Math.min(1000, Math.ceil(options.limit) * 4))}`,
      predicate.params,
    );
    const rows = result.getRowObjectsJson();
    return {
      checked: rows.length,
      candidates: rows
        .map((row) => candidateFromPlace(row, release, options))
        .filter((row): row is ProspectCandidate => Boolean(row))
        .slice(0, Math.min(250, Math.max(1, options.limit))),
    };
  } finally {
    clearTimeout(timeout);
    connection.closeSync();
    instance.closeSync();
  }
}
