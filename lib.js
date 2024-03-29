/* eslint-disable no-restricted-globals */
const github = require("@actions/github"); //这里有个quickFix，切换到ES标准语法
const fs = require("fs");
const path = require("path");
const { Octokit } = require("@octokit/rest"); //如果缺少就会出现TypeError: Cannot read property 'packages' of undefined
const core = require("@actions/core");
const axios = require("axios");
const {
  restEndpointMethods,
} = require("@octokit/plugin-rest-endpoint-methods");
const { argv } = require("process");
const semver = require("semver");

const getOctokit = (token) => {
  const _Octokit = Octokit.plugin(restEndpointMethods);
  return new _Octokit({ auth: token });
}; //octokit

const sleep = function (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}; //这里加一个sleep用于实现睡眠等待，比如airtable的api每使用5次休息1s（单位为毫秒ms，应为1000）

//下方函数的功能为遍历组织下所有package的rest实现方法（由于graphQL for package已被github弃用所以重写相关方法）
async function* traversalPackagesREST(argv) {
  const octokit = new Octokit({
    auth: `${argv.token}`,
  }); //octokit
  let hasNextPage = false; //是否有下一页，初始化为假
  let currentPage = 1; //当前页，初始化为1
  const maxPerPage = 100; //每页最大记录条数，设定为100，默认为30
  console.log("开始使用rest方法查询所有package");
  do {
    const restResponsePackages =
      await octokit.rest.packages.listPackagesForOrganization({
        package_type: "npm",
        org: "kungfu-trader",
        page: currentPage,
        per_page: maxPerPage,
      }); //使用rest方法列举组织下所有的package，后续package数量超过100后这里要想个办法看看hasNextPage是否应该为true
    for (const restPackage of restResponsePackages.data) {
      // console.log("================package: ", restPackage);
      yield restPackage;
    }
    currentPage++;
  } while (hasNextPage);
  // console.log("rest查询组织下所有package结束");
  //graphQL查询到的package会含有已被删除的，需要通过latestVersion是否为空来判断是否跳过。
  //目前rest方法查询到的package并不包含已被删除的，所以不需要额外判断
}

//下方函数的功能为遍历特定package所有version的rest实现方法（由于graphQL for package已被github弃用所以重写相关方法）
async function* traversalVersionREST(argv, package_name, version_count) {
  const octokit = new Octokit({
    auth: `${argv.token}`,
  }); //octokit
  let hasNextPage = false;
  let currentPage = 1;
  const maxPerPage = 100;
  console.log("开始使用rest方法查询所有version");
  do {
    const restResponseVersions =
      await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
        package_type: "npm",
        package_name: package_name,
        org: argv.owner,
        page: currentPage,
        per_page: maxPerPage,
      });
    //hasNextPage = version_count / maxPerPage > currentPage;
    //这里version_count理应为listPackagesForOrganization的其中一个返回字段，但是突然有一天字段消失了，所以通过下方的if来曲线解决赋值问题
    if (restResponseVersions.data.length === 100) {
      //如果返回的version记录为100条则大概率还有下一页，接着翻页查
      hasNextPage = true;
      console.log("version记录即将超过100条");
    } else if (restResponseVersions.data.length === 0) {
      //如果返回的version记录为0条则直接跳过，说明刚刚好100条
      hasNextPage = false;
      console.log("rest查询到的version数为0");
      break; //直接整个跳出，不建议用continue
    } else if (restResponseVersions.data.length === undefined) {
      //因为返回可能不只有0还可能有undefined，虽然效果相似但还是要分开判别
      hasNextPage = false;
      console.log("rest查询到的version数为undefined");
      break; //直接整个跳出，不建议用continue
    }
    if (hasNextPage === false) {
      console.log(
        `没有下一页,hasNextPage值为${hasNextPage},查询到的记录条数为${restResponseVersions.data.length}`
      );
    } else {
      console.log(
        `还有下一页,hasNextPage值为${hasNextPage},查询到的记录条数为${restResponseVersions.data.length}`
      );
    }
    for (const restVersion of restResponseVersions.data) {
      yield restVersion;
    }
    currentPage++;
    console.log(`查到的version之第${currentPage}页`);
  } while (hasNextPage);
}

//下方函数的功能为提取所有dev分支的后缀（理论上分支第二个v后面就是大版本号）
async function* traversalRepoRefsGraphQL(octokit, repository_name) {
  // console.log("开始遍历所有refs");
  let hasNextPage = false; //是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //每页最大值，这里定义为100，默认为30
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
      //注意nodes还是node要和查询返回结构一致
      yield graphPostFix;
    }
  }
}

//下方函数的功能是遍历后缀数组和version数组进行匹配，找到我们想要的版本后并返回
function comparePostFixAndVersions(postFixArray, versionsArray) {
  // console.log("开始比较");
  let matchedVersions = []; //存储匹配成功的versions
  let tempStoreMatchedAlphaVersion = []; //临时存储匹配到alpha的version，初始化为第一个元素
  let tempStoreMatchedReleaseVersion = []; //临时存储匹配到release的version，初始化为第一个元素
  let matchedFlag = false; //是否匹配成功的标志，初始化为false
  let matchAlphaFlag = false; //是否匹配到alpha版本
  let matchReleaseFlag = false; //是否匹配到release版本
  for (let varInPostFixArray of postFixArray) {
    //这里的元素已经过处理，可直接用
    const varLength = varInPostFixArray.length; //存储元素长度
    for (let varInVersionArray of versionsArray) {
      //利用for-of方式遍历数组时从下标为0的位置开始，也就是初始位置此外substring方法为小写
      const tempStoreSubString = varInVersionArray.substring(0, varLength); //提取version的前缀
      if (varInPostFixArray === tempStoreSubString) {
        matchedFlag = true; //匹配成功
        if (varInVersionArray.includes("alpha") && matchAlphaFlag === false) {
          matchAlphaFlag = true; //如果version中包含子串alpha且alpha版本还没匹配到
          tempStoreMatchedAlphaVersion.push(varInVersionArray); //将匹配到的alpha版本存入变量中
          // console.log(`匹配到的版本为: ${tempStoreMatchedAlphaVersion[0]}`); //输出匹配到的verison
        } else if (
          varInVersionArray.includes("alpha") &&
          matchAlphaFlag == true
        ) {
          continue; //如果仍为alpha版本则跳过
        } else if (matchReleaseFlag === false) {
          //如果release版本还没匹配到
          matchReleaseFlag = true;
          tempStoreMatchedReleaseVersion.push(varInVersionArray);
          // console.log(`匹配到的版本为: ${tempStoreMatchedReleaseVersion[0]}`); //输出匹配到的verison
        }
        //遍历获取version时使用的是first顺序，最先发布的存在数组最前面，这样最后一个匹配到的就是该分支最新版本version
        if (matchAlphaFlag === true && matchReleaseFlag === true) {
          break; //只有alpha和release都匹配成了才跳出
        } else {
          matchedFlag = false; //否则继续循环
        }
      }
    }
    if (matchedFlag === true) {
      matchedVersions.push(tempStoreMatchedAlphaVersion[0]); //将最终匹配到的存入数组中
      matchedVersions.push(tempStoreMatchedReleaseVersion[0]); //将最终匹配到的存入数组中
      matchAlphaFlag = false;
      matchReleaseFlag = false;
      matchedFlag = false; //置为false
      tempStoreMatchedAlphaVersion = [];
      tempStoreMatchedReleaseVersion = [];
    } //每一个大版本遍历版本数组进行前缀匹配，并将匹配成功的结果存入数组中
    else if (matchAlphaFlag === true) {
      matchedVersions.push(tempStoreMatchedAlphaVersion[0]); //将最终匹配到的存入数组中
      matchAlphaFlag = false;
      matchReleaseFlag = false;
      matchedFlag = false;
      tempStoreMatchedAlphaVersion = [];
      tempStoreMatchedReleaseVersion = [];
    } else if ((matchReleaseFlag = true)) {
      matchedVersions.push(tempStoreMatchedReleaseVersion[0]); //将最终匹配到的存入数组中
      matchReleaseFlag = false;
      matchAlphaFlag = false;
      matchedFlag = false;
      tempStoreMatchedAlphaVersion = [];
      tempStoreMatchedReleaseVersion = [];
    }
  }
  console.log("匹配到的version总数为:", matchedVersions.length);
  // console.log(matchedVersions);
  return matchedVersions; //返回存储着所有匹配结果的数组
}

//下方函数功能为发送数据到airtable并存入指定base内表格
exports.airtableOfferedSendingMethod = async function (traversalResult, argv) {
  const Airtable = require("airtable"); //引入airtable
  const apiKey = argv.apiKey; //获取apiKey
  const base = new Airtable({ apiKey: `${apiKey}` }).base(`${argv.base}`); //获取base的ID
  const storeStringify = JSON.stringify(traversalResult); //将json数组string化
  // console.log(`即将传输的内容为: ${storeBody}`); //控制台输出待传输的内容
  let backup = storeStringify; //要传输内容存入列名backup同名变量中，减少check format带来的单双引号变化影响传输结果
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
      console.log("create recode ", record.getId());
    }
  ); //在origin-data表中backup列创建一条记录
  process.on("unhandledRejection", (reason, p) => {
    console.log("Promise: ", p, "Reason: ", reason);
    //这里用来解决UnhandledPromiseRejectionWarning的问题
  });
};

function getVersionWithoutPatch(version) {
  const sVer = semver.parse(version);
  let verWithPatch = sVer.prerelease.length > 0 ? "-" + sVer.prerelease[0] : "";
  verWithPatch = sVer.major + "." + sVer.minor + verWithPatch;
  return verWithPatch;
}

async function sendVersionToAirtable(dataList, argv) {
  const l = dataList.length;
  let i = 10;
  const url = "https://api.airtable.com/v0/appd2XwFJcQWZM8fw/data";
  const mergFields = ["Package", "Versionkey"];
  while (i <= l) {
    const ret = await upsertAirtable(
      url,
      mergFields,
      dataList.slice(i - 10, i),
      argv.apiKey
    );
    console.log("send index ", i, " result ", ret);
    i += 10;
  }
  if (i - 10 > l) {
    const ret = await upsertAirtable(
      url,
      mergFields,
      dataList.slice(i - 10),
      argv.apiKey
    );
    console.log("send index ", l, " result ", ret);
  }
  return true;
}

async function upsertAirtable(url, mergFields, dataList, airtableApiKey) {
  let tryagain = 0;
  while (tryagain < 3) {
    try {
      const r = await axios.put(
        url,
        {
          performUpsert: {
            fieldsToMergeOn: mergFields,
          },
          records: dataList,
        },
        {
          headers: {
            Authorization: `Bearer ${airtableApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`upsertAirtable ${url} ${r}`);
      return true;
    } catch (e) {
      console.log(e);
      tryagain++;
    }
  }
  return false;
}

exports.traversalMessageRest = async function (argv) {
  const octokit = getOctokit(argv.token);
  let countVersion = 0; //该变量用于存储当前位置 //存储数组内有效数据量，方便判别是否该发送
  let countPackage = 0; //store steps of for-loops
  let sendFlag = false; //用于标记是否发送了
  let traversalResult = []; //该变量用于每次发送前存储json信息
  let backUpTraversalMessage = []; //该变量用于存储所有json信息用于返回（return）
  let traversalRefs = []; //该变量用于存储当前package对应的repo的所有分支，用于与version进行字符串匹配
  let traversalVersions = []; //该变量用于存储当前package的所有versions
  try {
    for await (let restPackage of traversalPackagesREST(argv)) {
      //遍历所有的package
      const versionSum = restPackage.version_count; //存储versoin总数
      console.log(`rest返回的package的version总数为 ${versionSum}`);
      const package_name = restPackage.name;
      const repository_name = restPackage.repository.name; //这俩参数用于后续查询versions
      for await (let graphPostFix of traversalRepoRefsGraphQL(
        octokit,
        repository_name
      )) {
        //外层每遍历到一个package，根据其对应到repo-name，遍历该仓库的所有dev分支
        const refsPost = graphPostFix.node.name; //比如action-bump-version的“v2/v2.0”（筛选条件为refs/heads/dev，这样返回的是dev后的内容）
        const subStart = refsPost.lastIndexOf("v"); //最后一个v所在的位置
        if (subStart === -1) {
          console.log(`${repository_name}的dev分支${refsPost}并非标准命名`);
          continue;
        } //如果该dev分支并非标准分支命名，不含字母v，返回值为-1，跳过并给出提示
        const subEnd = refsPost.length; //提取字符串长度
        const refsPostFix = refsPost.substring(subStart + 1, subEnd); //提取子串，这里获取的就是“v2/v2.0”里的“2.0”
        traversalRefs.push(refsPostFix); //子串仍为字符串类型（后续可以使用length，而如果是float则不能用length），存进数组
      } //遍历repo所有分支并提取出大版本号存储起来
      for await (let restVersion of traversalVersionREST(
        argv,
        package_name,
        versionSum
      )) {
        const versionName = restVersion.name;
        traversalVersions.push(versionName);
        // console.log(`${package_name} ${JSON.stringify(restVersion)} ... ${versionName}`)
      } //遍历package所有version并存储起来
      let matchedVersions = comparePostFixAndVersions(
        traversalRefs,
        traversalVersions
      ); //将大版本数组traversalRefs和version数组traversalVersions发送过去，返回匹配后的version数组matchedVersions
      // console.log("333", matchedVersions);
      console.log(`匹配到的version总数为: ${matchedVersions.length}`);
      traversalRefs = []; //分支数组清零(避免重复)
      traversalVersions = []; //版本数组清零(避免重复)
      if (matchedVersions.length === 0) {
        console.log(`${package_name}匹配成功数量为0`);
        continue;
      } else if (matchedVersions.length === 1) {
        console.log(`${package_name}匹配成功数量为1`);
        let version_name = matchedVersions[0];
        const versionWithoutPatch = getVersionWithoutPatch(version_name);
        const tempStoreResult = {
          fields: {
            Package: package_name,
            Version: version_name,
            Repo: repository_name,
            Versionkey: versionWithoutPatch,
          },
        }; //建立json，包含版本名version_name、包名package_name、仓库名repository_name
        console.log("tempStoreResult 1", tempStoreResult);
        traversalResult.push(tempStoreResult); //把json塞进发送数组里
        backUpTraversalMessage.push(tempStoreResult); //这里也存一份（备份）
        countVersion++; //计数，每50条传送一次
        sendFlag = false;
        continue;
      } else {
        for (let version_name of matchedVersions) {
          //遍历matchedVersions数组
          if (version_name === null) {
            // console.log("version_name为空,跳过json生成");
            continue;
          } else if (version_name === undefined) {
            // console.log("version_name未定义,跳过json生成");
            continue;
          }
          const versionWithoutPatch = getVersionWithoutPatch(version_name);
          const tempStoreResult = {
            fields: {
              Package: package_name,
              Version: version_name,
              Repo: repository_name,
              Versionkey: versionWithoutPatch,
            },
          }; //建立json，包含版本名version_name、包名package_name、仓库名repository_name
          console.log("tempStoreResult 2", tempStoreResult);
          traversalResult.push(tempStoreResult); //把json塞进发送数组里
          backUpTraversalMessage.push(tempStoreResult); //这里也存一份（备份）
          countVersion++; //计数，每50条传送一次
          sendFlag = false;
        }
      }
      countPackage++;
    }
    if (countVersion != 0) {
      //如果全部循环完成后仍有内容未发送
      sendFlag = true; //标记为已发送
      console.log("total item number", countVersion);
      await sendVersionToAirtable(traversalResult, argv);
      traversalResult = []; //清空数组
    }
  } catch (err) {
    console.log(err);
  }
  return backUpTraversalMessage; //return返回值到了index.js的调用参数traversalMessage中，最后用于输出setOutput
};
