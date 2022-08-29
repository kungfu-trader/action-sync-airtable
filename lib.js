/* eslint-disable no-restricted-globals */
const github = require("@actions/github"); //这里有个quickFix，切换到ES标准的引进（就是把require变成import？）
const fs = require("fs"); //filesystem文件系统
const path = require("path"); //这个路径是啥，看起来是被引入的
const { Octokit } = require("@octokit/core"); //Extendable client for GitHub's REST & GraphQL APIs
const {
  restEndpointMethods,
} = require("@octokit/plugin-rest-endpoint-methods"); //rest终端方法
const { count } = require("console");
//graphQL是否需要被引入（经过测试赞数没用到引入）

const getOctokit = (token) => {
  const _Octokit = Octokit.plugin(restEndpointMethods);
  return new _Octokit({ auth: token });
}; //octokit

async function* traversalPackagesRest(octokit) {
  //循环遍历获取所有package的rest方法
  //方法留着，如果未来需要可以调用
  const response = await octokit.request("GET /orgs/{org}/packages", {
    org: "kungfu-trader",
    package_type: "npm",
  }); //这里似乎不需要循环，因为在response schema中没有找到currentPage、hasNextPage这两个参数（但是有hasPages）
  for (const restPackage of response.data.Package) {
    yield restPackage;
  } //对于这里使用.package到底能否起效需要后续测试
}

async function* traversalVersionsRest(octokit, package_name) {
  //循环遍历获取所有版本的rest方法
  //方法留着，如果未来需要可以调用
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  let currentPage = 1; //当前页数，这里初始化为第一页（对应到graphQL就是first，从前面算起的第一页）
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  do {
    const response = await octokit.request(
      "GET /orgs/{org}/packages/{package_type}/{package_name}/versions",
      {
        package_type: "npm",
        package_name: package_name,
        org: "kungfu-trader",
        page: currentPage,
        per_page: maxPerPage,
      }
    );
    hasNextPage = response.data.total_count / maxPerPage > currentPage; //然而response-schema中没有total_count
    for (const restVersions of response.data.PackageVersion) {
      //data.PackageVersion需要测试格式是否正确
      yield restVersions;
    }
    currentPage++;
  } while (hasNextPage);
  //这里有个问题，返回中没有total_count，所以如何判别是否进入循环的条件？
  //还有一个需要注意的点就是本函数的传入参数包括了package_name，调用时不能忘了
}

//由于rest方法还是不太好测试。。。接下来把graphQL查询两者的语句也都实现了
//本次使用的都是graphQL的query方法，暂时用不到mutation（不过为了展示查询结果暂时写入某文件也不是不可能，当然最好还是控制台输出）
/*这部分是测试前的伪代码
async function* traversalPackagesGraphQL(octokit) {
  //循环遍历获取所有package的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  let startCursor = ""; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
  do {
    const graphResponse = octokit.graphql(`
      query{
        organization(login: "kungfu-trader") {
          packages(first: "${maxPerPage}", after: "${startCursor}") {
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
    for (const graphPackage of graphResponse.organization.packages.nodes) {
      yield graphPackage;
    }
    hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage;
    startCursor = graphResponse.organization.packages.pageInfo.endCursor;
  } while (hasNextPage);
}

async function* traversalVersionsGraphQL(
  octokit,
  package_name,
  repository_name
) {
  //循环遍历获取所有Versions的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  let startCursor = ""; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
  do {
    const graphResponse = octokit.graphql(`
      query{
        repository(name: "${repository_name}", owner: "kungfu-trader") {
          packages(names: "${package_name}", last: 1) {
            totalCount
            nodes {
              versions(first: "${maxPerPage}", after: "${startCursor}" {
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
    for (const graphVersion of graphResponse.repository.packages.nodes[0]
      .versions.nodes) {
      yield graphVersion;
    }
    hasNextPage =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
    startCursor =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
  } while (hasNextPage);
}

//实现了上述rest及graphQL查询方法后，下面构建调用函数完成整个查询，这里使用exports

exports.traversalMessage = async function (octokit) {
  let countNode = 0; //该变量用于存储当前位置
  let traversalResult = []; //该变量用于存储json信息
  for await (const graphPackage of traversalPackagesGraphQL(octokit)) {
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //如果通过下方判别函数则这俩参数用于后续查询versions
    if (graphPackage.latestVersion === null) {
      console.log(`跳过package: ${package_name}`);
      continue;
    }
    for await (const graphVersion of traversalVersionsGraphQL(
      octokit,
      package_name,
      repository_name
    )) {
      const version_name = graphVersion.version;
      const tempStoreResult = {
        version: version_name,
        package: package_name,
        repo: repository_name,
      };
      traversalResult.push(tempStoreResult);
      countNode++;
    }
  }
  //console.log(JSON.stringify(traversalResult)); //用于控制台输出最终结果
  exports.sendMessageToAirtable(traversalResult);
};

//关于查询到的结果如何存储也是一门学问
//暂时选择的是存储键值对（构成json{version,package,repository}）,然后把它存入数组中
//这里还有个问题是信息重复（冗余），比如repository和package信息被重复很多次
//json有没有信息/空间上限？如果没有，考虑将其使用assign方法连接？（似乎也不需要，每个package一个数组，一个version一个push）
//接下来考虑如何将已经查询并保存在traversalResult中的json数据发送到airtable或者zapier中？
const request = require("request");

exports.sendMessageToAirtable = async function (traversalResult) {
  const messageToAirtable = JSON.stringify(traversalResult);
  const options = {
    method: "POST",
    url: "https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201",
    headers: {
      Authorization: "Bearer keyV2K62gr8l53KRn",
      "Content-Type": "application/json",
      Cookie: "brw=brwjmHKMyO4TjVGoS",
    },
    body: JSON.stringify({
      records: [
        {
          fields: {
            store: `${messageToAirtable}\n`,
          },
        },
      ],
    }),
  };
  request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body);
  });
};
上述这部分为测试前的伪代码*/

//下方代码用于在github-action-控制台输出测试能否获取我们想要的package-version
async function* traversalPackagesGraphQL(octokit) {
  //循环遍历获取所有package的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  //let startCursor = ''; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
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
  let startCursor = graphResponse.organization.packages.pageInfo.endCursor;
  hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage;
  for (const graphPackage of graphResponse.organization.packages.nodes) {
    yield graphPackage;
  }
  while (hasNextPage) {
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
    for (const graphPackage of graphResponse.organization.packages.nodes) {
      yield graphPackage;
    }
    hasNextPage = graphResponse.organization.packages.pageInfo.hasNextPage;
    startCursor = graphResponse.organization.packages.pageInfo.endCursor;
  }
}
//遍历版本出错，似乎还是after的原因(修改after的位置+是否超过100进行区分这样after的初始化问题也解决了)
async function* traversalVersionsGraphQL(
  octokit,
  package_name,
  repository_name
) {
  //循环遍历获取所有Versions的graphQL方法
  let hasNextPage = false; //let是可变变量,是否有下一页，用以判断是否要继续循环
  const maxPerPage = 100; //const是常量，每页最大值，这里定义为100，默认为30
  //let startCursor = ''; //因为后续这里肯定是string类型的，所以这里先给它初始化为“”，注意不能初始化为=null，有风险
  //我似乎找到了为什么多页遍历版本会出现重复内容的原因，这是因为graphResponse被声明为常量const导致无法刷新内容
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
    graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
  hasNextPage =
    graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
  for (const graphVersion of graphResponse.repository.packages.nodes[0].versions
    .nodes) {
    yield graphVersion;
  }
  while (hasNextPage) {
    console.log(`startCursor: ${startCursor}`); //用于后续比较，怀疑是赋值问题
    console.log(`超过100: ${package_name}`);
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
        }`); //startCursor自身就是sting，是否还需要引号？
    //为了测试，这里将package和repo指定为action-bump-version
    //如果这次还是提示after后的内容为空（即startCursor未赋有效值的原因）则将其在do-while循环前不加after执行一次并将结构变为while-do
    for (const graphVersion of graphResponse.repository.packages.nodes[0]
      .versions.nodes) {
      yield graphVersion;
    }
    hasNextPage =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.hasNextPage;
    startCursor =
      graphResponse.repository.packages.nodes[0].versions.pageInfo.endCursor;
    console.log(`hasNextPage: ${hasNextPage}`); //after位置错了
    console.log(`endCursor: ${startCursor}`); //目前看是这个循环没有正常跳出
  }
}
const sleep = function (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}; //这里加一个sleep用于实现睡眠等待
//实现了上述rest及graphQL查询方法后，下面构建调用函数完成整个查询，这里使用exports
//exports.traversalMessage = async function (octokit) {
exports.traversalMessage = async function (argv) {
  const octokit = github.getOctokit(argv.token);
  let countVersion = 0; //该变量用于存储当前位置 //存储数组内有效数据量，方便判别是否该发送
  let countPackage = 0; //store steps of for-loops
  let countSend = 0; //store send times
  let sendFlag = false; //用于标记是否发送了
  let traversalResult = []; //该变量用于每次发送前存储json信息
  let backUpTraversalMessage = []; //该变量用于存储所有json信息用于返回（return）
  for await (const graphPackage of traversalPackagesGraphQL(octokit)) {
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //如果通过下方判别函数则这俩参数用于后续查询versions
    if (graphPackage.latestVersion === null) {
      console.log(`跳过package: ${package_name}`);
      continue;
    } //package没有最新版本意味着被删除，所以跳过（之前想用提取前缀来判断的方法，但是不保证未来没有deleted开头的package，所以放弃）
    for await (const graphVersion of traversalVersionsGraphQL(
      octokit,
      package_name,
      repository_name
    )) {
      const version_name = graphVersion.version;
      /*const tempStoreResult = {
        version: version_name,
        package: package_name,
        repo: repository_name,
      };*/
      //暂时将变量名删去，看看是否还需要做引号的转义
      //当然也有可能，json定义出错，直接跑失败了
      const tempStoreResult = {
        version_name,
        package_name,
        repository_name,
      };
      //exports.airtableOfferedMethod(tempStoreResult);
      //如果直接传，会达到每秒5次的接口使用率上限，同时还会产生超级多条记录，不便于处理（当然接口上限也好解决，每5条等1s后再发送下5条）
      traversalResult.push(tempStoreResult);
      backUpTraversalMessage.push(tempStoreResult); //这里也存一份
      /*const number = 5;
      let cur_num = 0;
      cur_num += 1;
      if(cur_num % number == 0) {
        sleep(1000);
      }*/
      countVersion++; //每50条传送一次
      sendFlag = false;
      if (countVersion % 50 === 0) {
        countVersion = 0; //置0
        exports.airtableOfferedMethod(traversalResult, argv); //调用发送
        sendFlag = true; //提示已发送
        traversalResult = []; //清空数组
        countSend++; //发送次数加一
        if (countSend === 5) {
          countSend = 0; //发送次数置0
          sleep(1000); //休眠1000ms，也就是1s
          //emmm,置0操作可以用取余来替代（比如===5然后置0等价于对5取余===0不用置0）
        }
      }
      //console.log(`countVersion: ${countVersion}`);
      //break; //这里加个break用于测试，这样只用遍历一次(这里只跳出了内层循环，每次获取有效package后都来一次获取action-bump-version的first:1，然后再push进数组)
    }
    //break; //测试action-bump-version的所有version能否正常遍历（这个目前包最多）
    countPackage++;
    console.log(`当前package: ${package_name}`);
    console.log(`countPackage: ${countPackage}`);
  }
  if (sendFlag === false) {
    sendFlag = true; //标记为已发送
    exports.airtableOfferedMethod(traversalResult, argv); //调用发送
    traversalResult = []; //清空数组
  }
  return backUpTraversalMessage; //用于返回return，这里的返回值到了index.js的调用参数 const traversalMessage中，最后用于输出setOutput
  //console.log(JSON.stringify(traversalResult)); //用于控制台输出最终结果
  console.log(traversalResult.length); //用于测试数组长度看看遍历能否进入下一页
  //const storeTraversalResult = JSON.stringify(traversalResult);
  //const storeTraversalResult = traversalResult + '';
  //exports.sendMessageToAirtable(storeTraversalResult);
  //exports.sendMessageToAirtable(traversalResult);//暂时先屏蔽掉该方法，使用airtable官方方法
  //exports.airtableOfferedMethod(storeTraversalResult);
  //exports.airtableOfferedMethod(traversalResult); //看起来似乎并不需要在这里string化
};
exports.traversalMessage = async function (argv) {
  const octokit = github.getOctokit(argv.token);
  let countVersion = 0; //该变量用于存储当前位置 //存储数组内有效数据量，方便判别是否该发送
  let countPackage = 0; //store steps of for-loops
  let countSend = 0; //store send times
  let sendFlag = false; //用于标记是否发送了
  let traversalResult = []; //该变量用于每次发送前存储json信息
  let backUpTraversalMessage = []; //该变量用于存储所有json信息用于返回（return）
  let traversalRefs = []; //该变量用于存储当前package对应的repo的所有分支，用于与version进行字符串匹配
  let traversalVersions = []; //该变量用于存储当前package的所有versions
  for await (const graphPackage of traversalPackagesGraphQL(octokit)) {
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //如果通过下方判别函数则这俩参数用于后续查询versions
    if (graphPackage.latestVersion === null) {
      console.log(`跳过package: ${package_name}`);
      continue;
    } //package没有最新版本意味着被删除，所以跳过（之前想用提取前缀来判断的方法，但是不保证未来没有deleted开头的package，所以放弃）
    for await (const graphPostFix of traversalRepoRefsGraphQL(
      octokit,
      repository_name
    )) {
      const refsPost = graphPostFix.name; //比如action-bump-version的“v2/v2.0”
      const subStart = refsPost.lastIndexOf("v"); //最后一个v所在的位置
      if (subStart === -1) {
        console.log(`${repository_name}的dev分支${refsPost}并非标准命名`);
        continue;
      } //如果该dev分支并非标准分支命名，不含字母v，返回值为-1，跳过并给出提示
      const subEnd = refsPost.length; //提取字符串长度
      const refsPostFix = refsPost.subString(subStart + 1, subEnd); //提取子串
      traversalRefs.push(refsPostFix); //存进数组
    } //遍历repo所有分支并提取出大版本号存储起来
    for await (const graphVersion of traversalVersionsGraphQL(
      octokit,
      package_name,
      repository_name
    )) {
      const version_name = graphVersion.version;
      traversalVersions.push(version_name);
    } //遍历package所有version并存储起来
    const matchedVersions = comparePostFixAndVersions(
      traversalRefs,
      traversalVersions
    );
    for (let version_name of matchedVersions) {
      /*const tempStoreResult = {
        version: version_name,
        package: package_name,
        repo: repository_name,
      };*/
      //暂时将变量名删去，看看是否还需要做引号的转义
      //当然也有可能，json定义出错，直接跑失败了
      const tempStoreResult = {
        version_name,
        package_name,
        repository_name,
      };
      //exports.airtableOfferedMethod(tempStoreResult);
      //如果直接传，会达到每秒5次的接口使用率上限，同时还会产生超级多条记录，不便于处理（当然接口上限也好解决，每5条等1s后再发送下5条）
      traversalResult.push(tempStoreResult);
      backUpTraversalMessage.push(tempStoreResult); //这里也存一份
      /*const number = 5;
      let cur_num = 0;
      cur_num += 1;
      if(cur_num % number == 0) {
        sleep(1000);
      }*/
      countVersion++; //每50条传送一次
      sendFlag = false;
      if (countVersion % 50 === 0) {
        countVersion = 0; //置0
        exports.airtableOfferedMethod(traversalResult, argv); //调用发送
        sendFlag = true; //提示已发送
        traversalResult = []; //清空数组
        countSend++; //发送次数加一
        if (countSend === 5) {
          countSend = 0; //发送次数置0
          sleep(1000); //休眠1000ms，也就是1s
          //emmm,置0操作可以用取余来替代（比如===5然后置0等价于对5取余===0不用置0）
        }
      }
      //console.log(`countVersion: ${countVersion}`);
      //break; //这里加个break用于测试，这样只用遍历一次(这里只跳出了内层循环，每次获取有效package后都来一次获取action-bump-version的first:1，然后再push进数组)
    }
    //break; //测试action-bump-version的所有version能否正常遍历（这个目前包最多）
    countPackage++;
    console.log(`当前package: ${package_name}`);
    console.log(`countPackage: ${countPackage}`);
  }
  if (sendFlag === false) {
    sendFlag = true; //标记为已发送
    exports.airtableOfferedMethod(traversalResult, argv); //调用发送
    traversalResult = []; //清空数组
  }
  return backUpTraversalMessage; //用于返回return，这里的返回值到了index.js的调用参数 const traversalMessage中，最后用于输出setOutput
  //console.log(JSON.stringify(traversalResult)); //用于控制台输出最终结果
  console.log(traversalResult.length); //用于测试数组长度看看遍历能否进入下一页
  //const storeTraversalResult = JSON.stringify(traversalResult);
  //const storeTraversalResult = traversalResult + '';
  //exports.sendMessageToAirtable(storeTraversalResult);
  //exports.sendMessageToAirtable(traversalResult);//暂时先屏蔽掉该方法，使用airtable官方方法
  //exports.airtableOfferedMethod(storeTraversalResult);
  //exports.airtableOfferedMethod(traversalResult); //看起来似乎并不需要在这里string化
};

/*
//exports.traversalMessage = async function (octokit) {
exports.traversalMessage = async function (argv) {
  const octokit = github.getOctokit(argv.token);
  let countVersion = 0; //该变量用于存储当前位置 //存储数组内有效数据量，方便判别是否该发送
  let countPackage = 0; //store steps of for-loops
  let countSend = 0; //store send times
  let sendFlag = false; //用于标记是否发送了
  let traversalResult = []; //该变量用于每次发送前存储json信息
  let backUpTraversalMessage = []; //该变量用于存储所有json信息用于返回（return）
  for await (const graphPackage of traversalPackagesGraphQL(octokit)) {
    const package_name = graphPackage.name;
    const repository_name = graphPackage.repository.name; //如果通过下方判别函数则这俩参数用于后续查询versions
    if (graphPackage.latestVersion === null) {
      console.log(`跳过package: ${package_name}`);
      continue;
    } //package没有最新版本意味着被删除，所以跳过（之前想用提取前缀来判断的方法，但是不保证未来没有deleted开头的package，所以放弃）
    for await (const graphVersion of traversalVersionsGraphQL(
      octokit,
      package_name,
      repository_name
    )) {
      const version_name = graphVersion.version;
      /*const tempStoreResult = {
        version: version_name,
        package: package_name,
        repo: repository_name,
      };*/ /*
      //暂时将变量名删去，看看是否还需要做引号的转义
      //当然也有可能，json定义出错，直接跑失败了
      const tempStoreResult = {
        version_name,
        package_name,
        repository_name,
      };
      //exports.airtableOfferedMethod(tempStoreResult);
      //如果直接传，会达到每秒5次的接口使用率上限，同时还会产生超级多条记录，不便于处理（当然接口上限也好解决，每5条等1s后再发送下5条）
      traversalResult.push(tempStoreResult);
      backUpTraversalMessage.push(tempStoreResult); //这里也存一份
      /*const number = 5;
      let cur_num = 0;
      cur_num += 1;
      if(cur_num % number == 0) {
        sleep(1000);
      }*/ /*
      countVersion++; //每50条传送一次
      sendFlag = false;
      if (countVersion % 50 === 0) {
        countVersion = 0; //置0
        exports.airtableOfferedMethod(traversalResult,argv); //调用发送
        sendFlag = true; //提示已发送
        traversalResult = []; //清空数组
        countSend++; //发送次数加一
        if (countSend === 5) {
          countSend = 0; //发送次数置0
          sleep(1000); //休眠1000ms，也就是1s
          //emmm,置0操作可以用取余来替代（比如===5然后置0等价于对5取余===0不用置0）
        }
      }
      //console.log(`countVersion: ${countVersion}`);
      //break; //这里加个break用于测试，这样只用遍历一次(这里只跳出了内层循环，每次获取有效package后都来一次获取action-bump-version的first:1，然后再push进数组)
    }
    //break; //测试action-bump-version的所有version能否正常遍历（这个目前包最多）
    countPackage++;
    console.log(`当前package: ${package_name}`);
    console.log(`countPackage: ${countPackage}`);
  }
  if (sendFlag === false) {
    sendFlag = true; //标记为已发送
    exports.airtableOfferedMethod(traversalResult,argv); //调用发送
    traversalResult = []; //清空数组
  }
  return backUpTraversalMessage; //用于返回return，这里的返回值到了index.js的调用参数 const traversalMessage中，最后用于输出setOutput
  //console.log(JSON.stringify(traversalResult)); //用于控制台输出最终结果
  console.log(traversalResult.length); //用于测试数组长度看看遍历能否进入下一页
  //const storeTraversalResult = JSON.stringify(traversalResult);
  //const storeTraversalResult = traversalResult + '';
  //exports.sendMessageToAirtable(storeTraversalResult);
  //exports.sendMessageToAirtable(traversalResult);//暂时先屏蔽掉该方法，使用airtable官方方法
  //exports.airtableOfferedMethod(storeTraversalResult);
  //exports.airtableOfferedMethod(traversalResult); //看起来似乎并不需要在这里string化
};
*/
//下方为发送遍历数据到airtable
const request = require("request");
const { waitForDebugger } = require("inspector");
//这里引入request
exports.sendMessageToAirtable = async function (traversalResult) {
  //const messageToAirtable = JSON.stringify(traversalResult);
  console.log(typeof traversalResult);
  //const param = '"' + `${traversalResult}` + '"';
  //const param = '"' + traversalResult + '"';
  //const param = traversalResult + ''; //要注意yarn build后会变为‘’
  const param = JSON.stringify(traversalResult); //string化
  console.log(typeof param);
  console.log(param);
  //console.log(traversalResult);
  let stringBodyStore = {
    records: [
      {
        fields: {
          store: `${param}`,
        },
      },
    ],
  };
  //stringBodyStore.store = stringBodyStore.store + "";
  //console.log(stringBodyStore.records[0].fields.store); //输出一下string之前的store值
  //stringBodyStore.records[0].fields.store = stringBodyStore.records[0].fields.store.toString();//这是一种方法
  //console.log(stringBodyStore.records[0].fields.store); //输出一下string之前的store值
  stringBodyStore.records[0].fields.store =
    stringBodyStore.records[0].fields.store + ""; //这是另外一种方法
  //当然还要考虑是否需要前后加比如'"'+store+'"'(这样还可以摆脱yarn build的影响)
  console.log(stringBodyStore.records[0].fields.store); //输出一下string后的store值
  let options = {
    method: "POST",
    url: "https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201",
    headers: {
      Authorization: "Bearer keyV2K62gr8l53KRn",
      "Content-Type": "application/json",
      Cookie: "brw=brwjmHKMyO4TjVGoS",
    },
    //body: JSON.stringify(stringBodyStore),
    //body: `${stringBodyStore}`,
    body: stringBodyStore,
  }; //在stringify之前先tostring
  //之前这里多了一个右花括号，导致后面的一直是undefined。。。（神奇的是居然没有报格式错误。。。）
  request(options, function (error, response) {
    if (error) throw new Error(error);
    console.log(response.body); //输出返回的body
    console.log(error); //加了一个输出错误类型
  });
  process.on("unhandledRejection", (reason, p) => {
    console.log("Promise: ", p, "Reason: ", reason);
    // do something
    //这里用来解决UnhandledPromiseRejectionWarning的问题
  });
  /*
  const options = {
    'method': 'POST',
  'url': 'https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201',
  'headers': {
    'Authorization': 'Bearer keyV2K62gr8l53KRn',
    'Content-Type': 'application/json',
    'Cookie': 'brw=brwjmHKMyO4TjVGoS'
  },
  body: JSON.stringify({
    "records": [
      {
        "fields": {
          "store": `${param}`
        }
      }
    ]
  })
  };*/
  /* 'method': 'POST',
  'url': 'https://api.airtable.com/v0/appd2XwFJcQWZM8fw/Table%201',
  'headers': {
    'Authorization': 'Bearer keyV2K62gr8l53KRn',
    'Content-Type': 'application/json',
    'Cookie': 'brw=brwjmHKMyO4TjVGoS'
  },
  body: JSON.stringify({
    "records": [
      {
        "fields": {
          "store": "{111}\n"
        }
      }
    ]
  })
*/
};
exports.airtableOfferedMethod = async function (traversalResult, argv) {
  //exec('npm', ['install', '-g', 'airtable']); //使用exec调用npm指令安装airtable，这样require时不会出错
  //将"-g"改为"--loacation=global"修改前提示如下npm WARN config global `--global`, `--local` are deprecated. Use `--location=global` instead
  //在package.json中的dependencies下指定airtable及版本号，这样就不需要exec了。
  const Airtable = require("airtable"); //引入airtable
  /*const base = new Airtable({ apiKey: "keyV2K62gr8l53KRn" }).base(
    "appd2XwFJcQWZM8fw"
  ); //声明一些必要的信息*/
  //这里将apiKey及base信息隐藏在action.yml中通过argv来传输
  const base = new Airtable(argv.apiKey).base(argv.base);
  const storeStringify = JSON.stringify(traversalResult); //这里先string化，然后下方使用encodeURI进行编码，收到后使用decodeURI进行解码
  //const storeEncodeURI = encodeURI(storeStringify); //这里存储编码结果（编码就是除了数字、字母外的都转义）
  const storeReplace = storeStringify.replace(/"/g, '\\"'); //使用正则表达式进行替换（这里要用\\"，如果只用一个\则看不到变化）
  //这里仍然接收不到的原因会不会是字符串首尾的也被转义了，输出测试一下。
  const storeBody = '"' + storeReplace + '"'; //首尾添加引号
  //const storeBody = '"' + storeReplace + '"'; //这个不能被prase
  //console.log(storeBody); //测试一下输出结果，满足要求
  let store_origin = storeBody; //自己传自己
  console.log(typeof store);
  //store": store,
  base("origin-data").create(
    {
      store_origin: store_origin,
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
  /*base("Table 1").create(
    {
      store: store,
    },
    { typecast: true },
    function (err, record) {
      if (err) {
        console.error(err);
        return;
      }
      console.log(record.getId());
    }
  );*/
  /*base('Table 1').create({
    "store": storeBody
  }, function(err, record) {
    if (err) {
      console.error(err);
      return;
    }
    console.log(record.getId());
  });*/
  /*base('Table 1').create(
    [
      {
        fields: {
          store: storeBody,
        },
      },
    ],
    function (err, records) {
      if (err) {
        console.error(err);
        return;
      }
      records.forEach(function (record) {
        console.log(record.getId());
      });
    },
  );*/
  process.on("unhandledRejection", (reason, p) => {
    console.log("Promise: ", p, "Reason: ", reason);
    // do something
    //这里用来解决UnhandledPromiseRejectionWarning的问题
  });
}; //add await before base.create
//下方为进一步深加工信息的功能组成（因为存在airtable的scripting性能瓶颈的可能性，所以在这里进行预处理,符合要求的再发送）
async function* traversalRepoRefsGraphQL(octokit, repository_name) {
  //该函数提取来所有dev分支的后缀
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
  for (const graphPostFix of graphRefs.repository.refs.edeges[0].nodes) {
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
    for (const graphPostFix of graphRefs.repository.refs.edeges[0].nodes) {
      yield graphPostFix;
    }
  }
} //遍历repo所有分支的后缀获取大版本号
//下方用于遍历后缀数组和version数组进行匹配，找到我们想要的版本后并返回
async function* comparePostFixAndVersions(postFixArray, versionsArray) {
  //const postFixArrayLength = postFixArray.length;//存储后缀数组长度
  //const versionsArrayLength = versionsArray.length;//存储版本数组长度
  let matchedVersions = []; //存储匹配成功的versions
  let tempStoreMatchedVersion = versionsArray[0]; //临时存储匹配到的version，初始化为第一个元素
  let matchedFlag = false; //是否匹配成功的标志，初始化为0
  for (let varInPostFixArray of postFixArray) {
    const varLength = varInPostFixArray.length; //存储元素长度
    for (let varInVersionArray of versionsArray) {
      const tempStoreSubString = varInVersionArray.subString(0, varLength); //提取version的前缀
      if (varInPostFixArray === tempStoreSubString) {
        matchedFlag = true; //匹配成功
        tempStoreMatchedVersion = varInVersionArray; //存储version全称
      }
    }
    if (matchedFlag === true) {
      matchedVersions.push(tempStoreMatchedVersion); //将最终匹配到的存入数组中
      matchedFlag = false; //置为false
    } //每一个大版本遍历版本数组进行前缀匹配，并将匹配成功的结果存入数组中
  }
  return matchedVersions;
}
