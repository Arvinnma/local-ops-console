import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hasEnglishTranslation, translateForLocale } from "../public/i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HAN = /[\u3400-\u9fff]/u;

test("every Chinese static label in index.html has an English translation", () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8")
    .replace(/<script\b[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[\s\S]*?<\/style>/giu, "");
  const values = [
    ...[...html.matchAll(/>([^<>]+)</gu)].map((match) => match[1].trim()),
    ...[...html.matchAll(/\b(?:aria-label|title|placeholder)="([^"]+)"/gu)].map((match) => match[1].trim())
  ].filter((value) => value && HAN.test(value));
  const missing = [...new Set(values.filter((value) => {
    const sample = value.replaceAll("{count}", "1").replaceAll("{name}", "Example").replaceAll("{action}", "启动");
    return !hasEnglishTranslation(sample);
  }))];
  assert.deepEqual(missing, []);
});

test("all literal tr() calls have an English translation", () => {
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const values = [...app.matchAll(/\btr\(\s*(["'`])([^\n]*?)\1/gu)]
    .map((match) => match[2])
    .filter((value) => HAN.test(value) && !value.includes("${"));
  const missing = [...new Set(values.filter((value) => {
    const sample = value.replaceAll("{count}", "1").replaceAll("{name}", "Example").replaceAll("{action}", "启动");
    return !hasEnglishTranslation(sample);
  }))];
  assert.deepEqual(missing, []);
});

test("common API validation and dynamic UI errors localize to English", () => {
  const cases = [
    "ID 已存在：example-service",
    "本地端口 1455 已被其他隧道使用",
    "服务 Example 的重启策略无效",
    "服务名称不能为空且不能超过 80 个字符",
    "SSH 端口 不是有效端口",
    "配置文件版本不受支持：9",
    "无法验证 SSH 私钥口令：invalid format",
    "排序保存失败：控制令牌无效，请刷新页面后重试",
    "已启动 2 个服务；1 个服务启动失败",
    "确定删除服务“example”吗？相关进程会被停止。",
    "Docker 容器已重启",
    "请求失败（503）"
  ];
  for (const value of cases) {
    const translated = translateForLocale(value, "en-US");
    assert.equal(HAN.test(translated), false, `${value} -> ${translated}`);
    assert.notEqual(translated, value);
  }
});

test("desktop shell pages provide English text for their Chinese copy", () => {
  for (const file of ["splash.html", "offline.html"]) {
    const html = fs.readFileSync(path.join(ROOT, "desktop", file), "utf8");
    const chineseElements = [...html.matchAll(/<([a-z0-9]+)\b([^>]*)>([^<>]*[\u3400-\u9fff][^<>]*)<\/\1>/giu)];
    for (const [, , attributes, content] of chineseElements) {
      assert.match(attributes, /\bdata-en="[^"]+"/u, `${file}: missing data-en for ${content.trim()}`);
    }
  }
});
