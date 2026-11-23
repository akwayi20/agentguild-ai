// Participation report and final eligibility gate.
//   npx hardhat run scripts/monitor.js --network bsc
// Writes reports/participation-<network>.json and .md
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const config = require("../config/adoption.json");
const { buildReport, evaluateGate, toMarkdown } = require("../lib/participation");

async function main() {
  const root = path.join(__dirname, "..");
  const deployments = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${hre.network.name}.json`), "utf8"));
  const manualPath = path.join(root, "config", "manual-checks.json");
  const manual = fs.existsSync(manualPath) ? JSON.parse(fs.readFileSync(manualPath, "utf8")) : {};

  const provider = hre.ethers.provider;
  const report = await buildReport(provider, deployments, config);
  const gate = await evaluateGate(provider, report, deployments, config, manual);

  const dir = path.join(root, "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `participation-${hre.network.name}.json`), JSON.stringify({ report, gate }, null, 2));
  const md = toMarkdown(report, gate);
  fs.writeFileSync(path.join(dir, `participation-${hre.network.name}.md`), md);
  console.log(md);
  process.exitCode = gate.ready ? 0 : 1;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
