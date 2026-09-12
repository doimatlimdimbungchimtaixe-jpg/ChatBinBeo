"use client";
import { useState } from "react";

export function ChatInput(props: { disabled: boolean; generating: boolean; onSend: (t: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || props.disabled || props.generating) return;
    props.onSend(t);
    setText("");
  };
  return (
    <div className="border-t border-neutral-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-800">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Type something… (Enter to send)"
          className="max-h-36 min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-[15px] outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
        {props.generating ? (
          <button onClick={props.onStop} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700">
            Stop
          </button>
        ) : (
          <button
            onClick={send}
            disabled={props.disabled || !text.trim()}
            className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Send
          </button>
        )}
      </div>
      <div className="mx-auto mt-1 max-w-3xl text-center text-[11px] text-neutral-500">
        English only — viết tiếng Việt/ngôn ngữ khác sẽ được nhắc dùng tiếng Anh.
      </div>
    </div>
  );
}
