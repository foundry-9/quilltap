"use strict";

// plugins/dist/qtap-plugin-auth-google/index.ts
var GoogleProvider = require("next-auth/providers/google").default;

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
  return GoogleProvider({
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
