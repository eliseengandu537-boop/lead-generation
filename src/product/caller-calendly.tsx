"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ExternalLink, LoaderCircle } from "lucide-react";
import {
  calendlyBookingUrl,
  calendlyScheduledMessage,
} from "@/platform/calling/calendly-options";
import { text, type RecordValue } from "./data";

export function CallerCalendly({
  url,
  lead,
  act,
  close,
}: {
  url: string;
  lead: RecordValue;
  act: (input: RecordValue) => Promise<RecordValue>;
  close: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [contact, setContact] = useState(text(lead.name, ""));
  const [email, setEmail] = useState(text(lead.email, ""));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [embed, setEmbed] = useState("");
  const [link, setLink] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // Only this scheduling iframe can change its confirmation UI. Browser
      // messages never create CRM bookings or fabricate verified meeting times.
      if (
        event.source === frame.current?.contentWindow &&
        calendlyScheduledMessage(event.origin, event.data)
      )
        setConfirmed(true);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  if (embed)
    return (
      <div className="caller-calendly">
        {confirmed ? (
          <p className="alert" role="status">
            <Check size={18} /> Calendly confirmed this booking. Meeting details
            and changes are managed in Calendly.
          </p>
        ) : (
          <p className="muted">
            Choose the time agreed with the prospect, then complete Calendly’s
            confirmation. Opening the calendar alone does not book a meeting.
          </p>
        )}
        <div className="caller-calendly-links">
          <a
            className="button"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} /> Open Calendly in a new tab
          </a>
          <button onClick={close}>{confirmed ? "Done" : "Close"}</button>
        </div>
        <iframe
          ref={frame}
          src={embed}
          title="Book a meeting with Concrete on Calendly"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <p className="muted">
          Calendly manages availability and its configured calendar invitations.
          Bookings are not yet synced into Concrete’s meeting reports.
        </p>
      </div>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!agreed || busy) return;
        setBusy(true);
        setError("");
        try {
          const name = contact.trim(),
            address = email.trim();
          if (name !== text(lead.name, "") || address !== text(lead.email, ""))
            await act({
              action: "edit-lead",
              id: lead.id,
              name,
              email: address,
            });
          setLink(calendlyBookingUrl(url, { name, email: address }));
          setEmbed(
            calendlyBookingUrl(
              url,
              { name, email: address },
              window.location.hostname,
            ),
          );
        } catch (problem) {
          setError((problem as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Book directly into the team’s Calendly calendar. Add the prospect’s
        details so the invitation goes to the person attending.
      </p>
      <div className="caller-meeting-contact">
        <label>
          Contact person
          <input
            aria-label="Contact person"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            required
            maxLength={160}
            autoComplete="off"
          />
        </label>
        <label>
          Prospect email
          <input
            aria-label="Prospect email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
            autoComplete="off"
          />
        </label>
      </div>
      <label className="caller-agreement">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          required
        />
        The prospect agreed to arrange a meeting.
      </label>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <footer className="caller-meeting-footer">
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="primary" type="submit" disabled={!agreed || busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <CalendarDays size={16} />
          )}
          Choose time in Calendly
        </button>
      </footer>
    </form>
  );
}
