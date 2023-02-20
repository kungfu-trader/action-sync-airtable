const { Octokit } = require("@octokit/rest"); 
const axios = require("axios");

exports.getPrWithRest = async function (argv) {
    const octokit = new Octokit({
        auth: `${argv.token}`,
      }); 
    console.log("start get pr");
    let hasNextPage = false; //是否有下一页，初始化为假
    let currentPage = 1; //当前页，初始化为1 
    const maxPerPage = 100; 
    const repoList = new Map();
    while(true){
        const repos = await octokit.rest.repos.listForOrg({
            org: "kungfu-trader",
            per_page: maxPerPage,
            page: currentPage
          });
        repos.data.forEach(it =>{
            // repoList.push(it.name);
            // console.log(it.name, " .  ", it.owner.login);
            repoList.set(it.name, it.owner.login);
        });
        if(repos.data.length < maxPerPage) {
            break;
        }
        currentPage++;
    }
    console.log(`repo numbers: ${repoList.size}`);
    for(const [repoName, owner] of repoList){
        console.log(repoName, " .  ", owner);
        const pulls = await octokit.rest.pulls.list({
            state: "all",
            owner: owner,
            repo: repoName,
            pull_number: 1
          });
        console.log(pulls.data[0]);
        axios.post('https://hooks.zapier.com/hooks/catch/14417843/3ybdcab/', {
            "pull_request": pulls.data[1]
        }).then(resp =>{
            console.log(resp.data)
        }).catch(err =>{
            console.error(err)
        });
        
        break;

    }

    

    
}
 
exports.getPrWithGraphQL = async function (argv) {
    const octokit = new Octokit({
        auth: `${argv.token}`,
      }); 
    console.log("start get pr");
    let endCursor = null;
    let hasNextPage = true;
    while(hasNextPage) {
        let graphRefs = await octokit.graphql(`
    query{
        organization(login: "kungfu-trader") {
            repositories(first: 20, after: ${endCursor}) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  name
                  pullRequests(last: 2) {
                    nodes {
                      url
                      state
                    }
                  }
                }
              }
            }
        }
    }
        `);
        hasNextPage = graphRefs.organization.repositories.pageInfo.hasNextPage;
        endCursor = "\""+ graphRefs.organization.repositories.pageInfo.endCursor + "\"";
        
        const prs = graphRefs.organization.repositories.edges[0].node.pullRequests;
        // console.log(`prs = ${prs}`)
        if(prs && prs.nodes.length > 0) {
        console.log(prs);

        }
        // break;
    }
}