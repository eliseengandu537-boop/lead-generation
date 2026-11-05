"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, Check, X } from "lucide-react";
import { api, date, number, rows, text, type RecordValue } from "./data";
export function AdminBookingBell({
  openMeetings,
}: {
  openMeetings: () => void;
}) {
  const [data, setData] = useState<RecordValue>({});
  const [open, setOpen] = useState(false),
    [toast, setToast] = useState("");
  const latest = useRef<string | null>(null),
    panel = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const result = await api("/api/platform/admin/call-centre/notifications");
    const id = text(rows(result.items)[0]?.id, "");
    if (latest.current !== null && id && latest.current !== id)
      setToast(text(rows(result.items)[0]?.title));
    latest.current = id;
    setData(result);
  }, []);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  async function read(item: RecordValue) {
    try {
      if (!item.read)
        await api("/api/platform/admin/call-centre/notifications", "POST", {
          id: item.id,
        });
    } catch {
      setToast(
        "Could not mark this notification as read. You can still view the booking.",
      );
    }
    setOpen(false);
    openMeetings();
    void refresh().catch(() => undefined);
  }
  return (
    <div className="admin-booking-bell" ref={panel}>
      <button
        className="icon-button"
        aria-label={`Meeting notifications${number(data.unread) ? `, ${number(data.unread)} unread` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          void refresh().catch(() => undefined);
        }}
      >
        <Bell size={18} />
        {number(data.unread) > 0 && (
          <span className="booking-notification-count">
            {number(data.unread) > 99 ? "99+" : number(data.unread)}
          </span>
        )}
      </button>
      {toast && (
        <div className="booking-toast" role="status">
          <CalendarDays size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss meeting alert"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {open && (
        <section
          className="booking-notification-panel"
          aria-label="Meeting notifications"
        >
          <header>
            <h3>Meeting notifications</h3>
            <span>{number(data.unread)} unread</span>
          </header>
          {rows(data.items).length ? (
            rows(data.items).map((item) => (
              <button
                className={`booking-notification-item ${item.read ? "" : "unread"}`}
                key={text(item.id)}
                onClick={() => void read(item)}
              >
                <CalendarDays size={18} />
                <span>
                  <b>{text(item.title)}</b>
                  <p>{text(item.message)}</p>
                  <small>{date(item.createdAt, true)}</small>
                </span>
                {Boolean(item.read) && <Check size={14} />}
              </button>
            ))
          ) : (
            <p className="muted">
              New bookings and meeting updates will appear here automatically.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
