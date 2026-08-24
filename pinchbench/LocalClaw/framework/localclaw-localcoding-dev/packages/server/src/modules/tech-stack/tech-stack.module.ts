import { Module } from "@nestjs/common";
import { TechStackController } from "./tech-stack.controller";
import { TechStackRegistrarService } from "./tech-stack-registrar.service";

@Module({
  controllers: [TechStackController],
  providers: [TechStackRegistrarService],
  exports: [TechStackRegistrarService],
})
export class TechStackModule {}
