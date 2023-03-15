/* eslint-disable no-restricted-globals */
const lib = require("./lib.js");
const argv = require("yargs/yargs")(process.argv.slice(2))
  .option("token", { description: "token", type: "string" })
  .option("owner", { description: "owner", type: "string" })
  .option("apiKey", { description: "apiKey", type: "string" })
  .option("base", { description: "base", type: "string" })
  .help().argv;

lib.traversalMessageRest(argv).catch(console.error);
