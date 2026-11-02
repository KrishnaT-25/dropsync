import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMeetingLink, isValidMeetingCode, parseMeetingCodeInput, parseMeetingLink } from "./meetingCode.js";

test("meeting code is exactly six characters, with an optional display hyphen", () => {
  assert.equal(isValidMeetingCode("ABCDEF"), true);
  assert.equal(isValidMeetingCode("ABC-DEF"), true);
  assert.equal(isValidMeetingCode("ABCDEF-extra"), false);
  assert.equal(parseMeetingCodeInput("abc-def"), "ABCDEF");
});

test("meeting links route to the same code", () => {
  const link = buildMeetingLink("ABCDEF", "https://dropsync1.vercel.app");
  assert.equal(link, "https://dropsync1.vercel.app/meet/ABCDEF");
  assert.equal(parseMeetingLink(link), "ABCDEF");
  assert.equal(parseMeetingLink("http://localhost:5173/meet/ABC-DEF"), "ABCDEF");
  assert.equal(parseMeetingCodeInput(link), "ABCDEF");
  assert.equal(parseMeetingLink("https://example.com/unrelated/ABCDEF"), "");
  assert.equal(parseMeetingLink("https://example.com/meet/ABCDEF-extra"), "");
});
