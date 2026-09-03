import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

export function evaluateAuditReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("npm audit report must be an object");
  }

  const counts = report?.metadata?.vulnerabilities;

  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error("npm audit report is missing vulnerability metadata");
  }

  const normalized = {};
  for (const severity of SEVERITIES) {
    if (!Object.hasOwn(counts, severity)) {
      throw new Error(`npm audit report is missing the ${severity} count`);
    }

    const value = counts[severity];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`npm audit report has an invalid ${severity} count`);
    }
    normalized[severity] = value;
  }

  const calculatedTotal = SEVERITIES.reduce(
    (total, severity) => total + normalized[severity],
    0,
  );
  if (!Object.hasOwn(counts, "total")) {
    throw new Error("npm audit report is missing the total count");
  }

  const total = counts.total;

  if (!Number.isInteger(total) || total < 0) {
    throw new Error("npm audit report has an invalid total count");
  }

  if (total !== calculatedTotal) {
    throw new Error("npm audit report total does not match severity counts");
  }

  return {
    ...normalized,
    total,
    blocksCi: normalized.high > 0 || normalized.critical > 0,
  };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error("usage: node scripts/check-npm-audit.mjs <audit-report.json>");
  }

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const summary = evaluateAuditReport(report);

  console.log(
    `[npm-audit] total=${summary.total} critical=${summary.critical} high=${summary.high} moderate=${summary.moderate} low=${summary.low}`,
  );

  if (summary.blocksCi) {
    console.error(
      "[npm-audit] blocked: at least one high or critical vulnerability",
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryPoint === import.meta.url) {
  main().catch(() => {
    console.error("[npm-audit] invalid or unavailable report");
    process.exitCode = 1;
  });
}
