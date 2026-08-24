/**
 * 主题跟随 VSCode:把 VSCode 的明暗主题同步到现有色板的 data-mode。
 *
 * VSCode 给 webview 的 <body> 加 class:vscode-light / vscode-dark /
 * vscode-high-contrast(暗) / vscode-high-contrast-light。据此设 documentElement
 * 的 data-mode(light/dark),复用 index.css 已有的浅/深两套 HSL 色板——组件零改动
 * 即跟随 VSCode 明暗。用户在 VSCode 里换主题,MutationObserver 实时同步。
 */
function currentVscodeMode(): "light" | "dark" {
  const c = document.body.classList;
  if (c.contains("vscode-light") || c.contains("vscode-high-contrast-light")) return "light";
  return "dark"; // vscode-dark / vscode-high-contrast 及缺省
}

function apply(): void {
  // 色板选择器是 [data-theme=claude][data-mode=dark],两者都要设,否则深色板不生效。
  document.documentElement.setAttribute("data-theme", "claude");
  document.documentElement.setAttribute("data-mode", currentVscodeMode());
}

/** 首次同步 + 监听 VSCode 主题切换。返回取消监听函数。 */
export function syncVscodeTheme(): () => void {
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
