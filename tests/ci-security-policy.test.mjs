import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateAuditReport } from "../scripts/check-npm-audit.mjs";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));

test("all direct dependencies use explicit versions or ranges", () => {
  const directDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  assert.equal(
    Object.values(directDependencies).some((version) => version === "latest"),
    false,
  );
});

test("workflow runs the locked static validation matrix", () => {
  for (const command of [
    "npm ci --no-audit --no-fund",
    "npm run typecheck",
    "npm run lint",
    "npm run build",
    "npm run test:security",
    "npm run test:auth",
    "npm run test:push-subscriptions",
    "npm run test:upload",
    "npm run test:push-hardening",
    "npm run test:schema-baseline",
    "npm run test:ci-security",
  ]) {
    assert.match(workflow, new RegExp(command.replaceAll(":", "\\:")));
  }

  assert.match(workflow, /node-version:\s*22\.22\.3/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
});

test("workflow has no deploy, real integration, or secret dependency", () => {
  assert.doesNotMatch(workflow, /\bdeploy\b/i);
  assert.doesNotMatch(workflow, /test:(?:auth|push-subscriptions):real/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(
    workflow,
    /SUPABASE_SERVICE_ROLE_KEY|ONESIGNAL_REST_API_KEY/,
  );
});

test("audit policy allows known non-critical findings", () => {
  const summary = evaluateAuditReport({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 3,
        critical: 0,
        total: 4,
      },
    },
  });

  assert.equal(summary.blocksCi, false);
  assert.equal(summary.total, 4);
});

test("audit policy blocks any critical finding", () => {
  const summary = evaluateAuditReport({
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 1,
        total: 1,
      },
    },
  });

  assert.equal(summary.blocksCi, true);
});

test("audit policy fails closed for malformed reports", () => {
  assert.throws(() => evaluateAuditReport({ error: "registry unavailable" }));
});
