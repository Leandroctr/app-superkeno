import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateAuditReport } from "../scripts/check-npm-audit.mjs";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const auditScript = fileURLToPath(
  new URL("../scripts/check-npm-audit.mjs", import.meta.url),
);

function createAuditReport(overrides = {}) {
  const vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    ...overrides,
  };

  return {
    metadata: {
      vulnerabilities: {
        ...vulnerabilities,
        total:
          vulnerabilities.info +
          vulnerabilities.low +
          vulnerabilities.moderate +
          vulnerabilities.high +
          vulnerabilities.critical,
      },
    },
  };
}

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

test("audit policy passes a report with no vulnerabilities", () => {
  const summary = evaluateAuditReport(createAuditReport());

  assert.equal(summary.blocksCi, false);
  assert.equal(summary.total, 0);
});

test("audit policy keeps low findings visible without blocking", () => {
  const summary = evaluateAuditReport(createAuditReport({ low: 1 }));

  assert.equal(summary.blocksCi, false);
  assert.equal(summary.low, 1);
});

test("audit policy keeps moderate findings visible without blocking", () => {
  const summary = evaluateAuditReport(
    createAuditReport({ low: 2, moderate: 1 }),
  );

  assert.equal(summary.blocksCi, false);
  assert.equal(summary.low, 2);
  assert.equal(summary.moderate, 1);
  assert.equal(summary.high, 0);
  assert.equal(summary.critical, 0);
});

test("audit policy blocks any high finding", () => {
  const summary = evaluateAuditReport(createAuditReport({ high: 1 }));

  assert.equal(summary.blocksCi, true);
  assert.equal(summary.high, 1);
});

test("audit policy blocks any critical finding", () => {
  const summary = evaluateAuditReport(createAuditReport({ critical: 1 }));

  assert.equal(summary.blocksCi, true);
});

test("audit policy fails closed for malformed reports", () => {
  assert.throws(() => evaluateAuditReport({ error: "registry unavailable" }));
});

test("audit policy fails closed for invalid JSON", () => {
  const directory = mkdtempSync(join(tmpdir(), "npm-audit-policy-"));
  const reportPath = join(directory, "invalid.json");

  try {
    writeFileSync(reportPath, "{not-json", "utf8");
    const result = spawnSync(process.execPath, [auditScript, reportPath], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid or unavailable report/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("audit policy requires metadata and vulnerability counts", () => {
  assert.throws(() => evaluateAuditReport({}));
  assert.throws(() => evaluateAuditReport({ metadata: {} }));
});

test("audit policy requires every severity count", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const report = createAuditReport();
    delete report.metadata.vulnerabilities[severity];

    assert.throws(
      () => evaluateAuditReport(report),
      new RegExp(`missing the ${severity} count`),
    );
  }
});

test("audit policy rejects non-numeric and negative severity counts", () => {
  assert.throws(() =>
    evaluateAuditReport(createAuditReport({ high: "0" })),
  );
  assert.throws(() =>
    evaluateAuditReport(createAuditReport({ moderate: -1 })),
  );
});

test("audit policy requires a valid and consistent total", () => {
  const missingTotal = createAuditReport();
  delete missingTotal.metadata.vulnerabilities.total;

  assert.throws(() => evaluateAuditReport(missingTotal), /missing the total/);

  const nonNumericTotal = createAuditReport();
  nonNumericTotal.metadata.vulnerabilities.total = "0";
  assert.throws(() => evaluateAuditReport(nonNumericTotal), /invalid total/);

  const inconsistentTotal = createAuditReport({ low: 1 });
  inconsistentTotal.metadata.vulnerabilities.total = 0;
  assert.throws(
    () => evaluateAuditReport(inconsistentTotal),
    /does not match severity counts/,
  );
});

test("audit policy fails closed when the report is unavailable", () => {
  const result = spawnSync(
    process.execPath,
    [auditScript, "tests/fixtures/missing-npm-audit-report.json"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid or unavailable report/);
});
