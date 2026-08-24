import { describe, it, expect } from "vitest";
import {
  matchesDangerousCommand,
  ACCEPT_EDITS_ASK_RULES,
} from "../dangerous-commands";

describe("matchesDangerousCommand（acceptEdits 高危命令二次确认）", () => {
  it("拦截 rm 删除（单文件、递归、目录）", () => {
    // 单文件删除（1.png 漏网场景）
    expect(matchesDangerousCommand("rm file.txt")).toBe(true);
    expect(matchesDangerousCommand('rm "C:\\path\\to\\file.txt"')).toBe(true);
    expect(matchesDangerousCommand("rm /tmp/test")).toBe(true);
    // 递归删除
    expect(matchesDangerousCommand("rm -rf /")).toBe(true);
    expect(matchesDangerousCommand("rm -fr /tmp/foo")).toBe(true);
    expect(matchesDangerousCommand("rm  -rf   /")).toBe(true); // 多空格
    expect(matchesDangerousCommand("RM -RF /")).toBe(true); // 大小写
    expect(matchesDangerousCommand("rm -r node_modules")).toBe(true); // 递归但无 -f 也确认
    // 删除空目录
    expect(matchesDangerousCommand("rmdir emptydir")).toBe(true);
  });

  it("拦截 git 强制推送", () => {
    expect(matchesDangerousCommand("git push --force")).toBe(true);
    expect(matchesDangerousCommand("git push -f origin main")).toBe(true);
    expect(matchesDangerousCommand("git push --force-with-lease")).toBe(true);
  });

  it("拦截数据库删除类操作（SQL 常大写）", () => {
    expect(matchesDangerousCommand("DROP TABLE users")).toBe(true);
    expect(matchesDangerousCommand("drop database prod")).toBe(true);
    expect(matchesDangerousCommand("TRUNCATE TABLE logs")).toBe(true);
  });

  it("拦截磁盘/格式化操作", () => {
    expect(matchesDangerousCommand("mkfs.ext4 /dev/sdb")).toBe(true);
    expect(matchesDangerousCommand("dd if=/dev/zero of=/dev/sda")).toBe(true);
  });

  it("拦截重定向到磁盘设备（命令中间位置）", () => {
    expect(matchesDangerousCommand("cat foo > /dev/sda")).toBe(true);
    expect(matchesDangerousCommand("echo x > /dev/nvme0n1")).toBe(true);
  });

  it("拦截递归 chmod 777", () => {
    expect(matchesDangerousCommand("chmod -R 777 /var")).toBe(true);
    expect(matchesDangerousCommand("chmod 777 -R .")).toBe(true);
    expect(matchesDangerousCommand("chmod -R a+rwx /opt")).toBe(true);
  });

  it("拦截管道/逻辑运算符后的危险命令", () => {
    expect(matchesDangerousCommand("ls | rm -rf /tmp")).toBe(true);
    expect(matchesDangerousCommand("echo ok && rm -rf build")).toBe(true);
    expect(matchesDangerousCommand("test -d x || rm -rf x")).toBe(true);
    expect(matchesDangerousCommand("foo && git push -f")).toBe(true); // 结尾无参数
  });

  it("放行安全命令", () => {
    expect(matchesDangerousCommand("git push origin main")).toBe(false);
    expect(matchesDangerousCommand("ls -la")).toBe(false);
    expect(matchesDangerousCommand("chmod +x script.sh")).toBe(false);
    expect(matchesDangerousCommand("echo 'drop table' is safe")).toBe(false);
    // ↑ 引号内的关键字不会触发（实现比预想更准确）
    expect(matchesDangerousCommand("cat file.txt")).toBe(false);
  });

  it("防误报：命令名前缀相似但不同", () => {
    expect(matchesDangerousCommand("rmmod some_module")).toBe(false); // 非 rm/rmdir
    expect(matchesDangerousCommand("mkfifo pipe")).toBe(false); // 非 mkfs
    expect(matchesDangerousCommand("git pushd")).toBe(false);
  });

  it("空输入/非法输入安全放行", () => {
    expect(matchesDangerousCommand("")).toBe(false);
    // @ts-expect-error 测试非字符串输入
    expect(matchesDangerousCommand(undefined)).toBe(false);
    // @ts-expect-error 测试非字符串输入
    expect(matchesDangerousCommand(null)).toBe(false);
  });

  it("已知局限：变形攻击可绕过（记录预期行为，非缺陷）", () => {
    // 命令名由子 shell 动态生成，开头不是字面 rm，前缀匹配抓不到（真正的绕过场景）。
    // 用户若担心此类绕过，应切到更严格模式或用 OS 隔离。
    expect(matchesDangerousCommand("$(echo rm) -rf /")).toBe(false);
    expect(matchesDangerousCommand("eval $CMD")).toBe(false); // eval 动态执行
  });

  it("规则集非空且稳定（防误删）", () => {
    expect(ACCEPT_EDITS_ASK_RULES.length).toBeGreaterThan(10);
    expect(ACCEPT_EDITS_ASK_RULES).toContain("rm"); // 通用删除规则
    expect(ACCEPT_EDITS_ASK_RULES).toContain("git push --force");
  });
});
