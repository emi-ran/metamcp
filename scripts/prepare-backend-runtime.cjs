const {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  stat,
  symlink,
} = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

// Reuse the tracer already shipped by our pinned Next dependency. Trace runtime
// imports, not the install graph: optional peers otherwise pull Next and Vitest
// into the backend image even though its entrypoints never use them.
const root = path.resolve(__dirname, "..");
const frontendRequire = createRequire(
  path.join(root, "apps/frontend/package.json"),
);
const { nodeFileTrace } = frontendRequire("next/dist/compiled/@vercel/nft");
const backendRequire = createRequire(
  path.join(root, "apps/backend/package.json"),
);
const drizzleModules = path.dirname(
  path.dirname(backendRequire.resolve("drizzle-kit")),
);

async function main() {
  const output = path.join(root, "backend-runtime");
  const { fileList, warnings } = await nodeFileTrace(
    [
      "apps/backend/dist/index.js",
      "apps/backend/node_modules/drizzle-kit/bin.cjs",
      "apps/backend/node_modules/drizzle-kit/index.js",
      // drizzle-kit loads the TypeScript config via a dynamic require. Include
      // its loader and native esbuild binary explicitly so tracing cannot miss it.
      path.join(drizzleModules, "esbuild/lib/main.js"),
      path.join(drizzleModules, "esbuild-register/dist/node.js"),
    ],
    { base: root, processCwd: path.join(root, "apps/backend") },
  );

  for (const warning of warnings) console.warn(warning.message);
  fileList.add("apps/backend/drizzle.config.ts");

  for (const file of fileList) {
    const source = path.join(root, file);
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    if ((await lstat(source)).isSymbolicLink()) {
      await symlink(await readlink(source), target);
    } else {
      await copyFile(source, target);
    }
  }

  // The tracer can retain a package's files without retaining every pnpm peer
  // symlink to it. Restore links only to packages already present in the trace;
  // never copy optional peer packages merely because a link exists upstream.
  async function restoreLinks(relativeDirectory) {
    for (const entry of await readdir(path.join(root, relativeDirectory), {
      withFileTypes: true,
    })) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory() && entry.name.startsWith("@")) {
        await restoreLinks(relative);
      } else if (entry.isSymbolicLink()) {
        const link = await readlink(path.join(root, relative));
        const target = path.join(output, relative);
        try {
          await stat(path.resolve(path.dirname(target), link));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await symlink(link, target);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    }
  }
  for (const entry of await readdir(path.join(output, "node_modules/.pnpm"))) {
    await restoreLinks(
      entry === "node_modules"
        ? "node_modules/.pnpm/node_modules"
        : path.join("node_modules/.pnpm", entry, "node_modules"),
    );
  }

  for (const file of fileList) {
    if (
      /node_modules\/\.pnpm\/(next@|@next\+swc|vitest@|typescript@)/.test(file)
    ) {
      throw new Error(`Unexpected backend runtime file: ${file}`);
    }
  }

  // Catch dynamic migration-loader omissions before exporting a broken image.
  execFileSync(
    process.execPath,
    [
      "-e",
      `const { createRequire } = require('node:module');
       const backend = createRequire(${JSON.stringify(path.join(output, "apps/backend/package.json"))});
       const drizzle = createRequire(backend.resolve('drizzle-kit'));
       drizzle('esbuild').transformSync('const value: number = 1', { loader: 'ts' });
       drizzle('esbuild-register/dist/node');
       for (const pkg of ['esbuild', 'esbuild-register/dist/node']) {
         if (!drizzle.resolve(pkg).startsWith(${JSON.stringify(output + path.sep)})) {
           throw new Error('Dependency escaped the runtime directory: ' + pkg);
         }
       }`,
    ],
    { stdio: "inherit" },
  );

  console.log(`Prepared backend runtime: ${fileList.size} traced files`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
