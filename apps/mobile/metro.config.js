const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// npm workspaces hoists shared deps (expo, react, etc.) up to the monorepo
// root node_modules - Metro needs to know about the root so it can both
// watch workspace packages (apps/mobile, packages/shared) for changes and
// resolve hoisted dependencies that aren't in apps/mobile/node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];

module.exports = config;
