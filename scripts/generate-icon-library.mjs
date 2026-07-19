import fs from "node:fs";
import path from "node:path";
import * as simpleIcons from "simple-icons";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "public", "icon-library.js");
const bySlug = new Map(
  Object.values(simpleIcons)
    .filter((icon) => icon && typeof icon === "object" && icon.slug && icon.path)
    .map((icon) => [icon.slug, icon])
);

const generic = [
  icon("localops", "Local Ops", "通用", "0B7F5A", '<path d="M5 14h3v5H5v-5Zm5-9h3v14h-3V5Zm5 5h3v9h-3v-9Z" fill="currentColor"/>', ["控制台", "dashboard"]),
  icon("server", "服务器", "通用", "3568D4", '<path d="M4 5h16v6H4V5Zm2 2v2h12V7H6Zm-2 6h16v6H4v-6Zm2 2v2h12v-2H6Zm1-7h2v1H7V8Zm0 8h2v1H7v-1Z" fill="currentColor"/>', ["service", "host", "vps"]),
  icon("terminal", "终端", "通用", "34443C", '<path d="M3 5h18v14H3V5Zm2 2v10h14V7H5Zm2 2 3 3-3 3-1.4-1.4L7.2 12 5.6 10.4 7 9Zm4 5h5v2h-5v-2Z" fill="currentColor"/>', ["command", "shell", "命令"]),
  icon("ssh", "SSH", "通用", "6856C7", '<path d="M8 3a5 5 0 0 1 4.6 7H21v4h-2v2h-3v2h-4.4A5 5 0 1 1 8 3Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm4.4 7-.8 2H14v-2h-1.6Z" fill="currentColor"/>', ["tunnel", "隧道", "key"]),
  icon("link", "链接", "通用", "0B7F5A", '<path d="M10.6 13.4a2 2 0 0 0 2.8 0l3-3a2 2 0 1 0-2.8-2.8l-1.3 1.3-1.4-1.4 1.3-1.3a4 4 0 1 1 5.6 5.6l-3 3a4 4 0 0 1-5.6 0l1.4-1.4Zm2.8-2.8a2 2 0 0 0-2.8 0l-3 3a2 2 0 1 0 2.8 2.8l1.3-1.3 1.4 1.4-1.3 1.3a4 4 0 1 1-5.6-5.6l3-3a4 4 0 0 1 5.6 0l-1.4 1.4Z" fill="currentColor"/>', ["route", "反向代理", "域名"]),
  icon("globe", "网络", "通用", "3568D4", '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm5.9 9a8 8 0 0 0-1.4-4H14c.4 1.2.7 2.6.8 4h3.1Zm-5.1 0c-.1-1.5-.4-2.8-.8-4-.4 1.2-.7 2.5-.8 4h1.6Zm-3.6 0c.1-1.4.4-2.8.8-4H7.5a8 8 0 0 0-1.4 4h3.1Zm-3.1 2a8 8 0 0 0 1.4 4H10a16 16 0 0 1-.8-4H6.1Zm5.1 0c.1 1.5.4 2.8.8 4 .4-1.2.7-2.5.8-4h-1.6Zm3.6 0c-.1 1.4-.4 2.8-.8 4h2.5a8 8 0 0 0 1.4-4h-3.1Z" fill="currentColor"/>', ["web", "network", "网站"]),
  icon("database", "数据库", "通用", "6856C7", '<path d="M12 3c5 0 8 1.5 8 3.5v11C20 19.5 17 21 12 21s-8-1.5-8-3.5v-11C4 4.5 7 3 12 3Zm6 3.5C18 5.9 15.7 5 12 5s-6 .9-6 1.5S8.3 8 12 8s6-.9 6-1.5ZM6 9v3c.8.6 3 1.2 6 1.2s5.2-.6 6-1.2V9c-1.5.7-3.5 1-6 1S7.5 9.7 6 9Zm0 5v3.3c.6.7 2.8 1.7 6 1.7s5.4-1 6-1.7V14c-1.5.8-3.5 1.2-6 1.2S7.5 14.8 6 14Z" fill="currentColor"/>', ["db", "storage", "存储"]),
  icon("api", "API", "通用", "F59E0B", '<path d="M8.5 4 3 12l5.5 8h2.4l-5.5-8 5.5-8H8.5Zm7 0h-2.4l5.5 8-5.5 8h2.4l5.5-8-5.5-8Z" fill="currentColor"/>', ["接口", "gateway"]),
  icon("code", "代码", "通用", "34443C", '<path d="m8.7 6.3 1.4 1.4L5.8 12l4.3 4.3-1.4 1.4L3 12l5.7-5.7Zm6.6 0L21 12l-5.7 5.7-1.4-1.4 4.3-4.3-4.3-4.3 1.4-1.4Z" fill="currentColor"/>', ["developer", "开发"]),
  icon("folder", "项目", "通用", "D97706", '<path d="M3 5h7l2 2h9v12H3V5Zm2 2v10h14V9h-7.8l-2-2H5Z" fill="currentColor"/>', ["project", "目录"]),
  icon("openclaw", "OpenClaw", "AI", "E94242", '<path d="M12 3C6.8 3 4 7.1 4 11c0 3.6 2.4 7 5.3 8v2h2v-1.5c.5.1 1 .1 1.5 0V21h2v-2c2.9-1 5.2-4.4 5.2-8 0-3.9-2.8-8-8-8Z" fill="currentColor"/><path d="M5.2 9.1C2.5 8.5 1.7 10.5 2.6 12c.9 1.5 2.6.7 3.4-1 .5-1 .1-1.7-.8-1.9Zm13.6 0c2.7-.6 3.5 1.4 2.6 2.9-.9 1.5-2.6.7-3.4-1-.5-1-.1-1.7.8-1.9Z" fill="currentColor"/><circle cx="9" cy="9" r="1.2" fill="#17211c"/><circle cx="15" cy="9" r="1.2" fill="#17211c"/>', ["claw", "龙虾", "agent"]),
  icon("hermes", "Hermes", "AI", "8A662B", '<path d="M12 3c2.4 0 4 1.5 4 3.7 0 1.8-1 3-2.6 3.6V12H16v2h-2.6v2H16v2h-2.6v3h-2v-3H8v-2h3.4v-2H8v-2h3.4v-1.7C9.6 9.8 8.5 8.5 8.5 6.7 8.5 4.5 9.9 3 12 3Zm0 2c-.9 0-1.5.6-1.5 1.7 0 1 .6 1.7 1.7 1.7S14 7.7 14 6.7C14 5.6 13.2 5 12 5Z" fill="currentColor"/>', ["nous", "agent", "AI"])
];

const brands = [
  ["openai", "openaigym", "OpenAI", "AI", ["ChatGPT", "GPT"]],
  ["anthropic", "anthropic", "Anthropic", "AI", ["Claude"]],
  ["gemini", "googlegemini", "Google Gemini", "AI", ["Google AI"]],
  ["deepseek", "deepseek", "DeepSeek", "AI", []],
  ["mistral", "mistralai", "Mistral AI", "AI", []],
  ["openrouter", "openrouter", "OpenRouter", "AI", []],
  ["ollama", "ollama", "Ollama", "AI", ["本地模型"]],
  ["huggingface", "huggingface", "Hugging Face", "AI", []],
  ["perplexity", "perplexity", "Perplexity", "AI", []],
  ["docker", "docker", "Docker", "开发", ["container", "容器"]],
  ["nodejs", "nodedotjs", "Node.js", "开发", ["node"]],
  ["caddy", "caddy", "Caddy", "开发", ["proxy", "反向代理"]],
  ["github", "github", "GitHub", "开发", []],
  ["gitlab", "gitlab", "GitLab", "开发", []],
  ["bitbucket", "bitbucket", "Bitbucket", "开发", []],
  ["git", "git", "Git", "开发", []],
  ["github-actions", "githubactions", "GitHub Actions", "开发", ["CI"]],
  ["jenkins", "jenkins", "Jenkins", "开发", ["CI"]],
  ["python", "python", "Python", "开发", []],
  ["typescript", "typescript", "TypeScript", "开发", ["TS"]],
  ["javascript", "javascript", "JavaScript", "开发", ["JS"]],
  ["go", "go", "Go", "开发", ["Golang"]],
  ["rust", "rust", "Rust", "开发", []],
  ["php", "php", "PHP", "开发", []],
  ["bun", "bun", "Bun", "开发", []],
  ["deno", "deno", "Deno", "开发", []],
  ["npm", "npm", "npm", "开发", []],
  ["pnpm", "pnpm", "pnpm", "开发", []],
  ["yarn", "yarn", "Yarn", "开发", []],
  ["vite", "vite", "Vite", "开发", []],
  ["react", "react", "React", "前端", []],
  ["vue", "vuedotjs", "Vue.js", "前端", []],
  ["svelte", "svelte", "Svelte", "前端", []],
  ["nextjs", "nextdotjs", "Next.js", "前端", []],
  ["express", "express", "Express", "后端", []],
  ["fastapi", "fastapi", "FastAPI", "后端", []],
  ["django", "django", "Django", "后端", []],
  ["flask", "flask", "Flask", "后端", []],
  ["postgresql", "postgresql", "PostgreSQL", "数据", ["postgres"]],
  ["mysql", "mysql", "MySQL", "数据", []],
  ["mariadb", "mariadb", "MariaDB", "数据", []],
  ["mongodb", "mongodb", "MongoDB", "数据", []],
  ["redis", "redis", "Redis", "数据", []],
  ["sqlite", "sqlite", "SQLite", "数据", []],
  ["elasticsearch", "elasticsearch", "Elasticsearch", "数据", []],
  ["kibana", "kibana", "Kibana", "数据", []],
  ["rabbitmq", "rabbitmq", "RabbitMQ", "数据", []],
  ["kafka", "apachekafka", "Apache Kafka", "数据", []],
  ["nginx", "nginx", "NGINX", "基础设施", ["proxy"]],
  ["cloudflare", "cloudflare", "Cloudflare", "基础设施", []],
  ["vercel", "vercel", "Vercel", "基础设施", []],
  ["supabase", "supabase", "Supabase", "基础设施", []],
  ["google-cloud", "googlecloud", "Google Cloud", "基础设施", ["GCP"]],
  ["digitalocean", "digitalocean", "DigitalOcean", "基础设施", []],
  ["vultr", "vultr", "Vultr", "基础设施", []],
  ["hetzner", "hetzner", "Hetzner", "基础设施", []],
  ["railway", "railway", "Railway", "基础设施", []],
  ["render", "render", "Render", "基础设施", []],
  ["portainer", "portainer", "Portainer", "基础设施", []],
  ["grafana", "grafana", "Grafana", "监控", []],
  ["prometheus", "prometheus", "Prometheus", "监控", []],
  ["home-assistant", "homeassistant", "Home Assistant", "工具", []],
  ["linux", "linux", "Linux", "系统", []],
  ["apple", "apple", "macOS", "系统", ["Apple"]],
  ["ubuntu", "ubuntu", "Ubuntu", "系统", []],
  ["debian", "debian", "Debian", "系统", []]
].map(([id, slug, label, group, aliases]) => {
  const source = bySlug.get(slug);
  if (!source) throw new Error(`Simple Icons 缺少图标：${slug}`);
  return icon(id, label, group, source.hex, `<path d="${source.path}" fill="currentColor"/>`, aliases);
});

const icons = [...generic, ...brands];
const output = `// Generated by scripts/generate-icon-library.mjs. Do not edit by hand.\n` +
  `export const ICON_LIBRARY = Object.freeze(${JSON.stringify(icons, null, 2)});\n` +
  `export const ICON_BY_ID = new Map(ICON_LIBRARY.map((icon) => [icon.id, icon]));\n`;

fs.writeFileSync(outputPath, output);
console.log(`已生成 ${icons.length} 个本地图标：${outputPath}`);

function icon(id, label, group, hex, svg, aliases = []) {
  return {
    id,
    label,
    group,
    hex: String(hex).replace(/^#/, "").toUpperCase(),
    keywords: [id, label, group, ...aliases].join(" ").toLowerCase(),
    viewBox: "0 0 24 24",
    svg
  };
}
