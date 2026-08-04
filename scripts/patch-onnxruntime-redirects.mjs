#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const packageDir = process.argv[2];
if (!packageDir) {
  console.error("Usage: patch-onnxruntime-redirects.mjs <onnxruntime-node-directory>");
  process.exit(2);
}

// The installer layout changed between onnxruntime-node releases. Versions
// such as 1.17.x use script/install.js directly and do not have the helper
// used by newer installers. On darwin/x64 that installer is a no-op because
// the prebuilt binary is already bundled, so there is nothing to patch.
const file = [
  path.join(packageDir, "script", "install-utils.js"),
  path.join(packageDir, "script", "install.js"),
].find((candidate) => fs.existsSync(candidate));

if (!file) {
  console.log("onnxruntime-node has no patchable install helper; continuing without redirect patch.");
  process.exit(0);
}

// install.js in 1.17.x uses the built-in fetch API only for optional Linux
// CUDA packages. fetch follows redirects itself, and no redirect patch is
// required for the supported Intel Mac path.
if (path.basename(file) === "install.js") {
  console.log(`No redirect patch needed for ${file}`);
  process.exit(0);
}

let source = fs.readFileSync(file, "utf8");
const marker = "function requestWithRedirects(url, callback, redirects = 0)";

if (!source.includes(marker)) {
  const importMarker = "const AdmZip = require('adm-zip'); // Use adm-zip instead of spawn";
  if (!source.includes(importMarker)) {
    console.error("Unsupported onnxruntime-node install script; redirect patch was not applied.");
    process.exit(1);
  }

  const helper = `

// Follow redirects returned by npm mirrors, proxies, and NuGet/CDN endpoints.
function requestWithRedirects(url, callback, redirects = 0) {
  if (redirects > 10) {
    throw new Error("Too many redirects while downloading " + url);
  }

  return https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      requestWithRedirects(new URL(res.headers.location, url).toString(), callback, redirects + 1);
      return;
    }
    callback(res);
  });
}
`;
  source = source.replace(importMarker, `${importMarker}${helper}`);
}

const patched = source.replaceAll("https\n      .get(url, (res) =>", "requestWithRedirects(url, (res) =>");
if (patched === source && !source.includes("requestWithRedirects(url, (res) =>")) {
  console.error("Could not find download requests in onnxruntime-node install script.");
  process.exit(1);
}

fs.writeFileSync(file, patched);
console.log(`Redirect support enabled in ${file}`);
