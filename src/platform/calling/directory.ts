import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, rateLimit } from "@/lib/auth";
import { encrypt, decrypt, hash } from "@/lib/security";
import { callerAccess } from "./access";

// Fixed city centres keep public-directory searches small and avoid sending any
// personal data to a geocoder. No automatic searches, pagination or bulk exports.
export const directoryCities = {
  Johannesburg: [-26.2041, 28.0473],
  Sandton: [-26.1076, 28.0567],
  Pretoria: [-25.7479, 28.2293],
  Centurion: [-25.8603, 28.1894],
  "Cape Town": [-33.9249, 18.4241],
  Durban: [-29.8587, 31.0218],
  Gqeberha: [-33.9608, 25.6022],
  Bloemfontein: [-29.0852, 26.1596],
} as const;
export const directoryCategories = {
  "Vehicle repair": ["shop", "car_repair"],
  Restaurants: ["amenity", "restaurant"],
  Cafes: ["amenity", "cafe"],
  Dentists: ["amenity", "dentist"],
  Clinics: ["amenity", "clinic"],
  Hairdressers: ["shop", "hairdresser"],
  Hotels: ["tourism", "hotel"],
  "Estate agents": ["office", "estate_agent"],
  "Car dealers": ["shop", "car"],
  "Hardware stores": ["shop", "hardware"],
} as const;
export const directoryInput = z
  .object({
    city: z.enum(
      Object.keys(directoryCities) as [
        keyof typeof directoryCities,
        ...Array<keyof typeof directoryCities>,
      ],
    ),
    category: z.enum(
      Object.keys(directoryCategories) as [
        keyof typeof directoryCategories,
        ...Array<keyof typeof directoryCategories>,
      ],
    ),
  })
  .strict();
export function directoryQuery(raw: unknown) {
  const input = directoryInput.parse(raw),
    [lat, lon] = directoryCities[input.city],
    [key, value] = directoryCategories[input.category];
  return {
    input,
    query: `[out:json][timeout:20][maxsize:67108864];nwr(around:8000,${lat},${lon})["${key}"="${value}"]["name"];out tags 10;`,
  };
}
export async function fetchDirectory(
  raw: unknown,
  request: typeof fetch = fetch,
) {
  const { input, query } = directoryQuery(raw);
  const endpoint = new URL(
    process.env.BUSINESS_DIRECTORY_URL ||
      "https://overpass.private.coffee/api/interpreter",
  );
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new HttpError(
      503,
      "Business directory provider is not configured correctly.",
    );
  let body: unknown;
  try {
    const response = await request(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": `ConcreteBusinessDirectory/1.0 (${new URL(process.env.NEXTAUTH_URL || "https://orbit-lead-generation.onrender.com").origin})`,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error("Directory unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty directory response");
    const parts: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1000000) throw new Error("Directory size limit");
        parts.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new HttpError(
      503,
      "The public business directory is unavailable right now. Use Search the web below to find businesses, or add a lead manually.",
    );
  }
  const parsed = z
    .object({
      remark: z.string().optional(),
      elements: z
        .array(
          z.object({
            id: z.number().int().positive(),
            type: z.enum(["node", "way", "relation"]),
            tags: z.record(z.string(), z.string()),
          }),
        )
        .max(10),
    })
    .safeParse(body);
  if (!parsed.success || parsed.data.remark)
    throw new HttpError(
      503,
      "The directory returned an incomplete search. Try again later.",
    );
  const cleanUrl = (value: string) => {
    try {
      const url = new URL(
        /^https?:\/\//i.test(value) ? value : `https://${value}`,
      );
      return ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : "";
    } catch {
      return "";
    }
  };
  return {
    attribution: "© OpenStreetMap contributors · ODbL",
    source: "https://www.openstreetmap.org/copyright",
    city: input.city,
    category: input.category,
    fetchedAt: new Date().toISOString(),
    results: parsed.data.elements
      .filter((item) => item.tags.name?.trim())
      .map((item) => ({
        company: item.tags.name.slice(0, 240),
        name: "",
        email: z
          .email()
          .safeParse(item.tags["contact:email"] || item.tags.email).success
          ? (item.tags["contact:email"] || item.tags.email).toLowerCase()
          : "",
        phone: (item.tags["contact:phone"] || item.tags.phone || "").slice(
          0,
          80,
        ),
        website: cleanUrl(
          item.tags["contact:website"] || item.tags.website || "",
        ),
        industry: input.category,
        location: [
          item.tags["addr:street"],
          item.tags["addr:suburb"],
          item.tags["addr:city"] || input.city,
        ]
          .filter(Boolean)
          .join(", ")
          .slice(0, 240),
        sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
        notes:
          "Source: OpenStreetMap contributors (ODbL). Public listing; details may be incomplete or outdated. Email permission and verification have not been established.",
      })),
  };
}
export async function searchDirectory(workspaceId: string, raw: unknown) {
  const { user } = await callerAccess(workspaceId);
  const input = directoryInput.parse(raw);
  await rateLimit(`directory-user:${user.id}`, 20, 60);
  const operationKey = `directory-cache:${hash(JSON.stringify(input))}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await db.platformOperationReceipt.findUnique({
    where: { workspaceId_operationKey: { workspaceId, operationKey } },
  });
  if (cached) return JSON.parse(decrypt(cached.encryptedResult));
  await rateLimit("directory-global", 3, 1);
  const result = await fetchDirectory(input);
  await db.platformOperationReceipt.upsert({
    where: { workspaceId_operationKey: { workspaceId, operationKey } },
    create: {
      workspaceId,
      operationKey,
      scopeHash: hash(JSON.stringify(input)),
      encryptedResult: encrypt(JSON.stringify(result)),
    },
    update: {},
  });
  return result;
}
