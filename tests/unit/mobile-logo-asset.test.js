import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const distPath = path.resolve("dist");
const assetsPath = path.join(distPath, "assets");

test("mobile production bundle uses the Vite-managed BKT logo asset", () => {
  assert.ok(fs.existsSync(path.join(distPath, "mobile.html")), "dist/mobile.html must exist; run npm run build first");
  assert.ok(fs.existsSync(assetsPath), "dist/assets must exist");

  const productionFiles = [
    path.join(distPath, "mobile.html"),
    ...fs.readdirSync(assetsPath)
      .filter(fileName => /\.(?:js|css)$/i.test(fileName))
      .map(fileName => path.join(assetsPath, fileName))
  ];
  const productionSource = productionFiles
    .map(filePath => fs.readFileSync(filePath, "utf8"))
    .join("\n");

  assert.equal(
    productionSource.includes("/outputs/bkt-logo.png"),
    false,
    "production bundle must not contain the old root-relative BKT logo path"
  );

  const bundledLogos = fs.readdirSync(assetsPath)
    .filter(fileName => /^bkt-logo-[A-Za-z0-9_-]+\.png$/.test(fileName));
  assert.equal(bundledLogos.length, 1, `expected one bundled BKT logo, found: ${bundledLogos.join(", ")}`);

  const bundledLogo = bundledLogos[0];
  assert.ok(fs.statSync(path.join(assetsPath, bundledLogo)).size > 0, "bundled BKT logo must not be empty");
  assert.match(productionSource, new RegExp(`/assets/${bundledLogo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});
