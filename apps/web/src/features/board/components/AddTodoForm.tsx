"use client";

import { useState } from "react";

import { Button } from "@pdash/ui/button";
import { Input } from "@pdash/ui/input";

import { useCreateTask } from "../api/mutations";

/** 受信箱に独自 ToDo を追加するフォーム */
export function AddTodoForm() {
  const [title, setTitle] = useState("");
  const createTask = useCreateTask();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask.mutate({ title: trimmed });
    setTitle("");
  };

  return (
    <form onSubmit={handleSubmit} className="mt-1 flex gap-1">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ Todo を追加"
        className="h-8 text-sm"
      />
      <Button
        type="submit"
        size="sm"
        disabled={!title.trim() || createTask.isPending}
      >
        追加
      </Button>
    </form>
  );
}
