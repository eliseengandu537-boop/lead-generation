"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, LoaderCircle, X } from "lucide-react";
import { api, rows, text, type RecordValue } from "./data";

const slotLabel = (value: unknown, full = false) =>
  new Date(String(value)).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    ...(full ? { weekday: "short", day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
export function CallerMeeting({
  workspaceId,
  lead,
  callId,
  act,
  close,
}: {
  workspaceId: string;
  lead: RecordValue;
  callId?: string;
  act: (input: RecordValue) => Promise<RecordValue>;
  close: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [availability, setAvailability] = useState<RecordValue>({});
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<RecordValue | null>(null);
  const [contact, setContact] = useState(text(lead.name, ""));
  const [email, setEmail] = useState(text(lead.email, ""));
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAvailability(
        await api(
          `/api/platform/${workspaceId}/caller/availability${date ? `?date=${encodeURIComponent(date)}` : ""}`,
        ),
      );
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, date]);
  useEffect(() => {
    modal.current?.showModal();
  }, []);
  useEffect(() => {
    setSlot(null);
    void load();
  }, [load]);
  const groups = new Map<string, RecordValue[]>();
  for (const item of rows(availability.slots)) {
    const day = new Date(text(item.startAt)).toLocaleDateString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    groups.set(day, [...(groups.get(day) || []), item]);
  }
  return (
    <dialog
      ref={modal}
      className="panel caller-meeting"
      aria-labelledby="caller-meeting-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="card-heading">
        <div>
          <p className="eyebrow">CONCRETE MEETINGS</p>
          <h2 id="caller-meeting-title">Book a website consultation</h2>
          <p className="muted">
            {text(lead.company)} · 30 minutes · South African time (SAST)
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Close meeting form"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!slot || !agreed || busy) return;
          setBusy(true);
          setError("");
          try {
            if (
              contact !== text(lead.name, "") ||
              email !== text(lead.email, "")
            )
              await act({
                action: "edit-lead",
                id: lead.id,
                name: contact,
                email,
              });
            await act({
              action: "book",
              leadId: lead.id,
              ...(callId ? { callId } : {}),
              title: `Website consultation · ${text(lead.company)}`.slice(
                0,
                160,
              ),
              startAt: slot.startAt,
              endAt: slot.endAt,
              timezone: "Africa/Johannesburg",
              notes,
              location: "Concrete consultation — phone / online meeting",
              customerAgreed: true,
              requestId: requestId.current,
            });
            close();
          } catch (problem) {
            setError((problem as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="caller-meeting-contact">
          <label>
            Contact person
            <input
              aria-label="Contact person"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              required
              maxLength={160}
              placeholder="The person attending the meeting"
            />
          </label>
          <label>
            Contact email (optional)
            <input
              aria-label="Contact email (optional)"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="For your team’s meeting record"
            />
          </label>
        </div>
        <div className="card-heading">
          <h3>Choose an agreed time</h3>
          <label className="caller-meeting-date">
            Choose another date
            <input
              aria-label="Meeting date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
        {loading ? (
          <p className="muted" role="status">
            <LoaderCircle size={15} className="spin" /> Checking the team’s
            available times…
          </p>
        ) : groups.size ? (
          [...groups].map(([day, slots]) => (
            <fieldset className="caller-slot-group" key={day}>
              <legend>{day}</legend>
              <div>
                {slots.map((item) => (
                  <button
                    type="button"
                    key={text(item.startAt)}
                    className={slot?.startAt === item.startAt ? "selected" : ""}
                    aria-pressed={slot?.startAt === item.startAt}
                    onClick={() => {
                      setSlot(item);
                      requestId.current = crypto.randomUUID();
                    }}
                  >
                    {slot?.startAt === item.startAt && <Check size={14} />}
                    {slotLabel(item.startAt)}
                  </button>
                ))}
              </div>
            </fieldset>
          ))
        ) : (
          <p className="alert">
            No meeting times are available for this date. Choose another
            weekday.
          </p>
        )}
        <label>
          Meeting notes
          <textarea
            aria-label="Meeting notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={5000}
            placeholder="What does the business need? Anything your team should prepare?"
          />
        </label>
        {slot && (
          <p className="caller-chosen-slot">
            <CalendarDays size={18} />
            {slotLabel(slot.startAt, true)} SAST · Concrete meeting team
          </p>
        )}
        <label className="caller-agreement">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            required
          />
          The prospect agreed to this meeting and time.
        </label>
        <p className="muted">
          Your administrator receives a notification automatically. The booking
          appears in both dashboards. You can download a calendar invitation
          after saving.
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button type="button" onClick={() => void load()}>
              Refresh available times
            </button>
          </div>
        )}
        <footer className="caller-meeting-footer">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!slot || !agreed || busy || loading}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <CalendarDays size={16} />
            )}
            Book meeting & notify admin
          </button>
        </footer>
      </form>
    </dialog>
  );
}
