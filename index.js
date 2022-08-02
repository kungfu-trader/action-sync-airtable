console.log("start traversal packages"); //输出测试,提示开始遍历仓库及版本
/* eslint-disable no-restricted-globals */
const lib = (exports.lib = require("./lib.js")); //调用lib.js，这句不改
const core = require("@actions/core");
//这个core是什么，看起来是actions下的（是的，这句就是引入，实际上这个包是官方提供的，具体功能包括Core functions for setting results, logging, registering secrets and exporting variables across actions）
const github = require("@actions/github"); //这个不改
//@actions/core：提供了工作流命令、输入和输出变量、退出状态和调试消息的接口。
//@actions/github：得到经过身份验证的 Octokit REST 客户端和对 GitHub 操作上下文的访问。
const main = async function () {
  const repo = github.context.repo; //看起来写注释时最好不要在大括号内？以免玄学错误
  const argv = {
    token: core.getInput("token"),
    owner: repo.owner,
    expireIn: core.getInput("expire-in"),
    onlyPrefix: core.getInput("only-prefix", { required: false }),
    exceptPrefix: core.getInput("except-prefix", { required: false }),
  }; //expire可能需要微调，下面两行里的prefix前缀是干嘛的,顺别还有core
  const deletedArtifacts = await lib.purgeArtifacts(
    argv.token,
    argv.owner,
    argv.expireIn,
    argv.onlyPrefix,
    argv.exceptPrefix
  ); //函数名改
  core.setOutput("deleted-artifacts", JSON.stringify(deletedArtifacts)); //这个改
};

if (process.env.GITHUB_ACTION) {
  //这个应该不需要动
  main().catch((error) => {
    console.error(error);
    core.setFailed(error.message);
  });
}
