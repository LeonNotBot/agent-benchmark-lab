declare module "mammoth/mammoth.browser" {
  export interface Message {
    type: "warning" | "error";
    message: string;
  }
  export interface ConvertToHtmlResult {
    value: string;
    messages: Message[];
  }
  export interface ExtractRawTextResult {
    value: string;
    messages: Message[];
  }
  interface Mammoth {
    convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<ConvertToHtmlResult>;
    extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
  }
  const mammoth: Mammoth;
  export = mammoth;
}
