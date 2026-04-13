// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const rawProjectPath = process.env["INPUT_PROJECT_PATH"] || "./";
const solutionFile = process.env["INPUT_SOLUTION_FILE"] || "";

// Normalise: strip trailing slash, collapse "./" → "."
const projectPath = rawProjectPath.replace(/\/+$/, "") || ".";

let sln = solutionFile;

if (!sln) {
	const pkgJsonPath = path.join(projectPath, "package.json");
	if (fs.existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
			sln = pkg.dotnetBuildSln || "";
		} catch {
			// ignore malformed package.json
		}
	}
}

if (sln) {
	// Normalise: strip leading ./
	sln = sln.replace(/^\.\//, "");
	// Prepend project-path only when it isn't already present
	if (
		projectPath !== "." &&
		projectPath !== "" &&
		!sln.startsWith(projectPath + "/")
	) {
		sln = `${projectPath}/${sln}`;
	}
} else {
	sln = projectPath;
}

console.log(`::notice::resolved solution-file: ${sln || "<empty>"}`);

const githubOutput = process.env["GITHUB_OUTPUT"];
const githubEnv = process.env["GITHUB_ENV"];

if (githubOutput) {
	fs.appendFileSync(githubOutput, `sln=${sln}${os.EOL}`);
}
// Also set SLN in the environment so subsequent steps can reference $SLN directly.
if (githubEnv) {
	fs.appendFileSync(githubEnv, `SLN=${sln}${os.EOL}`);
}
