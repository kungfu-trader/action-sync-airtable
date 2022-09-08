/* eslint-disable no-restricted-globals */
const github = require("@actions/github"); //这里有个quickFix，切换到ES标准的引进（就是把require变成import？）
const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest");
// const { Octokit } = require("@octokit/core"); //Extendable client for GitHub's REST & GraphQL APIs
const {
  restEndpointMethods,
} = require("@octokit/plugin-rest-endpoint-methods");
const { count } = require("console");

//这里引入request
//const request = require("request");
const { waitForDebugger } = require("inspector");
const { argv } = require("process");

const getOctokit = (token) => {
  const _Octokit = Octokit.plugin(restEndpointMethods);
  return new _Octokit({ auth: token });
}; //octokit

const sleep = function (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}; //这里加一个sleep用于实现睡眠等待，比如airtable的api每使用5次休息1s（单位为毫秒ms，应为1000）

async function* traversalPackagesGraphQL(octokit) {
  //循环遍历获取所有package的graphQL方法
  console.log("开始历获取所有package");
  let hasNextPage = false; //是否有下一页，用以判断是否要继续循环查询
  const maxPerPage = 100; //每页最大值，这里定义为100，默认为30
  let graphResponse = await octokit.graphql(`
          query{
            organization(login: "kungfu-trader") {
              packages(first: ${maxPerPage}) {
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  name
                  repository {
                    name
                  }
                  latestVersion {
                    version
                  }
                }
              }
            }
          }`);
  let startCursor = graphResponse.organization.packages.pageInfo.endCursor; //最后位置，也是有下一页时的起始位置（after）
  hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage; //是否有下一页
  for (let graphPackage of graphResponse.organization.packages.nodes) {
    yield graphPackage; //更新值，触发调用位置的后续工作
  }
  while (hasNextPage) {
    //有下一页则进入循环
    graphResponse = await octokit.graphql(`
        query{
          organization(login: "kungfu-trader") {
            packages(first: ${maxPerPage}, after: "${startCursor}") {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                name
                repository {
                  name
                }
                latestVersion {
                  version
                }
              }
            }
          }
        }`); //这里的first后面所需为int，而加了引号之后就成为string，所以要去掉引号
    for (let graphPackage of graphResponse.organization.packages.nodes) {
      yield graphPackage; //更新值，触发调用位置的后续操作
    }
    hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage; //是否有下一页
    startCursor = graphResponse.organization.packages.pageInfo.endCursor; //最终位置
  }
}

async function* traversalVersionsGraphQL(
  octokit,
  package_name,
  repository_name
) {
  //循环遍历获取所有Versions的graphQL方法
  console.log("开始遍历获取所有version");
  let hasNextPage = false; //是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //每页最大值，这里定义为100（可用最大为100），默认为30
  let graphResponse = await octokit.graphql(`
    query{
      repository(name: "${repository_name}", owner: "kungfu-trader") {
        packages(names: "${package_name}", last: 1) {
          totalCount
          nodes {
            versions(first: ${maxPerPage}) {
              nodes {
                version
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      }
    }`);
  let startCursor =
    graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor; //最终位置
  hasNextPage =
    graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage; //是否有下一页
  for (let graphVersion of graphResponse.repository.packages.nodes[0].versions
    .nodes) {
    yield graphVersion; //更新值，触发调用位置的后续操作
  }
  while (hasNextPage) {
    console.log(`版本数超过100的package为: ${package_name}`); //输出版本数大于100的package名称
    graphResponse = await octokit.graphql(`
        query{
          repository(name: "${repository_name}", owner: "kungfu-trader") {
            packages(names: "${package_name}", last: 1) {
              totalCount
              nodes {
                versions(first: ${maxPerPage}, after: "${startCursor}") {
                  nodes {
                    version
                  }
                  pageInfo {
                    endCursor
                    hasNextPage
                  }
                }
              }
            }
          }
        }`);
    for (let graphVersion of graphResponse.repository.packages.nodes[0].versions
      .nodes) {
      yield graphVersion;
    }
    hasNextPage =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
    startCursor =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
  }
}

//实现了上述graphQL查询方法后，下面构建调用函数完成整个查询，这里使用exports
exports.traversalMessage = async function (argv) {
  //gitReleaseNotes();//似乎没啥反应。。。
  //console.log(argv.token); //测试一下argv是否正常传输该token
  const octokit = getOctokit(argv.token);
  //console.log(octokit); //测试一下octokit能否正常被获取(这里似乎是octokit所有的方法)
  //const octokit = github.getOctokit(argv.token);
  let countVersion = 0; //该变量用于存储当前位置 //存储数组内有效数据量，方便判别是否该发送
  let countPackage = 0; //store steps of for-loops
  let countSend = 0; //store send times
  let sendFlag = false; //用于标记是否发送了
  let traversalResult = []; //该变量用于每次发送前存储json信息
  let backUpTraversalMessage = []; //该变量用于存储所有json信息用于返回（return）
  let traversalRefs = []; //该变量用于存储当前package对应的repo的所有分支，用于与version进行字符串匹配
  let traversalVersions = []; //该变量用于存储当前package的所有versions
  for await (let graphPackage of traversalPackagesGraphQL(octokit)) {
    //遍历所有的package
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //这俩参数用于后续查询versions
    console.log(`仓库下的package: ${package_name}`); //输出package看看问题在哪里
    console.log(`package对应repo: ${repository_name}`); //输出repo看看问题在哪里
    if (graphPackage.latestVersion === null) {
      console.log(`由于version为空,跳过package: ${package_name}`); //对于deleted的package仍可遍历到，因此需要被剔除
      continue;
    } //package没有最新版本意味着被删除，所以跳过（之前想用提取前缀来判断的方法，但是不保证未来没有deleted开头的package，所以放弃）
    console.log(`package最新version: ${graphPackage.latestVersion.version}`); //输出一下，看看查询结果是否正常看看问题在哪
    for await (let graphPostFix of traversalRepoRefsGraphQL(
      octokit,
      repository_name
    )) {
      //外层每遍历到一个package，根据其对应到repo-name，遍历该仓库的所有dev分支
      const refsPost = graphPostFix.node.name; //比如action-bump-version的“v2/v2.0”（筛选条件为refs/heads/dev，这样返回的是dev后的内容）
      console.log(`repo的refs有: ${refsPost}`); //输出一下，看看问题在哪里
      const subStart = refsPost.lastIndexOf("v"); //最后一个v所在的位置
      console.log(`最后一个v所在位置: ${subStart}`); //输出一下，看看问题在哪里
      if (subStart === -1) {
        console.log(`${repository_name}的dev分支${refsPost}并非标准命名`);
        continue;
      } //如果该dev分支并非标准分支命名，不含字母v，返回值为-1，跳过并给出提示
      const subEnd = refsPost.length; //提取字符串长度
      console.log(`refs后缀长度: ${subEnd}`); //输出一下，看看问题在哪里
      const refsPostFix = refsPost.substring(subStart + 1, subEnd); //提取子串，这里获取的就是“v2/v2.0”里的“2.0”
      //substring为小写
      console.log(`提取到的版本号为: ${refsPostFix}`); //输出一下，看看问题在哪里
      traversalRefs.push(refsPostFix); //子串仍为字符串类型（后续可以使用length，而如果是float则不能用length），存进数组
    } //遍历repo所有分支并提取出大版本号存储起来
    for await (let graphVersion of traversalVersionsGraphQL(
      octokit,
      package_name,
      repository_name
    )) {
      const versionName = graphVersion.version;
      console.log(`遍历到的version有: ${versionName}`); //输出一下，看看问题在哪里
      traversalVersions.push(versionName);
    } //遍历package所有version并存储起来
    console.log(`遍历得到的refs的总数为: ${traversalRefs.length}`); //输出一下，看看问题在哪里
    console.log(`遍历得到的versions的总数为: ${traversalVersions.length}`); //输出一下，看看问题在哪里
    console.log(`遍历得到的第一个refs: ${traversalRefs[0]}`); //输出一下，看看问题在哪里
    console.log(`遍历得到的第一个versions: ${traversalVersions[0]}`); //输出一下，看看问题在哪里
    console.log("开始进行匹配比较"); ////输出一下，看看问题在哪里
    console.log(typeof traversalRefs); //输出一下，看看问题在哪里
    console.log(typeof traversalVersions); //输出一下，看看问题在哪里
    let matchedVersions = await comparePostFixAndVersions(
      traversalRefs,
      traversalVersions
    ); //将大版本数组traversalRefs和version数组traversalVersions发送过去，返回匹配后的version数组matchedVersions
    console.log(`匹配到的version总数为: ${matchedVersions.length}`); //输出一下，看看问题在哪里
    console.log(typeof matchedVersions); //输出一下，看看问题在哪里
    traversalRefs = []; //分支数组清零(避免重复)
    traversalVersions = []; //版本数组清零(避免重复)
    if (matchedVersions.length === 0) {
      console.log(`${package_name}匹配成功数量为0`);
      continue;
    } else if (matchedVersions.length === 1) {
      console.log(`${package_name}匹配成功数量为1`);
      let version_name = matchedVersions[0];
      const tempStoreResult = {
        version_name,
        package_name,
        repository_name,
      }; //建立json，包含版本名version_name、包名package_name、仓库名repository_name
      //如果直接传，会达到每秒5次的接口使用率上限，同时还会产生超级多条记录，不便于处理（当然接口上限也好解决，每5条等1s后再发送下5条）
      traversalResult.push(tempStoreResult); //把json塞进发送数组里
      backUpTraversalMessage.push(tempStoreResult); //这里也存一份（备份）
      countVersion++; //计数，每50条传送一次
      sendFlag = false;
      if (countVersion % 50 === 0) {
        //满了50条
        countVersion = 0; //计数置0
        exports.airtableOfferedSendingMethod(traversalResult, argv); //调用发送
        console.log("发送50条");
        sendFlag = true; //提示已发送
        traversalResult = []; //清空发送数组
        countSend++; //发送次数加一
        if (countSend === 5) {
          countSend = 0; //发送次数置0
          sleep(1000); //休眠1000ms，也就是1s
          //置0操作也可以用取余来替代（比如===5然后置0等价于对5取余===0不用置0）
        }
      }
      continue;
    } else {
      for (let version_name of matchedVersions) {
        //遍历matchedVersions数组
        const tempStoreResult = {
          version_name,
          package_name,
          repository_name,
        }; //建立json，包含版本名version_name、包名package_name、仓库名repository_name
        //如果直接传，会达到每秒5次的接口使用率上限，同时还会产生超级多条记录，不便于处理（当然接口上限也好解决，每5条等1s后再发送下5条）
        traversalResult.push(tempStoreResult); //把json塞进发送数组里
        backUpTraversalMessage.push(tempStoreResult); //这里也存一份（备份）
        countVersion++; //计数，每50条传送一次
        sendFlag = false;
        if (countVersion % 50 === 0) {
          //满了50条
          countVersion = 0; //计数置0
          exports.airtableOfferedSendingMethod(traversalResult, argv); //调用发送
          console.log("发送50条");
          sendFlag = true; //提示已发送
          traversalResult = []; //清空发送数组
          countSend++; //发送次数加一
          if (countSend === 5) {
            countSend = 0; //发送次数置0
            sleep(1000); //休眠1000ms，也就是1s
            //置0操作也可以用取余来替代（比如===5然后置0等价于对5取余===0不用置0）
          }
        }
      }
    }
    countPackage++;
    console.log(`当前package: ${package_name}`);
    console.log(`countPackage: ${countPackage}`);
  }
  if (sendFlag === false) {
    //如果全部循环完成后仍有内容未发送
    sendFlag = true; //标记为已发送
    exports.airtableOfferedSendingMethod(traversalResult, argv); //调用发送
    traversalResult = []; //清空数组
  }
  return backUpTraversalMessage; //用于返回return，这里的返回值到了index.js的调用参数 const traversalMessage中，最后用于输出setOutput
};

//下方为发送遍历数据到airtable
exports.airtableOfferedSendingMethod = async function (traversalResult, argv) {
  //在package.json中的dependencies下指定airtable及版本号，这样就不需要exec了。
  const Airtable = require("airtable"); //引入airtable
  //这里将apiKey及base信息隐藏在action.yml中通过argv来传输
  //(仓库可视性改为public后action.yml如果能被浏览就会有airtable的key泄漏导致的内容失控风险)
  //const base = new Airtable(argv.apiKey).base(argv.base);
  const apiKey = argv.apiKey;
  //const base = new Airtable({apiKey}).base(argv.base);
  const base = new Airtable({ apiKey: `${apiKey}` }).base(`${argv.base}`);
  const storeStringify = JSON.stringify(traversalResult); //这里先string化，然后下方使用encodeURI进行编码，收到后使用decodeURI进行解码
  const storeReplace = storeStringify.replace(/"/g, '\\"'); //使用正则表达式进行替换（这里要用\\"，如果只用一个\则看不到变化）
  const storeBody = '"' + storeReplace + '"'; //首尾添加引号
  console.log(`即将传输的内容为: ${storeBody}`); //输出待传输的内容
  //let store_origin = storeBody; //自己传自己
  let backup = storeBody;
  base("origin-data").create(
    {
      backup: backup,
    },
    { typecast: true },
    function (err, record) {
      if (err) {
        console.error(err);
        return;
      }
      console.log(record.getId());
    }
  );
  process.on("unhandledRejection", (reason, p) => {
    console.log("Promise: ", p, "Reason: ", reason);
    // do something
    //这里用来解决UnhandledPromiseRejectionWarning的问题
  });
}; //add await before base.create

//下方为进一步深加工信息的功能组成（因为存在airtable的scripting性能瓶颈的可能性，所以在这里进行预处理,符合要求的再发送）
async function* traversalRepoRefsGraphQL(octokit, repository_name) {
  //该函数提取来所有dev分支的后缀（理论上分支第二个v后面就是大版本号）
  console.log("开始遍历所有refs");
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  let graphRefs = await octokit.graphql(`
    query{
      repository(name: "${repository_name}", owner: "kungfu-trader") {
        refs(refPrefix: "refs/heads/dev/", first: ${maxPerPage}) {
          edges {
            node {
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    } 
  `); //这里是遍历repo的所有分支，目的是为了获取后三位（比如v2/v2.1的2.1）用于和version进行前缀匹配
  let endCursor = graphRefs.repository.refs.pageInfo.endCursor;
  hasNextPage = graphRefs.repository.refs.pageInfo.hasNextPage;
  for (let graphPostFix of graphRefs.repository.refs.edges) {
    //注意edges的拼写
    yield graphPostFix;
  }
  while (hasNextPage) {
    hasNextPage = false;
    graphRefs = await octokit.graphql(`
      query{
        repository(name: "${repository_name}", owner: "kungfu-trader") {
          refs(refPrefix: "refs/heads/dev/", first: ${maxPerPage}, after: "${endCursor}") {
            edges {
              node {
                name
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `);
    hasNextPage = graphRefs.repository.refs.pageInfo.hasNextPage;
    endCursor = graphRefs.repository.refs.pageInfo.endCursor;
    for (let graphPostFix of graphRefs.repository.refs.edges) {
      //注意nodes还是node要和查询结构一致
      yield graphPostFix;
    }
  }
} //遍历repo所有分支的后缀获取大版本号

//下方用于遍历后缀数组和version数组进行匹配，找到我们想要的版本后并返回
//async function* comparePostFixAndVersions(postFixArray, versionsArray) {
function comparePostFixAndVersions(postFixArray, versionsArray) {
  console.log("开始比较");
  let matchedVersions = []; //存储匹配成功的versions
  let tempStoreMatchedVersion = versionsArray[0]; //临时存储匹配到的version，初始化为第一个元素
  let matchedFlag = false; //是否匹配成功的标志，初始化为false
  for (let varInPostFixArray of postFixArray) {
    //这里的元素已经过处理，可直接用
    console.log(`分支后缀为: ${varInPostFixArray}`); //输出大版本看看问题在哪里
    const varLength = varInPostFixArray.length; //存储元素长度
    console.log(`后缀长度为: ${varLength}`); //输出大版本长度看看问题在哪里
    for (let varInVersionArray of versionsArray) {
      //利用for-of方式遍历数组时从下标为0的位置开始，也就是初始位置
      //substring为小写
      console.log(`版本号为: ${varInVersionArray}`); //输出version看看问题在哪里
      const tempStoreSubString = varInVersionArray.substring(0, varLength); //提取version的前缀
      console.log(`提取的版本前缀为: ${tempStoreSubString}`); //输出版本前缀看看问题在哪里
      if (varInPostFixArray === tempStoreSubString) {
        matchedFlag = true; //匹配成功
        tempStoreMatchedVersion = varInVersionArray; //存储version全称（不是tempStoreSubString）
        console.log(`匹配到的版本为: ${tempStoreMatchedVersion}`); //输出匹配到的verison看看问题在哪里
        //遍历获取version时使用的是first顺序，最先发布的存在数组最前面，这样最后一个匹配到的就是该分支最新版本version
        break; //首次匹配即退出循环
      }
    }
    if (matchedFlag === true) {
      matchedVersions.push(tempStoreMatchedVersion); //将最终匹配到的存入数组中
      console.log(`匹配成功的版本version: ${tempStoreMatchedVersion}`); //输出最终匹配到的vesion
      matchedFlag = false; //置为false
    } //每一个大版本遍历版本数组进行前缀匹配，并将匹配成功的结果存入数组中
  }
  console.log("匹配到的version总数为:");
  console.log(matchedVersions.length);
  return matchedVersions; //返回存储着所有匹配结果的数组
  //yield matchedVersions;
}

//下方用于测试git-release-notes这个package的功能
//async function* gitReleaseNotes() {
async function gitReleaseNotes() {
  const releaseNotes = require("git-release-notes");

  const OPTIONS = {
    branch: "dev/v2/v2.0",
  };
  const RANGE = "v2.0.0-alpha.0..v2.0.0-alpha.10";
  const TEMPLATE = "markdown";

  releaseNotes(OPTIONS, RANGE, TEMPLATE)
    .then((changelog) => {
      console.log(`Changelog between ${RANGE}\n\n${changelog}`);
    })
    .catch((ex) => {
      console.error(ex);
      process.exit(1);
    });
}

// async function testtraversalPackagesREST(octokit, argv) {
//   //遍历获取所有package的rest方法
//   /*const octokit = new Octokit({
//     auth: 'YOUR-TOKEN'
//   })*/
//   const responseRestPackage = await octokit.request(
//     "GET /orgs/{org}/{repo}/packages/npm",
//     {
//       org: "kungfu-trader",
//       repo: "action-bump-version",
//     }
//   );
//   console.log("开始输出package");
//   console.log(responseRestPackage.items.name); //
//   console.log("完成输出package");
// }

//由于github在8月18日以后弃用了graphQL for packages，所以原有方法需改写成rest方法
// async function traversalPackagesREST(octokit, argv) {
//   //遍历获取所有package的rest方法
//   /*const octokit = new Octokit({
//     auth: 'YOUR-TOKEN'
//   })*/
//   const responseRestPackage = await octokit.request(
//     "GET /orgs/{org}/packages/npm",
//     {
//       org: "kungfu-trader",
//     }
//   );
//   console.log("开始输出package");
//   console.log(responseRestPackage.items.name); //
//   console.log("完成输出package");
//   return responseRestPackage;
// }
// async function traversalVersionsREST(octokit, argv) {
//   //遍历获取所有version的rest方法
//   const responseRestVersion = await octokit.request(
//     "GET /orgs/{org}/packages/{package_type}/{package_name}/versions",
//     {
//       package_type: "npm",
//       package_name: "action-sync-airtable",
//       org: "kungfu-trader",
//     }
//   );
//   console.log("开始输出version");
//   console.log(responseRestVersion.items.properties.name);
//   console.log("完成输出version");
// }

exports.consoleMessages = async function (argv) {
  try {
    const octokit = new Octokit({
      auth: `${argv.token}`,
    });
    // /const octokit = getOctokit(argv.token);
    console.log("开始调用");
    // await traversalPackagesREST(octokit, argv);
    // await traversalVersionsREST(octokit, argv);
    // await testtraversalPackagesREST(octokit, argv);
    /*const res =
      await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
        package_type: "npm",
        package_name: "test-rb-b",
        org: "kungfu-trader",
      });
    console.log(
      `-----[test-rb-b] First package_version is: ${res.data[0].name}`//输出version名称
    );
    console.log(`-----[test-rb-b] Package_version_id is: ${res.data[0].id}`);//输出version对应id
    console.log(`${res.data.length}`);//测试输出版本总数*/
    let currentPage = 1;
    let hasNextPage = false;
    const maxPerPage = 100;
    const res = await octokit.rest.packages.listPackagesForOrganization({
      package_type: "npm",
      org: "kungfu-trader",
      page: currentPage,
      per_page: maxPerPage,
    });
    //hasNextPage = restResponsePackages.data.total_count / maxPerPage > currentPage;
    console.log(res.data[0]);
    console.log("完成调用");
    /*const delete_pkg = await octokit.rest.packages.deletePackageVersionForOrg({
      package_type: "npm",
      package_name: "test-rb-b",
      org: "kungfu-trader",
      package_version_id: res.data[0].id,
    });
    console.log(
      `[INFO]-----Delete package test-rb-b(version:[${res.data[0].name}]) success!`
    );*/
  } catch (err) {
    console.log(err);
  }
};

//  https://github.com/kungfu-trader/test-rollback-packages/pkgs/npm/test-rb-b/37231052
//  https://api.github.com/user/packages/npm/test-rb-b/versions/37231052

async function traversalPackagesREST(argv) {
  const octokit = new Octokit({
    auth: `${argv.token}`,
  });
  let hasNextPage = false;
  let currentPage = 1;
  const maxPerPage = 100;
  console.log("开始使用rest方法查询所有package");
  do {
    const restResponsePackages =
      await octokit.rest.packages.listPackagesForOrganization({
        package_type: "npm",
        org: "kungfu-trader",
        page: currentPage,
        per_page: maxPerPage,
      });
    hasNextPage =
      restResponsePackages.data.total_count / maxPerPage > currentPage;
    /*for (const artifact of response.data.artifacts) {
      yield artifact;
    }*/
    currentPage++;
  } while (hasNextPage);
}
