console.log("start sync messages to airtable"); //在控制台输出信息,提醒开始运行
/* eslint-disable no-restricted-globals */
const lib = (exports.lib = require("./lib.js")); //引入lib.js
const core = require("@actions/core"); //Core functions for setting results, logging, registering secrets and exporting variables across actions
const github = require("@actions/github");

const main = async function () {
  const argv = {
    token: core.getInput("token"),
    owner: github.context.repo.owner,
    apiKey: core.getInput("apiKey"),
    base: core.getInput("base"),
  }; //定义argv，存储token等参数
  const traversalMessage = await lib.traversalMessageRest(argv); //调用lib.js中的核心
  core.setOutput("traversal-messages", JSON.stringify(traversalMessage)); //通过core输出返回结果
};

if (process.env.GITHUB_ACTION) {
  main().catch((error) => {
    console.error(error);
    setFailed(error.message);
  });
} //捕获并输出错误信息
