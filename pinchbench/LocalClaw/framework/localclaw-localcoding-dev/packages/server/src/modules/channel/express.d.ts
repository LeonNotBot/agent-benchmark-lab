declare module "express" {
  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    setHeader(name: string, value: string): Response;
  }
}
