import { useMemo, useState } from "react";
import {
  adoptedBodyNeedsCollapse,
  resolveBranchAdoptSource,
} from "../lib/adoptBranch";
import { useLocale } from "../lib/i18n";
import { findBranchInThread } from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  branchId: string;
  label: string;
  storedBody: string;
}

export function AdoptedClarifyCard({ branchId, label, storedBody }: Props) {
  const { t } = useLocale();
  const thread = useAppStore((s) => s.thread);
  const [expanded, setExpanded] = useState(false);

  const body = useMemo(() => {
    if (thread && branchId) {
      const branch = findBranchInThread(thread, branchId);
      const fromBranch = branch ? resolveBranchAdoptSource(branch).trim() : "";
      if (fromBranch) return fromBranch;
    }
    return storedBody.trim();
  }, [thread, branchId, storedBody]);

  const needsCollapse = adoptedBodyNeedsCollapse(body);
  const open = expanded || !needsCollapse;
  const title = label.trim() || t("fork.adoptedNote");

  return (
    <article
      className={`fn-adopt-card${open ? " is-open" : " is-collapsed"}`}
    >
      <div className="fn-adopt-sparkles" aria-hidden>
        <span>!</span>
        <span>/</span>
        <span>*</span>
      </div>
      <header className="fn-adopt-head">
        <span className="fn-adopt-chip">{t("fork.adopted")}</span>
        <span className="fn-adopt-label">{title}</span>
      </header>
      <div className="fn-adopt-body">
        {body ? (
          <MarkdownBody content={body} skipAdoptedSplit />
        ) : (
          <p className="muted">{t("fork.adoptedEmpty")}</p>
        )}
      </div>
      {needsCollapse ? (
        <button
          type="button"
          className="fn-adopt-toggle"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {open ? t("fork.adoptCollapse") : t("fork.adoptExpand")}
        </button>
      ) : null}
    </article>
  );
}
