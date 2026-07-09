# Transfer Connect Remote Logs Skill

Use this skill when the user asks to inspect, retrieve, grep, tail, count, or search logs from the remote Transfer Connect core server or the FEC proxy server.

## Skill Metadata

- Name: `Transfer Connect Remote Logs`
- Description: Retrieve and search Transfer Connect core and FEC proxy logs through the `tide.company` SSH bastion.
- Suggested allowed tools: `Bash(ssh:*)`, `Bash(find:*)`, `Bash(grep:*)`, `Bash(tail:*)`, `Bash(head:*)`, `Bash(awk:*)`, `Bash(sed:*)`, `Bash(wc:*)`, `Bash(sort:*)`, `Bash(uniq:*)`, `Bash(timeout:*)`

## Connection

- Bastion host: `ubuntu@tide.company`
- Core target host: `transferconnect@10.212.31.10`
- FEC proxy target host: `transferconnect@10.212.30.10`
- Preferred route from this PC: SSH `ProxyJump` through the bastion. This is the reusable tunnel path.
- Core app root on target: `/home/transferconnect/app-files/transfer-connect-core`
- Core log directory on target: `/home/transferconnect/app-files/transfer-connect-core/logs`
- FEC proxy app root on target: `/home/transferconnect/app-files/fec-proxy`
- FEC proxy log directory on target: `/home/transferconnect/app-files/fec-proxy/logs`

Use this base command shape for core remote shell work:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'REMOTE_COMMAND'
```

Use this base command shape for FEC proxy remote shell work:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 'REMOTE_COMMAND'
```

If `ProxyJump` fails, use the nested-hop fallback:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 ubuntu@tide.company 'ssh -o BatchMode=yes -o ConnectTimeout=10 transferconnect@TARGET_IP "REMOTE_COMMAND"'
```

## Proof Of Connectivity

Before investigating core logs in a new session, run a bounded proof of connectivity:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'hostname; test -d /home/transferconnect/app-files/transfer-connect-core/logs && find /home/transferconnect/app-files/transfer-connect-core/logs -maxdepth 1 -type f -name "*.log" | wc -l'
```

Before investigating FEC proxy logs in a new session, run a bounded proof of connectivity:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 'hostname; test -d /home/transferconnect/app-files/fec-proxy/logs && find /home/transferconnect/app-files/fec-proxy/logs -maxdepth 1 -type f -name "*.log" | wc -l'
```

Known working POC from 2026-07-09:

- First hop reached `tide-server`
- Core target reached `dellr720-transferspei-core-uat`
- Core log directory returned 157 `.log` files
- Live `grep` counts worked against `/home/transferconnect/app-files/transfer-connect-core/logs/transfer-connect-core.log`
- FEC proxy target reached `dellr720-transferspei-front-uat`
- FEC proxy log directory returned 57 `.log` files
- Live `grep` counts worked against `/home/transferconnect/app-files/fec-proxy/logs/fec-proxy.log`

## Log Families

The core directory contains current and rotated logs. Current core logs are normally:

- `transfer-connect-core.log` for main application/API activity
- `transfer-connect-core.h2h.log` for H2H activity
- `transfer-connect-core.paymentOrders.log` for payment order activity
- `transfer-connect-core.usersActivity.log` for user activity

Core rotated logs usually include date suffixes, for example:

- `transfer-connect-core-YYYY-MM-DD.N.log`
- `transfer-connect-core.h2h-YYYY-MM-DD.N.log`
- `transfer-connect-core.paymentOrders-YYYY-MM-DD.N.log`
- `transfer-connect-core.usersActivity-YYYY-MM-DD.N.log`

The FEC proxy directory contains:

- `fec-proxy.log` for current FEC proxy activity
- `fec-proxy-YYYY-MM-DD.N.log` for rotated FEC proxy logs
- `journals/` for journal-style supporting logs, when present

## Safety Rules

- Prefer targeted `grep`, `find`, `tail`, `head`, `awk`, and `sed` commands over copying whole logs.
- Do not run unbounded `tail -f`; use `timeout 30 tail -F ...` or another explicit limit.
- Do not paste secrets, tokens, full payloads, or credentials back to the user. Summarize sensitive lines and include only the fields needed for debugging.
- Use `grep -F` for literal IDs or request tokens, and `grep -E` only when a regex is needed.
- Quote remote commands carefully. For complex searches, put the whole remote command inside single quotes and use double quotes inside it.
- Keep searches server-side. Pull back counts, matching snippets, or compact summaries rather than large files.
- If a command fails because of SSH auth, host key, or network reachability, stop and report the exact failure.

## Command Cookbook

List recent log files by modification time:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'cd /home/transferconnect/app-files/transfer-connect-core/logs && find . -maxdepth 1 -type f -name "*.log" -printf "%TY-%Tm-%Td %TH:%TM %10s %f\n" | sort | tail -40'
```

Count current main-log request completions and errors:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'cd /home/transferconnect/app-files/transfer-connect-core/logs && printf "REQUEST COMPLETED "; grep -c "REQUEST COMPLETED" transfer-connect-core.log || true; printf "ERROR "; grep -c "ERROR" transfer-connect-core.log || true'
```

Search for a literal request id, trace id, account id, or other exact token across all current and rotated logs:

```bash
TOKEN='PUT_LITERAL_TOKEN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -RInF -- '$TOKEN' . | tail -100"
```

Search a specific date in the main application logs:

```bash
DATE='2026-07-09'
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -nF -- '$PATTERN' transfer-connect-core-$DATE*.log transfer-connect-core.log 2>/dev/null | tail -100"
```

Search only payment order logs:

```bash
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -nF -- '$PATTERN' transfer-connect-core.paymentOrders*.log 2>/dev/null | tail -100"
```

Search only H2H logs:

```bash
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -nF -- '$PATTERN' transfer-connect-core.h2h*.log 2>/dev/null | tail -100"
```

Search only user activity logs:

```bash
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -nF -- '$PATTERN' transfer-connect-core.usersActivity*.log 2>/dev/null | tail -100"
```

Find errors around a time window in the current main log:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'cd /home/transferconnect/app-files/transfer-connect-core/logs && awk '"'"'$0 >= "2026-07-09 11:30:00" && $0 <= "2026-07-09 11:45:00" && /ERROR|WARN|Exception|REQUEST COMPLETED/'"'"' transfer-connect-core.log | tail -200'
```

Follow the main log for a bounded time:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'cd /home/transferconnect/app-files/transfer-connect-core/logs && timeout 30 tail -F transfer-connect-core.log'
```

Get context around a match:

```bash
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 "cd /home/transferconnect/app-files/transfer-connect-core/logs && LC_ALL=C grep -RInF -C 3 -- '$PATTERN' transfer-connect-core*.log 2>/dev/null | tail -200"
```

Summarize recent HTTP status codes from request-completion lines:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.31.10 'cd /home/transferconnect/app-files/transfer-connect-core/logs && grep "REQUEST COMPLETED" transfer-connect-core.log | awk '"'"'{for (i=1; i<=NF; i++) if ($i ~ /^status=/) print $i}'"'"' | sort | uniq -c | sort -nr'
```

List recent FEC proxy log files by modification time:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 'cd /home/transferconnect/app-files/fec-proxy/logs && find . -maxdepth 1 -type f -name "*.log" -printf "%TY-%Tm-%Td %TH:%TM %10s %f\n" | sort | tail -40'
```

Count current FEC proxy warnings and errors:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 'cd /home/transferconnect/app-files/fec-proxy/logs && printf "WARN "; grep -c "WARN" fec-proxy.log || true; printf "ERROR "; grep -c "ERROR" fec-proxy.log || true'
```

Search all current and rotated FEC proxy logs for a literal token:

```bash
TOKEN='PUT_LITERAL_TOKEN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 "cd /home/transferconnect/app-files/fec-proxy/logs && LC_ALL=C grep -RInF -- '$TOKEN' fec-proxy*.log 2>/dev/null | tail -100"
```

Search a specific date in FEC proxy logs:

```bash
DATE='2026-07-09'
PATTERN='PUT_LITERAL_PATTERN_HERE'
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 "cd /home/transferconnect/app-files/fec-proxy/logs && LC_ALL=C grep -nF -- '$PATTERN' fec-proxy-$DATE*.log fec-proxy.log 2>/dev/null | tail -100"
```

Follow FEC proxy logs for a bounded time:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 -J ubuntu@tide.company transferconnect@10.212.30.10 'cd /home/transferconnect/app-files/fec-proxy/logs && timeout 30 tail -F fec-proxy.log'
```

## Response Pattern

When reporting results to the user:

- State which host and log files were searched.
- State the exact time window or token used.
- Give counts first, then representative snippets if needed.
- Keep snippets short and redact sensitive payload fields.
- If no matches are found, say exactly which file glob and date range were checked.
