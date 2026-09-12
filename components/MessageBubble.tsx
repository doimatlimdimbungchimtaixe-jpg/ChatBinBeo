"use client";
import { useState } from "react";
import type { Message } from "@/types";

export function MessageBubble(props: {
  message: Message;
  onCopy: (text: string) => void;
  onRegenerate?: () => void;
  isLastAssistant: boolean;
  generating: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = props.message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed md:max-w-[75%] ${
          isUser ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : "bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-100"
        }`}
      >
        <div>{props.message.content || (props.generating ? "…" : "")}</div>
        {!isUser && props.message.content && (
          <div className="mt-2 flex gap-3 text-[11px] opacity-60">
            <button
              onClick={() => {
                props.onCopy(props.message.content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="hover:underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {props.isLastAssistant && props.onRegenerate && (
              <button onClick={props.onRegenerate} disabled={props.generating} className="hover:underline disabled:opacity-40">
                Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
