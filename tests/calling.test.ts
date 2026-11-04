import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  bookingCalendar,
  bookingInput,
  phoneNumber,
  providerCallUpdate,
  validateBookingWindow,
} from "../src/platform/calling/rules";

test("calling accepts complete international numbers and normalizes South African SIM numbers", () => {
  assert.equal(phoneNumber("082 123 4567"), "+27821234567");
  assert.equal(phoneNumber("0027 (82) 123-4567"), "+27821234567");
  assert.equal(phoneNumber("+44 20 7946 0958"), "+442079460958");
  for (const value of [
    "1234",
    "tel:+27821234567",
    "+27821234567;ext=100",
    "+012345678",
    "+27821234567\nTo:+12345678",
    "*120*123#",
  ])
    assert.throws(() => phoneNumber(value));
});
test("provider status ignores duplicates, stale events, regressions and changes after a terminal result", () => {
  assert.equal(
    providerCallUpdate({ status: "INITIATED", lastSequence: -1 }, "ringing", 0),
    "RINGING",
  );
  assert.equal(
    providerCallUpdate({ status: "RINGING", lastSequence: 0 }, "answered", 1),
    "IN_PROGRESS",
  );
  assert.equal(
    providerCallUpdate(
      { status: "IN_PROGRESS", lastSequence: 1 },
      "ringing",
      2,
    ),
    null,
  );
  assert.equal(
    providerCallUpdate(
      { status: "IN_PROGRESS", lastSequence: 2 },
      "completed",
      2,
    ),
    null,
  );
  assert.equal(
    providerCallUpdate(
      { status: "IN_PROGRESS", lastSequence: 2 },
      "completed",
      3,
    ),
    "COMPLETED",
  );
  assert.equal(
    providerCallUpdate({ status: "COMPLETED", lastSequence: 3 }, "failed", 4),
    null,
  );
  assert.equal(
    providerCallUpdate(
      { status: "INITIATED", lastSequence: -1 },
      "no-answer",
      0,
    ),
    "NO_ANSWER",
  );
  assert.equal(
    providerCallUpdate(
      { status: "INITIATED", lastSequence: -1 },
      "manual-success",
      0,
    ),
    null,
  );
});
test("bookings require a real future window, a valid timezone, explicit agreement and no extra permissions", () => {
  const now = new Date("2030-01-01T00:00:00Z"),
    start = new Date("2030-01-02T12:00:00Z"),
    end = new Date("2030-01-02T12:30:00Z");
  validateBookingWindow(start, end, "Africa/Johannesburg", now);
  assert.throws(() =>
    validateBookingWindow(now, end, "Africa/Johannesburg", now),
  );
  assert.throws(() =>
    validateBookingWindow(start, start, "Africa/Johannesburg", now),
  );
  assert.throws(() =>
    validateBookingWindow(
      start,
      new Date(start.getTime() + 59000),
      "Africa/Johannesburg",
      now,
    ),
  );
  assert.throws(() =>
    validateBookingWindow(
      start,
      new Date(start.getTime() + 9 * 3600000),
      "Africa/Johannesburg",
      now,
    ),
  );
  assert.throws(() => validateBookingWindow(start, end, "Fake/City", now));
  const input = {
    action: "book",
    leadId: "lead1",
    title: "Discovery",
    hostId: "host1",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    customerAgreed: true,
    requestId: randomUUID(),
  };
  assert.ok(bookingInput.safeParse(input).success);
  for (const change of [
    { customerAgreed: false },
    { title: "Discovery\r\nATTENDEE:intruder" },
    { eligibility: "CONSENT" },
    { meetingUrl: "http://example.com" },
    { meetingUrl: "https://example.com/\r\nATTENDEE:bad@example.invalid" },
    { meetingUrl: "https://private:password@example.com/" },
  ])
    assert.equal(
      bookingInput.safeParse({ ...input, ...change }).success,
      false,
    );
});
test("calendar files preserve exact UTC times and revisions, fold UTF-8, escape untrusted text and omit internal notes", () => {
  const booking = {
    id: "booking1",
    title: "Prospect; meeting, " + "é".repeat(70),
    startAt: new Date("2030-01-02T12:00:00Z"),
    endAt: new Date("2030-01-02T12:30:00Z"),
    createdAt: new Date("2030-01-01T12:00:00Z"),
    updatedAt: new Date("2030-01-01T12:00:00Z"),
    location: "Office\rATTENDEE:bad@example.invalid",
    meetingUrl: "https://meeting.example.invalid/room",
    version: 2,
    status: "CANCELED",
    notes: "internal-secret",
  };
  const calendar = bookingCalendar(
    booking,
    {
      name: 'Host: "Team"\r\nATTENDEE:bad@example.invalid',
      email: "host@example.invalid",
    },
    { name: "Prospect", email: "prospect@example.invalid" },
  );
  const unfolded = calendar.replaceAll("\r\n ", "");
  assert.match(unfolded, /UID:booking1@concrete/);
  assert.match(unfolded, /DTSTART:20300102T120000Z/);
  assert.match(unfolded, /DTEND:20300102T123000Z/);
  assert.match(unfolded, /SEQUENCE:2/);
  assert.match(unfolded, /STATUS:CANCELLED/);
  assert.ok(!calendar.includes("internal-secret"));
  assert.equal(
    unfolded.split("\r\n").filter((line) => line.startsWith("ATTENDEE")).length,
    1,
  );
  assert.equal(
    unfolded.split("\r\n").filter((line) => line.startsWith("ORGANIZER"))
      .length,
    1,
  );
  assert.ok(
    calendar.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
  );
});
