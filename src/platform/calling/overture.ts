import path from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { phoneNumber } from "./rules";
import { cityCentres, prospectCities } from "./prospect-options";

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
      category: z.string(),
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
  if (
    !address.region ||
    !["GP", "GAUTENG", "ZA-GP"].includes(address.region.toUpperCase())
  )
    return null;
  if (
    item.lon < 27.15 ||
    item.lon > 29.2 ||
    item.lat < -26.95 ||
    item.lat > -25.05
  )
    return null;
  const category = item.category.toLowerCase();
  const beauty = /(^|_)(beauty|hair|nail|barber|spa)(_|$)/.test(category);
  const hierarchy = json(raw.categoryHierarchy);
  if (
    !beauty &&
    !category.includes("restaurant") &&
    !(Array.isArray(hierarchy) && hierarchy.includes("restaurant"))
  )
    return null;
  const email = z.email().safeParse(raw.email);
  return {
    sourceRecordId: `OVERTURE:${item.id}`,
    company: item.company,
    phone,
    email: email.success ? email.data.toLowerCase() : null,
    industry: beauty ? "Beauty" : "Restaurants",
    location: [address.locality || address.freeform || "Gauteng", "Gauteng"]
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
      confidence: item.confidence,
      sources: json(item.sources) || [],
      coordinates: { latitude: item.lat, longitude: item.lon },
      finding:
        "No website is listed in this source. This does not establish that no website exists elsewhere.",
      license: "https://docs.overturemaps.org/attribution/#places",
    },
  };
}

export async function fetchWebsiteProspects(options: {
  industry: string;
  city: string;
  exclude: string[];
  limit: number;
  cities?: string[];
}): Promise<{ checked: number; candidates: ProspectCandidate[] }> {
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
    const centre = cityCentres[options.city];
    const bounds = centre
      ? [
          Math.max(27.15, centre[1] - 0.18),
          Math.min(29.2, centre[1] + 0.18),
          Math.max(-26.95, centre[0] - 0.16),
          Math.min(-25.05, centre[0] + 0.16),
        ]
      : [27.15, 29.2, -26.95, -25.05];
    const beauty =
        "regexp_matches(taxonomy.primary,'(^|_)(beauty|hair|nail|barber|spa)(_|$)')",
      restaurant = "list_contains(taxonomy.hierarchy,'restaurant')";
    const category =
      options.industry === "Beauty"
        ? beauty
        : options.industry === "Restaurants"
          ? restaurant
          : `(${beauty} OR ${restaurant})`;
    const excluded = options.exclude
      .map((value) => value.replace(/^OVERTURE:/, ""))
      .filter((value) => /^[\w:@.-]{1,200}$/.test(value))
      .slice(0, 20000)
      .join(",");
    const area =
      options.city === "Gauteng" &&
      options.cities &&
      options.cities.length < prospectCities.length
        ? options.cities
            .flatMap((city) => {
              const point = cityCentres[city];
              return point
                ? [
                    `(bbox.xmin BETWEEN ${point[1] - 0.18} AND ${point[1] + 0.18} AND bbox.ymin BETWEEN ${point[0] - 0.16} AND ${point[0] + 0.16})`,
                  ]
                : [];
            })
            .join(" OR ")
        : "true";
    const result = await connection.runAndReadAll(
      `SELECT id, names.primary AS company, taxonomy.primary AS category, CAST(taxonomy.hierarchy AS JSON) AS categoryHierarchy, phones[1] AS phone, emails[1] AS email, CAST(websites AS JSON) AS websites, CAST(addresses AS JSON) AS addresses, CAST(sources AS JSON) AS sources, confidence, bbox.xmin AS lon, bbox.ymin AS lat FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=true) WHERE bbox.xmin BETWEEN ${bounds[0]} AND ${bounds[1]} AND bbox.ymin BETWEEN ${bounds[2]} AND ${bounds[3]} AND (${area || "false"}) AND addresses[1].country='ZA' AND UPPER(addresses[1].region) IN ('GP','GAUTENG','ZA-GP') AND confidence>=0.75 AND (websites IS NULL OR len(websites)=0) AND len(phones)>0 AND ${category} AND NOT list_contains(string_split($1,','),id) LIMIT 200`,
      [excluded],
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
