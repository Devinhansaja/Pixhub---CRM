// The mobile app lives inside the web CRM repository. Never resolve packages from the web app's
// ../node_modules (it has a different React), only from mobile/node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const parentModules = path.resolve(__dirname, "..", "node_modules");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\\/g, "[\\\\/]");

config.watchFolders = [__dirname];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.blockList = [new RegExp(`^${escape(parentModules)}[\\\\/].*`)];

module.exports = config;
