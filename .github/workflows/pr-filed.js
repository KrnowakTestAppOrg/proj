module.exports = ({context, github}) => {
    (async () => {
  const bot_name = "krnowak-test-bot"
  let time_desc_re = /^\s*(\d+)([wdh])\s*$/
  let date_desc_re = /^\s*(\d{4}-\d{2}-\d{2})\s*$/
  // parse body for commands
  console.log(`${context}`)
  const body = context.payload.pull_request.body
  const { data: pr } = await github.pulls.get({
    owner: context.repo.owner,
    repo: context.repo,
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
        repo: context.repo,
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
    propagate_branches.push["beta"].allowed = true
    // fallthrough
  case "flatcar-master-beta":
    propagate_branches.push["stable"].allowed = true
    // fallthrough
  }
  const lines = body.split("\n")
  // @<bot>: propagate branch_desc date_spec
  // @<bot>: ignore
  // @flatcar-bot: beta 2w, stable 1w
  // branch_desc: alpha, beta, stable
  // date_spec: nope, asap, \d+[mwd] (month, week, day), yyyy-mm-dd
  const prefix = `@${bot_name}: `
  let messages = []
  let break_out = false
  for (let line of lines) {
    if (!line.startsWith(prefix)) {
      continue
    }
    line = line.slice(prefix.length)
    const [cmd, ...rest] = line.split(" ")
    let do_next = false
    switch (cmd) {
    case "ignore":
      messages = []
      break_out = true
      break
    case "propagate":
      break
    default:
      messages.push(`Unknown command "${cmd}" in line "${line}". Ignoring.`)
      do_next = true
      break
    }
    if (break_out) {
      break
    }
    if (do_next) {
      continue
    }
    const periods = rest.join(" ").split(",")
    for (let period of periods) {
      const words = period.split(" ")
      if (words.length != 2) {
        messages.push(`"${period}" is not a valid propagation command. Ignoring.`)
        continue
      }
      const branch_desc = words[0].trim()
      if (!(branch_desc in s2l_branch_map)) {
        messages.push(`"${branch_desc}" in "${period}" is not a valid branch description. Allowed branch descriptions are "alpha", "beta" or "stable". Ignoring.`)
        continue
      }
      if (!propagate_branches[branch_desc].available) {
        messages.push(`"${branch_desc}" (${s2l_branch_map[branch_desc]}) in "${period}" is not available in the repo. Ignoring.`)
        continue
      }
      if (!propagate_branches[branch_desc].allowed) {
        messages.push(`"${branch_desc}" in "${period}" is not a valid branch description to propagate to from "${l2s_branch_map[target_branch]}" (${target_branch}). Ignoring.`)
        contunue
      }
      if (propagate_branches[branch_desc].specified) {
        messages.push(`"${branch_desc}" in "${period}" was already specified once. Ignoring.`)
        continue
      }
      propagate_branches[branch_desc].specified = true
      const time_desc = words[1].trim()
      if (time_desc === "asap") {
        messages.push(`Will propagate the changes to ${branch_desc} as soon as possible after this PR is merged.`)
      } else if (time_desc === "nope") {
        messages.push(`Will not propagate the changes to ${branch_desc}.`)
      } else {
        let match = time_desc.match(time_desc_re)
        if (match === null) {
          match = time_desc.match(date_desc_re)
          if (match === null || match.length !== 2) {
            messages.push(`"${time_desc}" in "${period}" is an invalid time description. Should be a number followed by either w (for weeks), d (for days) or h (for hours) or a date in format yyyy-mm-dd. Ignoring.`)
            continue
          }
          messages.push(`Will cherry pick the commits to ${branch_desc} on ${match[1]}.`)
        } else {
          if (match.length !== 3) {
            messages.push(`"${time_desc}" in "${period}" is an invalid time description. Should be a number followed by either w (for weeks), d (for days) or h (for hours) or a date in format yyyy-mm-dd. Ignoring.`)
            continue
          }
          let time_unit = ""
          switch (match[2]) {
          case "m":
            time_unit = "month"
            break
          case "w":
            time_unit = "week"
            break
          case "d":
            time_unit = "day"
            break
          }
          if (match[1] != 1) {
            time_unit = `${time_unit}s`
          }
          messages.push(`Will cherry pick the commits to ${branch_desc} in ${match[1]} ${time_unit} after this PR is merged.`)
        }
      }
    }
  }
  if (!break_out) {
    for (let branch_desc in propagate_branches) {
      if (propagate_branches[branch_desc].available && propagate_branches[branch_desc].allowed && !propagate_branches[branch_desc].specified) {
        messages.push(`Did not specify the propagation to "${branch_desc}" (${s2l_branch_map[branch_desc]}).`)
      }
    }
    github.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo,
      issue_number: context.payload.pull_request.number,
      body: messages.join("\n"),
    })
  }
    })();
}
