import type { GenerationOptions, Message } from "@/types";

export interface ChatModelInfo {
  name: string;
  params: string;
  vocabSize: number;
  contextWindow: number;
  location: string;
  usesExternalApi: boolean;
}

/** Abstraction — swap model later by implementing this. */
export interface ChatModel {
  readonly info: ChatModelInfo;
  readonly loaded: boolean;
  load(): Promise<void>;
  generate(messages: Message[], options?: GenerationOptions): Promise<string>;
  stream(messages: Message[], options?: GenerationOptions): AsyncIterable<string>;
  stop(): void;
}

export function messagesToPrompt(messages: Message[]): string {
  return messages
    .map((m) => (m.role === "user" ? `User: ${m.content}` : m.role === "assistant" ? `Assistant: ${m.content}` : m.content))
    .join("\n");
}
