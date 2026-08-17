import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLayoutScenario, runLayoutScenario } from "../js/simulation/scenario.js";
import { analyzeTrainTrace, importantTraceFrames } from "../js/train/trace-analysis.js";
import { buildWorldContract, renderWorldAscii } from "../js/world-model.js";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const layoutFile = resolve(arg("layout", "layouts/arntenoughrails.json"));
const frames = Math.max(0, Number(arg("frames", 900)) || 0);
const width = Math.max(24, Number(arg("width", 96)) || 96);
const height = Math.max(12, Number(arg("height", 32)) || 32);
const output = arg("out");
const assertClean = arg("assert", "false") === "true";
const requestedFrames = (arg("show", "") || "")
  .split(",")
  .map(Number)
  .filter(Number.isFinite);

const data = JSON.parse(readFileSync(layoutFile, "utf8"));
const scenario = createLayoutScenario(data, { start: frames > 0 });
const contract = buildWorldContract(scenario.board, scenario.bounds);
let trace = null;
let analysis = null;
if (frames > 0) {
  trace = runLayoutScenario(scenario, { frames, stopOnTerminal: false });
  analysis = analyzeTrainTrace(trace);
}

const frameNumbers = requestedFrames.length
  ? requestedFrames
  : trace
    ? importantTraceFrames(trace, 12)
    : [];
const maps = [];
if (!trace) {
  maps.push({
    frame: null,
    text: renderWorldAscii(
      scenario.board,
      scenario.train,
      scenario.bounds,
      { width, height }
    ),
  });
} else {
  for (const number of frameNumbers) {
    const frame = trace.frames.find((item) => item.frame === number);
    if (!frame?.after) continue;
    maps.push({
      frame: number,
      events: frame.events.map((event) => event.type),
      text: renderWorldAscii(
        scenario.board,
        { ...frame.after, cars: frame.after.cars },
        scenario.bounds,
        { width, height }
      ),
    });
  }
}

const report = {
  layout: layoutFile,
  contract,
  analysis,
  maps,
};
if (output) {
  writeFileSync(resolve(output), JSON.stringify(report, null, 2));
}

console.log(
  JSON.stringify(
    {
      layout: layoutFile,
      pieces: contract.pieces.length,
      paths: contract.paths.length,
      openMouths: contract.topology.openMouths.length,
      exposedBoundarySegments: contract.collision.exposedBoundarySegments,
      endpointFailures: contract.diagnostics.endpointFailures,
      analysis: analysis
        ? {
            frames: analysis.frames,
            finalMode: analysis.finalMode,
            maxCouplerError: analysis.maxCouplerError,
            badInvariantFrames: analysis.badInvariantFrames,
            violationCount: analysis.violationCount,
            violationCounts: analysis.violationCounts,
            transitions: analysis.transitions.filter((event) =>
              [
                "rail_exit",
                "car_rail_exit",
                "lead_rerail",
                "follower_rerail",
                "consist_stall",
              ].includes(event.type)
            ),
          }
        : null,
      report: output ? resolve(output) : null,
    },
    null,
    2
  )
);
for (const map of maps) {
  console.log(`\nFRAME ${map.frame ?? "initial"} ${map.events?.join(",") || ""}`);
  console.log(map.text);
}

if (
  assertClean &&
  (contract.diagnostics.endpointFailures.length > 0 ||
    (analysis &&
      (analysis.violationCount > 0 ||
        analysis.badInvariantFrames > 0 ||
        analysis.finalMode === "stalled")))
) {
  process.exitCode = 1;
}
