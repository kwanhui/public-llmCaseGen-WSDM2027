import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

// Renders the markdown the model and the instructor write (bold, lists, short
// headings). Used wherever case text is read rather than edited, so that a
// reader never sees literal asterisks. `className` adjusts size or colour for
// the place it sits in.
export function CaseMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3 text-sm leading-relaxed [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-medium [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-medium [&_p]:my-2 [&_strong]:font-semibold [&_em]:italic [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        className,
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
