"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CalendarClock, Mail, Phone, RefreshCw, Trophy, X } from "lucide-react";
import {
  api,
  label,
  number,
  object,
  rows,
  text,
  type RecordValue,
} from "./data";
import { Loading } from "./primitives";
import CallCentre from "./call-centre";
import { Stat, Stats, Tabs, compact, percent } from "./admin-ui";

const stages = [
  { id: "CONTACTED", label: "Contacted", empty: "Leads land here after their first email or call." },
  { id: "INTERESTED", label: "Interested", empty: "Replies and leads qualified on a call land here." },
  { id: "BOOKED", label: "Call booked", empty: "Booked calls show here with their date and time." },
  { id: "WON", label: "Won", empty: "Move a lead here when the client wins the deal." },
  { id: "LOST", label: "Lost", empty: "Leads that said no or opted out." },
];
const board = ["CONTACTED", "INTERESTED", "BOOKED"];
const stageName = (id: string) => stages.find((stage) => stage.id === id)?.label ?? id;
const zone = "Africa/Johannesburg";
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function when(value: unknown) {
  const at = new Date(text(value, ""));
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-ZA", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function ago(value: unknown) {
  const at = new Date(text(value, ""));
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return at.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** A card in the air: what is being dragged, where it came from and which column it is over. */
type Lift = {
  item: RecordValue;
  from: string;
  over: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Where the card sat when it was picked up, in page coordinates (for the fly-back). */
  originX: number;
  originY: number;
  /** The pointer when the drag began; the ghost's first position. Later moves set it directly. */
  x0: number;
  y0: number;
};
type Press = {
  item: RecordValue;
  from: string;
  card: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  touch: boolean;
  armed: boolean;
  timer: number;
};

/** Move a card between stage lists locally, so the board updates before the server answers. */
function moveLocally(data: RecordValue, id: string, from: string, to: string) {
  const columns: (RecordValue & { cards: RecordValue[] })[] = rows(data.stages).map((column) => ({
    ...column,
    cards: rows(column.cards),
  }));
  const source = columns.find((column) => column.id === from);
  const target = columns.find((column) => column.id === to);
  const card = source?.cards.find((item) => text(item.id) === id);
  if (!source || !target || !card) return data;
  source.cards = source.cards.filter((item) => text(item.id) !== id);
  source.total = Math.max(0, number(source.total) - 1);
  target.cards = [{ ...card, updatedAt: new Date().toISOString() }, ...target.cards];
  target.total = number(target.total) + 1;
  return { ...data, stages: columns };
}

export default function SalesPipeline({
  businesses,
}: {
  businesses: RecordValue[];
}) {
  const [tab, setTab] = useState("pipeline");
  const [workspace, setWorkspace] = useState("");
  const [data, setData] = useState<RecordValue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lift, setLift] = useState<Lift | null>(null);
  const [landing, setLanding] = useState<{ id: string; to: string } | null>(null);
  const [landed, setLanded] = useState("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const liftRef = useRef<Lift | null>(null);
  liftRef.current = lift;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api(
        `/api/platform/admin/pipeline${workspace ? `?workspaceId=${encodeURIComponent(workspace)}` : ""}`,
        "GET",
        undefined,
        signal,
      );
      if (!signal?.aborted) setData(result);
    },
    [workspace],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    load(controller.signal).catch((problem) => {
      if (!controller.signal.aborted) setError(problem.message);
    });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** Save a move. The board already shows it; on failure it reloads the real state. */
  async function move(card: RecordValue, from: string, stage: string, announce = true) {
    if (!stage || stage === from) return;
    const id = text(card.id);
    setBusy(id);
    setError("");
    setData((current) => (current ? moveLocally(current, id, from, stage) : current));
    try {
      await api("/api/platform/admin/pipeline", "POST", {
        action: "move",
        workspaceId: card.workspaceId,
        leadId: card.id,
        stage,
      });
      if (announce)
        setToast({
          text: `${text(card.company)} moved to ${stageName(stage)}.`,
          undo: () => {
            setToast(null);
            void move(card, stage, from, false);
          },
        });
      await load();
    } catch (problem) {
      setError((problem as Error).message);
      setToast(null);
      await load().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  // ---------- Drag and drop (mouse, pen, and touch after a short press) ----------
  function place(x: number, y: number) {
    const current = liftRef.current;
    if (!ghost.current || !current) return;
    ghost.current.style.transform = `translate3d(${x - current.offsetX}px, ${y - current.offsetY}px, 0) rotate(1.5deg)`;
  }
  function dropTarget(x: number, y: number) {
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    return element?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? "";
  }
  function stopTouchScroll(event: TouchEvent) {
    if (press.current?.armed || liftRef.current) event.preventDefault();
  }
  // Window listeners must be the same function objects when removed, across re-renders,
  // so they are stable wrappers that call this render's handlers.
  const latest = useRef({ onMove, onUp, onCancel, stopTouchScroll });
  latest.current = { onMove, onUp, onCancel, stopTouchScroll };
  const listeners = useRef({
    move: (event: PointerEvent) => latest.current.onMove(event),
    up: (event: PointerEvent) => latest.current.onUp(event),
    cancel: () => latest.current.onCancel(),
    touch: (event: TouchEvent) => latest.current.stopTouchScroll(event),
  }).current;
  function cleanup() {
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    document.removeEventListener("touchmove", listeners.touch);
    document.body.classList.remove("g-dragging");
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }
  function start(event: PointerEvent) {
    const pressed = press.current!;
    const rect = pressed.card.getBoundingClientRect();
    const next: Lift = {
      item: pressed.item,
      from: pressed.from,
      over: pressed.from,
      width: rect.width,
      height: rect.height,
      offsetX: pressed.startX - rect.left,
      offsetY: pressed.startY - rect.top,
      originX: rect.left + window.scrollX,
      originY: rect.top + window.scrollY,
      x0: event.clientX,
      y0: event.clientY,
    };
    liftRef.current = next;
    setLift(next);
    document.body.classList.add("g-dragging");
  }
  function onMove(event: PointerEvent) {
    const pressed = press.current;
    if (!pressed || event.pointerId !== pressed.pointerId) return;
    const distance = Math.hypot(event.clientX - pressed.startX, event.clientY - pressed.startY);
    if (!liftRef.current) {
      if (pressed.touch && !pressed.armed) {
        // A touch that moves before the press is held is a scroll, not a drag.
        if (distance > 8) cleanup();
        return;
      }
      if (distance < 6) return;
      start(event);
      return;
    }
    place(event.clientX, event.clientY);
    const over = dropTarget(event.clientX, event.clientY) || liftRef.current.from;
    if (over !== liftRef.current.over) {
      const next = { ...liftRef.current, over };
      liftRef.current = next;
      setLift(next);
    }
    // Scroll the page when the card nears the top or bottom edge.
    if (event.clientY < 90) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
  }
  function flyTo(x: number, y: number, finish: () => void, shrink = false) {
    const element = ghost.current;
    if (!element || reduced()) {
      finish();
      return;
    }
    element.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s, box-shadow 0.32s";
    element.style.transform = `translate3d(${x}px, ${y}px, 0)${shrink ? " scale(0.4)" : ""}`;
    if (shrink) element.style.opacity = "0";
    element.classList.add("is-dropping");
    window.setTimeout(finish, 330);
  }
  function onUp(event: PointerEvent) {
    const pressed = press.current;
    if (!pressed || event.pointerId !== pressed.pointerId) return;
    const current = liftRef.current;
    cleanup();
    if (!current) return;
    const target = dropTarget(event.clientX, event.clientY);
    const id = text(current.item.id);
    if (target && target !== current.from) {
      if (board.includes(target)) {
        // Land on the board: render the card hidden, then fly the ghost onto it.
        setLanding({ id, to: target });
        void move(current.item, current.from, target);
      } else {
        const box = document.querySelector<HTMLElement>(`[data-drop="${target}"]`)?.getBoundingClientRect();
        void move(current.item, current.from, target);
        flyTo(
          (box?.left ?? event.clientX) + (box?.width ?? 0) / 2 - current.width / 2,
          (box?.top ?? event.clientY) + 30,
          () => setLift(null),
          true,
        );
      }
    } else {
      flyTo(current.originX - window.scrollX, current.originY - window.scrollY, () => setLift(null));
    }
  }
  function onCancel() {
    const current = liftRef.current;
    cleanup();
    if (current) flyTo(current.originX - window.scrollX, current.originY - window.scrollY, () => setLift(null));
  }
  function onPress(event: ReactPointerEvent<HTMLElement>, item: RecordValue, from: string) {
    if (event.button !== 0 || press.current || liftRef.current || busy) return;
    if ((event.target as HTMLElement).closest("select, button, a, input, textarea")) return;
    const touch = event.pointerType === "touch";
    press.current = {
      item,
      from,
      card: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      touch,
      armed: !touch,
      timer: touch
        ? window.setTimeout(() => {
            if (!press.current) return;
            press.current.armed = true;
            navigator.vibrate?.(15);
            start(new PointerEvent("pointermove", { clientX: press.current.startX, clientY: press.current.startY }));
          }, 260)
        : 0,
    };
    window.addEventListener("pointermove", listeners.move);
    window.addEventListener("pointerup", listeners.up);
    window.addEventListener("pointercancel", listeners.cancel);
    if (touch) document.addEventListener("touchmove", listeners.touch, { passive: false });
  }
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the moved card is on the board (still invisible), fly the ghost onto it.
  useLayoutEffect(() => {
    if (!landing || !lift) return;
    const card = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(landing.id)}"]`);
    const rect = card?.getBoundingClientRect();
    const done = () => {
      setLift(null);
      setLanding(null);
      setLanded(landing.id);
      window.setTimeout(() => setLanded((value) => (value === landing.id ? "" : value)), 900);
    };
    if (!rect) {
      done();
      return;
    }
    flyTo(rect.left, rect.top, done);
  }, [landing]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = rows(data?.stages);
  const total = (id: string) =>
    number(columns.find((column) => column.id === id)?.total);
  const bookings = object(data?.bookings);
  const open = total("CONTACTED") + total("INTERESTED") + total("BOOKED");
  const decided = total("WON") + total("LOST");

  function cardBody(item: RecordValue, stageId: string, interactive = true) {
    const booked = item.bookingAt ? new Date(text(item.bookingAt)) : null;
    const overdue = booked && booked.getTime() < Date.now();
    const contact = [item.name, item.email || item.phone]
      .map((value) => text(value, ""))
      .filter(Boolean)
      .join(" · ");
    return (
      <>
        <header>
          <b title={text(item.company)}>{text(item.company)}</b>
        </header>
        <p className="adm-deal-client">{text(item.business)}</p>
        {booked ? (
          <p className={`adm-deal-when${overdue ? " is-overdue" : ""}`}>
            <CalendarClock size={14} />
            {when(item.bookingAt)}
            {overdue && " · needs an outcome"}
          </p>
        ) : item.lastCallAt ? (
          <p className="adm-deal-meta">
            <Phone size={13} />
            {label(item.lastCallOutcome)} · {ago(item.lastCallAt)}
          </p>
        ) : item.repliedAt ? (
          <p className="adm-deal-meta">
            <Mail size={13} />
            Replied {ago(item.repliedAt)}
          </p>
        ) : (
          <p className="adm-deal-meta">Updated {ago(item.updatedAt)}</p>
        )}
        <footer>
          <span className="adm-deal-contact" title={contact}>
            {contact || text(item.location, "No contact details")}
          </span>
          {interactive && (
            <select
              aria-label={`Move ${text(item.company)} to another stage`}
              value=""
              disabled={busy === text(item.id)}
              onChange={(event) => void move(item, stageId, event.target.value)}
            >
              <option value="">Move to…</option>
              {stages
                .filter((stage) => stage.id !== stageId)
                .map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
            </select>
          )}
        </footer>
      </>
    );
  }
  function card(item: RecordValue, stageId: string, index = 0) {
    const id = text(item.id);
    const lifted = lift && text(lift.item.id) === id && !landing;
    const hidden = landing?.id === id;
    return (
      <article
        className={`adm-deal${lifted ? " is-lifted" : ""}${hidden ? " is-landing" : ""}${landed === id ? " is-landed" : ""}`}
        key={id}
        data-card={id}
        style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
        onPointerDown={(event) => onPress(event, item, stageId)}
        onContextMenu={(event) => press.current?.touch && event.preventDefault()}
      >
        {cardBody(item, stageId)}
      </article>
    );
  }

  return (
    <div className="adm-pipeline">
      <Tabs
        label="Sales pipeline sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: "pipeline", label: "Pipeline", count: data ? open : undefined },
          { id: "calls", label: "Calls & bookings" },
          { id: "team", label: "Callers & setup" },
        ]}
      />
      {tab === "pipeline" && (
        <>
          <Stats>
            <Stat
              label="Open opportunities"
              value={data ? open : null}
              hint="Contacted, interested or booked"
            />
            <Stat
              label="Interested"
              value={data ? total("INTERESTED") : null}
              hint="Replied, or qualified on a call"
            />
            <Stat
              label="Calls booked"
              value={data ? total("BOOKED") : null}
              hint={`${compact(bookings.nextSevenDays)} in the next 7 days`}
            />
            <Stat
              label="Won"
              value={data ? total("WON") : null}
              tone={total("WON") > 0 ? "good" : undefined}
              hint={`${percent(total("WON"), decided)} win rate`}
            />
            <Stat
              label="Calls held"
              value={data ? bookings.completed : null}
              hint={`${compact(bookings.noShow)} no-shows`}
            />
          </Stats>
          <div className="adm-toolbar">
            <select
              aria-label="Show the pipeline for one client"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              <option value="">All clients</option>
              {businesses.map((business) => (
                <option
                  key={text(business.workspaceId)}
                  value={text(business.workspaceId)}
                >
                  {text(business.name)}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh pipeline"
              onClick={() =>
                void load().catch((problem) => setError(problem.message))
              }
            >
              <RefreshCw size={16} />
            </button>
            <span className="muted">
              Drag a card to another stage, or onto Won or Lost. Booking a call moves the lead to Call booked by itself.
            </span>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data ? (
            <Loading />
          ) : (
            <>
              <div className={`adm-board${lift ? " is-dragging" : ""}`}>
                {board.map((stageId) => {
                  const stage = stages.find((entry) => entry.id === stageId)!;
                  const column = object(
                    columns.find((item) => item.id === stage.id),
                  );
                  const cards = rows(column.cards);
                  const over = lift && lift.over === stage.id && lift.from !== stage.id;
                  return (
                    <section
                      className={`adm-column stage-${stage.id.toLowerCase()}${over ? " is-over" : ""}`}
                      key={stage.id}
                      data-drop={stage.id}
                      aria-label={`${stage.label}: ${compact(column.total)} leads`}
                    >
                      <header>
                        <span className="adm-dot" />
                        <h3>{stage.label}</h3>
                        <span className="adm-count">
                          {compact(column.total)}
                        </span>
                      </header>
                      <div className="adm-column-body">
                        {over && (
                          <div className="adm-drop-slot" style={{ height: lift.height }} aria-hidden="true" />
                        )}
                        {cards.map((item, index) => card(item, stage.id, index))}
                        {!cards.length && !over && (
                          <p className="adm-column-empty">{stage.empty}</p>
                        )}
                      </div>
                      {number(column.total) > cards.length && (
                        <footer>
                          Showing {cards.length} of {compact(column.total)}
                        </footer>
                      )}
                    </section>
                  );
                })}
                <div className="adm-outcomes">
                  {(["WON", "LOST"] as const).map((id) => (
                    <section
                      key={id}
                      data-drop={id}
                      className={`adm-outcome is-${id.toLowerCase()}${lift && lift.over === id ? " is-over" : ""}`}
                      aria-label={`${stageName(id)}: ${compact(total(id))} leads`}
                    >
                      <span className="adm-outcome-icon">
                        {id === "WON" ? <Trophy size={20} /> : <X size={20} />}
                      </span>
                      <b>{stageName(id)}</b>
                      <small>
                        {compact(total(id))} lead{total(id) === 1 ? "" : "s"}
                      </small>
                      {id === "WON" && <small>{percent(total("WON"), decided)} win rate</small>}
                      <em>{lift ? "Drop here" : ""}</em>
                    </section>
                  ))}
                </div>
              </div>
              {(["WON", "LOST"] as const).map((id) =>
                total(id) > 0 ? (
                  <details className="adm-lost" key={id}>
                    <summary>
                      {stageName(id)} <span className="adm-count">{compact(total(id))}</span>
                    </summary>
                    <div className="adm-lost-grid">
                      {rows(object(columns.find((item) => item.id === id)).cards).map((item, index) =>
                        card(item, id, index),
                      )}
                    </div>
                  </details>
                ) : null,
              )}
              {lift && (
                <div
                  ref={ghost}
                  className={`adm-deal adm-ghost stage-${lift.over.toLowerCase()}`}
                  style={{
                    width: lift.width,
                    height: lift.height,
                    // Only the first position; pointer moves update the transform directly.
                    transform: `translate3d(${lift.x0 - lift.offsetX}px, ${lift.y0 - lift.offsetY}px, 0) rotate(1.5deg)`,
                  }}
                  aria-hidden="true"
                >
                  {cardBody(lift.item, lift.from, false)}
                </div>
              )}
            </>
          )}
          {toast && (
            <div className="adm-toast" role="status">
              <span>{toast.text}</span>
              {toast.undo && (
                <button className="button" onClick={toast.undo}>
                  Undo
                </button>
              )}
            </div>
          )}
        </>
      )}
      {tab === "calls" && <CallCentre view="calls" />}
      {tab === "team" && <CallCentre view="team" />}
    </div>
  );
}
