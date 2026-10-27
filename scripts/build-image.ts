// cow fork: build-once-pull-forever for the linux build image.
//
//   node extension-ci-tools/scripts/build-image.ts
//
// Upstream's ci_phase.py rebuilds the manylinux image from scratch on every
// run (~5 min). The image is a function of its Dockerfile and build args, so
// this tags it by a hash of those and pulls it from GHCR when the recipe is
// unchanged; only a recipe change rebuilds and re-pushes (needs
// packages: write). Without GITHUB_TOKEN, or when GHCR is unreachable, it is
// upstream's plain build. Either way it leaves the local duckdb/<arch> tag
// that ci_phase.py's `docker run`s use (CI_LINUX_IMAGE_PREBUILT=true skips
// ci_phase.py's own build).
//
// Inputs are the job's environment: CI_VCPKG_URL, CI_VCPKG_COMMIT,
// CI_EXTRA_TOOLCHAINS, CI_CUDA_VERSION, CI_EXTENSION_NAME, DUCKDB_PLATFORM,
// GITHUB_WORKSPACE, GITHUB_TOKEN, GITHUB_REPOSITORY_OWNER, GITHUB_ACTOR.
// Node 24+ runs it as is (type stripping); no dependencies.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

// Run a command with inherited output; true on exit code 0.
function attempt(command: string[], stdin?: string): boolean {
  console.log(`+ ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    input: stdin,
    stdio: [stdin === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });
  return result.status === 0;
}

function run(command: string[]): void {
  if (!attempt(command)) {
    throw new Error(`command failed: ${command.join(" ")}`);
  }
}

const arch = env("DUCKDB_PLATFORM");
const context = join(env("GITHUB_WORKSPACE", "."), "extension-ci-tools", "docker", arch);
const toolchains = (process.env.CI_EXTRA_TOOLCHAINS ?? "").replace(/^;+|;+$/g, "");
// Same build args, same order, as upstream's build_linux.
const buildArgs = [
  `vcpkg_url=${env("CI_VCPKG_URL")}`,
  `vcpkg_commit=${env("CI_VCPKG_COMMIT")}`,
  `extra_toolchains=;${toolchains};`,
  `cuda_version=${process.env.CI_CUDA_VERSION ?? ""}`,
];
const localTag = `duckdb/${arch}`;

function build(tag: string): void {
  run(["docker", "build", ...buildArgs.flatMap((arg) => ["--build-arg", arg]), "-t", tag, context]);
}

const token = process.env.GITHUB_TOKEN ?? "";
const owner = (process.env.GITHUB_REPOSITORY_OWNER ?? "").toLowerCase();

if (token === "" || owner === "") {
  console.log("No GITHUB_TOKEN/owner: plain build, no GHCR cache");
  build(localTag);
} else {
  const recipe = createHash("sha256")
    .update(readFileSync(join(context, "Dockerfile")))
    .update(buildArgs.join("|"))
    .digest("hex")
    .slice(0, 16);
  const image = `ghcr.io/${owner}/${env("CI_EXTENSION_NAME")}-build:${arch}-${recipe}`;
  console.log(`Target build image: ${image}`);

  const loggedIn = attempt(
    ["docker", "login", "ghcr.io", "-u", process.env.GITHUB_ACTOR || owner, "--password-stdin"],
    token,
  );
  if (!loggedIn) {
    console.log("::warning::GHCR login failed; building uncached");
  }
  if (loggedIn && attempt(["docker", "pull", image])) {
    console.log(`Image cache HIT -> reusing ${image}`);
  } else {
    console.log(`Image cache MISS -> building ${image}`);
    build(image);
    if (loggedIn && !attempt(["docker", "push", image])) {
      console.log(`::warning::could not push ${image} to GHCR (needs packages: write)`);
    }
  }
  run(["docker", "tag", image, localTag]);
}
