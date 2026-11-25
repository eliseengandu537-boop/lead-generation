"use client";

import Link from "next/link";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MonetticMark } from "./primitives";

/** The "glass" app frame: a soft dusk backdrop behind frosted panels. */
export function GlassBackdrop() {
  return <div className="g-backdrop" aria-hidden="true" />;
}

export function GlassBrand({ href }: { href: string }) {
  return (
    <Link href={href} className="g-brand" aria-label="Monettic home">
      <span className="g-brand-tile">
        <MonetticMark small />
      </span>
      <span>monettic</span>
    </Link>
  );
}

export type PillItem = { id: string; label: string; badge?: ReactNode };

/** Top menu as a row of pills. The highlight slides to the chosen pill: the edge in the
 * direction of travel moves first and the other edge catches up, so it stretches a little. */
export function PillNav({
  items,
  active,
  onSelect,
  label,
}: {
  items: PillItem[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const scroller = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState<{ left: number; right: number; forward: boolean } | null>(null);
  const ids = items.map((item) => item.id).join("|");

  useLayoutEffect(() => {
    const list = track.current;
    if (!list) return;
    function place() {
      const pill = list!.querySelector<HTMLElement>(`[data-pill="${CSS.escape(active)}"]`);
      if (!pill) {
        setGlow(null);
        return;
      }
      const left = pill.offsetLeft;
      const right = list!.offsetWidth - (pill.offsetLeft + pill.offsetWidth);
      setGlow((previous) =>
        previous && previous.left === left && previous.right === right
          ? previous
          : { left, right, forward: !previous || left >= previous.left },
      );
      const box = scroller.current;
      if (box && box.scrollWidth > box.clientWidth) {
        box.scrollTo({ left: Math.max(0, left - 24), behavior: "smooth" });
      }
    }
    place();
    const watcher = new ResizeObserver(place);
    watcher.observe(list);
    return () => watcher.disconnect();
  }, [active, ids]);

  return (
    <nav className="g-pills" aria-label={label} ref={scroller}>
      <div className="g-pills-track" ref={track}>
        {glow && (
          <span
            className="g-pill-glow"
            aria-hidden="true"
            style={{
              left: glow.left,
              right: glow.right,
              // left, right: the leading edge is quicker than the trailing edge.
              transitionDuration: glow.forward ? "0.55s, 0.36s" : "0.36s, 0.55s",
            }}
          />
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-pill={item.id}
            className={`g-pill${item.id === active ? " is-active" : ""}`}
            aria-current={item.id === active ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.label}</span>
            {item.badge}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** One round button on the floating left rail; shows its name as a tooltip. */
export function RailButton({
  label,
  icon,
  onClick,
  href,
  active = false,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  const className = `g-rail-button${active ? " is-active" : ""}`;
  return href ? (
    <Link href={href} className={className} aria-label={label} data-tip={label}>
      {icon}
    </Link>
  ) : (
    <button type="button" className={className} aria-label={label} data-tip={label} onClick={onClick}>
      {icon}
    </button>
  );
}
