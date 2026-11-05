export const prospectCities = [
  "Johannesburg",
  "Pretoria",
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
] as const;
export const prospectIndustries = ["ALL", "Restaurants", "Beauty"] as const;
export const cityCentres: Record<string, [number, number]> = {
  Johannesburg: [-26.2041, 28.0473],
  Pretoria: [-25.7479, 28.2293],
  Sandton: [-26.1076, 28.0567],
  Centurion: [-25.8603, 28.1894],
  Midrand: [-25.9992, 28.1263],
  Benoni: [-26.1885, 28.3208],
  Boksburg: [-26.2047, 28.2571],
  Roodepoort: [-26.1625, 27.8725],
  "Kempton Park": [-26.1003, 28.24],
  Germiston: [-26.2259, 28.1708],
  Krugersdorp: [-26.085, 27.775],
  Vereeniging: [-26.6731, 27.9261],
};
export function gautengDayStart(now = new Date()) {
  const local = new Date(now.getTime() + 2 * 3600000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      2 * 3600000,
  );
}
export function inProspectArea(
  latitude: number,
  longitude: number,
  cities: string[],
) {
  if (
    cities.length === prospectCities.length &&
    prospectCities.every((city) => cities.includes(city))
  )
    return true;
  return cities.some((city) => {
    const centre = cityCentres[city];
    return (
      centre &&
      Math.abs(latitude - centre[0]) <= 0.16 &&
      Math.abs(longitude - centre[1]) <= 0.18
    );
  });
}
