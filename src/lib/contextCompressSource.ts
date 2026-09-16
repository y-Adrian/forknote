import type {
  ArchiveSnapshot,
  ChatSession,
  FeedbackEvent,
  ThreadRoot,
} from "../types";
import {
  buildArchiveSource,
  buildCompressDeltaAfterArchive,
  capArchiveSource,
  resolveBaseArchive,
} from "./archive";
import { formatArchiveDraftAsCompressSource } from "./contextMemory";

export function buildCompressSource(
  thread: ThreadRoot,
  options?: {
    feedbackLog?: FeedbackEvent[] | null;
    /** Prefer this archive draft (+ post-archive delta) over raw full thread. */
    archive?: ArchiveSnapshot | null;
  },
): string {
  const archive = options?.archive ?? null;
  if (archive?.content.trim()) {
    const draftPart = formatArchiveDraftAsCompressSource(archive.content);
    const delta = buildCompressDeltaAfterArchive(archive, thread, {
      feedbackLog: options?.feedbackLog,
    });
    return capArchiveSource(
      delta ? `${draftPart}\n\n${delta}` : draftPart,
    );
  }
  return capArchiveSource(
    buildArchiveSource(thread, { feedbackLog: options?.feedbackLog }),
  );
}

/** Resolve best archive to reuse for Compress (active, else latest). */
export function resolveCompressArchive(
  session?: ChatSession | null,
): ArchiveSnapshot | null {
  return resolveBaseArchive(session?.archives, session?.activeArchiveId);
}
