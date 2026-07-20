"use client";

import { useRef, useState, useTransition } from "react";
import { createClientAction } from "@/app/(dashboard)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Inline form to create a new client workspace. */
export function CreateClientForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await createClientAction(formData);
          if (res?.error) {
            setError(res.error);
          } else {
            formRef.current?.reset();
          }
        });
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      ref={formRef}
    >
      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
        <Input name="name" placeholder="Client name" required />
        <Input name="objectives" placeholder="Objectives (optional)" />
      </div>
      <Button disabled={pending} type="submit">
        {pending ? "Adding…" : "Add client"}
      </Button>
      {error ? <p className="text-red-500 text-sm">{error}</p> : null}
    </form>
  );
}
