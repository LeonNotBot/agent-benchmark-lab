export class CreateSessionDto {
  title!: string;
  prompt!: string;
  cwd?: string;
  allowedTools?: string;
}
