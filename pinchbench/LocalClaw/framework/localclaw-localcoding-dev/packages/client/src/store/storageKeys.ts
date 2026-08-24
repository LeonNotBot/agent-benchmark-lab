/**
 * 所有 localStorage 键名的统一常量定义。
 * 前缀统一使用 "lc:"。
 */

export const SK = {
  WORKSPACE:            "lc:workspace",
  THEME:                "lc:theme",
  LOCALE:               "lc:locale",
  ROUTING_PREFERENCE:   "lc:routingPreference",
  MODEL_OVERRIDE:       "lc:modelOverride",
  SMART_HYBRID_CONFIG:  "lc:smartHybridConfig",
  SELECTED_MODEL:       "lc:selectedModel",
  DESIGN_MODE:           "lc:designMode",
  DESIGN_PROMPT_ENHANCE: "lc:designPromptEnhance",
  RIGHT_PANEL_WIDTH:    "lc:rightPanelWidth",
  // 文件/审阅左右分栏中「右侧文件列表面板」的宽度(px)
  SPLIT_FILE_LIST_WIDTH: "lc:splitFileListWidth",
  SIDEBAR_WIDTH:        "lc:sidebarWidth",
  SIDEBAR_OPEN:         "lc:sidebarOpen",
  LAST_SESSION_ID:      "lc:lastSessionId",
  SESSION_RUN_CONFIGS:  "lc:sessionRunConfigs",
  QUICK_PHRASES:        "lc:quickPhrases",
  REVIEW_OPTIONS:       "lc:reviewOptions",
  // 汇总卡片「已撤销」轮次的状态 + after 快照（按 roundKey），刷新后恢复撤销↔重新应用
  EDIT_SUMMARY_REVERTS: "lc:editSummaryReverts",
  AUTO_DEPLOY_FORM:     "lc:autoDeployForm",
  // 按会话隔离：记录该会话「进行中」的部署 deployId，供切回时自动恢复订阅
  AUTO_DEPLOY_ACTIVE:   "lc:autoDeployActive",
  // 按会话隔离：记录该会话最近一次部署成功的信息（地址/名称/时间），供下次进入回显
  AUTO_DEPLOY_LAST:     "lc:autoDeployLast",
  // 按会话隔离：记录该会话最近一次部署失败的完整 payload，供切回时还原失败现场
  AUTO_DEPLOY_LAST_FAIL: "lc:autoDeployLastFail",
  PROJECT_PINS:         "lc:projectPins",
  SESSION_PINS:         "lc:sessionPins",
  PROJECT_ALIASES:      "lc:projectAliases",
  PROJECT_HIDDEN:       "lc:projectHidden",
  REGISTERED_PROJECTS:  "lc:registeredProjects",
  CHANNEL_PINS:         "lc:channelPins",
  CHANNEL_ALIASES:      "lc:channelAliases",
  CHANNEL_HIDDEN:       "lc:channelHidden",
  // 开发者工具：流式渲染录制开关。默认关闭，仅需排查流式渲染问题时手动开启。
  DEBUG_RECORDING_ENABLED: "lc:debugRecordingEnabled",
} as const;
