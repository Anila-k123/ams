import { useState } from "react";
import { Button, PopMenu } from "../ui/kit";

export type NewDocKind = "word" | "cell" | "slide";

/** One "Add document" button with the two ways in: upload a file you already have, or create a new
 *  one in the document editor (ONLYOFFICE, docs/ONLYOFFICE_PLAN.md). Used on the Documents page and on
 *  a case's Documents tab. */
export default function AddDocumentButton({ onUpload, onCreate, variant = "primary", size }: {
  onUpload: () => void;
  onCreate: (kind: NewDocKind) => void;
  variant?: "primary" | "ghost";
  size?: "sm";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button variant={variant} size={size} icon="plus" aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>Add document</Button>
      {anchor && (
        <PopMenu anchor={anchor} align="right" width={250} onClose={() => setAnchor(null)} items={[
          { label: "Upload a file", icon: "upload", meta: "From your computer", onClick: onUpload },
          "-",
          { label: "New Word document", icon: "file", meta: "Create in the editor", onClick: () => onCreate("word") },
          { label: "New Excel sheet", icon: "file", meta: "Create in the editor", onClick: () => onCreate("cell") },
          { label: "New PowerPoint", icon: "file", meta: "Create in the editor", onClick: () => onCreate("slide") },
        ]} />
      )}
    </>
  );
}
