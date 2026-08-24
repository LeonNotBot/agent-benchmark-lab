import {
  Controller, Get, Post, Delete, Query,
  Param, Body, Inject, HttpException, HttpStatus,
} from "@nestjs/common";
import { SkillMarketService } from "./skill-market.service";

@Controller("api/market")
export class SkillMarketController {
  constructor(
    @Inject(SkillMarketService) private readonly marketService: SkillMarketService,
  ) {}

  @Get("skills")
  async search(
    @Query("q") query?: string,
    @Query("tag") tag?: string,
  ) {
    const skills = await this.marketService.searchSkills(query, tag);
    return { skills };
  }

  @Post("skills/install")
  async install(@Body() body: { sourceId: string; name: string }) {
    const result = await this.marketService.installSkill(body.sourceId, body.name);
    if (!result.ok) {
      const messages: Record<string, string> = {
        source_not_found: "市场源不存在",
        registry_empty: "无法获取市场列表，请检查网络连接",
        skill_not_found: `未找到技能 "${body.name}"`,
        download_failed: `下载技能失败${result.detail ? `: ${result.detail}` : ""}`,
        validation_failed: `技能格式无效${result.detail ? `: ${result.detail}` : ""}`,
      };
      throw new HttpException(
        { message: messages[result.reason] ?? "安装失败", reason: result.reason },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { success: true, skill: result.skill };
  }

  @Get("sources")
  sources() {
    return { sources: this.marketService.getSources() };
  }

  @Post("sources")
  addSource(@Body() body: { name: string; url: string }) {
    if (!body.name || !body.url) {
      throw new HttpException(
        "name and url required", HttpStatus.BAD_REQUEST,
      );
    }
    const source = this.marketService.addSource(body.name, body.url);
    return { source };
  }

  @Delete("sources/:id")
  removeSource(@Param("id") id: string) {
    const ok = this.marketService.removeSource(id);
    if (!ok) {
      throw new HttpException("Cannot remove source", HttpStatus.BAD_REQUEST);
    }
    return { success: true };
  }

  @Post("refresh")
  async refresh() {
    await this.marketService.refreshAll();
    return { success: true };
  }
}
