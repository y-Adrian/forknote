/**
 * Sidecar Office tool runtime packages that must ship in the packaged desktop app.
 * Kept as a shared list so package.json files patterns and probes stay in sync.
 */
export const PACKAGED_OFFICE_DEPS = Object.freeze(["docx", "exceljs"]);

/** electron-builder `files` globs that must include each office package. */
export function packagedOfficeFileGlobs(
  deps = PACKAGED_OFFICE_DEPS,
) {
  return deps.map((name) => `node_modules/${name}/**/*`);
}
