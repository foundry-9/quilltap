"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// plugins/dist/qtap-plugin-auth-google/index.ts
var import_google = __toESM(require("next-auth/providers/google"));
var REQUIRED_ENV_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
var config = {
  providerId: "google",
  displayName: "Google",
  icon: "google",
  requiredEnvVars: REQUIRED_ENV_VARS,
  buttonColor: "bg-white hover:bg-gray-50 border border-gray-300",
  buttonTextColor: "text-gray-700"
};
function checkEnvVars(requiredVars) {
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);
  return {
    isConfigured: missingVars.length === 0,
    missingVars
  };
}
function isConfigured() {
  const status = getConfigStatus();
  return status.isConfigured;
}
function getConfigStatus() {
  return checkEnvVars(REQUIRED_ENV_VARS);
}
function createProvider() {
  if (!isConfigured()) {
    return null;
  }
  return (0, import_google.default)({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  });
}
module.exports = {
  config,
  isConfigured,
  getConfigStatus,
  createProvider
};
