"use client";
import { useState } from "react";
import type { Conversation } from "@/types";
import { cx } from "@/lib/utils";
import { AccountBlock } from "./AuthPanel";

export function Sidebar(props: {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <>
      {props.open && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={props.onClose} />}
      <aside
        className={cx(
          "fixed z-30 flex h-full w-72 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950",
          "transition-transform md:static md:translate-x-0",
          props.open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between p-3">
          <div className="text-sm font-semibold">ChatBinBeo</div>
          <button
            onClick={props.onNew}
            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {props.conversations.length === 0 && (
            <div className="px-2 py-6 text-center text-xs text-neutral-500">Chưa có cuộc trò chuyện nào.</div>
          )}
          {props.conversations.map((c) => (
            <div
              key={c.id}
              className={cx(
                "group mb-1 rounded-lg px-2 py-2 text-sm",
                c.id === props.activeId ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
              )}
            >
              {editingId === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    props.onRename(c.id, draft);
                    setEditingId(null);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </form>
              ) : (
                <button onClick={() => props.onSelect(c.id)} className="block w-full truncate text-left">
                  {c.title}
                </button>
              )}
              <div className="mt-1 hidden gap-2 text-[11px] text-neutral-500 group-hover:flex">
                <button
                  onClick={() => {
                    setEditingId(c.id);
                    setDraft(c.title);
                  }}
                  className="hover:underline"
                >
                  Rename
                </button>
                <button onClick={() => props.onDelete(c.id)} className="hover:underline hover:text-red-500">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-neutral-200 p-3 text-xs dark:border-neutral-800">
          <AccountBlock />
          <button onClick={props.onOpenSettings} className="mt-1 w-full rounded-lg px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900">
            ⚙ Settings
          </button>
          <div className="mt-1 px-2 text-neutral-500">Created by Bin</div>
        </div>
      </aside>
    </>
  );
}
