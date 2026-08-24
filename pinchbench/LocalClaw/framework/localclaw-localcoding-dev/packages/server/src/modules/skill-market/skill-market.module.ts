import { Module } from "@nestjs/common";
import { SkillMarketService } from "./skill-market.service";
import { SkillMarketController } from "./skill-market.controller";
import { SkillModule } from "../skill/skill.module";

@Module({
  imports: [SkillModule],
  controllers: [SkillMarketController],
  providers: [SkillMarketService],
  exports: [SkillMarketService],
})
export class SkillMarketModule {}
