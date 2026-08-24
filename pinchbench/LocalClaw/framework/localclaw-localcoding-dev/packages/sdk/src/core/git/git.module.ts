import { Module } from "@nestjs/common";
import { GitService, GIT_SERVICE } from "./git.service";

@Module({
  providers: [
    GitService,
    { provide: GIT_SERVICE, useExisting: GitService },
  ],
  exports: [GitService, GIT_SERVICE],
})
export class GitModule {}
