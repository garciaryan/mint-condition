import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBulkLines } from "../lib/collection/parse.ts";

test("comma and tab years", () => {
  assert.deepEqual(parseBulkLines("SD 7208, 1971").lines, [{ query: "SD 7208", year: 1971 }]);
  assert.deepEqual(parseBulkLines("SD 7208\t1971").lines, [{ query: "SD 7208", year: 1971 }]);
});

test("plain trailing year is not split", () => {
  assert.deepEqual(parseBulkLines("ST 2001").lines, [{ query: "ST 2001" }]);
});

test("last comma wins", () => {
  assert.deepEqual(parseBulkLines("Smith, John, 1971").lines, [{ query: "Smith, John", year: 1971 }]);
});

test("invalid year is an error with line number", () => {
  const r = parseBulkLines("SD 7208, 71");
  assert.equal(r.lines.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 1);
  assert.match(r.errors[0].reason, /year/);
});

test("messy text: BOM, CRLF, blank lines, trailing comma", () => {
  const r = parseBulkLines("﻿A 1\r\n\r\nB 2,\r\n");
  assert.deepEqual(r.lines, [{ query: "A 1" }, { query: "B 2" }]);
  assert.deepEqual(r.errors, []);
});

test("full-width and nbsp spaces collapse; line numbers stay original", () => {
  const r = parseBulkLines("\n  SD　　 7208  ,  1971 \nbad, x");
  assert.deepEqual(r.lines, [{ query: "SD 7208", year: 1971 }]);
  assert.equal(r.errors[0].line, 3);
});

test("64 char cap", () => {
  assert.equal(parseBulkLines("a".repeat(64)).lines.length, 1);
  const r = parseBulkLines("a".repeat(65));
  assert.equal(r.lines.length, 0);
  assert.equal(r.errors[0].line, 1);
});

test("500 line cap", () => {
  const text = Array.from({ length: 501 }, (_, i) => `C ${i}`).join("\n");
  const r = parseBulkLines(text);
  assert.equal(r.lines.length, 500);
  assert.deepEqual(r.errors, [{ line: 501, reason: "only the first 500 records are added" }]);
});
