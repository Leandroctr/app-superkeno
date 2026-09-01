import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatOneSignalError,
  isSafePushTargetUrl,
  MAX_PUSH_ERROR_MESSAGE_LENGTH,
  resolvePushTargetUrl,
} from "../lib/push-security.ts";

const baseUrl = "https://pwa.example.test";
const routeSource = readFileSync("app/api/push/send/route.ts", "utf8");
const oneSignalSource = readFileSync("components/onesignal-initializer.tsx", "utf8");
const uploadSource = readFileSync("app/api/admin/upload/route.ts", "utf8");
const pageSource = readFileSync("app/page.tsx", "utf8");
const settingsSource = readFileSync("lib/app-settings.server.ts", "utf8");
const apiSettingsSource = readFileSync("app/api/settings/route.ts", "utf8");
const serverLoggerSource = readFileSync("lib/logger/server.ts", "utf8");
const clientLoggerSource = readFileSync("lib/logger/client.ts", "utf8");

test("B-2 accepts legitimate internal and HTTP(S) targets", () => {
  assert.equal(isSafePushTargetUrl("/pagina", baseUrl), true);
  assert.equal(isSafePushTargetUrl("/", baseUrl), true);
  assert.equal(isSafePushTargetUrl("https://dominio-valido.com", baseUrl), true);
  assert.equal(isSafePushTargetUrl("http://dominio-valido.com", baseUrl), true);
});

test("B-2 rejects protocol-relative, dangerous, invalid, and manipulated targets", () => {
  for (const value of [
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "blob:https://evil.com/id",
    "https:\\evil.com",
    "https:evil.com",
    "not a url",
    " /pagina",
    "/pagina ",
    "/pagina com espaco",
    "\t/pagina",
  ]) {
    assert.equal(isSafePushTargetUrl(value, baseUrl), false, value);
  }
});

test("B-2 falls back without returning an unsafe requested target", () => {
  assert.equal(
    resolvePushTargetUrl("//evil.com", ["https://plataforma.valida.com", baseUrl], baseUrl),
    "https://plataforma.valida.com",
  );
  assert.equal(resolvePushTargetUrl("/pagina", [baseUrl], baseUrl), "/pagina");
  assert.equal(resolvePushTargetUrl("invalid", ["invalid"], baseUrl), "/");
});

test("B-4 stores only allowlisted OneSignal error fields", () => {
  const serialized = formatOneSignalError(400, {
    code: "invalid_request",
    message: "Invalid notification request",
    request_id: "req_123",
    headers: { authorization: "Key simulated-secret" },
    apiKey: "simulated-secret",
    recipients: ["subscription-secret"],
  });
  const parsed = JSON.parse(serialized);

  assert.deepEqual(parsed, {
    provider: "onesignal",
    status: 400,
    code: "invalid_request",
    message: "Invalid notification request",
    requestId: "req_123",
  });
  assert.doesNotMatch(serialized, /simulated-secret|subscription-secret|authorization/i);
});

test("B-4 bounds huge, deeply nested, unexpected, and long responses", () => {
  const inputs = [
    { message: "x".repeat(100_000) },
    { unexpected: { deeply: { nested: { secret: "simulated-secret" } } } },
    { errors: [{ message: "quoted \\\"message\\\" ".repeat(10_000) }] },
    null,
  ];

  for (const input of inputs) {
    const serialized = formatOneSignalError(503, input);
    const parsed = JSON.parse(serialized);
    assert.ok(serialized.length <= MAX_PUSH_ERROR_MESSAGE_LENGTH);
    assert.equal(parsed.provider, "onesignal");
    assert.equal(parsed.status, 503);
    assert.equal(typeof parsed.message, "string");
    assert.doesNotMatch(serialized, /simulated-secret/);
  }
});

test("B-4 route never persists the raw provider response and success clears errors", () => {
  assert.doesNotMatch(routeSource, /JSON\.stringify\(oneSignalResult\)/);
  assert.match(routeSource, /formatOneSignalError\(oneSignalResponse\.status, oneSignalResult\)/);
  assert.match(routeSource, /error_message:\s*oneSignalResponse\.ok\s*\?\s*null/);
});

test("B-3 production client source does not expose subscription IDs or stack traces", () => {
  assert.match(oneSignalSource, /NODE_ENV\s*!==\s*["']production["']/);
  assert.doesNotMatch(oneSignalSource, /PushSubscription\.id:/);
  assert.doesNotMatch(oneSignalSource, /event\.current\)/);
  assert.doesNotMatch(oneSignalSource, /error\.stack/);
  assert.equal(oneSignalSource.match(/console\.(?:log|warn|error)/g)?.length, 3);
});

test("B-3 server and splash logs discard raw errors, URLs, and upload payload details", () => {
  assert.doesNotMatch(serverLoggerSource, /error\.message|String\(error\)/);
  assert.doesNotMatch(clientLoggerSource, /error\.message|String\(error\)/);
  assert.doesNotMatch(uploadSource, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(pageSource, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(settingsSource, /publicUrl:\s*data\.public_url/);
  assert.doesNotMatch(apiSettingsSource, /publicUrl:\s*settings\.publicUrl/);
});
