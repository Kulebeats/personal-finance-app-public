import { runAIEvalPack } from "../server/modules/ai/ai.eval-pack";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

const report = runAIEvalPack();

console.log("AI Eval Pack Report");
console.log(
  `Pass rate: ${formatPercent(report.passRate)} (required ${formatPercent(report.requiredPassRate)})`,
);
console.log(`Checks: ${report.passedChecks}/${report.totalChecks}`);

for (const result of report.results) {
  const status = result.pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${result.id} - ${result.detail}`);
}

if (!report.passed) {
  process.exitCode = 1;
}
