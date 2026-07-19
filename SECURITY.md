# Security Policy

Local Ops executes user-configured commands and SSH tunnels. Treat it as a privileged local developer tool, even though it does not require root access for ordinary operation.

## Supported versions

Security fixes are provided for the latest release. Upgrade before reporting an issue that only affects an older build.

## Reporting a vulnerability

Do not open a public issue containing an exploit, token, private hostname, SSH key path, or sensitive log output. Use GitHub's **Report a vulnerability** / private security advisory flow for this repository. Include the affected version, impact, reproduction steps, and a minimal proof of concept with secrets removed.

## Security boundaries

- Keep ports `19080`, `19090`, `19091`, `19092`, and `19093` on loopback interfaces only.
- The optional port 80 rule must remain limited to `lo0`, `127.0.0.1`, and `::1`.
- Never publish the console through a public Caddy route, Cloudflare Tunnel, ngrok, a router port forward, or a similar service.
- Never commit `config/catalog.json`, `config/process-compose.token`, `.env` files, runtime logs, or private keys.
- SSH private keys are referenced by path only. They must not be copied into the project, exported configuration, or application bundle.
- Electron must keep `nodeIntegration` disabled, `contextIsolation` enabled, sandboxing enabled, navigation restricted, and permissions denied by default.
- Reverse-proxy targets and SSH local listeners must stay on loopback addresses.
- Web mutations must retain their temporary-token and request-origin checks.

If a local API token enters Git history, rotate `config/process-compose.token` immediately and remove the old value from the repository history. If an SSH key is exposed, revoke and replace the key rather than only deleting the file.

## 中文说明

Local Ops 能执行用户配置的本机命令和 SSH 隧道，因此必须始终作为本机工具使用。不要把控制台或 `19080`、`19090`、`19091`、`19092`、`19093` 端口暴露到局域网或公网；不要提交真实配置、API 密钥、环境变量、日志或 SSH 私钥。发现安全问题时请使用 GitHub 私密安全报告，不要在公开 Issue 中粘贴敏感信息。
