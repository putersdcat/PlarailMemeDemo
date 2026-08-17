import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

function readOption(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  if (value) return value.slice(prefix.length);

  const option = `--${name}`;
  const index = process.argv.indexOf(option);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function positionalArguments() {
  const argumentsList = process.argv.slice(2);
  const positional = [];
  for (let index = 0; index < argumentsList.length; index++) {
    const argument = argumentsList[index];
    if (argument === "--out" || argument === "--base") {
      index++;
      continue;
    }
    if (argument === "--help" || argument.startsWith("--out=") || argument.startsWith("--base=")) {
      continue;
    }
    if (!argument.startsWith("-")) positional.push(argument);
  }
  return positional;
}

function printHelp() {
  console.log(`Usage: node scripts/export-portable-diff.mjs [options] [output]

Creates one standard Git patch containing tracked changes and non-ignored
untracked files in the current repository.

Options:
  --out=<file>   Patch path, relative to the repository root (default:
                 portable-plarail.patch)
  --base=<ref>   Git commit or ref to compare against (default: HEAD)
  [output]       Positional output path, useful with npm on Windows
  --help         Show this help

The generated patch can be applied from the target repository with:
  git apply --3way --binary --whitespace=fix .\\portable-plarail.patch
`);
}

function runGit(args, cwd, allowedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: null,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`could not run git: ${result.error.message}`);
  }

  if (!allowedStatuses.includes(result.status)) {
    const details = Buffer.from(result.stderr || []).toString("utf8").trim();
    throw new Error(
      `git ${args.join(" ")} failed with exit code ${result.status}${
        details ? `: ${details}` : ""
      }`
    );
  }

  return {
    status: result.status,
    stdout: Buffer.from(result.stdout || []),
    stderr: Buffer.from(result.stderr || []),
  };
}

function gitPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function splitNullSeparated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function ensureTrailingNewline(buffer) {
  if (!buffer.length || buffer[buffer.length - 1] === 0x0a) return buffer;
  return Buffer.concat([buffer, Buffer.from("\n")]);
}

function isInsideDirectory(directory, candidate) {
  const childPath = relative(directory, candidate);
  return (
    childPath === "" ||
    (!childPath.startsWith(`..${sep}`) && childPath !== ".." && !isAbsolute(childPath))
  );
}

function displayPath(filePath, repoRoot) {
  const repoRelative = relative(repoRoot, filePath);
  return isInsideDirectory(repoRoot, filePath)
    ? `.${sep}${repoRelative.replaceAll("/", sep)}`
    : filePath;
}

function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const initialCwd = process.cwd();
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], initialCwd)
    .stdout.toString("utf8")
    .trim();
  if (!repoRoot) throw new Error("Git returned an empty repository root");

  const positional = positionalArguments();
  const base = readOption("base", positional[1] || "HEAD");
  const outputArgument = readOption(
    "out",
    positional[0] || "portable-plarail.patch"
  );
  const outputPath = resolve(repoRoot, outputArgument);
  const outputIsInsideRepo = isInsideDirectory(repoRoot, outputPath);
  const outputRelative = outputIsInsideRepo
    ? gitPath(relative(repoRoot, outputPath))
    : null;

  if (outputIsInsideRepo && !outputRelative) {
    throw new Error("--out must name a file, not the repository directory");
  }

  if (outputRelative) {
    const trackedOutput = runGit(
      ["ls-files", "--error-unmatch", "--", outputRelative],
      repoRoot,
      [0, 1]
    );
    if (trackedOutput.status === 0 && trackedOutput.stdout.length) {
      throw new Error(
        `refusing to overwrite tracked output file ${outputRelative}; choose another --out path`
      );
    }
  }

  const trackedDiff = runGit(
    ["diff", "--binary", "--full-index", "--no-ext-diff", base, "--"],
    repoRoot
  ).stdout;

  const untrackedFiles = splitNullSeparated(
    runGit(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot).stdout
  ).filter((filePath) => filePath !== outputRelative);

  const sections = [];
  if (trackedDiff.length) sections.push(ensureTrailingNewline(trackedDiff));

  for (const filePath of untrackedFiles) {
    const absolutePath = resolve(repoRoot, filePath);
    try {
      lstatSync(absolutePath);
    } catch {
      throw new Error(`untracked file disappeared while exporting: ${filePath}`);
    }

    const result = runGit(
      [
        "diff",
        "--no-index",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--",
        "/dev/null",
        gitPath(filePath),
      ],
      repoRoot,
      [0, 1]
    );

    if (result.status === 1 && result.stdout.length) {
      sections.push(ensureTrailingNewline(result.stdout));
    }
  }

  const patch = Buffer.concat(sections);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, patch);

  const outputDisplay = displayPath(outputPath, repoRoot);
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        base,
        trackedChanges: trackedDiff.length > 0,
        untrackedFiles: untrackedFiles.length,
        bytes: patch.length,
      },
      null,
      2
    )
  );
  console.log(`Patch written to ${outputDisplay}`);
  console.log(
    `Apply from the target repository with: git apply --3way --binary --whitespace=fix ${outputDisplay}`
  );
}

try {
  main();
} catch (error) {
  console.error(`portable diff: ${error.message}`);
  process.exitCode = 1;
}