/* eslint-disable no-restricted-globals */
const github = require("@actions/github");
const fs = require("fs"); //filesystem文件系统
const path = require("path"); //这个路径是啥，看起来是被引入的
const { Octokit } = require("@octokit/core"); //Extendable client for GitHub's REST & GraphQL APIs
const {
  restEndpointMethods,
} = require("@octokit/plugin-rest-endpoint-methods"); //rest终端方法
const { count } = require("console");
//graphQL是否需要被引入

const getOctokit = (token) => {
  const _Octokit = Octokit.plugin(restEndpointMethods);
  return new _Octokit({ auth: token });
}; //octokit

async function* traversalPackagesRest(octokit) {
  //循环遍历获取所有package的rest方法
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
