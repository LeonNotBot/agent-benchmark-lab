import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Inject,
  NotFoundException,
  HttpCode,
} from "@nestjs/common";
import { TemplateService } from "./template.service";
import type { Template } from "@lenovo/agent-protocol";

@Controller("api")
export class TemplateController {
  constructor(
    @Inject(TemplateService)
    private readonly templateService: TemplateService,
  ) {}

  @Get("templates")
  list() {
    return { templates: this.templateService.listTemplates() };
  }

  @Get("templates/:slug")
  get(@Param("slug") slug: string) {
    const template = this.templateService.getTemplate(slug);
    if (!template) {
      throw new NotFoundException(`Template "${slug}" not found`);
    }
    return { template };
  }

  @Post("templates")
  save(@Body() body: { template: Omit<Template, "builtin"> }) {
    const template = this.templateService.saveTemplate(body.template);
    return { template };
  }

  @Delete("templates/:slug")
  @HttpCode(200)
  delete(@Param("slug") slug: string) {
    try {
      this.templateService.deleteTemplate(slug);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }
}
