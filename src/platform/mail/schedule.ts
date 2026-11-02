export function withinSendingWindow(
  now: Date,
  timezone: string,
  campaign: {
    sendStartHour: number;
    sendEndHour: number;
    sendWeekdays: number[];
  },
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekday =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
      parts.find((part) => part.type === "weekday")?.value || "",
    ) + 1;
  return (
    campaign.sendWeekdays.includes(weekday) &&
    hour >= campaign.sendStartHour &&
    hour < campaign.sendEndHour
  );
}
