console.log("start traversal packages"); //输出测试
/* eslint-disable no-restricted-globals */
const lib = (exports.lib = require('./lib.js')); //调用lib.js，不改
const core = require('@actions/core'); //这个core是什么，看起来是actions下的
const github = require('@actions/github'); //这个不改

const main = async function () {
  const repo = github.context.repo; //看起来写注释时最好不要在大括号内？以免玄学错误
  const argv = {
    token: core.getInput('token'),
    owner: repo.owner,
    expireIn: core.getInput('expire-in'),
    onlyPrefix: core.getInput('only-prefix', { required: false }),
    exceptPrefix: core.getInput('except-prefix', { required: false }),
  }; //expire可能需要微调，下面两行里的prefix前缀是干嘛的
  const deletedArtifacts = await lib.purgeArtifacts( 
    argv.token,
    argv.owner,
    argv.expireIn,
    argv.onlyPrefix,
    argv.exceptPrefix,
  ); //函数名改
  core.setOutput('deleted-artifacts', JSON.stringify(deletedArtifacts)); //这个改
};

if (process.env.GITHUB_ACTION) { //这个应该不需要动
  main().catch((error) => {
    console.error(error);
    core.setFailed(error.message);
  });
}
