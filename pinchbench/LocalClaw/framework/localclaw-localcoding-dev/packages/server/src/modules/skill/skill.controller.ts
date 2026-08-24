import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Inject, HttpException, HttpStatus, Res, Req,
} from "@nestjs/common";
import { SkillService } from "./skill.service";
import type { CreateSkillDto, UpdateSkillDto } from "./dto/skill.dto";

@Controller("api/skills")
export class SkillController {
  constructor(
    @Inject(SkillService) private readonly skillService: SkillService,
  ) {}

  @Get()
  list() {
    return { skills: this.skillService.listSkills() };
  }

  // 静态路由必须在 :name 参数路由之前
  @Post("import-zip")
  importZip(@Req() req: any) {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const buffer = Buffer.concat(chunks);
          if (buffer.length === 0) {
            reject(new HttpException("empty body", HttpStatus.BAD_REQUEST));
            return;
          }
          resolve(this.skillService.importFromZipBuffer(buffer));
        } catch (e: any) {
          reject(new HttpException(
            { message: e.message || String(e) },
            HttpStatus.BAD_REQUEST,
          ));
        }
      });
      req.on("error", (err: any) => reject(
        new HttpException(String(err), HttpStatus.BAD_REQUEST),
      ));
    });
  }

  @Get(":name/export")
  exportSkill(@Param("name") name: string, @Res() res: any) {
    try {
      const { zipBuffer, fileName } = this.skillService.exportSkill(name);
      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      });
      res.send(zipBuffer);
    } catch (e) {
      throw new HttpException(String(e), HttpStatus.NOT_FOUND);
    }
  }

  @Get(":name")
  detail(@Param("name") name: string) {
    const skill = this.skillService.getSkill(name);
    if (!skill) {
      throw new HttpException("Skill not found", HttpStatus.NOT_FOUND);
    }
    return { skill };
  }

  @Post()
  create(@Body() body: CreateSkillDto) {
    if (!body.name || !body.description || !body.content) {
      throw new HttpException(
        "name, description, content required",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const skill = this.skillService.createSkill(body.name, body);
      return { skill };
    } catch (e) {
      throw new HttpException(String(e), HttpStatus.CONFLICT);
    }
  }

  @Put(":name")
  update(@Param("name") name: string, @Body() body: UpdateSkillDto) {
    try {
      const skill = this.skillService.updateSkill(name, body);
      return { skill };
    } catch (e) {
      throw new HttpException(String(e), HttpStatus.NOT_FOUND);
    }
  }

  @Put(":name/disabled")
  setDisabled(
    @Param("name") name: string,
    @Body() body: { disabled?: boolean },
  ) {
    const skill = this.skillService.getSkill(name);
    if (!skill) {
      throw new HttpException("Skill not found", HttpStatus.NOT_FOUND);
    }
    this.skillService.setDisabled(name, body.disabled === true);
    return { success: true, disabled: body.disabled === true };
  }

  @Delete(":name")
  remove(@Param("name") name: string) {
    const ok = this.skillService.deleteSkill(name);
    if (!ok) {
      throw new HttpException("Skill not found", HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }
}
