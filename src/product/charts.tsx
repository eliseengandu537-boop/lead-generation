"use client";
import { useEffect, useRef, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { date, number, text, type RecordValue } from "./data";

export function MetricNumber({ value }: { value: unknown }) {
  const target = typeof value === "number" ? value : Number(value);
  const valid =
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(target);
  const previous = useRef(valid ? target : 0);
  const [display, setDisplay] = useState(valid ? target : 0);
  useEffect(() => {
    if (!valid) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      previous.current = target;
      return;
    }
    const from = previous.current;
    let frame = 0;
    const start = performance.now();
    const tick = (stamp: number) => {
      const elapsed = Math.min(1, (stamp - start) / 280);
      setDisplay(
        Math.round(from + (target - from) * (1 - Math.pow(1 - elapsed, 3))),
      );
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    previous.current = target;
    return () => cancelAnimationFrame(frame);
  }, [target, valid]);
  return (
    <span
      className="metric-number"
      aria-label={valid ? String(target) : "Unavailable"}
    >
      {valid ? new Intl.NumberFormat("en-ZA").format(display) : "—"}
    </span>
  );
}

const defaultMetrics = [
  { key: "sent", label: "Emails sent" },
  { key: "replies", label: "Replies" },
  { key: "discovered", label: "Discovered businesses" },
  { key: "qualified", label: "Qualified leads" },
];
export function TrendChart({
  values,
  title = "Outreach performance",
  description = "Recorded activity over time",
  metrics = defaultMetrics,
}: {
  values: RecordValue[];
  title?: string;
  description?: string;
  metrics?: { key: string; label: string }[];
}) {
  const [metric, setMetric] = useState(metrics[0]?.key || "sent");
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (!metrics.some((item) => item.key === metric))
      setMetric(metrics[0]?.key || "sent");
  }, [metrics, metric]);
  const points = values.filter((entry) => entry.date || entry.day);
  const maximum = Math.max(1, ...points.map((entry) => number(entry[metric])));
  const x = (index: number) =>
    24 + (index / Math.max(1, points.length - 1)) * 612;
  const y = (entry: RecordValue) =>
    198 - (number(entry[metric]) / maximum) * 160;
  const path = points
    .map((entry, index) => `${index ? "L" : "M"}${x(index)},${y(entry)}`)
    .join(" ");
  const selected = active === null ? null : points[active];
  const metricName =
    metrics.find((item) => item.key === metric)?.label || metric;
  return (
    <div className="trend-chart">
      <div className="trend-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <select
          aria-label={`${title} metric`}
          value={metric}
          onChange={(event) => {
            setMetric(event.target.value);
            setActive(null);
          }}
        >
          {metrics.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {points.length ? (
        <>
          <div className="trend-stage">
            <svg
              className="trend-svg"
              viewBox="0 0 660 230"
              role="img"
              aria-label={`${metricName} across ${points.length} recorded days`}
            >
              {[0, 1, 2, 3].map((line) => (
                <g key={line}>
                  <line
                    className="chart-grid-line"
                    x1="24"
                    x2="636"
                    y1={38 + (line * 160) / 3}
                    y2={38 + (line * 160) / 3}
                  />
                  <text className="chart-tick" x="0" y={42 + (line * 160) / 3}>
                    {Math.round(maximum * (1 - line / 3))}
                  </text>
                </g>
              ))}
              {points.length > 1 && (
                <path
                  d={`${path} L${x(points.length - 1)},198 L24,198 Z`}
                  fill="var(--accent)"
                  opacity=".045"
                />
              )}
              <path
                d={path}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((entry, index) => (
                <g key={text(entry.date ?? entry.day, String(index))}>
                  <circle
                    cx={x(index)}
                    cy={y(entry)}
                    r={active === index ? 5 : 3}
                    fill="var(--accent)"
                  />
                  <circle
                    cx={x(index)}
                    cy={y(entry)}
                    r="12"
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${date(entry.date ?? entry.day)}: ${number(entry[metric])} ${metricName}`}
                    onMouseEnter={() => setActive(index)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    onTouchStart={() => setActive(index)}
                  />
                </g>
              ))}
            </svg>
            {selected && (
              <div
                className="chart-tooltip"
                role="status"
                style={{
                  left: `${Math.max(12, Math.min(75, (active! / Math.max(1, points.length - 1)) * 85))}%`,
                }}
              >
                <span>{date(selected.date ?? selected.day)}</span>
                <b>
                  {number(selected[metric]).toLocaleString()}{" "}
                  {metricName.toLowerCase()}
                </b>
              </div>
            )}
          </div>
          <div className="trend-axis">
            <span>{date(points[0].date ?? points[0].day)}</span>
            <span>{date(points.at(-1)?.date ?? points.at(-1)?.day)}</span>
          </div>
        </>
      ) : (
        <div className="chart-empty">
          <ChartNoAxesCombined size={28} strokeWidth={1.3} />
          <b>No recorded activity in this period</b>
          <p>Your chart will appear as your campaigns and research run.</p>
        </div>
      )}
    </div>
  );
}
