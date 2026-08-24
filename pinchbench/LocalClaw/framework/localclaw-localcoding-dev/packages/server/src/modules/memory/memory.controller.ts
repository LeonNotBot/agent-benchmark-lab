import { Controller, Get, Inject } from "@nestjs/common";
import { MemoryService } from "./memory.service";

@Controller("api/memory")
export class MemoryController {
  constructor(
    @Inject(MemoryService) private readonly memoryService: MemoryService,
  ) {}

  @Get("files")
  listFiles() {
    return { files: this.memoryService.listMemoryFiles() };
  }
}
