import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { atomic, loadSite, preparePublication, publishPrepared, usdc, isMergedMainEvent } from "./publication.ts";
import type { PublicationEvent } from "./publication.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const reportDirectory = resolve(root, "deployment/irys/reports");
interface Report {
  status: string;
  token: string;
  bundler: string;
  events: PublicationEvent[];
  assetBytes?: number;
  maxUploadAtomicUsdc?: string;
  fundToAtomicUsdc?: string;
  wallet?: string;
  startingBalanceAtomicUsdc?: string;
  items?: { path: string; id: string; bytes: number }[];
  url?: string;
  failedStage?: string;
}
const report: Report = { status: "starting", token: "usdc-solana", bundler: "https://uploader.irys.xyz", events: [] };
let stage = "configuration";

function save() {
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(resolve(reportDirectory, "publication.json"), JSON.stringify(report, null, 2) + "\n");
}

async function main() {
  const fundOnly = process.argv[2] === "--fund-only";
  if (process.argv.length > (fundOnly ? 3 : 2)) throw new Error("Unknown arguments");
  if (fundOnly) {
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main") {
      throw new Error("Funding requires a manual main-branch workflow");
    }
  } else {
    if (process.env.GITHUB_EVENT_NAME !== "pull_request_target" || !process.env.GITHUB_EVENT_PATH) {
      throw new Error("Publication requires a merged-main PR event");
    }
    const event: unknown = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (!isMergedMainEvent(event)) throw new Error("Publication requires a merged-main PR event");
  }
  const maxUpload = usdc(process.env.IRYS_MAX_UPLOAD_USDC || "0.10");
  const maxFund = usdc(process.env.IRYS_MAX_FUND_USDC || "1.00");
  const fundTo = usdc(process.env.IRYS_FUND_TO_USDC || "0");
  if (maxUpload === 0n || fundTo > maxFund || (fundOnly && fundTo === 0n)) throw new Error("Invalid limits");
  if (fundTo > 0n && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw new Error("Funding is only allowed in manually dispatched workflows");
  }
  const key = process.env.IRYS_WALLET_KEY?.trim();
  if (!key || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(key)) throw new Error("Expected a base58 Solana secret key");
  const rpc = process.env.IRYS_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  if (new URL(rpc).protocol !== "https:") throw new Error("RPC must use HTTPS");
  stage = "static asset validation";
  const assets = loadSite(resolve(root, "apps/browser/dist/irys-browser"));
  report.assetBytes = assets.reduce((sum, asset) => sum + asset.data.length, 0);
  report.maxUploadAtomicUsdc = maxUpload.toString();
  report.fundToAtomicUsdc = fundTo.toString();
  save();

  stage = "Solana mainnet RPC verification";
  const response = await fetch(rpc, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
    signal: AbortSignal.timeout(20_000),
  });
  const genesis: unknown = await response.json();
  // Solana mainnet's 32-character chain reference; reject devnet/testnet RPCs.
  if (!response.ok || typeof genesis !== "object" || genesis === null || !("result" in genesis) ||
      typeof genesis.result !== "string" || !genesis.result.startsWith("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")) {
    throw new Error("RPC is not Solana mainnet");
  }
  stage = "Irys USDC connection";
  const { Uploader }: typeof import("@irys/upload") = require("@irys/upload");
  const { USDCSolana }: typeof import("@irys/upload-solana") = require("@irys/upload-solana");
  const irys = await Uploader(USDCSolana)
    .bundlerUrl(report.bundler)
    .withRpc(rpc)
    .withWallet(key);
  if (irys.token !== "usdc-solana" || irys.tokenConfig.base[1] !== 1_000_000) {
    throw new Error("Unexpected payment token or decimals");
  }
  report.wallet = irys.address;
  report.startingBalanceAtomicUsdc = atomic(await irys.getBalance()).toString();
  stage = "signing and quoting";
  const plan = await preparePublication(irys, assets);
  report.items = plan.map(({ path, id, bytes }) => ({ path, id, bytes }));
  report.status = "prepared";
  save();
  const id = await publishPrepared(irys, plan, {
    maxUpload, maxFund, fundTo, fundOnly,
    record: async (event) => {
      stage = event.type;
      report.events.push(event);
      save();
      console.log(JSON.stringify(event)); // Only explicitly selected public fields.
    },
  });
  if (id === null) {
    report.status = "funding-complete";
    save();
    console.log("Irys credit is ready. No website files were uploaded.");
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Irys funding complete\n\nNo website was published. Publication runs only after a PR is merged into main.\n");
    }
    return;
  }
  report.status = "published";
  report.url = `https://gateway.irys.xyz/${id}/`;
  save();
  console.log(`Published: ${report.url}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${report.url}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Irys publication\n\n[Open website](${report.url})\n\nManifest: \`${id}\`\n\n` +
      `Payment: USDC on Solana. Native SOL fees are separate.\n\n` +
      `This publishes the LAN/PQ echo diagnostic, not a complete localhost web tunnel.\n`);
  }
}

main().catch(() => {
  // SDK errors may contain request configs/credentials. Never serialize them.
  report.status = "failed";
  report.failedStage = stage;
  save();
  console.error(`Publication failed during ${stage}. See the public report and deployment/irys/README.md.`);
  console.error("If funding started, inspect wallet history and Irys credit before retrying: a transfer may already have been sent.");
  process.exitCode = 1;
});
