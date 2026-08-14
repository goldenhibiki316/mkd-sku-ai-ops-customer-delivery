export type BuildVersion = {
  commit_sha: string;
  branch: string;
  built_at: string;
  working_tree_dirty: boolean;
  application: 'mkd-customer-ops-web';
};

declare const __APP_COMMIT_SHA__: string;
declare const __APP_BRANCH__: string;
declare const __APP_BUILT_AT__: string;
declare const __APP_DIRTY__: boolean;

export function getBuildVersion(
  env: NodeJS.ProcessEnv = process.env,
): BuildVersion {
  return {
    commit_sha: typeof __APP_COMMIT_SHA__ === 'string'
      ? __APP_COMMIT_SHA__
      : env.APP_COMMIT_SHA?.trim() || 'development',
    branch: typeof __APP_BRANCH__ === 'string'
      ? __APP_BRANCH__
      : env.APP_BRANCH?.trim() || 'development',
    built_at: typeof __APP_BUILT_AT__ === 'string'
      ? __APP_BUILT_AT__
      : env.APP_BUILT_AT?.trim() || 'development',
    working_tree_dirty: typeof __APP_DIRTY__ === 'boolean'
      ? __APP_DIRTY__
      : env.APP_WORKTREE_DIRTY === 'true',
    application: 'mkd-customer-ops-web',
  };
}
