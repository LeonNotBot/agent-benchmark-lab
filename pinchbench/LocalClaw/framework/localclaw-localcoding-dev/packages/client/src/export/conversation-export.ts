import type { Attachment, StreamMessage } from "@lenovo/agent-protocol";

export type ConversationExportAttachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  base64?: string;
};

export type ConversationExportEntry = {
  role: "user" | "assistant";
  markdown: string;
  attachments?: ConversationExportAttachment[];
};

type UserPromptMessage = Extract<StreamMessage, { type: "user_prompt" }>;
type AssistantMessage = Extract<StreamMessage, { type: "assistant" }>;
type AssistantContent = AssistantMessage["message"]["content"];
type AssistantTextBlock = Extract<AssistantContent[number], { type: "text" }>;

function toExportAttachment(
  attachment: Attachment,
): ConversationExportAttachment {
  return attachment.mimeType.startsWith("image/")
    ? {
        kind: "image",
        name: attachment.name,
        mimeType: attachment.mimeType,
        base64: attachment.base64,
      }
    : {
        kind: "file",
        name: attachment.name,
        mimeType: attachment.mimeType,
      };
}

function isTextBlock(
  block: AssistantContent[number],
): block is AssistantTextBlock {
  return block.type === "text";
}

function isUserPromptMessage(
  message: StreamMessage,
): message is UserPromptMessage {
  return message.type === "user_prompt";
}

function isAssistantMessage(
  message: StreamMessage,
): message is AssistantMessage {
  return message.type === "assistant";
}

function normalizeAssistantText(content: AssistantContent | undefined): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");
}

function formatDateLabel(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[-\s]+|[-\s]+$/g, "");
}

export function buildConversationExportEntries(
  messages: StreamMessage[],
): ConversationExportEntry[] {
  const entries: ConversationExportEntry[] = [];

  for (const message of messages) {
    if (isUserPromptMessage(message)) {
      const attachments = (message.attachments ?? []).map(toExportAttachment);
      entries.push({
        role: "user",
        markdown: message.prompt,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      continue;
    }

    if (isAssistantMessage(message)) {
      const markdown = normalizeAssistantText(message.message?.content);
      if (markdown) {
        entries.push({ role: "assistant", markdown });
      }
    }
  }

  return entries;
}

export function buildConversationPdfFilename(
  title: string | undefined,
  now = new Date(),
): string {
  const safeTitle = sanitizeTitle(title ?? "") || "session";
  return `${safeTitle}-${formatDateLabel(now)}.pdf`;
}
