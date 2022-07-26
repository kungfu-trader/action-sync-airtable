/* eslint-disable no-restricted-globals */
const github = require('@actions/github');
const differenceInMilliseconds = require('date-fns/differenceInMilliseconds'); //看起来是时间
const fs = require('fs'); //filesystem文件系统
const path = require('path'); //这个路径是啥，看起来是被引入的
const { Octokit } = require('@octokit/core');
const { restEndpointMethods } = require('@octokit/plugin-rest-endpoint-methods'); //rest终端方法是啥
const parseDuration = require('parse-duration'); //似乎是用于将时间进行格式化/格式转化

const purgeOpts = { dry: false }; //这个要改，这里的dry是啥

function shouldDelete(artifact, expireIn, onlyPrefix, exceptPrefix) { //看起来是查找需要被删除的
  const expireInMs = parseDuration(expireIn);
  const included = onlyPrefix === '' || artifact.name.startsWith(onlyPrefix);
  const excluded = exceptPrefix && artifact.name.startsWith(exceptPrefix);
  const expired = differenceInMilliseconds(new Date(), new Date(artifact.created_at)) >= expireInMs;

  return included && !excluded && expired;
}

async function* eachArtifact(octokit, owner, repo) {
  let hasNextPage = false;
  let currentPage = 1;
  const maxPerPage = 100;
  do {
    const response = await octokit.rest.actions.listArtifactsForRepo({
      owner: owner,
      repo: repo,
      page: currentPage,
      per_page: maxPerPage,
    });
    hasNextPage = response.data.total_count / maxPerPage > currentPage;
    for (const artifact of response.data.artifacts) {
      yield artifact;
    }
    currentPage++;
  } while (hasNextPage);
}

/*
  We need to create our own github client because @actions/core still uses
  old version of @octokit/plugin-rest-endpoint-methods which doesn't have
  `.listArtifactsForRepo`. This won't be needed when @actions/core gets updated
  This ---------------> https://github.com/actions/toolkit/blob/master/packages/github/package.json#L42
                        https://github.com/octokit/rest.js/blob/master/package.json#L38
  Needs to use this  -> https://github.com/octokit/plugin-rest-endpoint-methods.js/pull/45
*/
const getOctokit = (token) => {
  const _Octokit = Octokit.plugin(restEndpointMethods);
  return new _Octokit({ auth: token });
};

exports.setOpts = function (argv) {
  purgeOpts.dry = argv.dry;
};

exports.purgeArtifacts = async function (token, owner, expireIn, onlyPrefix, exceptPrefix) {
  const octokit = getOctokit(token);
  const deletedArtifacts = [];
  const repositoriesQuery = await octokit.graphql(`
    query {
      organization(login: "${owner}") {
        id
        repositories(first: 100) {
          nodes {
            id,
            name,
            diskUsage
          }
        }
      }
    }`);
  for (const repository of repositoriesQuery.organization.repositories.nodes) {
    const repoDiskUsageKB = repository.diskUsage;
    const repoDiskUsageMB = repository.diskUsage / 2 ** 10;
    const repoDiskUsageGB = repository.diskUsage / 2 ** 20;
    const unit = repoDiskUsageGB > 1 ? 'GB' : repoDiskUsageMB > 1 ? 'MB' : 'KB';
    const repoDiskUsage =
      repoDiskUsageGB > 1 ? repoDiskUsageGB : repoDiskUsageMB > 1 ? repoDiskUsageMB : repoDiskUsageKB;
    console.log(`> purging for repository ${repository.name} (${repoDiskUsage.toFixed(0)} ${unit})`);

    for await (const artifact of eachArtifact(octokit, owner, repository.name)) {
      console.log(`Checking artifact: ${artifact.name}`);
      if (shouldDelete(artifact, expireIn, onlyPrefix, exceptPrefix)) {
        console.log(`Deleting artifact:\n${JSON.stringify(artifact, null, 2)}`);
        if (!purgeOpts.dry) {
          await octokit.rest.actions.deleteArtifact({
            owner: owner,
            repo: repository.name,
            artifact_id: artifact.id,
          });
          deletedArtifacts.push(artifact);
          console.log(`Deleted artifact:  ${artifact.name}`);
        }
      }
    }
  }
  return deletedArtifacts;
};
