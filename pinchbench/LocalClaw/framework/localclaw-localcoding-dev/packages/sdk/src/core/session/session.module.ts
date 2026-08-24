import { Module } from "@nestjs/common";
import { SessionService, SESSION_SERVICE } from "./session.service";
import { FileChangeService } from "./file-change.service";
import { ToolDiffService } from "./tool-diff.service";
import { SessionRevertService } from "./session-revert.service";
import { GitModule } from "../git/git.module";

/**
 * 会话能力模块（SDK）。不含 HTTP controller —— REST 路由由宿主产品编排（模式 A）。
 * 宿主需先 import DatabaseModule.forRoot 提供 DATABASE 连接。
 *
 * 同时以 SESSION_SERVICE 令牌 re-provide 同一 SessionService 单例（useExisting），
 * 供对外接入方按 ISessionService 接口注入；SDK 内部仍直接注入具体类。
 */
@Module({
  imports: [GitModule],
  providers: [
    SessionService,
    FileChangeService,
    ToolDiffService,
    SessionRevertService,
    { provide: SESSION_SERVICE, useExisting: SessionService },
  ],
  exports: [SessionService, FileChangeService, ToolDiffService, SessionRevertService, SESSION_SERVICE],
})
export class SessionModule {}
