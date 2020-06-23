module.exports = ({context, github}) => {
    (async () => {
        // configured stuff
        const bot_name = "krnowak-test-bot"
        const central_repo_owner = "KrnowakTestAppOrg"
        const central_repo_repo = "central"
        const central_pending_column_id = 9618257
        try {
            await github.pulls.checkIfMerged({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: context.payload.pull_request.number,
            })
        } catch (error) {
            console.log(`PR closed, skipping`, error)
            return
        }
        let time_desc_re = /^\s*(\d+)([wdh])\s*$/
        let date_desc_re = /^\s*((\d{4})-(\d{1,2})-(\d{1,2}))\s*$/
        let issue_number_re = /^\s*(\d+)\s*$/
        // parse body for commands
        const body = context.payload.pull_request.body
        const { data: pr } = await github.pulls.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: context.payload.pull_request.number,
        })
        let s2l_branch_map = {
            "alpha": "flatcar-master-alpha",
            "beta": "flatcar-master-beta",
            "stable": "flatcar-master",
        }
        let l2s_branch_map = {
            "flatcar-master-alpha": "alpha",
            "flatcar-master-beta": "beta",
            "flatcar-master": "stable",
        }
        let propagate_branches = {}
        for (let key in s2l_branch_map) {
            propagate_branches[key] = {
                "available": false, // does the project have this branch?
                "allowed": false, // is it allowed to propagate to this branch?
                "specified": false, // was it already specified in the bot command?
            }
        }
        {
            const per_page = 100
            let page = 0
            while (1) {
                // page numbering is 1-based, so we increment it before doing the call
                page++
                const { data: branches } = await github.repos.listBranches({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    page: page,
                    per_page: per_page,
                })
                for (let branch of branches) {
                    if (branch.name in l2s_branch_map) {
                        propagate_branches[l2s_branch_map[branch.name]].available = true
                    }
                }
                if (branches.length < per_page) {
                    break
                }
            }
        }
        const target_branch = pr.base.ref
        switch (target_branch) {
        case "flatcar-master-edge":
            propagate_branches["alpha"].allowed = true
            // fallthrough
        case "flatcar-master-alpha":
            propagate_branches["beta"].allowed = true
            // fallthrough
        case "flatcar-master-beta":
            propagate_branches["stable"].allowed = true
            // fallthrough
        }
        const lines = body.split("\n")
        // @<bot>: propagate branch_desc date_spec
        // @<bot>: ignore
        // @flatcar-bot: beta 2w, stable 1w
        // branch_desc: alpha, beta, stable
        // date_spec: nope, asap, \d+[mwd] (month, week, day), yyyy-mm-dd
        const prefix = `@${bot_name}:`
        let issues = {
            owner: context.repo.owner,
            repo: context.repo.repo,
            pr: context.payload.pull_request.number,
            branches: [], // { name: , date: , }
            commits: [],
        }
        let closings = []
        for (let line of lines) {
            if (!line.startsWith(prefix)) {
                console.log(line, "not a command line")
                continue
            }
            line = line.slice(prefix.length)
            line = line.trim()
            const [cmd, ...rest] = line.split(/\s+/)
            if (cmd === "ignore") {
                console.log("ignore command spotted")
                return
            }
            if (cmd === "close") {
                if (rest.length !== 1) {
                    console.log(`close command invalid`)
                    continue
                }
                let match = rest[0].match(issue_number_re)
                if (match === nil || match.length !== 2) {
                    console.log(`"${issue_number}" in close command is not a number`)
                    continue
                }
                const issue_number = match[1]
                closings.push(issue_number)
                continue
            }
            if (cmd === "propagate") {
                console.log("propagate line spotted")
                const periods = rest.join(" ").split(",")
                for (let period of periods) {
                    period = period.trim()
                    const words = period.split(/\s+/)
                    if (words.length !== 2) {
                        console.log(`${period} invalid`)
                        continue
                    }
                    const branch_desc = words[0].trim()
                    if (!(branch_desc in s2l_branch_map)) {
                        console.log(`${branch_desc} invalid`)
                        continue
                    }
                    if (!propagate_branches[branch_desc].available) {
                        console.log(`${branch_desc} unavailable`)
                        continue
                    }
                    if (!propagate_branches[branch_desc].allowed) {
                        console.log(`${branch_desc} not allowed`)
                        continue
                    }
                    if (propagate_branches[branch_desc].specified) {
                        console.log(`${branch_desc} already specified`)
                        continue
                    }
                    propagate_branches[branch_desc].specified = true
                    const time_desc = words[1].trim()
                    let date = new Date()
                    date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
                    if (time_desc === "asap") {
                        // TODO: file PRs immediately?
                    } else if (time_desc === "nope") {
                        console.log(`${branch_desc} not to be propagated`)
                        continue
                    } else {
                        let match = time_desc.match(time_desc_re)
                        if (match === null) {
                            match = time_desc.match(date_desc_re)
                            if (match === null || match.length !== 5) {
                                console.log(`${time_desc} matched no regexps`)
                                continue
                            }
                            const year = parseInt(match[2], 10)
                            const month = parseInt(match[3], 10)
                            const day = parseInt(match[4], 10)
                            // months are zero-based in Date, but we
                            // use 1-based in our messages
                            date = new Date(year, month-1, day, 12)
                            if ((date.getFullYear() !== year) || (date.getMonth() !== month-1) || (date.getDate() !== day)) {
                                console.log(`${time_desc} has bogus date (actually ${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()})`)
                                continue
                            }
                        } else {
                            if (match.length !== 3) {
                                console.log(`${time_desc} short desc invalid?`)
                                continue
                            }
                            switch (match[2]) {
                            case "m":
                                date.setMonth(date.getMonth() + parseInt(match[1], 10))
                                break
                            case "w":
                                date.setDate(date.getDate() + parseInt(match[1], 10) * 7)
                                break
                            case "d":
                                date.setDate(date.getDate() + parseInt(match[1], 10))
                                break
                            }
                        }
                    }
                    console.log(`pushing ${s2l_branch_map[branch_desc]} and ${date}`)
                    issues.branches.push({
                        name: s2l_branch_map[branch_desc],
                        date: date,
                    })
                }
                continue
            }
        }
        if (issues.branches.length > 0) {
            let page = 0
            let per_page = 100
            while (1) {
                // page numbering is 1-based, so we increment it
                // before doing the call
                page++
                const { data: commits } = await github.pulls.listCommits({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    pull_number: context.payload.pull_request.number,
                    per_page: per_page,
                    page: page,
                })
                // TODO: I'm not sure if this returns commits sorted
                // by parents.
                for (let commit of commits) {
                    issues.commits.push(commit.sha)
                }
                if (commits.length < per_page) {
                    break
                }
            }
            for (let branch of issues.branches) {
                let body = [
                    `owner: ${issues.owner}`,
                    `repo: ${issues.repo}`,
                    `original-pr: ${issues.pr}`,
                    `branch: ${branch.name}`,
                    `date: ${branch.date.getFullYear()}-${branch.date.getMonth()+1}-${branch.date.getDate()}`,
                    `commits:`,
                    ...issues.commits,
                ]
                const { data: issue } = await github.issues.create({
                    owner: central_repo_owner,
                    repo: central_repo_repo,
                    title: `Propagate PR ${issues.pr} from ${issues.owner}/${issues.repo} to ${branch.name}`,
                    body: body.join("\n"),
                })
                await github.projects.createCard({
                    column_id: central_pending_column_id,
                    content_id: issue.id,
                    content_type: "Issue",
                })
            }
        }
        for (let issue_number of closings) {
            await github.issues.update({
                owner: central_repo_owner,
                repo: central_repo_repo,
                issue_number: issue_number,
                state: "closed",
            })
        }
    })();
}
