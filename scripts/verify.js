// Verifies every contract in deployments/<network>.json on BscScan and records the result.
//   npx hardhat run scripts/verify.js --network bsc
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const c of d.contracts) {
    try {
      await hre.run("verify:verify", { address: c.address, constructorArguments: c.constructorArgs });
      c.sourceVerified = true;
    } catch (e) {
      if (/already verified/i.test(e.message)) c.sourceVerified = true;
      else console.error(`Verification failed for ${c.name}:`, e.message);
    }
    console.log(c.name, c.sourceVerified ? "verified" : "NOT verified");
  }
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
