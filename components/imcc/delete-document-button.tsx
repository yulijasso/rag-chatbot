"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteKnowledgeDocumentAction } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Delete a knowledge document behind a "type the name to confirm" modal.
 * The delete button stays disabled until the typed text exactly matches the
 * document title — a deliberate guard against accidental deletion.
 */
export function DeleteDocumentButton({
  documentId,
  title,
  onDeleted,
}: {
  documentId: string;
  title: string;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = confirmText.trim() === title.trim();

  function reset() {
    setConfirmText("");
    setError(null);
  }

  function onDelete() {
    if (!matches) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteKnowledgeDocumentAction(documentId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      onDeleted?.();
    });
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <button
          aria-label={`Delete ${title}`}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Delete"
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            This permanently removes the document and its embeddings from the
            knowledge base. This can't be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="text-muted-foreground text-sm" htmlFor="confirm-delete">
            Type <span className="font-medium text-foreground">{title}</span> to
            confirm
          </label>
          <Input
            autoComplete="off"
            id="confirm-delete"
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches) {
                onDelete();
              }
            }}
            placeholder={title}
            value={confirmText}
          />
          {error ? <p className="text-red-500 text-sm">{error}</p> : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={!matches || pending}
            onClick={onDelete}
            type="button"
            variant="destructive"
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
