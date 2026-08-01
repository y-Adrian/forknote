/**
 * When a new Clarify / Fork turn may start.
 * Main generation may continue in parallel; another branch turn may not.
 */
export function canStartAskBranch(options: {
  loadingMain: boolean;
  loadingBranch: boolean;
}): boolean {
  void options.loadingMain;
  return !options.loadingBranch;
}

/**
 * Whether clearing a pending agent plan is safe when starting Clarify.
 * Never clear a main-turn plan while main is still loading.
 */
export function shouldClearPendingPlanForClarify(options: {
  loadingMain: boolean;
  pendingBranchId?: string | null;
}): boolean {
  if (options.pendingBranchId) return true;
  return !options.loadingMain;
}
