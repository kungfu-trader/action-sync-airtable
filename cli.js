/* eslint-disable no-restricted-globals */
const lib = require("./lib.js");
const pr = require("./pr.js");
//token
//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
const argv = require("yargs/yargs")(process.argv.slice(2))
  .option("token", { description: "token", type: "string" })
  .option("owner", { description: "owner", type: "string" })
  .option("apiKey", { description: "apiKey", type: "string" })
  .option("base", { description: "base", type: "string" })
  .help().argv;

// pr.getPrWithGraphQL(argv).catch(console.error);
// pr.getPrWithRest(argv).catch(console.error);

// lib.setOpts(argv);
lib.traversalMessageRest(argv).catch(console.error);
