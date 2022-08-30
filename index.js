console.log("start sync messages to airtable"); //在控制台输出信息
//console.log("start traversal packages"); //输出测试,提示开始遍历仓库及版本
/* eslint-disable no-restricted-globals */
const lib = (exports.lib = require("./lib.js")); //用了quickFix,一时也看不出来哪里改了。。。
//const lib = (exports.lib = require("./lib.js"));//调用lib.js，这句不改
import { getInput, setFailed } from "@actions/core"; //这个是quickFix后的定义
//const core = require('@actions/core');这个是原先的定义
//这个core是什么，看起来是actions下的（是的，这句就是引入，实际上这个包是官方提供的，具体功能包括Core functions for setting results, logging, registering secrets and exporting variables across actions）
import { context } from "@actions/github"; //这个也是quickFix后的（会不会报错呢）
//const github = require('@actions/github');//这个不改
//@actions/core：提供了工作流命令、输入和输出变量、退出状态和调试消息的接口。
//@actions/github：得到经过身份验证的 Octokit REST 客户端和对 GitHub 操作上下文的访问。
const main = async function () {
  const repo = context.repo; //看起来写注释时最好不要在大括号内？以免玄学错误
  const argv = {
    token: getInput("token"),
    owner: repo.owner,
    apiKey: getInput("apiKey"),
    base: getInput("base"),
  }; //expire可能有用不过需要微调，下面两行里的prefix前缀是干嘛的,顺别还有core
  //最后添加了apiKey，这个存储的是airtable的写权限的密钥;以及base，这个存储的是airtable中的目标base
  //上述的apiKey和base暂时先用默认值赋值，定义在action.yml中
  //在quickFix后，自动对部分定义语句做了修改（简略），希望不要出错
  const traversalMessage = await lib.traversalMessage(
    argv.apiKey,
    argv.base,
    argv.token,
    argv.owner
  ); //这里在定义传参数中也加入了apiKey和base
  //暂时先吧expireIn、onlyPrefix、exceptPrefix的定义和传参数删掉
  /*const deletedArtifacts = await lib.purgeArtifacts(
    argv.token,
    argv.owner,
    argv.expireIn,
    argv.onlyPrefix,
    argv.exceptPrefix
  );*/ //函数名改
  core.setOutput("traversal-messages", JSON.stringify(traversalMessage)); //这里测试一下，如果这个输出可以被hookdeck抓到，也是不错的
  //core.setOutput("deleted-artifacts", JSON.stringify(deletedArtifacts)); //这个是core提供的输出，暂时用不到，删
  //Outputs can be set with setOutput which makes them available to be mapped into inputs of other actions to ensure they are decoupled.
};

if (process.env.GITHUB_ACTION) {
  //这个应该不需要动，目的是输出错误
  main().catch((error) => {
    console.error(error);
    setFailed(error.message);
  });
}
